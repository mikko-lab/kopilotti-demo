/**
 * Extracts structured vehicle-ATTRIBUTE preferences (body type, fuel, price
 * range, color) directly from the raw transcript text.
 *
 * This is deliberately separate from signals.js's Signal taxonomy, which
 * only captures buying-PROCESS signals (financing interest, family need,
 * price objection...) and has no channel for "what car do they actually
 * want." Claude's SSE hint titles name attribute categories (VÄRITOIVE,
 * SOPIVA HINTAVÄLI) but the hint pipeline only maps TITLES to signal types
 * (see signals.js's HINT_TITLE_RULES) — the actual stated value (which
 * color, which price range) was previously read nowhere and discarded,
 * which is why the inventory engine fell back to a generic tag match with
 * no connection to what was actually said. Reading straight from the
 * transcript is also LLM-independent: it works identically whether the
 * session is running on live Claude output or the offline local fallback.
 */

const BODY_TYPE_RULES = [
  { regex: /farmari|combi/i, value: 'combi' },
  { regex: /maasturi|suv\b|katumaasturi/i, value: 'suv' },
  { regex: /viistoperä|hatchback/i, value: 'hatchback' },
  { regex: /sedan/i, value: 'sedan' },
  { regex: /tila-?auto|\bmpv\b/i, value: 'mpv' },
  // A bare ALV-deductibility question ("onko alv-vähennyskelpoinen") counts
  // as a pakettiauto request on its own, without needing "pakettiauto" to
  // also be said — VAT deductibility-by-driving-log is specifically a
  // panel-van (N1-class) property (see inventory-engine.js/generate-
  // inventory.js's vatDeductible field), so asking about it is asking about
  // that vehicle category, the same way asking for "farmari" asks for combi.
  { regex: /pakettiauto\w*|hyötyajoneuvo\w*|alv-?vähenn\w*/i, value: 'van' },
];

const FUEL_RULES = [
  // Word-boundary on "bensa"/"bensiini" so it doesn't also match inside an
  // unrelated compound; checked before hybrid/sähkö so "bensa-automaatti"
  // doesn't get shadowed by a later, looser pattern.
  { regex: /\bbensa\w*|\bbensiini\w*/i, value: 'bensiini' },
  { regex: /\bdiesel\w*/i, value: 'diesel' },
  { regex: /ladattava\s*hybridi|plug-?in/i, value: 'ladattava hybridi' },
  // "hybrid" without the trailing -i also occurs (Claude's hint titles use
  // both "HYBRIDIVAIHTOEHTOJA" and "HYBRID-MAHDOLLISUUS" in practice).
  { regex: /\bhybrid\w*/i, value: 'hybridi' },
  { regex: /sähköauto|\bsähkö\b/i, value: 'sähkö' },
];

const COLOR_RULES = [
  { regex: /punaisen?|punainen/i, value: 'punainen' },
  { regex: /sinisen?|sininen/i, value: 'sininen' },
  { regex: /mustan?|musta\b/i, value: 'musta' },
  { regex: /valkoisen?|valkoinen/i, value: 'valkoinen' },
  { regex: /harmaan?|harmaa\b/i, value: 'harmaa' },
  { regex: /hopean?|hopea\b/i, value: 'hopea' },
];

const TRANSMISSION_RULES = [
  { regex: /automaatti\w*/i, value: 'Automaatti' },
  { regex: /manuaali\w*|käsivaihte\w*/i, value: 'Manuaali' },
];

// "Saa olla myös hybridi" (hybrid is ALSO acceptable) states that hybrid is
// one allowed option among others, not the sole required fuel — but a plain
// firstMatch() has no way to represent that distinction and previously
// treated it as a hard requirement. Confirmed with real impact: on the
// exact transcript this was found in, treating "hybridi" as required
// dropped a real 5-vehicle match down to 0. When an optionality marker
// appears shortly before a matched value, that match is skipped (treated
// as absent, not as the stated requirement) rather than hard-filtered on.
const OPTIONALITY_MARKERS = /saa olla myös|myös käy|käy myös|tai myös|voi olla myös|sopii myös/i;
const OPTIONALITY_WINDOW = 30; // chars to look back before a candidate match

