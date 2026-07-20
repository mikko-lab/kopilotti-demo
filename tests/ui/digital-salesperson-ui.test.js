'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('vehicle.html', 'utf8');
const landing = fs.readFileSync('index.html', 'utf8');
const uiScript = fs.readFileSync('js/digital-salesperson.js', 'utf8');
const demoVehicle = fs.readFileSync('js/demo-vehicle.js', 'utf8');
const apiScript = fs.readFileSync('js/negotiation-api.js', 'utf8');
const vehicleStyles = fs.readFileSync('styles/vehicle.css', 'utf8');

test('presents one verified price-offer path without direct purchase competition', () => {
  assert.match(html, /<h2 id="digitalSalespersonTitle">Hintaehdotus<\/h2>/);
  assert.match(html, /Aloita hinnan neuvottelu/);
  assert.doesNotMatch(html, /Osta \/ Varaa|Nopea asiointi|Jatka ostoon tai varaukseen/);
  assert.doesNotMatch(html, /id="directPurchaseTitle"|id="btnDirectPurchase"/);
});

test('avoids auction, bidding, discount-promise, and generic chatbot labels', () => {
  for (const forbidden of ['Tee tarjous', 'Tarjoa hinta', 'Huuda auto', 'AI-chat', 'Chatbot', 'huutokauppa']) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test('removes person identity and general vehicle question actions', () => {
  assert.doesNotMatch(html, /Laura|Kysy autosta|Kysy auton kunnosta|Kysy rahoituksesta|data-question/);
  assert.doesNotMatch(uiScript, /Laura|Mika|handleQuestion|PERSONAS/);
  assert.match(html, /Tämä demo ei muodosta sitovaa kauppaa, maksua, rahoitussopimusta tai varausta/);
});

test('shows list price, verified report condition, and an accessible offer form', () => {
  assert.match(html, /id="offerListPrice">95 000 €/);
  assert.match(html, /Olen tutustunut ajoneuvon tietoihin ja kuntoraporttiin/);
  assert.match(html, /Tarjouksen tekeminen edellyttää, että olet tutustunut ajoneuvon kuntoraporttiin/);
  assert.match(html, /<label for="priceInput">Tarjoushinta<\/label>/);
  assert.match(html, /id="priceInput"[^>]+aria-describedby="priceHelp priceError"/);
  assert.match(html, /<button class="btn btn-primary" type="submit">Lähetä tarjous<\/button>/);
});

test('keeps persona out of negotiation transport and contains no client pricing thresholds', () => {
  assert.equal(apiScript.includes('persona'), false);
  for (const confidential of ['floorPrice', 'targetPrice', 'minimumNegotiableOffer', 'counterStep']) {
    assert.equal(apiScript.includes(confidential), false, confidential);
    assert.equal(uiScript.includes(confidential), false, confidential);
  }
  assert.equal(uiScript.includes('reasonCode'), false);
});

test('separates price agreement, provider confirmation, and handover status', () => {
  assert.match(html, /aria-label="Ostopolun vaiheet"/);
  assert.match(html, /id="purchaseStatus" role="status" aria-live="polite"/);
  assert.match(html, /Ota yhteys myyjään/);
  assert.match(uiScript, /Tarjouksesi hyväksyttiin/);
  assert.match(uiScript, /Maksu odottaa vahvistusta/);
  assert.match(uiScript, /Rahoitushakemuksesi on käsittelyssä/);
  assert.match(uiScript, /Auton luovutuksen edellytykset ovat kunnossa/);
  assert.match(uiScript, /Demon maksuvahvistus/);
  assert.match(uiScript, /Demon rahoitusvahvistus/);
  assert.doesNotMatch(uiScript, /Auto on myyty|Auto on nyt sinun|Kauppa on valmis/);
});

test('preserves focus and announces asynchronous purchase state changes', () => {
  assert.match(html, /id="purchaseJourney"[^>]+tabindex="-1"/);
  assert.match(html, /id="purchaseStatus"[^>]+aria-live="polite"[^>]+tabindex="-1"/);
  assert.match(uiScript, /journey\.focus\(\)/);
  assert.match(uiScript, /panel\.focus\(\)/);
});

test('uses one Alfa Romeo source throughout the standalone demo without Audi assets', () => {
  assert.match(demoVehicle, /makeModel: 'Alfa Romeo Giulia Quadrifoglio'/);
  assert.match(demoVehicle, /registration: 'XYZ-123'/);
  assert.match(demoVehicle, /listPrice: 95_000/);
  assert.match(demoVehicle, /agreedPrice: 92_500/);
  assert.match(html, /Hinnasta sovittu · 92 500 €/);
  assert.match(uiScript, /import \{ DEMO_VEHICLE \} from '\.\/demo-vehicle\.js'/);
  assert.doesNotMatch(uiScript, /inventory\.json/);
  assert.match(landing, /src="js\/demo-landing\.js"/);
  for (const surface of [landing, html, uiScript, demoVehicle]) {
    assert.doesNotMatch(surface, /audi/i);
  }
});

test('keeps the demo vehicle identity visible after the final status update', () => {
  assert.match(html, /id="journeyDemoVehicle">Alfa Romeo Giulia Quadrifoglio · XYZ-123/);
  assert.match(uiScript, /setText\('journeyDemoVehicle', vehicleIdentity\(vehicle\)\)/);
  assert.match(uiScript, /setText\('journeyDemoStatus', 'Valmis noudettavaksi'\)/);
});

test('turns only the timeline marker into a check without hiding agreement text', () => {
  assert.match(vehicleStyles, /li\.complete > span:first-child/);
  assert.doesNotMatch(vehicleStyles, /journey-demo-timeline li\.complete span \{/);
});
