import { detectLocalSignals, signalsFromHint, signalsFromScenario } from './signals.js';
import { runBusinessRules } from './business-rules.js';
import { unmatchedSignalLabels } from './inventory-engine.js';
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
  });
  console.log('[business-rules]', { signalCount: businessSignals.length, ...result });
  renderRecommendations(result.recommendedVehicles, businessSignals);
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
    setBadgeLive('badgeClaude', true);
    logEvent('Claude-analyysi valmis', 'ok');
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
function addHint(h) {
  hints.push(h);
  document.getElementById('statHints').textContent=hints.length;
  logEvent(`Aikomus tunnistettu: ${h.title}`, 'ok');
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

function renderSuggestedAction(hintList) {
  const container = document.getElementById('suggestedActionContainer');
  const top = pickSuggestedAction(hintList);
  if (!top) {
    container.innerHTML = '<div class="signals-empty">Ei vielä ehdotuksia</div>';
    return;
  }
  const card = document.createElement('div');
  card.className = `suggested-action ${top.type}`;
  card.innerHTML = `
    <div class="suggested-action-body">
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
function renderRecommendations(vehicles, signals) {
  const list = document.getElementById('recommendedList');
  if (!vehicles || !vehicles.length) {
    // Zero matches has two distinct causes that read very differently in a
    // live demo: "nothing detected yet" (normal, still waiting) vs "we DID
    // detect signals, they just don't say anything about vehicle
    // preference" (e.g. ostovalmius/vaihtoauto/vakuutus — process-stage
    // signals, not vehicle-attribute signals). Left unexplained, the second
    // case reads as broken to anyone skimming the demo without reading the
    // signal badges above it.
    const unmatched = unmatchedSignalLabels(signals);
    list.innerHTML = unmatched
      ? `<div class="cars-placeholder">Tunnistetut signaalit (${unmatched.join(', ')}) kertovat ostoprosessin vaiheesta, eivät automieltymyksestä — siksi ajoneuvoehdotusta ei näytetä tässä kohtaa.</div>`
      : '<div class="cars-placeholder">Suositukset ilmestyvät kun keskustelusta on tunnistettu signaaleja</div>';
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
          <div class="rec-meta">${v.year} · ${v.transmission} · ${v.dealershipLocation}</div>
        </div>
        <div class="rec-match"><span class="rec-match-val">${v.matchScore}%</span><span class="rec-match-lbl">osuvuus</span></div>
      </div>
      <div class="rec-pricing">
        <span class="rec-price">${v.price.toLocaleString('fi-FI')} €</span>
        <span class="rec-monthly">${v.estimatedMonthlyPayment} €/kk</span>
        <span class="rec-availability ${v.available}">${AVAILABILITY_LABEL_FI[v.available] || v.available}</span>
      </div>
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
