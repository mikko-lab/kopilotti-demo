import { detectLocalSignals, signalsFromHint, signalsFromScenario } from './signals.js';
import { runBusinessRules } from './business-rules.js';
import { unmatchedSignalLabels, preferencesExcludedEverything, loadInventory, checkNamedModelClaim } from './inventory-engine.js';
import { extractVehiclePreferences, preferenceConflictsInText } from './vehicle-preferences.js';
import { createGauge } from './gauge.js';
import { HashChainedAuditLog } from './audit-log.js';

const SCENARIOS = {
  hinta: {
    text: 'No tää hinta tuntuu vähän korkeelta... Netissä katsoin että vastaavia on halvemmalla. En tiedä onko tää auton arvoinen.',
    hints: [
      { type: 'blue', icon: '📊', title: 'HINTAVERTAILU', text: 'Markkinalla ei vastaavaa alle 32 500 € tällä varustelulla. Näytä vertailu asiakkaalle.', action: 'Näytä vertailu' },
      { type: 'yellow', icon: '⚠️', title: 'VASTAVÄITE', text: 'Asiakas vertaa eri varustelutasoon — kysy mitä autoja hän on katsonut.', action: 'Kysy lisää' },
    ],
    meter: 38, meterDesc: 'Epävarma — hintaepäily', cars: [1,3,4], signal: 'Hintaepäily'
  },
  rahoitus: {
    text: 'Meillä on jo yksi auto lainassa. Pitäisi katsoa onko järkevä kuukausierä. Rahoitushan teillä onnistuu?',
    hints: [
      { type: 'green', icon: '💳', title: 'RAHOITUSMAHDOLLISUUS', text: 'Asiakas haluaa osamaksun. Ehdota joustavaa rahoituspakettia — kuukausierä alkaen 289 €/kk.', action: 'Laske erä' },
      { type: 'blue', icon: '🛡️', title: 'YHDISTELMÄTARJOUS', text: 'Rahoituspaketti + kaskovakuutus = vahva paketti. Poistaa viimeisimmät epäilykset.', action: 'Näytä paketti' },
    ],
    meter: 62, meterDesc: 'Kiinnostunut — rahoitus auki', cars: [3,2,6], signal: 'Rahoituskiinnostus'
  },
  perhe: {
    text: 'Meillä on kolme lasta, nuorin on 2-vuotias. Pitää olla tilaa ja turvalliset turvavyöt takapenkillä. Käydään kesällä mökillä usein.',
    hints: [
      { type: 'green', icon: '👨‍👩‍👧', title: 'PERHEAUTO', text: 'ISOFIX + 3 turvavyötä taka. Volvo XC60 ja RAV4 sopivat täydellisesti — tarkista saatavuus.', action: 'Näytä perheautot' },
      { type: 'yellow', icon: '🏕️', title: 'MÖKKIMATKAT', text: 'Mökkiajelu mainittiin — kysy tarvitaanko vetokoukku. Lisää myyntivaltti.', action: 'Kysy vetokoukusta' },
    ],
    meter: 71, meterDesc: 'Vahva tarve — sopivat autot olemassa', cars: [1,2,6], signal: 'Perhetarve'
  },
  osto: {
    text: 'Kyllä tää tuntuu hyvältä. Tää on just semmonen mitä hain. Pitää kattoo vielä vakuutukset mutta muuten näyttää selvältä.',
    hints: [
      { type: 'green', icon: '🤝', title: 'OSTOVALMIS', text: 'Asiakas on lähellä päätöstä. Ehdota koeajoa nyt — älä anna lähteä ilman sitoutumisenmerkkiä.', action: 'Ehdota koeajoa' },
      { type: 'blue', icon: '🛡️', title: 'VAKUUTUS', text: 'Meillä on valmiiksi kilpailutettu kaskovakuutus. Ota puheeksi heti — poistaa viimeisen esteen.', action: 'Esitä kaskovakuutus' },
    ],
    meter: 89, meterDesc: 'Erittäin korkea — toimi nyt', cars: [1,5,2], signal: 'Ostosignaali'
  },
  vaihto: {
    text: 'Meillä on se vanha Passat mikä pitäisi saada vaihdossa. 2017 malli, noin 140 000 kilometriä. Se on ihan ok kunnossa.',
    hints: [
      { type: 'yellow', icon: '🔄', title: 'VAIHTOAUTO', text: 'Kysy heti: moottori, huoltohistoria, onko vahinkoja? Tarvitset tiedot hyvityshinnan laskemiseen.', action: 'Kysy lisätiedot' },
      { type: 'blue', icon: '📉', title: 'PASSAT 2017 ARVO', text: 'Passat -17 / 140tkm markkina-arvo n. 9 500–11 500 € kunnosta riippuen. Aloita 9 800 €:sta.', action: 'Laske hyvitys' },
    ],
    meter: 54, meterDesc: 'Harkitsee — vaihtokauppa avain', cars: [3,4,1], signal: 'Vaihtoauto'
  },
  pakettiauto: {
    text: 'Etsimme yritykselle pakettiautoa, tarvitsemme alv-vähennyskelpoisen. Budjetti noin 20-30 000 €.',
    hints: [
      { type: 'green', icon: '📦', title: 'PAKETTIAUTO + ALV', text: 'Asiakas etsii pakettiautoa yritykselle. ALV-vähennyskelpoisuus (ajopäiväkirjan mukaan) on vahva myyntivaltti — korosta sitä.', action: 'Näytä pakettiautot' },
      { type: 'blue', icon: '💼', title: 'YRITYSASIAKAS', text: 'Yritysasiakkaalle kannattaa mainita myös rahoitusvaihtoehdot ja alv-vähennys hankintahinnasta.', action: 'Kerro rahoituksesta' },
    ],
    // No signal: mapping in SCENARIO_SIGNAL_TYPE (signals.js) — deliberately.
    // This scenario's recommendations come from the vehicle-preferences.js
    // bodyType=van hard filter, not the old buying-process signal-tag
    // scheme (which has no category for "wants a van" and shouldn't be
    // forced into one). "Budjetti" in the transcript still produces a
    // genuine price_sensitivity signal via the local regex path.
    meter: 68, meterDesc: 'Yritysasiakas — selkeä tarve', cars: [], signal: 'Pakettiauto'
  },
  whatsapp: {
    // Demonstrates that the analysis pipeline is channel-agnostic: this
    // transcript never touches SpeechRecognition or the Web Speech API at
    // all, it's a WhatsApp-style text thread (customer + myyjä turns, plus
    // media the myyjä sends mid-conversation) fed into the exact same
    // extractVehiclePreferences()/runBusinessRules()/inventory pipeline
    // used for the voice scenarios above — same as a live mic session, just
    // with `currentTranscript` populated from a chat log instead of speech.
    // The opening line mirrors how a real dealer's "Lähetä WhatsApp-viesti"
    // link pre-fills the customer's first message (rekisterinumero +
    // toimipiste), which is genuinely how these conversations start today.
    //
    // Deliberately NOT a real WhatsApp Business API integration (no
    // webhook, no Meta account, no live message sending) — see the
    // "Miksi Kopilotti on tehty" section of the README for why remote,
    // text-first sales conversations are the actual scenario this models.
    //
    // Media the myyjä sends (tyres, windshield, service-book page, a short
    // video) are represented as plain transcript events, not files Claude
    // or the local fallback actually inspects — Kopilotti flags THAT media
    // was sent and reminds the myyjä what to verify, it does not grade the
    // vehicle's condition from the photo itself (see KUVAT-hint below: it
    // is a workflow reminder, not a condition verdict).
    text: 'Hei! Minua kiinnostaa auto rekisterinumerolla: HJK-482 - Toimipiste: Tampere. Onko se vielä myynnissä? Myyjä: Hei ja kiitos viestistä! Kyllä on, Skoda Octavia Combi ladattava hybridi. Miten voin auttaa? Asiakas: Etsimme farmaria, pitää olla ladattava hybridi jos mahdollista. Hintaluokka 30-45 000 euroa, automaatti ja ajokilometrejä alle 100 000 km. Voisitko lähettää kuvia renkaista, tuulilasista ja huoltokirjasta ennen kuin tulemme koeajolle? Myyjä: Toki, hetkinen. Myyjä lähetti kuvan renkaista edestä ja takaa. Myyjä lähetti kuvan tuulilasista. Myyjä lähetti kuvan huoltokirjan viimeisimmästä sivusta. Myyjä lähetti lyhyen videon autosta. Tässä kuvat ja video, kaikki näyttää siistiltä mutta katsothan itsekin. Asiakas: Kiitos nopeasta vastauksesta, näyttää hyvältä! Paljonko kuukausierä olisi rahoituksella? Myyjä: Lasketaan heti tarjous ja lähetetään tänne. Asiakas: Hyvä, jos numerot näyttää järkeviltä niin voidaan sopia koeajo jo tällä viikolla.',
    hints: [
      { type: 'blue', icon: '📸', title: 'KUVAT JA VIDEO VASTAANOTETTU', text: 'Asiakas pyysi kuvia renkaista, tuulilasista ja huoltokirjasta ennen koeajoa — myyjä lähetti ne. Tarkista itse ennen lähetystä että kuvat vastaavat nykykuntoa, älä luota pelkkään AI-yhteenvetoon.', action: 'Tarkista kuvat' },
      { type: 'green', icon: '💳', title: 'RAHOITUSKIINNOSTUS', text: 'Asiakas kysyi kuukausierää heti kuvien jälkeen — vahva ostosignaali etäkaupassa. Lähetä rahoituslaskelma samaan WhatsApp-ketjuun.', action: 'Lähetä rahoituslaskelma' },
      { type: 'green', icon: '🤝', title: 'KOEAJOPYYNTÖ', text: 'Asiakas on jo valmis sopimaan koeajon tällä viikolla. Varaa aika heti ketjussa kiinni — älä jätä asiakasta odottamaan puhelua.', action: 'Varaa koeajo' },
    ],
    // Uses the existing 'Rahoituskiinnostus' scenario-tag (same string the
    // 'rahoitus' scenario above uses) so signalsFromScenario() maps it to a
    // real FINANCING Signal via SCENARIO_SIGNAL_TYPE (signals.js) — not a
    // new/unmapped label. This matters here specifically: unlike
    // pakettiauto's deliberately-unmapped 'Pakettiauto' tag (that scenario's
    // recommendations come entirely from the bodyType=van hard filter, so an
    // empty Detected Signals panel there is fine), THIS scenario's own
    // meterDesc below claims a strong signal, and the demo scenario path
    // (analyzeScenario's local fallback) never runs detectLocalSignals() or
    // derives signals from the canned `hints` array the way live/SSE input
    // does (see handleSSEEvent's 'hint' case) — the scenario-level tag is
    // the ONLY source of a Signal here, exactly like every other scenario
    // above. Financing was picked over purchase-ready because it's the more
    // concretely stated ask in this transcript ("Paljonko kuukausierä
    // olisi").
    meter: 78, meterDesc: 'Vahva etäostosignaali — kuvat tarkistettu, koeajo sovittu', cars: [], signal: 'Rahoituskiinnostus'
  }
};

