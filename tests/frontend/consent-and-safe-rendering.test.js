// @vitest-environment jsdom
//
// Phase A frontend regression suite: the consent gate state machine and the
// safe-rendering fixes in js/app.js. Every test loads a FRESH copy of the
// real index.html into jsdom and a fresh instance of js/app.js (via
// vi.resetModules()) so module-level state (consentState, hints, etc.)
// never leaks between tests.
//
// No real microphone, backend, Anthropic API, or network is used anywhere
// in this file — `fetch` is always a local stub (default: rejects, so a
// call that reaches it unexpectedly fails the test loudly instead of
// silently "working"), and SpeechRecognition is a local fake constructor.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

function extractBodyInnerHTML(html) {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!match) throw new Error('index.html: could not locate <body>...</body>');
  return match[1];
}
const BODY_HTML = extractBodyInnerHTML(INDEX_HTML);

// jsdom has no real layout engine — every element's getBoundingClientRect()
// returns an all-zero rect by default, which would make
// checkConsentBoxExposed() in app.js treat #consentBox as a "zero-size box"
// (correctly, for a real browser bug) on every single test. Stubbed here,
// once, to a plausible non-zero box so consent tests exercise the actual
// gate logic instead of tripping the unrelated exposure guard.
function stubLayout() {
  Element.prototype.getBoundingClientRect = () => ({
    width: 300, height: 120, top: 0, left: 0, right: 300, bottom: 120, x: 0, y: 0, toJSON() {},
  });
}

// Minimal fake SpeechRecognition constructor — enough for startSession()'s
// `'SpeechRecognition' in window` branch to take the "supported" path and
// for .start()/.stop() to be callable without throwing. No audio, no real
// recognition, ever.
class FakeSpeechRecognition {
  constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; }
  start() {}
  stop() {}
}

function rejectingFetch() {
  return vi.fn(() => Promise.reject(new Error('fetch must not be called in this test')));
}

// app.js unconditionally warms the (local, static) inventory catalog cache
// at module load — that's ordinary demo-data loading, not the consent-gated
// "backend-analyysikutsu" this suite cares about (the analysis endpoint,
// `${BACKEND_URL}/api/analyze`). Filters it out so gate assertions check
// specifically for an analysis call, not "fetch was never invoked at all".
function analysisCalls(fetchMock) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/analyze'));
}

// jsdom doesn't implement window.matchMedia at all — unrelated to anything
// in scope here (js/gauge.js's own prefers-reduced-motion check, untouched
// by this slice), but createGauge()/initGauges() run unconditionally at
// app.js's module-load time, so every test needs this present regardless of
// whether that particular test cares about gauges.
function stubMatchMedia() {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
}

async function loadApp({ fetchImpl } = {}) {
  document.documentElement.innerHTML = `<head></head><body>${BODY_HTML}</body>`;
  stubLayout();
  stubMatchMedia();
  window.SpeechRecognition = FakeSpeechRecognition;
  // @ts-ignore - test-only global
  window.webkitSpeechRecognition = FakeSpeechRecognition;
  global.fetch = fetchImpl || rejectingFetch();

  vi.resetModules();
  const app = await import('../../js/app.js');
  // Let module-load-time async work (loadInventory()'s own fetch, already
  // caught internally) settle before the test body runs.
  await Promise.resolve();
  await Promise.resolve();
  return app;
}

function scenarioButton(key) {
  return document.querySelector(`.scenario-btn[data-scenario="${key}"]`);
}

function sessionLooksActive() {
  return !document.getElementById('btnStop').classList.contains('hidden');
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
});

describe('Consent gate: initial state', () => {
  test('1. Alkutilassa skenaariota ei voi käynnistää', async () => {
    const app = await loadApp();
    expect(app.consentState).toBe(app.CONSENT_STATE.UNKNOWN);
    expect(scenarioButton('hinta').disabled).toBe(true);

    await app.runScenario('hinta');

    expect(sessionLooksActive()).toBe(false);
    expect(app.consentState).toBe(app.CONSENT_STATE.UNKNOWN);
  });

  test('2. Alkutilassa mikrofonia, liittämissessiota tai analyysiä ei voi käynnistää', async () => {
    const app = await loadApp();
    expect(document.getElementById('btnStart').disabled).toBe(true);
    expect(document.getElementById('btnPaste').disabled).toBe(true);

    app.startSession();
    expect(sessionLooksActive()).toBe(false);

    app.startPasteSession();
    expect(sessionLooksActive()).toBe(false);
    expect(document.getElementById('pasteBox').classList.contains('hidden')).toBe(true);

    await app.analyzeNow();
    expect(analysisCalls(global.fetch)).toHaveLength(0);
  });
});

