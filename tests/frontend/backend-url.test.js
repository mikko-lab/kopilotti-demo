// @vitest-environment jsdom
//
// Production Wiring slice: resolveBackendUrl() is the single source of truth
// for which backend a given page origin talks to. Tested directly as a pure
// function (hostname in, URL out) rather than through the module's own
// `location` global, matching the reason it was extracted from the old
// inline BACKEND_URL ternary in the first place.

import { describe, test, expect, vi } from 'vitest';
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

// Same jsdom-gap stubs as tests/frontend/consent-and-safe-rendering.test.js -
// app.js's own module-load-time work (initGauges, wireEvents) needs these
// regardless of which exported function a given test actually exercises.
function stubLayout() {
  Element.prototype.getBoundingClientRect = () => ({
    width: 300, height: 120, top: 0, left: 0, right: 300, bottom: 120, x: 0, y: 0, toJSON() {},
  });
}
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

async function loadApp() {
  document.documentElement.innerHTML = `<head></head><body>${BODY_HTML}</body>`;
  stubLayout();
  stubMatchMedia();
  global.fetch = vi.fn(() => Promise.reject(new Error('fetch must not be called in this test')));

  vi.resetModules();
  const app = await import('../../js/app.js');
  await Promise.resolve();
  await Promise.resolve();
  return app;
}

describe('resolveBackendUrl', () => {
  test('both local hosts resolve to the local backend', async () => {
    const app = await loadApp();

    expect(app.resolveBackendUrl('localhost')).toBe('http://localhost:3001');
    expect(app.resolveBackendUrl('127.0.0.1')).toBe('http://localhost:3001');
  });

  test('a GitHub Pages host resolves to exactly the Render production URL', async () => {
    const app = await loadApp();

    expect(app.resolveBackendUrl('mikko-lab.github.io')).toBe(
      'https://kopilotti-demo-api.onrender.com'
    );
  });

  test('any other non-local host also resolves to the production backend', async () => {
    const app = await loadApp();

    for (const hostname of ['example.com', 'staging.kopilotti-demo.example', '']) {
      expect(app.resolveBackendUrl(hostname)).toBe(
        'https://kopilotti-demo-api.onrender.com'
      );
    }
  });

  test('the production URL never contains the retired Railway address', async () => {
    const app = await loadApp();

    const production = app.resolveBackendUrl('mikko-lab.github.io');
    expect(production).not.toContain('railway.app');
    expect(production).toBe('https://kopilotti-demo-api.onrender.com');
  });
});