// Explicit three-state consent state machine (unknown -> accepted | denied).
// A plain boolean can't represent "customer refused" as distinct from
// "not asked yet" — both used to collapse to `false`, which is what let a
// denied customer's session silently behave the same as one who was never
// asked. Session-only by design: never persisted to localStorage or any
// other storage that would survive a page reload, matching a real consent
// gate's own scope (this tab, this visit).
export const CONSENT_STATE = Object.freeze({ UNKNOWN: 'unknown', ACCEPTED: 'accepted', DENIED: 'denied' });
export let consentState = CONSENT_STATE.UNKNOWN;
function isConsentAccepted() { return consentState === CONSENT_STATE.ACCEPTED; }

let sessionActive=false, timer=null, secs=0;
let hints=[], signals=0, currentTranscript='', currentScenario=null;
let recognition=null;

// Live-mic auto-analyze: re-armed on every recognition result (interim or
// final), fires once speech has paused for AUTO_ANALYZE_DEBOUNCE_MS — the
// silence is the signal, not a fixed poll interval, so a mid-sentence pause
// doesn't fire early and a long sentence doesn't wait needlessly. Only fires
// when there's new *final* content since the last auto-analysis, so
// continuous interim updates alone can't trigger repeat API calls.
let autoAnalyzeTimer = null;
let lastAutoAnalyzedTranscript = '';
const AUTO_ANALYZE_DEBOUNCE_MS = 1800;

// Business-rules input: every signal-producing event (a scenario starting, a
// hint arriving via SSE, the offline regex fallback matching) pushes into
// this array, then triggers a recompute, which also drives the Recommended
// Vehicles card (js/inventory-engine.js, via business-rules.js).
let businessSignals = [];

// Purchase Intent's own value now lives here rather than being read back out
// of a DOM node (the old linear meter's #meterVal/#meterDesc no longer exist
// now that Purchase Intent is a gauge — see updateMeter()).
let currentPurchaseIntent = 0;
let currentMeterDesc = 'Sessio ei käynnissä';

let gaugeIntent = null;
let gaugeConfidence = null;

async function recomputeBusinessRules() {
  const result = await runBusinessRules({
    signals: businessSignals,
    transcriptWordCount: currentTranscript.trim() ? currentTranscript.trim().split(/\s+/).length : 0,
    meterValue: currentPurchaseIntent,
    transcript: currentTranscript,
  });
  console.log('[business-rules]', { signalCount: businessSignals.length, ...result });
  renderRecommendations(result.recommendedVehicles, businessSignals, result.preferences);
  gaugeConfidence?.update(result.confidence);
  renderDetectedSignals(businessSignals);
  renderSuggestedAction(hints);
  return result;
}

const LOCAL_BACKEND_URL = 'http://localhost:3001';
// The Render service created and smoke-tested in the Safe Render Bootstrap
// slice - see render.yaml. The previous production host stopped resolving
// entirely and was replaced; see git history for that URL if ever needed.
const PRODUCTION_BACKEND_URL = 'https://kopilotti-demo-api.onrender.com';

// Pure function, deliberately separated from the module-level BACKEND_URL
// constant below so it's directly unit-testable without needing to control
// the real `location` global. Derives from the page's own origin instead of
// a single hardcoded URL used everywhere — a hardcoded string here
// previously got left pointed at localhost after local testing and shipped
// that way by accident. localhost/127.0.0.1 -> local backend, anything else
// (GitHub Pages, etc.) -> the production backend.
function resolveBackendUrl(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
    ? LOCAL_BACKEND_URL
    : PRODUCTION_BACKEND_URL;
}

const BACKEND_URL = resolveBackendUrl(location.hostname);

// Hash-chained so a tampered/removed entry is detectable after the fact
// (verifyChain()) — makes "Suostumus kirjattu" an actual provable claim
// instead of a toast asserting something no one can check. See
// js/audit-log.js and the ai-transparency-gate proto it's ported from.
const consentAuditLog = new HashChainedAuditLog();

function renderConsentAuditLog() {
  document.getElementById('consentAuditJson').textContent = consentAuditLog.toJSON();
}

// Verifies — via computed style, not trust — that the consent notice was
// actually exposed to the salesperson before treating the obligation as
// satisfied. Mirrors ai-transparency-gate's checkExposedToAssistiveTech():
// host-page CSS, an aria-hidden ancestor, or a zero-size box can all
// silently defeat a consent box that "looks correct" in the markup.
function checkConsentBoxExposed(el) {
  const reasons = [];
  const style = getComputedStyle(el);
  if (style.display === 'none') reasons.push('display:none');
  if (style.visibility === 'hidden' || style.visibility === 'collapse') reasons.push('visibility:hidden');
  if (Number(style.opacity) === 0) reasons.push('opacity:0');
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) reasons.push('zero-size box');
  let node = el;
  while (node) {
    if (node.getAttribute('aria-hidden') === 'true') { reasons.push('aria-hidden="true" on an ancestor'); break; }
    node = node.parentElement;
  }
  return { exposed: reasons.length === 0, reasons };
}

// Enables/disables every control this consent gate covers, in one place, so
// there is exactly one source of truth for "is this control reachable right
// now" instead of scattered ad-hoc disabled= assignments. Native `disabled`
// (not a CSS class / aria-disabled alone) so keyboard tab order and screen
// readers reflect the blocked state for free — a visually "disabled-looking"
// button that's still focusable/activatable would satisfy nothing here.
function applyConsentGateUI() {
  const accepted = isConsentAccepted();
  document.getElementById('btnStart').disabled = !accepted;
  document.getElementById('btnPaste').disabled = !accepted;
  document.querySelectorAll('.scenario-btn[data-scenario]').forEach(btn => { btn.disabled = !accepted; });
  // btnAnalyze's own enabled state otherwise follows the session lifecycle
  // (startSession()/startPasteSession() enable it, an in-flight request
  // temporarily disables it) — only ever force it off here, never force it
  // on, so this gate can't re-enable it ahead of a session actually existing.
  if (!accepted) document.getElementById('btnAnalyze').disabled = true;
}

