/**
 * Signal detection & normalization.
 *
 * A `Signal` is: { id, type, label, evidence, source, weight, timestamp }
 * - type: a category from SIGNAL_TYPES below
 * - source: 'claude' (from a real/SSE hint) | 'local-regex' (offline fallback) | 'scenario' (canned demo)
 * - weight: 0-1, how strongly this single signal counts as evidence
 *
 * Three producers, one shared shape — this is what lets business-rules.js
 * treat live SSE input, the offline regex fallback, and canned demo
 * scenarios identically, rather than three separate ad-hoc code paths.
 */

export const SIGNAL_TYPES = {
  PRICE_SENSITIVITY: 'price_sensitivity',
  FINANCING: 'financing',
  TRADE_IN: 'trade_in',
  FAMILY: 'family',
  PURCHASE_READY: 'purchase_ready',
  INSURANCE: 'insurance',
};

let _signalCounter = 0;
function makeSignal({ type, label, evidence, source, weight }) {
  return { id: `sig_${++_signalCounter}`, type, label, evidence, source, weight, timestamp: Date.now() };
}

// Data-driven version of the regex if-chain that used to live inline in the
// local-fallback branch of analyzeNow() — same detection, same patterns,
// just iterated once instead of six separate if-statements.
const LOCAL_SIGNAL_RULES = [
  { regex: /hinta|kallis|halv|euro|budjetti/, type: SIGNAL_TYPES.PRICE_SENSITIVITY, label: 'Hintaepäily', evidence: 'Hintaan liittyvä maininta transkriptiossa' },
  { regex: /rahoitus|osamaksu|kuukausierä|laina/, type: SIGNAL_TYPES.FINANCING, label: 'Rahoituskiinnostus', evidence: 'Rahoitukseen liittyvä maininta transkriptiossa' },
  // "vaihto" alone (without a word-boundary anchor) also matches inside
  // "vaihtoehto"/"vaihtoehtoja" (alternative/alternatives) — an unrelated,
  // very common Finnish word. That collision was a real bug: a hint or
  // transcript mentioning "hybridivaihtoehtoja" incorrectly fired a
  // trade-in signal despite no trade-in car ever being mentioned.
  { regex: /\bvaihtoauto\w*|vanha|passat|toyota|ford|auto meillä/, type: SIGNAL_TYPES.TRADE_IN, label: 'Vaihtoauto', evidence: 'Vaihtoautoon liittyvä maininta transkriptiossa' },
  { regex: /lapsi|perhe|isofix|tilaa|tavaratila|mökki/, type: SIGNAL_TYPES.FAMILY, label: 'Perhetarve', evidence: 'Perhetarpeeseen liittyvä maininta transkriptiossa' },
  { regex: /koeajo|kokeilla|testata|istua|tuntuma/, type: SIGNAL_TYPES.PURCHASE_READY, label: 'Ostovalmius', evidence: 'Koeajo-/ostovalmiusmaininta transkriptiossa' },
  { regex: /vakuutus|kasko|liikenne/, type: SIGNAL_TYPES.INSURANCE, label: 'Vakuutuskiinnostus', evidence: 'Vakuutukseen liittyvä maininta transkriptiossa' },
];

export function detectLocalSignals(text) {
  const t = (text || '').toLowerCase();
  return LOCAL_SIGNAL_RULES
    .filter(rule => rule.regex.test(t))
    .map(rule => makeSignal({ type: rule.type, label: rule.label, evidence: rule.evidence, source: 'local-regex', weight: 0.7 }));
}

// Generalizes the exact substring-matching pattern buildTriggers() already
// does (h.title?.includes('RAHOITUS') etc.) into one shared normalizer, so
// the SSE/Claude hint path and the trigger logic stop duplicating the same
// keyword matching independently.
const HINT_TITLE_RULES = [
  { match: /RAHOITUS/, type: SIGNAL_TYPES.FINANCING },
  // \bVAIHTOAUTO\b, not bare VAIHTO — "HYBRIDIVAIHTOEHTOJA" (hybrid
  // ALTERNATIVES) contains "VAIHTO" as a substring and was incorrectly
  // firing a trade-in-vehicle signal despite no trade-in ever being
  // mentioned. Confirmed root cause via a real SSE hint title from live
  // Claude output, not a hypothetical.
  { match: /\bVAIHTOAUTO\b|PASSAT/, type: SIGNAL_TYPES.TRADE_IN },
  { match: /PERHE|MÖKKI/, type: SIGNAL_TYPES.FAMILY },
  { match: /OSTO|KOEAJO/, type: SIGNAL_TYPES.PURCHASE_READY },
  { match: /HINTA|VASTAVÄITE/, type: SIGNAL_TYPES.PRICE_SENSITIVITY },
  { match: /VAKUUTUS/, type: SIGNAL_TYPES.INSURANCE },
];

export function signalsFromHint(hint) {
  const title = hint?.title || '';
  const rule = HINT_TITLE_RULES.find(r => r.match.test(title));
  if (!rule) return null; // e.g. the generic "KUUNTELE" fallback hint carries no signal
  return makeSignal({ type: rule.type, label: title, evidence: hint.text, source: 'claude', weight: 1.0 });
}

// Emits a Signal straight from a demo scenario's own `signal:` field, so
// canned demos flow through the identical pipeline as live/SSE input rather
// than being special-cased.
const SCENARIO_SIGNAL_TYPE = {
  'Hintaepäily': SIGNAL_TYPES.PRICE_SENSITIVITY,
  'Rahoituskiinnostus': SIGNAL_TYPES.FINANCING,
  'Perhetarve': SIGNAL_TYPES.FAMILY,
  'Ostosignaali': SIGNAL_TYPES.PURCHASE_READY,
  'Vaihtoauto': SIGNAL_TYPES.TRADE_IN,
};

export function signalsFromScenario(scenario) {
  const type = SCENARIO_SIGNAL_TYPE[scenario?.signal];
  if (!type) return null;
  return makeSignal({ type, label: scenario.signal, evidence: scenario.text, source: 'scenario', weight: 1.0 });
}
