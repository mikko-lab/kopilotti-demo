'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('vehicle.html', 'utf8');
const landing = fs.readFileSync('index.html', 'utf8');
const uiScript = fs.readFileSync('js/digital-salesperson.js', 'utf8');
const demoVehicle = fs.readFileSync('js/demo-vehicle.js', 'utf8');
const apiScript = fs.readFileSync('js/negotiation-api.js', 'utf8');
const purchaseApiScript = fs.readFileSync('js/purchase-flow-api.js', 'utf8');
const vehicleStyles = fs.readFileSync('styles/vehicle.css', 'utf8');
const dealSummarySource = fs.readFileSync('js/deal-summary.js', 'utf8');
const staticServer = fs.readFileSync('scripts/serve-static-demo.js', 'utf8');
const packageManifest = fs.readFileSync('package.json', 'utf8');
const dealSummaryModule = import(`data:text/javascript;base64,${Buffer.from(dealSummarySource).toString('base64')}`);
const negotiationStart = html.indexOf('<section class="salesperson-flow');
const negotiationEnd = html.indexOf('<section class="purchase-card journey-demo-card');
const negotiationMarkup = html.slice(negotiationStart, negotiationEnd);
const submitPriceSource = uiScript.slice(uiScript.indexOf('async function submitPrice'), uiScript.indexOf('function renderDecision('));

test('presents one verified price-offer path without direct purchase competition', () => {
  assert.match(html, /<h2 id="digitalSalespersonTitle">Hinnan neuvottelu<\/h2>/);
  assert.match(html, /Aloita hinnan neuvottelu/);
  assert.match(vehicleStyles, /\.digital-salesperson-card > \.negotiation-gate-status \+ \.purchase-button \{ margin-top: var\(--space-3\); \}/);
  assert.doesNotMatch(html, /Osta \/ Varaa|Nopea asiointi|Jatka ostoon tai varaukseen/);
  assert.doesNotMatch(html, /id="directPurchaseTitle"|id="btnDirectPurchase"/);
});

test('avoids auction, bidding, discount-promise, and generic chatbot labels', () => {
  for (const forbidden of ['Tee tarjous', 'Tarjoa hinta', 'Huuda auto', 'Lähetä tarjous', 'Tarjousyhteenveto', 'Tarjoushinta', 'AI-chat', 'Chatbot', 'huutokauppa']) {
    assert.equal(`${html}\n${uiScript}`.includes(forbidden), false, forbidden);
  }
});

test('removes person identity and general vehicle question actions', () => {
  assert.doesNotMatch(html, /Laura|Kysy autosta|Kysy auton kunnosta|Kysy rahoituksesta|data-question/);
  assert.doesNotMatch(uiScript, /Laura|Mika|handleQuestion|PERSONAS/);
  assert.match(html, /Tämä demo ei muodosta sitovaa kauppaa, maksua, rahoitussopimusta tai varausta/);
});

test('requires the inspection report before enabling the accessible negotiation form', () => {
  assert.doesNotMatch(html, /id="offerListPrice"/);
  assert.match(html, /id="specListPrice">95 000 €/);
  assert.match(html, /id="btnOpenPreNegotiationReport"[^>]+type="button"[^>]*>Avaa kuntoraportti<\/button>/);
  assert.match(html, /id="btnStartDigitalSalesperson"[^>]+disabled/);
  assert.match(html, /id="negotiationGateStatus" role="status" aria-live="polite"/);
  assert.match(html, /Tutustu auton tietoihin ja kuntoraporttiin ennen hinnan neuvottelua/);
  assert.doesNotMatch(html, /Olen tutustunut ajoneuvon tietoihin ja kuntoraporttiin/);
  assert.match(html, /Millä hinnalla voimme tehdä kaupat\?/);
  assert.match(html, /<label for="priceInput">Ehdottamasi kauppahinta<\/label>/);
  assert.match(html, /id="priceInput"[^>]+aria-describedby="priceHelp priceError"/);
  assert.match(html, /<button class="btn btn-primary" type="submit">Ehdota hintaa<\/button>/);
});