// Only ever wired to btnGiveConsent's own click handler (see wireEvents) —
// no scenario/session/analysis function may call this itself. That's what
// makes "customer pressed the explicit accept button" the one and only path
// to CONSENT_STATE.ACCEPTED, per spec.
async function giveConsent() {
  // Idempotent guard against a double-invocation (e.g. a rapid double-click
  // before the button's own disabled state below takes visual effect)
  // logging two PASS entries for one user action. Set synchronously, before
  // any `await` below, so a second call queued on the event loop always
  // observes ACCEPTED here and returns before reaching the log append.
  if (isConsentAccepted()) return;

  const consentBox = document.getElementById('consentBox');
  const exposure = checkConsentBoxExposed(consentBox);

  if (!exposure.exposed) {
    // Refuse rather than silently accept a consent we can't prove was seen —
    // same "refuse-don't-guess" stance as the other guardrail checks. State
    // stays exactly as it was (unknown or denied) — this is not a grant.
    await consentAuditLog.append({ eventType: 'customer_consent', stage: 'CONSENT_GIVEN', verdict: 'BLOCK', payload: { reasons: exposure.reasons } });
    renderConsentAuditLog();
    showToast('⚠️ Suostumusnäkymä ei ollut näkyvissä — suostumusta ei voitu vahvistaa');
    return;
  }

  consentState = CONSENT_STATE.ACCEPTED;
  await consentAuditLog.append({ eventType: 'customer_consent', stage: 'CONSENT_GIVEN', verdict: 'PASS', payload: { reasons: ['consent box exposed and acknowledged'] } });
  renderConsentAuditLog();

  consentBox.style.display='none';
  document.getElementById('statusSub').textContent='Suostumus saatu — valmis';
  applyConsentGateUI();
  showToast('✅ Suostumus kirjattu');
}

async function denyConsent() {
  consentState = CONSENT_STATE.DENIED;
  await consentAuditLog.append({ eventType: 'customer_consent', stage: 'CONSENT_DENIED', verdict: 'BLOCK', payload: { reasons: ['asiakas kieltäytyi'] } });
  renderConsentAuditLog();

  // Defensive cleanup, not just a state flip: denial can in principle arrive
  // while a session is already active (e.g. a customer revoking mid-session
  // in a future UI), so stopSession()'s own timer/recognition/auto-analyze
  // teardown must actually run here rather than assuming today's UI flow is
  // the only way this function is ever reached.
  if (sessionActive) stopSession();
  if (autoAnalyzeTimer) { clearTimeout(autoAnalyzeTimer); autoAnalyzeTimer = null; }

  // denied stays locked out of every gated control until the customer's own
  // explicit accept click — applyConsentGateUI() re-disables everything
  // since consentState is no longer 'accepted'.
  applyConsentGateUI();
  showToast('❌ Suostumus kieltäytyi — sessio peruutettu');
}

function startSession() {
  // Defense in depth alongside btnStart's own disabled= state — a direct
  // call (devtools, a future caller) must fail closed too, never start the
  // microphone without an accepted consent.
  if (!isConsentAccepted()) return;
  sessionActive=true;

  // Reset live-mic session state: currentTranscript is a module-level
  // variable initialized ONCE at page load and only ever appended to by the
  // SpeechRecognition onresult handler (startRecognition, below) — without
  // this reset, stopping and restarting a live-mic session on the same page
  // load carries the previous session's transcript, hints and signals
  // forward into the new one. runScenario()/analyzeScenario()/analyzeNow()
  // already do the equivalent reset for the demo-scenario path (currentTranscript,
  // hints, signals, businessSignals) — this mirrors that for the live-mic
  // path specifically. The scenario path itself is untouched.
  currentTranscript='';
  lastAutoAnalyzedTranscript='';
  hints=[];
  signals=0;
  businessSignals=[];
  showTranscript('');
  document.getElementById('statHints').textContent='0';
  document.getElementById('statSig').textContent='0';
  document.getElementById('pasteBox').classList.add('hidden');
  document.getElementById('transcriptArea').classList.remove('hidden');
  document.getElementById('pasteInput').value='';

  document.getElementById('statusDot').classList.add('active');
  document.getElementById('statusTitle').textContent='Sessio käynnissä';
  document.getElementById('statusSub').textContent='Kuuntelen...';
  document.getElementById('btnStart').classList.add('hidden');
  document.getElementById('btnPaste').classList.add('hidden');
  document.getElementById('btnStop').classList.remove('hidden');
  document.getElementById('btnCRM').classList.remove('hidden');
  document.getElementById('btnAnalyze').disabled=false;
  document.getElementById('wave').classList.remove('hidden');

  timer=setInterval(()=>{
    secs++;
    const m=Math.floor(secs/60), s=secs%60;
    document.getElementById('statTime').textContent=`${m}:${s.toString().padStart(2,'0')}`;
  },1000);

  if ('SpeechRecognition' in window||'webkitSpeechRecognition' in window) {
    startRecognition();
  } else {
    showToast('⚠️ Selain ei tue puheentunnistusta — käytä demo-skenaarioita alla');
    document.getElementById('statusSub').textContent='Puheentunnistus ei tuettu — käytä demo-skenaarioita';
  }
}

// Live text-conversation mode: for when the seller is ALREADY mid-conversation
// with a customer in a real text channel (WhatsApp, web chat, SMS...) and
// wants Kopilotti reading along as it happens, without speaking anything out
// loud. No SpeechRecognition involved at all — the seller pastes/types the
// growing conversation into #pasteInput themselves (see handlePasteInput()
// below), copying new messages over from wherever the real conversation is
// actually happening. Deliberately manual, not an automated read of any
// external app or API — see the README's "Seuraavaksi" section for why a
// live WhatsApp Business API webhook is a separate, much larger piece of
// work than this.
function startPasteSession() {
  // Same defense-in-depth stance as startSession() — see its comment.
  if (!isConsentAccepted()) return;
  sessionActive=true;
  currentScenario=null;

  // Same session-state reset as startSession() above (mic path) — see that
  // function's own comment for why this matters (stale transcript/signals
  // otherwise carrying over from a previous session on the same page load).
  currentTranscript='';
  lastAutoAnalyzedTranscript='';
  hints=[];
  signals=0;
  businessSignals=[];
  document.getElementById('statHints').textContent='0';
  document.getElementById('statSig').textContent='0';

  document.getElementById('transcriptArea').classList.add('hidden');
  document.getElementById('pasteBox').classList.remove('hidden');
  const pasteInput = document.getElementById('pasteInput');
  pasteInput.value='';
  pasteInput.focus();

  document.getElementById('statusDot').classList.add('active');
  document.getElementById('statusTitle').textContent='Sessio käynnissä';
  document.getElementById('statusSub').textContent='Liitä-tila — päivitä keskustelua tekstikenttään sitä mukaa kun se etenee';
  document.getElementById('btnStart').classList.add('hidden');
  document.getElementById('btnPaste').classList.add('hidden');
  document.getElementById('btnStop').classList.remove('hidden');
  document.getElementById('btnCRM').classList.remove('hidden');
  document.getElementById('btnAnalyze').disabled=false;

  timer=setInterval(()=>{
    secs++;
    const m=Math.floor(secs/60), s=secs%60;
    document.getElementById('statTime').textContent=`${m}:${s.toString().padStart(2,'0')}`;
  },1000);
}

// Fires on every edit to the paste box (input event: typing, paste, cut all
// included). currentTranscript is simply SET to the box's current full
// value rather than appended — paste-mode text is edited in place (the
// seller may paste a new chunk in the middle, fix a typo, etc.), unlike
// SpeechRecognition's onresult handler which only ever appends finalized
// segments. Reuses the exact same scheduleAutoAnalyze() debounce used by
// live mic input, so a burst of pasted text settles for
// AUTO_ANALYZE_DEBOUNCE_MS before triggering analysis, same as speech
// pausing.
function handlePasteInput() {
  // Same defense-in-depth stance as startSession() — pasted text must never
  // be picked up for analysis without an accepted consent, regardless of
  // whether the paste box happens to be reachable.
  if (!isConsentAccepted()) return;
  currentScenario=null;
  currentTranscript = document.getElementById('pasteInput').value;
  scheduleAutoAnalyze();
}

function startRecognition() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SR();
  recognition.lang='fi-FI'; recognition.continuous=true; recognition.interimResults=true;
  recognition.onresult=(e)=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal) currentTranscript+=e.results[i][0].transcript+' ';
      else interim=e.results[i][0].transcript;
    }
    showTranscript(currentTranscript+interim);
    scheduleAutoAnalyze();
  };
  recognition.onerror=(e)=>{
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      showToast('❌ Mikrofonilupa evätty — salli mikrofoni selaimen asetuksista');
      document.getElementById('statusSub').textContent='Mikrofonilupa puuttuu';
    } else if(e.error==='no-speech'){
      // Hiljaisuus on normaalia — ei näytetä virhettä, onend hoitaa uudelleenkäynnistyksen
    } else if(e.error==='network'){
      showToast('⚠️ Verkkovirhe puheentunnistuksessa — yritetään uudelleen');
    } else {
      showToast(`⚠️ Puheentunnistuksen virhe: ${e.error}`);
    }
  };
  recognition.onend=()=>{
    // Selaimet (erit. Chrome) katkaisevat tunnistuksen hiljaisuuden jälkeen —
    // käynnistetään automaattisesti uudelleen niin kauan kuin sessio on aktiivinen.
    if(sessionActive){
      try { recognition.start(); }
      catch(err) { setTimeout(()=>{ if(sessionActive) startRecognition(); },300); }
    }
  };
  try { recognition.start(); setBadgeLive('badgeSpeech', true); logEvent('Puheentunnistus käynnistetty', 'ok'); }
  catch(err) { showToast('⚠️ Puheentunnistusta ei voitu käynnistää'); }
}