// Returns the value of the LAST (furthest-in-text, largest match index)
// non-optionality-marked match across ALL of `rules` — not the first rule
// (in priority/declaration order) that happens to match anywhere in the
// text. The previous version returned as soon as any rule matched, which
// meant an earlier-declared rule (e.g. BODY_TYPE_RULES' combi, declared
// before suv) would win even when the customer's actual final statement in
// the transcript named a different category later on (e.g. "Haluaisin
// farmarin... Itse asiassa mietin että ehkä maasturi olisikin parempi" kept
// resolving to 'combi' because combi is checked first, regardless of where
// in the text each word actually appeared). Scanning every rule and keeping
// the match with the greatest `m.index` makes the most RECENT statement win
// instead, for every category that uses this helper (bodyType, fuel, color,
// transmission). The OPTIONALITY_MARKERS/OPTIONALITY_WINDOW check is
// applied identically to every candidate match, unchanged from before.
function firstMatch(text, rules) {
  let best = null; // { index, value }
  for (const rule of rules) {
    // Use a global copy of the rule's regex so we can walk ALL occurrences
    // in the text, not just the first — without mutating/sharing lastIndex
    // state on the original `rule.regex` object, which is also used
    // elsewhere (e.g. preferenceConflictsInText's rules.find(...).test()).
    const flags = rule.regex.flags.includes('g') ? rule.regex.flags : rule.regex.flags + 'g';
    const globalRegex = new RegExp(rule.regex.source, flags);
    let m;
    while ((m = globalRegex.exec(text)) !== null) {
      const precedingWindow = text.slice(Math.max(0, m.index - OPTIONALITY_WINDOW), m.index);
      if (!OPTIONALITY_MARKERS.test(precedingWindow)) {
        if (!best || m.index > best.index) best = { index: m.index, value: rule.value };
      }
      if (m.index === globalRegex.lastIndex) globalRegex.lastIndex++; // guard against zero-length matches
    }
  }
  return best ? best.value : null;
}

/**
 * Matches Finnish shorthand price ranges where a single "000"/"t" suffix is
 * shared by both numbers ("20-30 000 €", "20-30t", "hintaluokka 20-30 000")
 * as well as fully-spelled-out ranges ("20 000 - 30 000 €"). Returns
 * {min, max} in euros, or null if no range is found.
 */
function extractPriceRange(text) {
  let m = text.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:000|tuhatta|t\b)/i);
  if (m) {
    const min = parseInt(m[1], 10) * 1000;
    const max = parseInt(m[2], 10) * 1000;
    if (min < max) return { min, max };
  }
  m = text.match(/(\d[\d\s]{3,6}\d)\s*[-–]\s*(\d[\d\s]{3,6}\d)\s*€/);
  if (m) {
    const min = parseInt(m[1].replace(/\s/g, ''), 10);
    const max = parseInt(m[2].replace(/\s/g, ''), 10);
    if (min < max) return { min, max };
  }
  return null;
}

/**
 * "alle 100 000 km", "alle 100t km", "alle 100 tuhatta km", "max 80000 km",
 * "korkeintaan 150 000 km" — a stated upper bound on mileage. Two patterns,
 * same split as extractPriceRange: fully-spelled-out digits vs. shorthand
 * with a "000/tuhatta/t" multiplier suffix.
 */
function extractMaxMileage(text) {
  let m = text.match(/(?:alle|maksimissaan|max|korkeintaan)\s*(\d[\d\s]{2,6}\d)\s*km/i);
  if (m) return parseInt(m[1].replace(/\s/g, ''), 10);
  m = text.match(/(?:alle|maksimissaan|max|korkeintaan)\s*(\d{1,3})\s*(?:000|tuhatta|t\b)\s*km/i);
  if (m) return parseInt(m[1], 10) * 1000;
  return null;
}

/**
 * "Maksimissaan 5 vuotta vanha", "korkeintaan 3 vuotta vanha", "alle 5
 * vuotta vanha" — an upper bound on the car's age, converted to a minimum
 * model year (this year minus N). Symmetric to extractMaxMileage. Deliberately
 * requires "vuotta vanha" adjacent to the number — bare "vanha" is excluded
 * from LOCAL_SIGNAL_RULES' trade-in detection for the identical reason (see
 * signals.js): "<N> vuotta vanha" describes the car being bought, not an
 * existing one being traded in, and the two extractions must agree on that.
 */
