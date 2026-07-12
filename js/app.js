import { detectLocalSignals, signalsFromHint, signalsFromScenario } from './signals.js';
import { runBusinessRules } from './business-rules.js';
import { unmatchedSignalLabels, preferencesExcludedEverything, loadInventory, checkNamedModelClaim } from './inventory-engine.js';
import { extractVehiclePreferences, preferenceConflictsInText } from './vehicle-preferences.js';
import { createGauge } from './gauge.js';

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
  }
};

let sessionActive=false, consentGiven=false, timer=null, secs=0;
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

// Derive from the page's own origin instead of hardcoding one environment's URL —
// a hardcoded string here previously got left pointed at localhost after local
// testing and shipped that way by accident. localhost/127.0.0.1 -> local backend,
// anything else (GitHub Pages, etc.) -> production Railway backend.
const BACKEND_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : 'https://kopilotti-demo-production.up.railway.app';

function giveConsent() {
  consentGiven=true;
  document.getElementById('consentBox').style.display='none';
  document.getElementById('btnStart').disabled=false;
  document.getElementById('statusSub').textContent='Suostumus saatu — valmis';
  showToast('✅ Suostumus kirjattu');
}

function denyConsent() {
  showToast('❌ Suostumus kieltäytyi — sessio peruutettu');
}