function scheduleAutoAnalyze() {
  // Auto-analyze is explicitly one of the gated actions (spec section 3) —
  // guarded here too, not just at its callers, so no future call site can
  // silently reintroduce an analysis timer without an accepted consent.
  if (!isConsentAccepted()) return;
  if (autoAnalyzeTimer) clearTimeout(autoAnalyzeTimer);
  autoAnalyzeTimer = setTimeout(() => {
    autoAnalyzeTimer = null;
    if (currentScenario) return; // scenarios drive their own analysis
    if (document.getElementById('btnAnalyze').disabled) return; // analysis already in flight
    const t = currentTranscript.trim();
    if (t.length < 10 || t === lastAutoAnalyzedTranscript.trim()) return;
    lastAutoAnalyzedTranscript = currentTranscript;
    analyzeNow();
  }, AUTO_ANALYZE_DEBOUNCE_MS);
}

function stopSession() {
  sessionActive=false;
  clearInterval(timer);
  if (autoAnalyzeTimer) { clearTimeout(autoAnalyzeTimer); autoAnalyzeTimer=null; }
  if(recognition) recognition.stop();
  document.getElementById('statusDot').classList.remove('active');
  document.getElementById('statusTitle').textContent='Sessio päättynyt';
  document.getElementById('statusSub').textContent=`Kesto: ${document.getElementById('statTime').textContent}`;
  document.getElementById('btnStop').classList.add('hidden');
  document.getElementById('btnStart').classList.remove('hidden');
  document.getElementById('btnPaste').classList.remove('hidden');
  document.getElementById('wave').classList.add('hidden');
  setBadgeLive('badgeSpeech', false);
  showToast('Sessio lopetettu');
}

function showTranscript(text) {
  document.getElementById('transcriptPlaceholder').classList.add('hidden');
  const t=document.getElementById('transcriptText');
  t.classList.remove('hidden');
  t.textContent=text;
}

async function runScenario(key) {
  // Never grants consent itself, under any circumstance — the customer's own
  // explicit accept click (giveConsent(), wired only to btnGiveConsent) is
  // the sole path to CONSENT_STATE.ACCEPTED. A scenario button is also kept
  // `disabled` while not accepted (applyConsentGateUI), so this is defense
  // in depth for a direct call, not the only guard.
  if (!isConsentAccepted()) {
    showToast('⚠️ Pyydä asiakkaalta suostumus ensin');
    return;
  }
  if(!sessionActive){ startSession(); }
  // Defensive, not just startSession()'s own reset: a demo scenario can be
  // launched while a paste-mode session is already active (sessionActive
  // true, so the startSession() call above is skipped) — without this, the
  // scenario would type into the still-hidden transcriptArea while
  // pasteBox stayed on screen. Cheap to always assert the scenario/mic UI
  // state regardless of which mode was active before.
  document.getElementById('pasteBox').classList.add('hidden');
  document.getElementById('transcriptArea').classList.remove('hidden');
  document.getElementById('btnPaste').classList.add('hidden');
  currentScenario=key;
  const s=SCENARIOS[key];
  currentTranscript='';
  showTranscript('');
  logEvent(`Skenaario käynnistetty: ${s.signal}`, 'ok');
  const words=s.text.split(' ');
  let i=0;
  const iv=setInterval(()=>{
    if(i<words.length){ currentTranscript=words.slice(0,i+1).join(' ')+' '; showTranscript(currentTranscript); i++; }
    else { clearInterval(iv); setTimeout(()=>analyzeScenario(s),500); }
  },70);
}

async function analyzeScenario(s) {
  // Reached from runScenario() (already gated) and from analyzeNow()'s
  // currentScenario branch (also already gated) — checked again here so
  // this function is safe to call directly too, never analyzing without an
  // accepted consent regardless of call path.
  if (!isConsentAccepted()) return;
  hints=[]; signals=0;
  businessSignals=[];
  document.getElementById('statHints').textContent='0';

  // Pushed now (so it's present for whichever recompute fires first below),
  // but NOT recomputed/rendered yet — that happens alongside the meter
  // update further down, so the Recommended Vehicles card lands in sync
  // with the rest of the analysis instead of appearing mid-way through the
  // "Claude analysoi..." spinner's own visible window during the offline
  // fallback path.
  const scenarioSignal = signalsFromScenario(s);
  if (scenarioSignal) businessSignals.push(scenarioSignal);

  if (BACKEND_URL && await analyzeWithSSE(s.text)) return;

  // Paikallinen fallback
  document.getElementById('analyzing').classList.add('visible');
  document.getElementById('btnAnalyze').disabled=true;
  await new Promise(r=>setTimeout(r,1200));
  document.getElementById('analyzing').classList.remove('visible');
  document.getElementById('btnAnalyze').disabled=false;
  s.hints.forEach((h,i)=>setTimeout(()=>addHint(h),i*350));
  setTimeout(()=>{ updateMeter(s.meter,s.meterDesc); signals++; document.getElementById('statSig').textContent=signals; logEvent(`Ostohalukkuus päivitetty: ${s.meter}%`, 'ok'); recomputeBusinessRules(); },200);
}

async function analyzeNow() {
  // "Analyysin käynnistäminen" is explicitly gated — checked here directly
  // (not just via btnAnalyze's disabled state) so a direct call can never
  // trigger analysis, local or backend, without an accepted consent.
  if (!isConsentAccepted()) return;
  if(currentScenario) { analyzeScenario(SCENARIOS[currentScenario]); return; }
  if(currentTranscript.length<10) return;

  hints=[]; signals=0;
  businessSignals=[];
  document.getElementById('statHints').textContent='0';

  if (BACKEND_URL && await analyzeWithSSE(currentTranscript)) return;

  // Paikallinen fallback
  document.getElementById('analyzing').classList.add('visible');
  document.getElementById('btnAnalyze').disabled=true;
  await new Promise(r=>setTimeout(r,1100));
  const t=currentTranscript.toLowerCase();
  const localHints=[];
  if(/hinta|kallis|halv|euro|budjetti/.test(t))
    localHints.push({type:'yellow',icon:'💰',title:'HINTAKESKUSTELU',text:'Asiakas pohtii hintaa — kysy budjetti ja tarjoa rahoituslaskelma.',action:'Laske rahoitus'});
  if(/rahoitus|osamaksu|kuukausierä|laina/.test(t))
    localHints.push({type:'green',icon:'💳',title:'RAHOITUSKIINNOSTUS',text:'Rahoitus puheenaiheena — ehdota joustavaa rahoituspakettia.',action:'Näytä paketti'});
  if(/vaihto|vanha|passat|toyota|ford|auto meillä/.test(t))
    localHints.push({type:'blue',icon:'🔄',title:'VAIHTOAUTO',text:'Kysy heti: merkki, vuosi, km-lukema ja kunto hyvityshinnan arvioimiseksi.',action:'Kysy lisätiedot'});
  if(/lapsi|perhe|isofix|tilaa|tavaratila|mökki/.test(t))
    localHints.push({type:'green',icon:'👨‍👩‍👧',title:'PERHETARPEET',text:'Perheauto — nosta esiin ISOFIX, tavaratilan koko ja vetokoukku.',action:'Näytä perheautot'});
  if(/koeajo|kokeilla|testata|istua|tuntuma/.test(t))
    localHints.push({type:'green',icon:'🚗',title:'KOEAJOPYYNTÖ',text:'Asiakas haluaa koeajon — varaa aika heti, se sitouttaa.',action:'Varaa koeajo'});
  if(/vakuutus|kasko|liikenne/.test(t))
    localHints.push({type:'blue',icon:'🛡️',title:'VAKUUTUS',text:'Mainitse kaskovakuutus — valmiiksi kilpailutettu, poistaa viimeisen esteen.',action:'Esitä kaskovakuutus'});
  if(!localHints.length)
    localHints.push({type:'blue',icon:'👂',title:'KUUNTELE',text:'Ei selkeää signaalia vielä — kysy avoimia kysymyksiä: "Mihin käyttöön auto tulee?"',action:'Kysy lisää'});
  localHints.forEach((h,i)=>setTimeout(()=>addHint(h),i*350));
  const meter=(/osto|selvä|hyvä|sopii|otetaan/.test(t)?82:/rahoitus|koeajo/.test(t)?63:/hinta|kallis/.test(t)?38:50);
  setTimeout(()=>{ updateMeter(meter, meter>70?'Vahva ostosignaali':meter>55?'Kiinnostunut':'Harkitsee vielä'); signals++; document.getElementById('statSig').textContent=signals; logEvent(`Ostohalukkuus päivitetty: ${meter}%`, 'ok'); businessSignals.push(...detectLocalSignals(currentTranscript)); recomputeBusinessRules(); },200);
  document.getElementById('analyzing').classList.remove('visible');
  document.getElementById('btnAnalyze').disabled=false;
}