test('opening the demo report records completion, enables negotiation, and restores focus', () => {
  assert.match(uiScript, /state\.preNegotiationReportOpened = true/);
  assert.match(uiScript, /startButton\.disabled = false/);
  assert.match(uiScript, /✓ Kuntoraporttiin tutustuttu/);
  assert.match(uiScript, /reportButton\.textContent = 'Avaa uudelleen'/);
  assert.match(uiScript, /reportButton\.setAttribute\('aria-label', 'Avaa kuntoraportti uudelleen'\)/);
  assert.match(uiScript, /dialog\.showModal\(\)/);
  assert.match(uiScript, /preNegotiationConditionReport'\)\.addEventListener\('close', restoreFocusAfterPreNegotiationReport\)/);
  assert.match(uiScript, /btnStartDigitalSalesperson'\)\.focus\(\)/);
  assert.match(uiScript, /if \(!state\.preNegotiationReportOpened\)/);
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
  assert.match(uiScript, /Voimme tehdä kaupat hinnalla \$\{formatEuro\(decision\.approvedAmount\)\}\. Jatketaan maksutavan valintaan\./);
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

test('shows a textual deal summary with vehicle, registration, list price, offer and difference', () => {
  assert.match(html, /id="dealSummaryTitle">Kaupan yhteenveto/);
  assert.doesNotMatch(negotiationMarkup, /Hinnan tueksi|Kaupan kohde/);
  assert.match(html, /id="dealSummaryImage"[^>]+src="assets\/cars\/demo-vehicle-placeholder\.svg"[^>]+alt="Geneerinen demokuva ajoneuvosta"/);
  assert.match(uiScript, /summaryImage\.src = vehicle\.image/);
  assert.match(uiScript, /summaryImage\.alt = 'Geneerinen demokuva ajoneuvosta'/);
  assert.match(html, /id="dealSummaryVehicle">Alfa Romeo Giulia Quadrifoglio/);
  assert.match(html, /id="dealSummaryRegistration">XYZ-123/);
  assert.match(html, /id="dealSummaryListPrice">95 000 €/);
  assert.match(html, /id="dealSummaryOffer">Ei vielä annettu/);
  assert.match(html, /id="dealSummaryDifference">—<\/dd>/);
  assert.doesNotMatch(html, /id="dealSummaryPercentage"|— €/);
  assert.match(html, /aria-label="Ero listahintaan"/);
  assert.doesNotMatch(html, /class="deal-summary"[^>]+aria-live/);
  assert.doesNotMatch(negotiationMarkup, /<figcaption|>Geneerinen demokuva ajoneuvosta</);
  assert.doesNotMatch(vehicleStyles, /\.deal-summary\s*\{[^}]*display:\s*none/);
});

test('uses one clear negotiation heading and asks the main question only once in the flow', () => {
  assert.equal((negotiationMarkup.match(/Millä hinnalla voimme tehdä kaupat\?/g) || []).length, 1);
  assert.equal((negotiationMarkup.match(/id="flowTitle">Hinnan neuvottelu</g) || []).length, 1);
  assert.match(negotiationMarkup, /id="flowVehicle">Alfa Romeo Giulia Quadrifoglio · XYZ-123/);
  assert.match(negotiationMarkup, /id="negotiationAgentTitle">Digitaalinen automyyjä/);
  assert.doesNotMatch(negotiationMarkup, /Neuvottelu auton hinnasta|Hinnan tueksi|Kaupan kohde/);
});

test('updates the deal summary on every price input without waiting for submit', () => {
  assert.match(uiScript, /priceInput'\)\.addEventListener\('input', updateDealSummary\)/);
  assert.match(uiScript, /calculateDealSummary\(state\.vehicle\.listPrice/);
  assert.match(uiScript, /`\$\{formatSignedEuro\(summary\.difference\)\} · \$\{formatSignedPercent\(summary\.percentageDifference\)\}`/);
});

test('parses spaced and compact 94 100 euro input as the same integer amount', async () => {
  const { parseEuroInput } = await dealSummaryModule;
  assert.equal(parseEuroInput('94 100'), 94_100);
  assert.equal(parseEuroInput('94100'), 94_100);
  assert.equal(parseEuroInput('94 100 €'), 94_100);
});

test('calculates and formats a 92 500 euro offer against 95 000 correctly', async () => {
  const { calculateDealSummary, formatSignedEuro, formatSignedPercent } = await dealSummaryModule;
  const summary = calculateDealSummary(95_000, 92_500);
  assert.deepEqual({ offerPrice: summary.offerPrice, difference: summary.difference }, { offerPrice: 92_500, difference: -2_500 });
  assert.equal(formatSignedEuro(summary.difference), '−2 500 €');
  assert.equal(formatSignedPercent(summary.percentageDifference), '−2,6 %');
});

test('calculates and formats a 93 900 euro offer against 95 000 correctly', async () => {
  const { calculateDealSummary, formatSignedEuro, formatSignedPercent } = await dealSummaryModule;
  const summary = calculateDealSummary(95_000, 93_900);
  assert.deepEqual({ offerPrice: summary.offerPrice, difference: summary.difference }, { offerPrice: 93_900, difference: -1_100 });
  assert.equal(formatSignedEuro(summary.difference), '−1 100 €');
  assert.equal(formatSignedPercent(summary.percentageDifference), '−1,2 %');
});

test('stacks summary before input by default and uses two columns when the negotiation panel has desktop width', () => {
  assert.ok(html.indexOf('class="deal-summary"') < html.indexOf('class="negotiation-input"'));
  assert.ok(html.indexOf('id="negotiationAgentTitle"') < html.indexOf('for="priceInput"'));
  assert.doesNotMatch(uiScript, /function startNegotiation\(\) \{[\s\S]*?priceInput'\)\.focus\(\)[\s\S]*?\n\}/);
  assert.match(vehicleStyles, /\.conversation \{ container-type: inline-size/);
  assert.match(vehicleStyles, /@container \(min-width: 560px\)/);
  assert.match(vehicleStyles, /grid-template-columns: minmax\(320px, 1\.6fr\) minmax\(220px, 1fr\)/);
  assert.match(vehicleStyles, /grid-template-areas: 'input summary'/);
  assert.match(vehicleStyles, /\.deal-summary \{ grid-area: summary/);
  assert.match(vehicleStyles, /\.deal-summary-image \{ display: block; width: 100%; max-height: 150px/);
  assert.match(vehicleStyles, /@media \(max-width: 639px\)[\s\S]*?\.price-input-row \.btn \{ width: 100%; \}/);
});

test('accepted manual offer locks input and changes summary to agreed price', () => {
  assert.match(html, /id="dealSummaryOfferLabel">Ehdottamasi hinta/);
  assert.match(uiScript, /setText\('dealSummaryOfferLabel', 'Sovittu kauppahinta'\)/);
  assert.match(uiScript, /priceInput'\)\.disabled = true/);
  assert.match(submitPriceSource, /const form = event\.currentTarget/);
  assert.match(submitPriceSource, /form\.classList\.add\('hidden'\)/);
  assert.doesNotMatch(submitPriceSource, /event\.currentTarget\.classList\.add/);
  assert.match(uiScript, /Voimme tehdä kaupat hinnalla \$\{formatEuro\(decision\.approvedAmount\)\}\. Jatketaan maksutavan valintaan\./);
  assert.match(uiScript, /Hinnasta sovittu · \$\{formatEuro\(purchaseApi\.session\.agreedPrice\)\}/);
});

test('does not disguise transport failures as a commercial review decision', () => {
  assert.match(uiScript, /Hinnan tarkistaminen ei onnistunut juuri nyt\. Kaupan tietoja ei muutettu\./);
  assert.match(uiScript, /renderDecisionActions\('unavailable'\)/);
  assert.doesNotMatch(submitPriceSource, /Tarkistutan vielä, voimmeko tulla hinnassa vastaan/);
});

test('binds native browser fetch before storing it on API client instances', () => {
  assert.match(apiScript, /fetchImpl = globalThis\.fetch\.bind\(globalThis\)/);
  assert.match(purchaseApiScript, /fetchImpl = globalThis\.fetch\.bind\(globalThis\)/);
});

test('uses dealership language while checking, accepting, and escalating a price', () => {
  assert.match(uiScript, /Tarkistan, voimmeko tehdä kaupat tällä hinnalla\./);
  assert.match(uiScript, /En voi vahvistaa kauppaa tällä hinnalla suoraan\. Tarkistutan vielä, voimmeko tulla hinnassa vastaan\./);
  assert.match(uiScript, /Lähin hinta, jolla voimme tehdä kaupat/);
  assert.doesNotMatch(`${html}\n${uiScript}`, /Tarjouksesi|hyväksytty tarjous|vastatarjous|bid accepted|offer accepted|auction/i);
});

test('Run Demo remains pinned to its separate 92 500 euro price', () => {
  assert.match(demoVehicle, /agreedPrice: 92_500/);
  assert.match(html, /Hinnasta sovittu · 92 500 €/);
  assert.match(html, /data-demo-step="condition"[^>]*><span[^>]*>○<\/span>Kuntoraportti avattu/);
  assert.match(uiScript, /async function runDemo\(\) \{[\s\S]*markPreNegotiationReportOpened\(\)/);
  assert.match(html, /id="journeyDemoTitle">Koko asiakaspolku/);
  assert.match(html, /id="btnRunDemo"[^>]*>Katso koko demopolku<\/button>/);
  assert.doesNotMatch(negotiationMarkup, /Run Demo|Katso koko demopolku|journeyDemoTimeline/);
  assert.doesNotMatch(html, /id="journeyDemoRegistration"|id="journeyDemoListPrice"/);
});

test('Run Demo keeps each normal-motion step visible long enough to read', () => {
  assert.match(uiScript, /const DEMO_STEP_DELAY_MS = 1_500/);
  assert.match(uiScript, /const REDUCED_MOTION_DEMO_STEP_DELAY_MS = 120/);
  assert.match(uiScript, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
});

test('static demo does not serve backend pricing policy files to the browser', () => {
  assert.match(packageManifest, /"dev:static": "node scripts\/serve-static-demo\.js"/);
  assert.doesNotMatch(staticServer, /express\.static\(projectRoot/);
  assert.match(staticServer, /app\.use\('\/js'/);
  assert.match(staticServer, /response\.status\(404\)/);
  assert.doesNotMatch(uiScript, /93900|93_900|acceptanceThreshold/);
});