function startSession() {
  sessionActive=true;
  document.getElementById('statusDot').classList.add('active');
  document.getElementById('statusTitle').textContent='Sessio käynnissä';
  document.getElementById('statusSub').textContent='Kuuntelen...';
  document.getElementById('btnStart').classList.add('hidden');
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
  if(!sessionActive){ if(!consentGiven) giveConsent(); startSession(); }
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
      if (hintSignal) { businessSignals.push(hintSignal); recomputeBusinessRules(); }
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
    container.innerHTML = '<div class="signals-empty">Ei vielä ehdotuksia</div>';
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
  const cardType = isFlagged ? 'yellow' : top.type;
  const card = document.createElement('div');
  card.className = `suggested-action ${cardType}`;
  card.innerHTML = `
    <div class="suggested-action-body">
      ${isFlagged ? `<div class="suggested-action-conflict">⚠ AI:n ehdotus EI täsmää varastoon — ${conflictLine}. Alla oleva peruste on tekoälyn oma, tarkistamaton väite:</div>` : ''}
      <div class="suggested-action-title">${top.icon} ${top.action}</div>
      <div class="suggested-action-why"><strong>Miksi:</strong> ${top.text}</div>
    </div>
    <button class="suggested-action-use" type="button">Käytä tätä</button>
  `;
  container.innerHTML = '';
  container.appendChild(card);
  card.querySelector('.suggested-action-use').addEventListener('click', (e) => {
    logEvent(`Vihje käytetty: ${top.action}`, 'ok');
    e.target.disabled = true;
    e.target.textContent = '✓ Käytetty';
  });
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

function renderDetectedSignals(signalList) {
  const row = document.getElementById('signalsRow');
  const distinctTypes = [...new Set(signalList.map(s => s.type))];
  if (!distinctTypes.length) {
    row.className = 'signals-empty';
    row.textContent = 'Signaaleja ilmestyy kun keskustelua on analysoitu';
    return;
  }
  row.className = 'signals-row';
  row.innerHTML = distinctTypes.map(type => {
    const meta = SIGNAL_BADGE_META[type] || { icon: '•', label: type, variant: 'positive' };
    return `<span class="signal-badge ${meta.variant}">${meta.icon} ${meta.label}</span>`;
  }).join('');
}

function updateMeter(val,desc) {
  currentPurchaseIntent = val;
  currentMeterDesc = desc;
  gaugeIntent?.update(val);
}

const AVAILABILITY_LABEL_FI = { available: 'Heti saatavilla', reserved: 'Varattu', incoming: 'Tulossa' };

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
    if (unmatched) {
      list.innerHTML = `<div class="cars-placeholder">Tunnistetut signaalit (${unmatched.join(', ')}) kertovat ostoprosessin vaiheesta, eivät automieltymyksestä — siksi ajoneuvoehdotusta ei näytetä tässä kohtaa.</div>`;
    } else if (excludedByPreferences) {
      const stated = [];
      if (preferences.bodyType) stated.push(preferences.bodyType);
      if (preferences.fuel) stated.push(preferences.fuel);
      if (preferences.transmission) stated.push(preferences.transmission.toLowerCase());
      if (preferences.priceMin != null || preferences.priceMax != null) stated.push(`${preferences.priceMin ?? '–'}–${preferences.priceMax ?? '–'} €`);
      if (preferences.maxMileage != null) stated.push(`alle ${preferences.maxMileage.toLocaleString('fi-FI')} km`);
      if (preferences.minYear != null) stated.push(`vuosimalli ${preferences.minYear}+`);
      list.innerHTML = `<div class="cars-placeholder">Asiakkaan toiveilla (${stated.join(', ')}) ei löydy tarkkaa osumaa varastosta juuri nyt.</div>`;
    } else {
      list.innerHTML = '<div class="cars-placeholder">Suositukset ilmestyvät kun keskustelusta on tunnistettu signaaleja</div>';
    }
    return;
  }
  list.innerHTML = '<div class="rec-list"></div>';
  const container = list.querySelector('.rec-list');
  vehicles.forEach(v => {
    const card = document.createElement('div');
    card.className = 'rec-card';
    card.innerHTML = `
      <div class="rec-top">
        <span class="rec-icon" aria-hidden="true">${v.image}</span>
        <div class="rec-info">
          <div class="rec-name">${v.brand} ${v.model} ${v.trim}</div>
          <div class="rec-meta">${v.year} · ${v.transmission} · ${v.mileage.toLocaleString('fi-FI')} km · ${v.dealershipLocation}</div>
        </div>
        <div class="rec-match"><span class="rec-match-val">${v.matchScore}%</span><span class="rec-match-lbl">osuvuus</span></div>
      </div>
      <div class="rec-pricing">
        <span class="rec-price">${v.price.toLocaleString('fi-FI')} €</span>
        <span class="rec-monthly">${v.estimatedMonthlyPayment} €/kk</span>
        <span class="rec-availability ${v.available}">${AVAILABILITY_LABEL_FI[v.available] || v.available}</span>
      </div>
      ${v.vatDeductible ? `<div class="rec-vat-badge">🧾 ALV-vähennyskelpoinen <span class="rec-vat-caveat">— edellyttää ajopäiväkirjaa ja liiketoimintakäyttöä</span></div>` : ''}
      <div class="rec-explanation">${v.explanation}</div>
    `;
    container.appendChild(card);
  });
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
async function lookupVehicle(e) {
  e.preventDefault();
  const input = document.getElementById('plateInput');
  const plate = input.value.trim();
  const resultEl = document.getElementById('plateResult');
  if (!plate) return false;

  resultEl.innerHTML = '<div class="plate-result loading" role="status">🔍 Haetaan…</div>';

  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicle/${encodeURIComponent(plate)}`);
    const data = await res.json();
    if (res.status === 404) {
      resultEl.innerHTML = `<div class="plate-result notfound" role="alert">${data.error || 'Ajoneuvoa ei löytynyt'}</div>`;
      logEvent(`Rekisterihaku: ${plate} ei löytynyt`, 'pending');
      return false;
    }
    if (!res.ok) {
      resultEl.innerHTML = `<div class="plate-result error" role="alert">${data.error || 'Haku epäonnistui'}</div>`;
      logEvent(`Rekisterihaku epäonnistui: ${plate}`, 'pending');
      return false;
    }
    resultEl.innerHTML = `
      <div class="plate-result ok">
        <span class="plate-result-icon" aria-hidden="true">🚗</span>
        <div class="plate-result-body">
          <div class="plate-result-title"><strong>${data.make} ${data.model}</strong> (${data.year})</div>
          <div class="plate-result-meta">${data.plate} · ${data.mileage.toLocaleString('fi-FI')} km</div>
          <div class="plate-result-value">Arvioitu vaihtoarvo: <strong>${data.estimatedTradeInValue.toLocaleString('fi-FI')} €</strong></div>
        </div>
      </div>`;
    logEvent(`Vaihtoauton rekisterihaku valmis: ${data.make} ${data.model}`, 'ok');
  } catch (err) {
    resultEl.innerHTML = '<div class="plate-result error" role="alert">⚠️ Backend ei tavoitettavissa — rekisterihaku vaatii yhteyden palvelimeen (demo-data ei toimi paikallisesti)</div>';
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
  entry.innerHTML = `<span class="timeline-time">${time}</span><span class="timeline-text"></span><span class="timeline-status ${status}">${status === 'ok' ? 'OK' : 'Pending'}</span>`;
  entry.querySelector('.timeline-text').textContent = text; // textContent, not innerHTML — text may include unescaped user/vehicle data
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
// Warm the inventory cache at load time — a hint can never arrive before at
// least one full Claude API round-trip, so this local JSON fetch has ample
// time to resolve before checkNamedModelClaim() (in addHint()) needs it.
loadInventory().catch(() => {}); // failure handled by that check's own null-cache fallback, not here