async function analyzeWithSSE(transcript) {
  // The actual backend network call this whole gate exists to prevent
  // without consent — checked here directly (not only at analyzeScenario()/
  // analyzeNow()) so `fetch` is provably never reached on a denied/unknown
  // consent, independent of which caller reached this function.
  if (!isConsentAccepted()) return false;
  document.getElementById('analyzing').classList.add('visible');
  document.getElementById('btnAnalyze').disabled=true;
  let sawServerError = false;
  try {
    const res = await fetch(`${BACKEND_URL}/api/analyze`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({transcript})
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const messages = buffer.split('\n\n');
      buffer = messages.pop();
      for (const msg of messages) {
        let type='', data='';
        for (const line of msg.trim().split('\n')) {
          if (line.startsWith('event: ')) type = line.slice(7).trim();
          if (line.startsWith('data: ')) data = line.slice(6).trim();
        }
        if (type && data) {
          try {
            if (type === 'error') { sawServerError = true; }
            handleSSEEvent(type, JSON.parse(data));
          } catch(_) {}
        }
      }
    }
    // A stream that completes without a network error can still carry an
    // upstream failure (invalid/rate-limited API key, Claude outage) as an
    // 'error' SSE event — treat that the same as a connection failure below,
    // not as success, or the UI silently stalls at stale values with no
    // indication anything went wrong.
    if (sawServerError) throw new Error('server reported analysis error');

    // signalsFromHint() only recognizes a fixed set of Finnish keywords in
    // Claude's HINT titles (RAHOITUS, VAIHTOAUTO, PERHE, ...) — a real,
    // observed transcript ("...vanhan tilalle...", "...hintaluokassa...")
    // produced hint titles that never happened to use any of those words
    // ("BENSIINI-AUTOMAATTI HAKU", "HUOMIO HYBRIDEISTÄ"), so businessSignals
    // stayed empty despite the raw transcript clearly containing a trade-in
    // and a price signal — which cascaded into an empty Detected Signals
    // panel AND Confidence stuck at 0 (computeConfidence returns 0 for an
    // empty signals array). detectLocalSignals() already exists and reads
    // the raw transcript directly rather than going through Claude's lossy
    // hint-title intermediary — previously only ever called on the offline
    // fallback path. Running it here too, for any signal TYPE not already
    // contributed by a Claude hint, closes that gap without double-counting
    // the same evidence twice under two different signal types.
    const alreadyDetectedTypes = new Set(businessSignals.map(s => s.type));
    const supplementalSignals = detectLocalSignals(transcript).filter(s => !alreadyDetectedTypes.has(s.type));
    if (supplementalSignals.length) businessSignals.push(...supplementalSignals);

    setBadgeLive('badgeClaude', true);
    logEvent('Claude-analyysi valmis', 'ok');
    if (supplementalSignals.length) recomputeBusinessRules();
    return true;
  } catch(err) {
    console.warn('Backend ei tavoitettavissa, käytetään paikallista analyysiä:', err.message);
    setBadgeLive('badgeClaude', false);
    logEvent('Backend ei tavoitettavissa — paikallinen analyysi', 'pending');
    showToast('Tekoälyanalyysi ei onnistunut — käytetään paikallista arviota');
    return false;
  } finally {
    document.getElementById('analyzing').classList.remove('visible');
    document.getElementById('btnAnalyze').disabled=false;
  }
}

function handleSSEEvent(type, data) {
  switch(type) {
    case 'hint': {
      addHint(data);
      const hintSignal = signalsFromHint(data);
      if (hintSignal) {
        // Dedupe within a single analysis response: two HINT objects from
        // the same Claude reply can map to the same signal TYPE (see
        // signals.js's signalsFromHint()/HINT_TITLE_RULES), and pushing
        // both would inflate computeConfidence()'s raw signals.length-based
        // avgWeight beyond what the actual distinct signal types warrant.
        // Mirrors the existing alreadyDetectedTypes dedup pattern in
        // analyzeWithSSE() (used there for the local-signal supplement),
        // applied here to Claude's own per-hint signals instead. Only the
        // business-rules signal is deduped — addHint(data) above still runs
        // unconditionally, so every hint Claude returns is still shown to
        // the salesperson as its own card.
        const alreadyHasType = businessSignals.some(s => s.type === hintSignal.type);
        if (!alreadyHasType) {
          businessSignals.push(hintSignal);
          recomputeBusinessRules();
        }
      }
      break;
    }
    case 'meter':
      updateMeter(data.value, data.desc);
      signals++;
      document.getElementById('statSig').textContent=signals;
      logEvent(`Ostohalukkuus päivitetty: ${data.value}%`, 'ok');
      recomputeBusinessRules();
      break;
    case 'cars':
      // The backend's Claude prompt still emits this (unchanged, per spec:
      // Claude integration is not to be modified), but the Recommended
      // Vehicles card is now driven entirely by the deterministic
      // business-rules/inventory-matching pipeline (recomputeBusinessRules,
      // triggered by the 'hint'/'meter' cases above), not by Claude's old
      // raw car-ID list. Intentionally not rendered.
      break;
  }
}

// Bookkeeping only now — individual hint cards no longer render into their
// own list (that whole card is gone). The full history still exists in
// hints[] for buildTriggers()/syncToCRM(), and is used to derive the
// Suggested Next Action shown in the AI Insights card (renderSuggestedAction
// below) plus each entry is logged to the Live Event Timeline.
//
// Logged as "Myyntivihje" (sales tip), never "Aikomus tunnistettu" (customer
// intent detected) — a HINT is Claude's sales advice given the signals so
// far (per the backend system prompt), not a literal transcription of what
// the customer said. Verified empirically: the same test transcript with an
// explicit "bensa" (petrol) request produced a hybrid-alternative HINT in
// 1 of 3 real API calls ("HYBRID-MAHDOLLISUUS") — a genuine, real, if
// occasional, proactive-upsell behavior from Claude, not a text-parsing
// bug. Framing it as "detected intent" would misrepresent the AI's own
// suggestion as a fact about the customer. Checked across ALL stated
// preference categories (fuel, body type, color, transmission — see
// preferenceConflictsInText), not fuel only: the same non-determinism that
// produces a fuel mismatch can just as easily produce a body-type or color
// one, and a fuel-only patch would leave those silently undetected.
//
// Also checked: a hint can name a SPECIFIC real model (checkNamedModelClaim)
// that sounds plausible but doesn't actually satisfy the customer's stated
// hard requirements in real stock — e.g. "Skoda Octavia Combi täyttää
// kriteerit täydellisesti" when the one Octavia in stock has 136 762 km
// against a stated <100 000 km cap. That's a sharper, verifiable-at-a-glance
// version of the same "Claude's suggestion isn't grounded in real inventory"
// problem, worth flagging with the same mechanism rather than a separate one.
// async, called fire-and-forget from handleSSEEvent (hints.push() below
// stays the first, synchronous line so anything reading the `hints` array
// immediately after this call sees the new entry — only the log line at
// the end waits on the inventory check). Was getCachedInventory() (a
// synchronous cache peek, null if not loaded yet) — real-world testing
// (fast scripted clicks, no human pause between page load and the first
// hint) showed the very first hint of a session could genuinely arrive
// before the background loadInventory() fetch resolved, silently skipping
// the model-claim check for that one hint. await loadInventory() here
// removes the race instead of relying on "there's probably enough time.”
async function addHint(h) {
  hints.push(h);
  document.getElementById('statHints').textContent=hints.length;
  const statedPrefs = extractVehiclePreferences(currentTranscript);
  const combinedText = `${h.title || ''} ${h.text || ''}`;
  const conflicts = preferenceConflictsInText(combinedText, statedPrefs);
  const inventory = await loadInventory().catch(() => null);
  const modelClaim = inventory ? checkNamedModelClaim(combinedText, statedPrefs, inventory) : null;

  const warnings = [];
  if (conflicts.length) warnings.push(`asiakas mainitsi ${conflicts.map(c => c.stated).join(', ')}`);
  if (modelClaim && !modelClaim.matchesStock) {
    const why = modelClaim.inStockAtAll ? modelClaim.reasons.join(', ') : 'ei varastossa lainkaan';
    warnings.push(`${modelClaim.brand} ${modelClaim.model} ei täsmää varastoon: ${why}`);
  }
  const label = warnings.length
    ? `Myyntivihje (tarkista ennen käyttöä — ${warnings.join('; ')}): ${h.title}`
    : `Myyntivihje: ${h.title}`;
  logEvent(label, 'ok');
}

// Same green/blue/yellow/red vocabulary the old hint cards used, read here
// as an urgency order for picking ONE hint to surface as the headline
// action: red (urgent) > yellow (warning) > green (opportunity) > blue (info).
const HINT_URGENCY = { red: 3, yellow: 2, green: 1, blue: 0 };

// A hint's `type` can originate from Claude's own SSE response (see
// handleSSEEvent's 'hint' case) — never trusted as a literal CSS class name
// without going through this allowlist first, in case a future backend/
// prompt change ever emits something outside the four known values below.
const HINT_TYPE_CLASSES = new Set(['blue', 'yellow', 'green', 'red']);
function safeHintTypeClass(type) {
  return HINT_TYPE_CLASSES.has(type) ? type : 'blue';
}

