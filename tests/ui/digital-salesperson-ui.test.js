'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('vehicle.html', 'utf8');
const uiScript = fs.readFileSync('js/digital-salesperson.js', 'utf8');
const apiScript = fs.readFileSync('js/negotiation-api.js', 'utf8');

test('presents the digital salesperson as an additional dealership purchase path', () => {
  assert.match(html, /<h2 id="directPurchaseTitle">Osta \/ Varaa<\/h2>/);
  assert.match(html, /<h2 id="digitalSalespersonTitle">Digitaalinen automyyjä<\/h2>/);
  assert.match(html, /Haluatko keskustella tämän auton hinnasta\?/);
  assert.match(html, /Aloita keskustelu/);
  assert.match(html, /ei korvaa automyyjää\. Se korvaa odottamisen/);
});

test('avoids auction, bidding, discount-promise, and generic chatbot labels', () => {
  for (const forbidden of ['Tee tarjous', 'Tarjoa hinta', 'Huuda auto', 'AI-chat', 'Chatbot', 'huutokauppa']) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test('uses semantic persona controls and explicit non-binding demo copy', () => {
  assert.match(html, /<fieldset class="persona-fieldset">/);
  assert.match(html, /type="radio" name="persona" value="laura"/);
  assert.match(html, /type="radio" name="persona" value="mika"/);
  assert.match(html, /Tämä demo ei muodosta sitovaa kauppaa, maksua, rahoitussopimusta tai varausta/);
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
  assert.match(uiScript, /Hinnasta on sovittu/);
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
