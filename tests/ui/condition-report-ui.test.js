'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('vehicle.html', 'utf8');
const script = fs.readFileSync('js/digital-salesperson.js', 'utf8');
const api = fs.readFileSync('js/purchase-flow-api.js', 'utf8');

test('condition report is a mandatory semantic step with an unselected acknowledgement', () => {
  assert.match(html, /<section class="condition-report-step hidden"[^>]+aria-labelledby="conditionReportTitle"[^>]+tabindex="-1"/);
  assert.match(html, /<h2 id="conditionReportTitle">Auton kuntoraportti<\/h2>/);
  assert.match(html, /<label class="condition-checkbox" for="conditionAcknowledgement">/);
  assert.match(html, /<input id="conditionAcknowledgement"[^>]+type="checkbox">/);
  assert.doesNotMatch(html, /id="conditionAcknowledgement"[^>]+checked/);
  assert.match(html, /id="btnProceedAfterCondition"[^>]+disabled/);
});

test('loading and error states are announced and exact customer-safe failure copy exists', () => {
  assert.match(html, /id="conditionReportStatus" role="status" aria-live="polite"/);
  assert.match(script, /Auton kuntoraporttia ei saatu avattua\. Emme siirry rahoitukseen tai maksamiseen ennen kuin raportti on saatavilla\./);
  assert.match(script, /Auton kuntotiedot vaativat myyjän tarkistuksen\. Pyyntö on välitetty eteenpäin\./);
  assert.match(script, /Auton kuntoraportti on päivittynyt\. Tutustu uuteen versioon ennen kuin jatkat\./);
});

test('keyboard and focus flow uses native controls and moves focus into and out of the report step', () => {
  assert.match(html, /<button[^>]+id="btnBackFromCondition"[^>]+type="button"/);
  assert.match(html, /<form class="condition-acknowledgement/);
  assert.match(script, /step\.focus\(\)/);
  assert.match(script, /conditionAcknowledgement'\)\.focus\(\)/);
  assert.match(script, /conditionReturnFocus\.focus\(\)/);
  assert.match(script, /addEventListener\('change'/);
});

test('HTML summary is authoritative and PDF remains an optional source link', () => {
  assert.match(html, /id="conditionReportSections"/);
  assert.match(html, /class="condition-source-link hidden"/);
  assert.match(html, /id="conditionReportSource"/);
  assert.match(script, /section\.title/);
  assert.match(script, /section\.content/);
  assert.match(script, /image\.alt = photo\.alt/);
});

test('client contains no report content, authoritative timestamps, or transition bypass', () => {
  for (const forbidden of ['generalCondition:', 'bodyNotes:', 'interiorCondition:', 'contentHash =', 'acknowledgedAt', 'servedAt']) {
    assert.equal(script.includes(forbidden), false, forbidden);
  }
  assert.match(api, /X-Correlation-Id/);
  assert.match(api, /reportCommand\('acknowledge'/);
  assert.match(api, /\/payment-method/);
  assert.match(api, /\/provider\/start/);
});