function pickSuggestedAction(hintList) {
  if (!hintList.length) return null;
  return hintList.reduce((best, h) =>
    (HINT_URGENCY[h.type] ?? 0) >= (HINT_URGENCY[best.type] ?? 0) ? h : best
  );
}

async function renderSuggestedAction(hintList) {
  const container = document.getElementById('suggestedActionContainer');
  const top = pickSuggestedAction(hintList);
  if (!top) {
    const empty = document.createElement('div');
    empty.className = 'signals-empty';
    empty.textContent = 'Ei vielä ehdotuksia';
    container.replaceChildren(empty);
    return;
  }
  // Same generic conflict check as addHint()'s timeline entry, applied
  // here too — this card is the highest-visibility surface in the AI
  // Insights panel, and a Claude-proposed alternative (e.g. suggesting a
  // hybrid, a different body type, or a different color than what the
  // customer stated) needs to read as "our suggestion", not as if it were
  // confirmed customer data, wherever it's shown, not just in the timeline.
  // Also checked here: a named real model that doesn't actually satisfy the
  // customer's stated requirements in stock (see addHint()'s own note, and
  // its note on why this awaits loadInventory() instead of peeking a
  // synchronous cache that might not be warm yet for the session's first hint).
  const statedPrefs = extractVehiclePreferences(currentTranscript);
  const combinedText = `${top.title || ''} ${top.text || ''}`;
  const conflicts = preferenceConflictsInText(combinedText, statedPrefs);
  const inventoryForCheck = await loadInventory().catch(() => null);
  const modelClaim = inventoryForCheck ? checkNamedModelClaim(combinedText, statedPrefs, inventoryForCheck) : null;

  const conflictNotes = conflicts.map(c => `${c.categoryLabel}: ${c.stated}`);
  let modelClaimNote = null;
  if (modelClaim && !modelClaim.matchesStock) {
    const why = modelClaim.inStockAtAll ? modelClaim.reasons.join(', ') : 'ei varastossa lainkaan';
    modelClaimNote = `${modelClaim.brand} ${modelClaim.model} ei täsmää varastoon (${why})`;
  }
  const conflictLine = [
    conflictNotes.length ? `asiakas mainitsi ${conflictNotes.join(', ')}` : null,
    modelClaimNote,
  ].filter(Boolean).join(' — ');

  // A flagged hint's own AI-generated title/"Miksi" text often confidently
  // asserts the exact opposite of the conflict note sitting right above it
  // (real example: "ei täsmää varastoon (korityyppi suv)" directly followed
  // by "täsmälleen kriteereiden mukainen" in the same green "success"-styled
  // card) — technically correct flagging, but reads as two contradictory
  // claims stacked in one box, worse than no flag at all. When flagged, the
  // whole card is forced into warning styling (not whatever type/color
  // Claude assigned) and the wording makes clear the claim below is
  // unverified, not a second, independent, confirmed fact.
  const isFlagged = !!conflictLine;
  // top.icon/top.action/top.text/top.type can all originate from Claude's
  // SSE response (see handleSSEEvent's 'hint' case) — every one of them goes
  // through textContent/an allowlisted class below, never through an HTML
  // string, regardless of what the backend/model returns.
  const cardType = isFlagged ? 'yellow' : safeHintTypeClass(top.type);
  const card = document.createElement('div');
  card.className = `suggested-action ${cardType}`;

  const body = document.createElement('div');
  body.className = 'suggested-action-body';

  if (isFlagged) {
    const conflictDiv = document.createElement('div');
    conflictDiv.className = 'suggested-action-conflict';
    conflictDiv.textContent = `⚠ AI:n ehdotus EI täsmää varastoon — ${conflictLine}. Alla oleva peruste on tekoälyn oma, tarkistamaton väite:`;
    body.appendChild(conflictDiv);
  }

  const titleDiv = document.createElement('div');
  titleDiv.className = 'suggested-action-title';
  titleDiv.textContent = `${top.icon || ''} ${top.action || ''}`.trim();
  body.appendChild(titleDiv);

  const whyDiv = document.createElement('div');
  whyDiv.className = 'suggested-action-why';
  const whyLabel = document.createElement('strong');
  whyLabel.textContent = 'Miksi:';
  whyDiv.append(whyLabel, document.createTextNode(` ${top.text || ''}`));
  body.appendChild(whyDiv);

  card.appendChild(body);

  const useBtn = document.createElement('button');
  useBtn.className = 'suggested-action-use';
  useBtn.type = 'button';
  useBtn.textContent = 'Käytä tätä';
  useBtn.addEventListener('click', (e) => {
    logEvent(`Vihje käytetty: ${top.action}`, 'ok');
    e.target.disabled = true;
    e.target.textContent = '✓ Käytetty';
  });
  card.appendChild(useBtn);

  container.replaceChildren(card);
}

// price_sensitivity is the one signal type that means "objection/hesitation"
// rather than "confirmed positive evidence" — variant drives the badge's
// check-mark-vs-warning styling (see .signal-badge.positive/.caution).
const SIGNAL_BADGE_META = {
  price_sensitivity: { icon: '⚠', label: 'Hintaherkkyys', variant: 'caution' },
  financing: { icon: '✓', label: 'Rahoituskiinnostus', variant: 'positive' },
  trade_in: { icon: '✓', label: 'Vaihtoauto', variant: 'positive' },
  family: { icon: '✓', label: 'Perhetarve', variant: 'positive' },
  purchase_ready: { icon: '✓', label: 'Ostovalmius', variant: 'positive' },
  insurance: { icon: '✓', label: 'Vakuutuskiinnostus', variant: 'positive' },
};

// variant only ever needs to be one of these two known CSS classes — the
// fallback branch below (an unrecognized signal type) still gets whitelisted
// here rather than trusting SIGNAL_BADGE_META's own fallback object shape.
const SIGNAL_BADGE_VARIANTS = new Set(['positive', 'caution']);
function renderDetectedSignals(signalList) {
  const row = document.getElementById('signalsRow');
  const distinctTypes = [...new Set(signalList.map(s => s.type))];
  if (!distinctTypes.length) {
    row.className = 'signals-empty';
    row.textContent = 'Signaaleja ilmestyy kun keskustelua on analysoitu';
    return;
  }
  row.className = 'signals-row';
  row.replaceChildren(...distinctTypes.map(type => {
    const meta = SIGNAL_BADGE_META[type] || { icon: '•', label: type, variant: 'positive' };
    const variant = SIGNAL_BADGE_VARIANTS.has(meta.variant) ? meta.variant : 'positive';
    const span = document.createElement('span');
    span.className = `signal-badge ${variant}`;
    span.textContent = `${meta.icon} ${meta.label}`;
    return span;
  }));
}

function updateMeter(val,desc) {
  currentPurchaseIntent = val;
  currentMeterDesc = desc;
  gaugeIntent?.update(val);
}

const AVAILABILITY_LABEL_FI = { available: 'Heti saatavilla', reserved: 'Varattu', incoming: 'Tulossa' };

// v.available is used directly as a CSS class name below — restricted to
// these three known values (inventory.json is local demo data today, but
// treated as an untrusted source here per spec, same as the image path).
function safeAvailabilityClass(value) {
  return Object.prototype.hasOwnProperty.call(AVAILABILITY_LABEL_FI, value) ? value : 'available';
}

// Vehicle photos may only come from this app's own known local asset
// filenames — never an arbitrary inventory.json string used verbatim as an
// <img src>, which could otherwise point at an external URL, a data:/
// javascript: URI, or a path outside assets/cars/. Anything not an exact
// match falls back to a small inline SVG placeholder (no network fetch of
// its own, so it can never itself become an exfiltration or injection
// vector).
const VEHICLE_IMAGE_ALLOWED = new Set([
  'assets/cars/audi-a4.jpg', 'assets/cars/audi-q5.jpg', 'assets/cars/bmw-320.jpg', 'assets/cars/bmw-x3.jpg',
  'assets/cars/citroen-berlingo.jpg', 'assets/cars/ford-focus.jpg', 'assets/cars/ford-kuga.jpg',
  'assets/cars/hyundai-i30.jpg', 'assets/cars/hyundai-tucson.jpg', 'assets/cars/kia-niro.jpg',
  'assets/cars/kia-sportage.jpg', 'assets/cars/mazda-3.jpg', 'assets/cars/mazda-cx-5.jpg',
  'assets/cars/mercedes-benz-c-class.jpg', 'assets/cars/mercedes-benz-glc.jpg', 'assets/cars/mercedes-benz-sprinter.jpg',
  'assets/cars/nissan-leaf.jpg', 'assets/cars/nissan-qashqai.jpg', 'assets/cars/peugeot-208.jpg',
  'assets/cars/peugeot-3008.jpg', 'assets/cars/renault-trafic.jpg', 'assets/cars/skoda-fabia.jpg',
  'assets/cars/skoda-kodiaq.jpg', 'assets/cars/skoda-octavia.jpg', 'assets/cars/toyota-corolla.jpg',
  'assets/cars/toyota-rav4.jpg', 'assets/cars/toyota-yaris.jpg', 'assets/cars/volkswagen-golf.jpg',
  'assets/cars/volkswagen-passat.jpg', 'assets/cars/volkswagen-tiguan.jpg', 'assets/cars/volkswagen-transporter.jpg',
  'assets/cars/volvo-v60.jpg', 'assets/cars/volvo-v90.jpg', 'assets/cars/volvo-xc60.jpg',
]);
const VEHICLE_IMAGE_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48">'
  + '<rect width="64" height="48" fill="#e2e8f0"/>'
  + '<text x="32" y="30" font-size="20" text-anchor="middle">🚗</text></svg>'
);
function safeVehicleImageSrc(src) {
  return VEHICLE_IMAGE_ALLOWED.has(src) ? src : VEHICLE_IMAGE_FALLBACK;
}