function extractMinYear(text) {
  const m = text.match(/(?:alle|maksimissaan|max|korkeintaan)\s*(\d{1,2})\s*vuotta\s*vanha/i);
  if (!m) return null;
  return new Date().getFullYear() - parseInt(m[1], 10);
}

/**
 * @returns {{bodyType: string|null, fuel: string|null, color: string|null,
 *            transmission: string|null, priceMin: number|null, priceMax: number|null,
 *            maxMileage: number|null, minYear: number|null}}
 *          Every field is null when nothing was found — never guesses.
 */
export function extractVehiclePreferences(text) {
  const t = (text || '');
  const range = extractPriceRange(t);
  return {
    bodyType: firstMatch(t, BODY_TYPE_RULES),
    fuel: firstMatch(t, FUEL_RULES),
    color: firstMatch(t, COLOR_RULES),
    transmission: firstMatch(t, TRANSMISSION_RULES),
    priceMin: range?.min ?? null,
    priceMax: range?.max ?? null,
    maxMileage: extractMaxMileage(t),
    minYear: extractMinYear(t),
  };
}

export function hasAnyPreference(prefs) {
  if (!prefs) return false;
  return !!(prefs.bodyType || prefs.fuel || prefs.color || prefs.transmission || prefs.priceMin != null || prefs.priceMax != null || prefs.maxMileage != null || prefs.minYear != null);
}

// Every categorical attribute (not price, which is a range rather than a
// discrete value — see the note on preferenceConflictsInText) is checked
// the same generic way, so a mismatch in body type or color gets caught
// exactly like the fuel mismatch that prompted this — not a fuel-only
// patch that leaves the other three attributes silently unchecked.
const CATEGORY_RULES = {
  bodyType: BODY_TYPE_RULES,
  fuel: FUEL_RULES,
  color: COLOR_RULES,
  transmission: TRANSMISSION_RULES,
};
const CATEGORY_LABEL_FI = { bodyType: 'korityyppi', fuel: 'polttoaine', color: 'väri', transmission: 'vaihteisto' };

/**
 * Generic version of the original fuel-only check: for EVERY category the
 * customer stated a preference for (body type, fuel, color, transmission),
 * does `text` (a hint's title+text combined) explicitly name a DIFFERENT
 * value in that same category? Returns one entry per conflicting category,
 * e.g. a hint that proposes both a hybrid AND a different body type against
 * a customer who asked for petrol+combi returns two conflicts, not one.
 *
 * Deliberately an existence check across ALL of a category's rules, not
 * "extract the one value this text is about" — a real observed hint text
 * was "RAV4 Hybrid on tehokas ja taloudellinen, mutta bensiinivara
 * rajallinen", which mentions BOTH "Hybrid" and "bensiini" in one sentence.
 * Picking "the first/primary value mentioned" (extractVehiclePreferences'
 * normal firstMatch behavior) would have resolved to "bensiini" there and
 * silently missed the actual hybrid suggestion, since the bensiini rule
 * sorts first. Checking "is ANY non-stated value mentioned" catches it
 * regardless of rule order.
 *
 * Price range is intentionally NOT covered here: it's a numeric range, not
 * one of a fixed set of categorical values, so "does the text mention a
 * conflicting price" would need parsing arbitrary standalone euro amounts
 * in free text and comparing bounds — a meaningfully different, more
 * fragile problem than a rule-lookup, and not something observed as an
 * actual failure mode across any of the real API runs checked so far. Left
 * as a known, explicit gap rather than a silent one.
 */
export function preferenceConflictsInText(text, statedPreferences) {
  if (!text || !statedPreferences) return [];
  const conflicts = [];
  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    const stated = statedPreferences[category];
    if (!stated) continue;
    const conflicting = rules.find(r => r.value !== stated && r.regex.test(text));
    if (conflicting) conflicts.push({ category, categoryLabel: CATEGORY_LABEL_FI[category], stated, mentioned: conflicting.value });
  }
  return conflicts;
}

export const BODY_TYPE_LABEL_FI = { combi: 'farmari', suv: 'maasturi', hatchback: 'viistoperä', sedan: 'sedan', mpv: 'tila-auto', van: 'pakettiauto' };