describe('Consent gate: denial', () => {
  test('3. Kieltäytymisen jälkeen skenaarion painaminen ei muuta tilaa hyväksytyksi', async () => {
    const app = await loadApp();
    await app.denyConsent();
    expect(app.consentState).toBe(app.CONSENT_STATE.DENIED);

    await app.runScenario('hinta');

    expect(app.consentState).toBe(app.CONSENT_STATE.DENIED);
    expect(sessionLooksActive()).toBe(false);
  });

  test('4. Kieltäytymisen jälkeen backend-kutsua ei tehdä', async () => {
    const app = await loadApp();
    await app.denyConsent();

    const result = await app.analyzeWithSSE('asiakas kysyi hintaa');

    expect(result).toBe(false);
    expect(analysisCalls(global.fetch)).toHaveLength(0);
  });

  test('5. Kieltäytymisen jälkeen käyttäjän nimenomainen hyväksyntä avaa toiminnot', async () => {
    const app = await loadApp();
    await app.denyConsent();
    expect(document.getElementById('btnStart').disabled).toBe(true);

    await app.giveConsent();

    expect(app.consentState).toBe(app.CONSENT_STATE.ACCEPTED);
    expect(document.getElementById('btnStart').disabled).toBe(false);
    expect(document.getElementById('btnPaste').disabled).toBe(false);
    expect(scenarioButton('hinta').disabled).toBe(false);
  });
});

describe('Consent gate: runScenario never grants consent itself', () => {
  test('6. runScenario() ei koskaan myönnä suostumusta', async () => {
    const app = await loadApp();
    expect(app.consentState).toBe(app.CONSENT_STATE.UNKNOWN);

    await app.runScenario('rahoitus');
    expect(app.consentState).toBe(app.CONSENT_STATE.UNKNOWN);

    await app.denyConsent();
    await app.runScenario('rahoitus');
    expect(app.consentState).toBe(app.CONSENT_STATE.DENIED);
  });
});

describe('Consent gate: idempotent logging', () => {
  test('7. Yksi hyväksymispainallus tuottaa vain yhden hyväksyntälokimerkinnän', async () => {
    const app = await loadApp();

    // Simulates two near-simultaneous invocations of the same click handler
    // (e.g. a fast double-click before the button's own disabled= state
    // takes visual effect) racing each other, not two separate deliberate
    // user actions.
    await Promise.all([app.giveConsent(), app.giveConsent()]);

    const passEntries = app.consentAuditLog
      .getEntries()
      .filter((e) => e.stage === 'CONSENT_GIVEN' && e.verdict === 'PASS');
    expect(passEntries.length).toBe(1);

    const verification = await app.consentAuditLog.verifyChain();
    expect(verification.valid).toBe(true);
  });
});

describe('Safe rendering: transcription / user input', () => {
  test('8. Haitallinen HTML litteroinnissa näytetään tekstinä eikä luo DOM-elementtiä', async () => {
    const app = await loadApp();
    const malicious = '<img src=x onerror=alert(1)>';

    app.showTranscript(malicious);

    const transcriptEl = document.getElementById('transcriptText');
    expect(transcriptEl.textContent).toBe(malicious);
    expect(transcriptEl.querySelector('img')).toBeNull();
    expect(transcriptEl.innerHTML).not.toContain('<img');
  });
});

describe('Safe rendering: model hint', () => {
  test('9. Haitallinen HTML mallin vihjeessä näytetään tekstinä eikä luo DOM-elementtiä', async () => {
    const app = await loadApp();
    const maliciousHint = {
      type: 'blue',
      icon: '<img src=x onerror=alert(2)>',
      title: 'HINTAVERTAILU',
      action: '<svg onload=alert(3)>Toimi</svg>',
      text: '<script>alert(4)</script> asiakas mainitsi hinnan',
    };

    await app.renderSuggestedAction([maliciousHint]);

    const container = document.getElementById('suggestedActionContainer');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(2)>');
    expect(container.textContent).toContain('<script>alert(4)</script> asiakas mainitsi hinnan');
  });
});