// Renders the output of the deterministic inventory-matching engine
// (js/inventory-engine.js via business-rules.js) — replaces the old static
// showCars()/selectCar() pair entirely; there is no "select a car" concept
// anymore, each render reflects the current best matches for the signals
// collected so far.
function renderRecommendations(vehicles, signals, preferences) {
  const list = document.getElementById('recommendedList');
  if (!vehicles || !vehicles.length) {
    // Zero matches has three distinct causes that read very differently in
    // a live demo: "nothing detected yet" (normal, still waiting), "we DID
    // detect signals, they just don't say anything about vehicle
    // preference" (e.g. ostovalmius/vaihtoauto/vakuutus — process-stage
    // signals, not vehicle-attribute signals), or "the customer's stated
    // requirements (body type/fuel/price/vaihteisto) are real hard filters
    // and nothing in stock happens to satisfy all of them right now." Left
    // unexplained, all three read as broken to anyone skimming the demo.
    const unmatched = unmatchedSignalLabels(signals);
    const excludedByPreferences = preferencesExcludedEverything(vehicles, signals, preferences);
    const placeholder = document.createElement('div');
    placeholder.className = 'cars-placeholder';
    if (unmatched) {
      // unmatched entries are Signal labels, which for a Claude-sourced hint
      // are the hint's own raw title (see signals.js's signalsFromHint) —
      // textContent, never string-built HTML, regardless of what Claude sent.
      placeholder.textContent = `Tunnistetut signaalit (${unmatched.join(', ')}) kertovat ostoprosessin vaiheesta, eivät automieltymyksestä — siksi ajoneuvoehdotusta ei näytetä tässä kohtaa.`;
    } else if (excludedByPreferences) {
      const stated = [];
      if (preferences.bodyType) stated.push(preferences.bodyType);
      if (preferences.fuel) stated.push(preferences.fuel);
      if (preferences.transmission) stated.push(preferences.transmission.toLowerCase());
      if (preferences.priceMin != null || preferences.priceMax != null) stated.push(`${preferences.priceMin ?? '–'}–${preferences.priceMax ?? '–'} €`);
      if (preferences.maxMileage != null) stated.push(`alle ${preferences.maxMileage.toLocaleString('fi-FI')} km`);
      if (preferences.minYear != null) stated.push(`vuosimalli ${preferences.minYear}+`);
      placeholder.textContent = `Asiakkaan toiveilla (${stated.join(', ')}) ei löydy tarkkaa osumaa varastosta juuri nyt.`;
    } else {
      placeholder.textContent = 'Suositukset ilmestyvät kun keskustelusta on tunnistettu signaaleja';
    }
    list.replaceChildren(placeholder);
    return;
  }

  const container = document.createElement('div');
  container.className = 'rec-list';
  vehicles.forEach(v => {
    // Every field below comes from inventory.json — treated as an untrusted
    // source per spec (a demo-local file today, but the same rendering code
    // would run against a real backend-fed catalog tomorrow). All text goes
    // through textContent; the one place a value becomes markup-adjacent
    // (the image src, the availability CSS class) goes through its own
    // allowlist above instead of being used verbatim.
    const card = document.createElement('div');
    card.className = 'rec-card';

    const top = document.createElement('div');
    top.className = 'rec-top';

    const img = document.createElement('img');
    img.className = 'rec-icon';
    img.src = safeVehicleImageSrc(v.image);
    img.alt = `${v.brand} ${v.model}`;
    img.loading = 'lazy';
    top.appendChild(img);

    const info = document.createElement('div');
    info.className = 'rec-info';
    const name = document.createElement('div');
    name.className = 'rec-name';
    name.textContent = `${v.brand} ${v.model} ${v.trim}`;
    const meta = document.createElement('div');
    meta.className = 'rec-meta';
    meta.textContent = `${v.year} · ${v.transmission} · ${v.mileage.toLocaleString('fi-FI')} km · ${v.dealershipLocation}`;
    info.append(name, meta);
    top.appendChild(info);

    const match = document.createElement('div');
    match.className = 'rec-match';
    const matchVal = document.createElement('span');
    matchVal.className = 'rec-match-val';
    matchVal.textContent = `${v.matchScore}%`;
    const matchLbl = document.createElement('span');
    matchLbl.className = 'rec-match-lbl';
    matchLbl.textContent = 'osuvuus';
    match.append(matchVal, matchLbl);
    top.appendChild(match);

    card.appendChild(top);

    const pricing = document.createElement('div');
    pricing.className = 'rec-pricing';
    const price = document.createElement('span');
    price.className = 'rec-price';
    price.textContent = `${v.price.toLocaleString('fi-FI')} €`;
    const monthly = document.createElement('span');
    monthly.className = 'rec-monthly';
    monthly.textContent = `${v.estimatedMonthlyPayment} €/kk`;
    const availabilityClass = safeAvailabilityClass(v.available);
    const availability = document.createElement('span');
    availability.className = `rec-availability ${availabilityClass}`;
    availability.textContent = AVAILABILITY_LABEL_FI[availabilityClass] || availabilityClass;
    pricing.append(price, monthly, availability);
    card.appendChild(pricing);

    if (v.vatDeductible) {
      const vatBadge = document.createElement('div');
      vatBadge.className = 'rec-vat-badge';
      vatBadge.append('🧾 ALV-vähennyskelpoinen ');
      const caveat = document.createElement('span');
      caveat.className = 'rec-vat-caveat';
      caveat.textContent = '— edellyttää ajopäiväkirjaa ja liiketoimintakäyttöä';
      vatBadge.appendChild(caveat);
      card.appendChild(vatBadge);
    }

    const explanation = document.createElement('div');
    explanation.className = 'rec-explanation';
    explanation.textContent = v.explanation;
    card.appendChild(explanation);

    container.appendChild(card);
  });
  list.replaceChildren(container);
}

// Preserved as-is (same trigger logic as before the redesign) — only the
// presentation changed: this used to feed a CRM-summary modal, now it
// returns structured data that drives the CRM Integration state, the
// Automation Status pipeline, and the Live Event Timeline instead.
function buildTriggers() {
  const meter = currentPurchaseIntent;
  const triggers = [];
  if (meter >= 70) triggers.push({ trigger: 'high_intent', action: 'create_followup_task', priority: 'high', assignee: 'myyjä' });
  const hasFinance = hints.some(h => h.title?.includes('RAHOITUS'));
  if (hasFinance) triggers.push({ trigger: 'finance_interest', action: 'prefill_offer', template: 'rahoituspaketti' });
  const hasTrade = hints.some(h => h.title?.includes('VAIHTO'));
  if (hasTrade) triggers.push({ trigger: 'trade_in', action: 'start_valuation', system: 'ERP' });
  if (triggers.length === 0) triggers.push({ trigger: 'none', action: 'log_visit_only' });
  return triggers;
}

const CRM_STATE_META = {
  pending: { icon: '⏳', label: 'Pending', desc: 'Ei vielä lähetetty' },
  queued: { icon: '🕓', label: 'Queued', desc: 'Lähetys käynnissä…' },
  synced: { icon: '✅', label: 'Synced', desc: 'Tiedot synkronoitu' },
  failed: { icon: '⚠️', label: 'Failed', desc: 'Synkronointi epäonnistui' },
};

function renderCrmState(state) {
  const row = document.getElementById('crmStateRow');
  const meta = CRM_STATE_META[state];
  row.className = `crm-state ${state}`;
  document.getElementById('crmStateIcon').textContent = meta.icon;
  document.getElementById('crmStateLabel').textContent = meta.label;
  document.getElementById('crmStateDesc').textContent = meta.desc;
}

// Only two of the four steps are conditional on what buildTriggers() found —
// CRM/ERP always complete once a sync runs (that's the base pipeline every
// session goes through), Follow-up/Trade-in only complete if their specific
// trigger actually fired, otherwise they're marked skipped (not left stuck
// "pending" forever, which would misleadingly look like a hung queue).
const AUTOMATION_STEP_CONDITIONS = {
  crm: () => true,
  erp: () => true,
  followup: (triggers) => triggers.some(t => t.trigger === 'high_intent'),
  tradein: (triggers) => triggers.some(t => t.trigger === 'trade_in'),
};
const AUTOMATION_STEP_EVENT_LABEL = {
  crm: 'CRM päivitetty',
  erp: 'ERP:lle ilmoitettu',
  followup: 'Seurantatehtävä luotu',
  tradein: 'Vaihtoauton arviointi käynnistetty',
};