describe('Safe rendering: vehicle inventory data and backend errors', () => {
  test('10a. Haitallinen HTML ajoneuvodatassa näytetään tekstinä eikä luo DOM-elementtiä', async () => {
    const app = await loadApp();
    const maliciousVehicle = {
      id: 'veh-xss', brand: '<img src=x onerror=alert(5)>', model: 'Testi', trim: '',
      year: 2020, price: 20000, estimatedMonthlyPayment: 250, mileage: 50000,
      dealershipLocation: '<script>alert(6)</script>', transmission: 'Automaatti',
      available: 'available', vatDeductible: false, image: 'assets/cars/audi-a4.jpg',
      matchScore: 88, explanation: '<b onmouseover=alert(7)>selitys</b>',
    };

    app.renderRecommendations([maliciousVehicle], [], null);

    const list = document.getElementById('recommendedList');
    expect(list.querySelector('img[onerror]')).toBeNull();
    expect(list.querySelector('script')).toBeNull();
    expect(list.querySelector('b')).toBeNull();
    expect(list.textContent).toContain('<img src=x onerror=alert(5)>');
    expect(list.textContent).toContain('<script>alert(6)</script>');
    expect(list.textContent).toContain('<b onmouseover=alert(7)>selitys</b>');
  });

  test('10b. Haitallinen HTML backendin virheviestissä näytetään tekstinä eikä luo DOM-elementtiä', async () => {
    const maliciousError = '<img src=x onerror=alert(8)>';
    const fetchImpl = vi.fn((url) => {
      if (String(url).includes('/api/vehicle/')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: maliciousError }),
        });
      }
      return Promise.reject(new Error('unexpected fetch: ' + url));
    });
    const app = await loadApp({ fetchImpl });

    document.getElementById('plateInput').value = 'ABC-123';
    await app.lookupVehicle({ preventDefault: () => {} });

    const resultEl = document.getElementById('plateResult');
    expect(resultEl.querySelector('img')).toBeNull();
    expect(resultEl.textContent).toContain(maliciousError);
    expect(resultEl.innerHTML).not.toContain('<img src=x onerror');
  });
});

describe('Safe rendering: vehicle image source allowlist', () => {
  test('11. Virheellinen tai ulkoinen ajoneuvokuvan URL korvautuu turvallisella fallbackilla', async () => {
    const app = await loadApp();

    expect(app.safeVehicleImageSrc('assets/cars/audi-a4.jpg')).toBe('assets/cars/audi-a4.jpg');

    for (const badSrc of [
      'javascript:alert(1)',
      'https://evil.example/x.jpg',
      'data:image/svg+xml;utf8,<svg onload=alert(1)>',
      '../../etc/passwd',
      'assets/cars/../../../secret.jpg',
      '',
      undefined,
      null,
    ]) {
      const safe = app.safeVehicleImageSrc(badSrc);
      expect(safe.startsWith('javascript:')).toBe(false);
      expect(safe.startsWith('data:image/svg+xml')).toBe(true);
    }

    const maliciousVehicle = {
      id: 'veh-img', brand: 'Testi', model: 'Malli', trim: '', year: 2020, price: 20000,
      estimatedMonthlyPayment: 250, mileage: 50000, dealershipLocation: 'X',
      transmission: 'Automaatti', available: 'available', vatDeductible: false,
      image: 'https://evil.example/tracker.jpg', matchScore: 50, explanation: 'ok',
    };
    app.renderRecommendations([maliciousVehicle], [], null);
    const img = document.querySelector('#recommendedList img.rec-icon');
    expect(img.getAttribute('src')).toBe(app.safeVehicleImageSrc('https://evil.example/tracker.jpg'));
    expect(img.getAttribute('src').startsWith('https://evil.example')).toBe(false);
  });
});

describe('Auto-analyze is gated the same way as manual analysis', () => {
  test('kieltäytyminen perii käynnissä olevan session ja peruuttaa automaattisen analyysin', async () => {
    vi.useFakeTimers();
    const app = await loadApp();
    await app.giveConsent();
    app.startPasteSession();
    expect(sessionLooksActive()).toBe(true);

    await app.denyConsent();
    expect(sessionLooksActive()).toBe(false);

    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(analysisCalls(global.fetch)).toHaveLength(0);
    vi.useRealTimers();
  });
});