// "Animate only the active step": at any given moment exactly one step
// carries the .active pulsing state, the rest are already .done/.skipped or
// still at rest — a sequential reveal, not everything animating at once.
async function animateAutomationSteps(triggers) {
  const steps = document.querySelectorAll('.automation-step');
  for (const stepEl of steps) {
    const key = stepEl.dataset.step;
    stepEl.className = 'automation-step active';
    await new Promise(r => setTimeout(r, 400));
    const met = AUTOMATION_STEP_CONDITIONS[key](triggers);
    stepEl.className = `automation-step ${met ? 'done' : 'skipped'}`;
    if (met) logEvent(AUTOMATION_STEP_EVENT_LABEL[key], 'ok');
  }
}

async function syncToCRM() {
  const triggers = buildTriggers();
  document.getElementById('crmTriggersJson').textContent =
    JSON.stringify({ timestamp: new Date().toISOString(), triggers }, null, 2);

  renderCrmState('queued');
  logEvent('CRM-webhook jonossa', 'pending');
  await new Promise(r => setTimeout(r, 700));

  renderCrmState('synced');
  setBadgeLive('badgeCRM', triggers.some(t => t.trigger !== 'none'));

  await animateAutomationSteps(triggers);
  showToast('✅ Synkronoitu CRM:ään');
}

// Four explicit states (Loading/Success/Not found/Error), not just two CSS
// classes doing double duty — a 404 ("this plate genuinely has no match" —
// notfound) and a network failure ("couldn't even ask" — error) are
// different situations for the salesperson and read differently here.
// Builds a single-line plate-result state node (loading/notfound/error) —
// `text` may be a backend error message (data.error), rendered as text only,
// never as HTML, per spec.
function buildPlateStateNode(stateClass, role, text) {
  const div = document.createElement('div');
  div.className = `plate-result ${stateClass}`;
  if (role) div.setAttribute('role', role);
  div.textContent = text;
  return div;
}

function buildPlateSuccessNode(data) {
  const div = document.createElement('div');
  div.className = 'plate-result ok';
  const icon = document.createElement('span');
  icon.className = 'plate-result-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🚗';

  const body = document.createElement('div');
  body.className = 'plate-result-body';

  const title = document.createElement('div');
  title.className = 'plate-result-title';
  const titleStrong = document.createElement('strong');
  titleStrong.textContent = `${data.make} ${data.model}`;
  title.append(titleStrong, document.createTextNode(` (${data.year})`));

  const meta = document.createElement('div');
  meta.className = 'plate-result-meta';
  meta.textContent = `${data.plate} · ${data.mileage.toLocaleString('fi-FI')} km`;

  const value = document.createElement('div');
  value.className = 'plate-result-value';
  const valueStrong = document.createElement('strong');
  valueStrong.textContent = `${data.estimatedTradeInValue.toLocaleString('fi-FI')} €`;
  value.append('Arvioitu vaihtoarvo: ', valueStrong);

  body.append(title, meta, value);
  div.append(icon, body);
  return div;
}

async function lookupVehicle(e) {
  e.preventDefault();
  const input = document.getElementById('plateInput');
  const plate = input.value.trim();
  const resultEl = document.getElementById('plateResult');
  if (!plate) return false;

  resultEl.replaceChildren(buildPlateStateNode('loading', 'status', '🔍 Haetaan…'));

  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicle/${encodeURIComponent(plate)}`);
    const data = await res.json();
    // data.error is the backend's own error message — shown as text only,
    // never interpreted as HTML, regardless of what the backend returns.
    if (res.status === 404) {
      resultEl.replaceChildren(buildPlateStateNode('notfound', 'alert', data.error || 'Ajoneuvoa ei löytynyt'));
      logEvent(`Rekisterihaku: ${plate} ei löytynyt`, 'pending');
      return false;
    }
    if (!res.ok) {
      resultEl.replaceChildren(buildPlateStateNode('error', 'alert', data.error || 'Haku epäonnistui'));
      logEvent(`Rekisterihaku epäonnistui: ${plate}`, 'pending');
      return false;
    }
    resultEl.replaceChildren(buildPlateSuccessNode(data));
    logEvent(`Vaihtoauton rekisterihaku valmis: ${data.make} ${data.model}`, 'ok');
  } catch (err) {
    resultEl.replaceChildren(buildPlateStateNode('error', 'alert', '⚠️ Backend ei tavoitettavissa — rekisterihaku vaatii yhteyden palvelimeen (demo-data ei toimi paikallisesti)'));
    logEvent('Rekisterihaku epäonnistui: backend ei tavoitettavissa', 'pending');
  }
  return false;
}

function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
}

// Live Event Timeline — append-only log of things that already happen
// elsewhere (no new business logic). Newest entry on top.
let timelineEntryCount = 0;
function logEvent(text, status = 'ok') {
  const list = document.getElementById('timelineList');
  const empty = list.querySelector('.timeline-empty');
  if (empty) empty.remove();
  // Plain <div>, not <li> — the container's role="log" (the semantically
  // correct ARIA role for a running event log, per WAI-ARIA) is not a list
  // role, so listitem children here would have no list/listbox ancestor to
  // satisfy that relationship and axe correctly flags it.
  const entry = document.createElement('div');
  entry.className = 'timeline-entry';
  const time = new Date().toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const timeSpan = document.createElement('span');
  timeSpan.className = 'timeline-time';
  timeSpan.textContent = time;
  const textSpan = document.createElement('span');
  textSpan.className = 'timeline-text';
  textSpan.textContent = text; // may include unescaped user/vehicle/AI data — textContent only
  const statusSpan = document.createElement('span');
  statusSpan.className = `timeline-status ${status === 'ok' ? 'ok' : 'pending'}`;
  statusSpan.textContent = status === 'ok' ? 'OK' : 'Pending';
  entry.append(timeSpan, textSpan, statusSpan);
  list.insertBefore(entry, list.firstChild);
  timelineEntryCount++;
  document.getElementById('timelineCount').textContent = timelineEntryCount;
}

// Header connection badges (Speech/Claude/CRM) — purely a presentational
// reflection of state that already exists elsewhere (recognition started,
// analyzeWithSSE succeeded, a real CRM trigger fired), not a new source of truth.
function setBadgeLive(id, isLive) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('live', !!isLive);
}

// --- Event wiring (replaces the old inline onclick="..." attributes now that
// this file is an ES module and its functions aren't implicitly global) ---
function wireEvents() {
  document.getElementById('btnDenyConsent').addEventListener('click', denyConsent);
  document.getElementById('btnGiveConsent').addEventListener('click', giveConsent);
  document.getElementById('btnStart').addEventListener('click', startSession);
  document.getElementById('btnPaste').addEventListener('click', startPasteSession);
  document.getElementById('pasteInput').addEventListener('input', handlePasteInput);
  document.getElementById('btnStop').addEventListener('click', stopSession);
  document.getElementById('btnCRM').addEventListener('click', syncToCRM);
  document.getElementById('btnAnalyze').addEventListener('click', analyzeNow);
  document.querySelectorAll('.scenario-btn[data-scenario]').forEach(btn => {
    btn.addEventListener('click', () => runScenario(btn.dataset.scenario));
  });
  document.getElementById('plateForm').addEventListener('submit', lookupVehicle);
}

function initGauges() {
  gaugeIntent = createGauge(document.getElementById('gaugeIntentWrap'), { label: 'Ostohalukkuus', value: 0, colorVar: '--success' });
  gaugeConfidence = createGauge(document.getElementById('gaugeConfidenceWrap'), { label: 'Confidence', value: 0, colorVar: '--primary' });
}

wireEvents();
initGauges();
// Sets the initial disabled= state for every consent-gated control
// (scenario buttons included) before any user interaction is possible —
// consentState starts at CONSENT_STATE.UNKNOWN, so everything gated starts
// blocked, matching spec requirement 1.
applyConsentGateUI();
// Warm the inventory cache at load time — a hint can never arrive before at
// least one full Claude API round-trip, so this local JSON fetch has ample
// time to resolve before checkNamedModelClaim() (in addHint()) needs it.
loadInventory().catch(() => {}); // failure handled by that check's own null-cache fallback, not here

// --- Test-only exports (frontend regression tests, tests/frontend/) ---
// The functions/state below have no other consumer; production behavior is
// entirely driven by wireEvents()'s own DOM listeners and the calls above,
// which run unconditionally on module load exactly as before this file had
// any exports. Exporting them doesn't change runtime behavior — it only
// makes them reachable from a test module that imports this file directly.
export {
  runScenario,
  giveConsent,
  denyConsent,
  startSession,
  startPasteSession,
  handlePasteInput,
  analyzeNow,
  analyzeWithSSE,
  addHint,
  renderSuggestedAction,
  renderRecommendations,
  showTranscript,
  lookupVehicle,
  safeVehicleImageSrc,
  resolveBackendUrl,
  consentAuditLog,
};
