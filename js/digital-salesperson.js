import { CustomerNegotiationApi } from './negotiation-api.js';
import { PurchaseFlowApi } from './purchase-flow-api.js';
import { DEMO_VEHICLE } from './demo-vehicle.js';
import { calculateDealSummary, formatSignedEuro, formatSignedPercent } from './deal-summary.js';

const api = new CustomerNegotiationApi();
const purchaseApi = new PurchaseFlowApi();
const state = { vehicle: null, negotiationStarted: false, preNegotiationReportOpened: false, conditionReturnFocus: null, purchasePath: null, demoRun: 0 };
const PURCHASE_PATH = { DIRECT: 'DIRECT_LIST_PRICE', NEGOTIATED: 'NEGOTIATED_PRICE' };
const DEMO_STEP_DELAY_MS = 1_500;
const REDUCED_MOTION_DEMO_STEP_DELAY_MS = 120;

const SALES_EXPERIENCE = {
  name: 'Digitaalinen automyyjä',
  greeting: 'Olet tutustunut auton tietoihin ja kuntoraporttiin. Millä hinnalla voimme tehdä kaupat?',
};

async function loadVehicle() {
  state.vehicle = DEMO_VEHICLE;
  renderVehicle(state.vehicle);
}

function renderVehicle(vehicle) {
  document.title = `${vehicle.makeModel} · ${vehicle.registration} – Kopilotti Sales`;
  setText('breadcrumbVehicle', vehicle.makeModel);
  setText('vehicleTitle', vehicle.makeModel);
  setText('vehicleSubtitle', vehicle.registration);
  setText('vehiclePrice', formatEuro(vehicle.listPrice));
  setText('offerListPrice', formatEuro(vehicle.listPrice));
  setText('vehicleMonthly', '');
  setText('vehicleAvailability', 'Demoajoneuvo');
  const image = document.getElementById('vehicleImage');
  image.src = vehicle.image;
  image.alt = vehicle.imageAlt;

  setText('specMakeModel', vehicle.makeModel);
  setText('specRegistration', vehicle.registration);
  setText('specListPrice', formatEuro(vehicle.listPrice));
  setText('journeyDemoTitle', vehicle.makeModel);
  setText('journeyDemoRegistration', vehicle.registration);
  setText('journeyDemoListPrice', formatEuro(vehicle.listPrice));
  setText('journeyDemoAgreedPrice', `Hinnasta sovittu · ${formatEuro(vehicle.agreedPrice)}`);
  setText('journeyDemoVehicle', vehicleIdentity(vehicle));
  setText('dealSummaryVehicle', vehicle.makeModel);
  setText('dealSummaryRegistration', vehicle.registration);
  setText('dealSummaryListPrice', formatEuro(vehicle.listPrice));
}

function updateDealSummary() {
  const summary = calculateDealSummary(state.vehicle.listPrice, parseEuro(document.getElementById('priceInput').value));
  setText('dealSummaryOffer', summary ? formatEuro(summary.offerPrice) : '—');
  setText('dealSummaryDifference', summary ? formatSignedEuro(summary.difference) : '—');
  setText('dealSummaryPercentage', summary ? formatSignedPercent(summary.percentageDifference) : '—');
}

function showAcceptedDealSummary(approvedAmount) {
  const summary = calculateDealSummary(state.vehicle.listPrice, approvedAmount);
  setText('dealSummaryOfferLabel', 'Sovittu kauppahinta');
  setText('dealSummaryOffer', formatEuro(approvedAmount));
  setText('dealSummaryDifference', formatSignedEuro(summary.difference));
  setText('dealSummaryPercentage', formatSignedPercent(summary.percentageDifference));
  document.getElementById('priceInput').disabled = true;
}

function openFlow() {
  if (!state.preNegotiationReportOpened) {
    setText('negotiationGateStatus', 'Avaa kuntoraportti ennen hinnan neuvottelua.');
    document.getElementById('btnOpenPreNegotiationReport').focus();
    return;
  }
  const flow = document.getElementById('digitalSalespersonFlow');
  flow.classList.remove('hidden');
  document.getElementById('btnStartDigitalSalesperson').setAttribute('aria-expanded', 'true');
  flow.focus();
  startNegotiation();
}

function markPreNegotiationReportOpened() {
  state.preNegotiationReportOpened = true;
  setText('conditionReportAvailability', '✓ Avattu');
  setText('negotiationGateStatus', '✓ Kuntoraporttiin tutustuttu');
  document.getElementById('negotiationGateStatus').classList.add('complete');
  const startButton = document.getElementById('btnStartDigitalSalesperson');
  startButton.disabled = false;
  document.getElementById('btnOpenPreNegotiationReport').textContent = 'Avaa kuntoraportti uudelleen';
}

function openPreNegotiationConditionReport() {
  markPreNegotiationReportOpened();
  const dialog = document.getElementById('preNegotiationConditionReport');
  dialog.showModal();
  document.getElementById('btnClosePreNegotiationReport').focus();
}

function closePreNegotiationConditionReport() {
  document.getElementById('preNegotiationConditionReport').close();
}

function restoreFocusAfterPreNegotiationReport() {
  document.getElementById('btnStartDigitalSalesperson').focus();
}

function closeFlow() {
  document.getElementById('digitalSalespersonFlow').classList.add('hidden');
  document.getElementById('btnStartDigitalSalesperson').setAttribute('aria-expanded', 'false');
  document.getElementById('btnStartDigitalSalesperson').focus();
}

function startNegotiation() {
  if (state.negotiationStarted) return;
  state.negotiationStarted = true;
  document.getElementById('conversation').classList.remove('hidden');
  setText('personaStatus', SALES_EXPERIENCE.name);
  addMessage('salesperson', SALES_EXPERIENCE.greeting, SALES_EXPERIENCE.name);
  document.getElementById('priceInput').focus();
}

async function submitPrice(event) {
  event.preventDefault();
  const input = document.getElementById('priceInput');
  const errorElement = document.getElementById('priceError');
  const offerAmount = parseEuro(input.value);
  errorElement.textContent = '';
  if (!Number.isSafeInteger(offerAmount) || offerAmount <= 0) {
    errorElement.textContent = 'Kirjoita ehdottamasi kauppahinta kokonaisina euroina, esimerkiksi 93 900.';
    input.focus();
    return;
  }

  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  addMessage('customer', formatEuro(offerAmount), 'Sinä');
  const waitingMessage = addMessage('salesperson pending', 'Tarkistan, voimmeko tehdä kaupat tällä hinnalla.', SALES_EXPERIENCE.name);
  try {
    const decision = await api.discussPrice({
      vehicleId: state.vehicle.id,
      offerAmount,
      evidence: `Asiakkaan hintaehdotus on ${offerAmount} EUR.`,
    });
    waitingMessage.remove();
    renderDecision(decision);
    event.currentTarget.classList.add('hidden');
  } catch (_error) {
    waitingMessage.remove();
    addMessage('salesperson decision', 'En voi vahvistaa kauppaa tällä hinnalla suoraan. Tarkistutan vielä, voimmeko tulla hinnassa vastaan. Neuvottelua ei tarvitse aloittaa alusta.', SALES_EXPERIENCE.name);
    renderDecisionActions('escalate');
  } finally {
    submitButton.disabled = false;
  }
}

function renderDecision(decision) {
  const salesperson = SALES_EXPERIENCE.name;
  if (decision.status === 'ACCEPT') {
    showAcceptedDealSummary(decision.approvedAmount);
    addMessage('salesperson decision', `Voimme tehdä kaupat hinnalla ${formatEuro(decision.approvedAmount)}. Jatketaan maksutavan valintaan. ${vehicleIdentity(state.vehicle)}.`, salesperson);
    renderDecisionActions('reserve');
  } else if (decision.status === 'COUNTER') {
    addMessage('salesperson decision', `Lähin hinta, jolla voimme tehdä kaupat, on ${formatEuro(decision.counterAmount)}. Haluatko hyväksyä hinnan ja jatkaa ostoprosessiin?`, salesperson);
    renderDecisionActions('counter');
  } else if (decision.status === 'REJECT') {
    addMessage('salesperson decision', 'Emme voi tehdä kauppoja ehdottamallasi hinnalla. Voit jatkaa neuvottelua tai edetä listahinnalla.', salesperson);
    renderDecisionActions('rejected');
  } else {
    addMessage('salesperson decision', 'En voi vahvistaa kauppaa tällä hinnalla suoraan. Tarkistutan vielä, voimmeko tulla hinnassa vastaan. Neuvottelua ei tarvitse aloittaa alusta.', salesperson);
    renderDecisionActions('escalate');
  }
}

function renderDecisionActions(mode) {
  const container = document.getElementById('decisionActions');
  container.classList.remove('hidden');
  container.replaceChildren();
  if (mode === 'reserve' || mode === 'counter') {
    container.append(createAction(mode === 'counter' ? 'Hyväksy hinta ja jatka' : 'Jatka ostoprosessiin', (event) => beginPurchaseFlow(PURCHASE_PATH.NEGOTIATED, event.currentTarget), true));
  }
  if (mode === 'rejected') {
    container.append(createAction('Jatka listahinnalla', (event) => beginPurchaseFlow(PURCHASE_PATH.DIRECT, event.currentTarget), true));
  }
  if (mode === 'escalate') {
    const note = document.createElement('p');
    note.className = 'purchase-fineprint';
    note.textContent = 'Tämä konseptidemo ei lähetä oikeaa yhteydenottopyyntöä.';
    container.append(note);
  }
  container.append(createAction('Palaa auton tietoihin', closeFlow, false));
}

function createAction(label, handler, primary) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${primary ? 'btn-primary' : 'btn-outline'} purchase-button`;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function addMessage(className, text, speaker) {
  const message = document.createElement('div');
  message.className = `message ${className}`;
  const name = document.createElement('strong');
  name.textContent = speaker;
  const content = document.createElement('span');
  content.textContent = text;
  message.append(name, content);
  const list = document.getElementById('messageList');
  list.append(message);
  list.scrollTop = list.scrollHeight;
  return message;
}

async function beginPurchaseFlow(purchasePath, trigger) {
  state.conditionReturnFocus = trigger || document.activeElement;
  state.purchasePath = purchasePath;
  try {
    await purchaseApi.start({
      vehicleId: state.vehicle.id,
      purchasePath,
      negotiationSessionId: purchasePath === PURCHASE_PATH.NEGOTIATED ? api.getSessionId() : null,
    });
    showDealAgreement(purchasePath);
  } catch (error) {
    const journey = document.getElementById('purchaseJourney');
    journey.classList.remove('hidden');
    setPurchaseStatus('Ostoprosessia ei voitu aloittaa', 'Kaupan tietoja ei muutettu. Yritä uudelleen tai ota yhteys myyjään.');
    journey.focus();
  }
}

function showDealAgreement(purchasePath) {
  document.getElementById('digitalSalespersonFlow').classList.add('hidden');
  document.querySelectorAll('.purchase-card').forEach((card) => card.classList.add('hidden'));
  document.getElementById('conditionReportStep').classList.add('hidden');
  document.getElementById('paymentMethods').classList.add('hidden');
  document.getElementById('demoConfirmation').classList.add('hidden');
  const journey = document.getElementById('purchaseJourney');
  const agreement = document.getElementById('dealAgreement');
  journey.classList.remove('hidden');
  agreement.classList.remove('hidden');
  const negotiated = purchasePath === PURCHASE_PATH.NEGOTIATED;
  setText('purchaseJourneyTitle', negotiated ? `Hinnasta sovittu · ${formatEuro(purchaseApi.session.agreedPrice)}` : 'Ostopolku aloitettu');
  setText('dealAgreementTitle', negotiated ? 'Hinnasta sovittu' : 'Listahinta valittu');
  setText('agreementPrice', formatEuro(purchaseApi.session.agreedPrice));
  setText('agreementVehicle', vehicleIdentity(state.vehicle));
  setPurchaseStatus(
    negotiated ? 'Hinnasta sovittu' : 'Suora ostopolku',
    `${vehicleIdentity(state.vehicle)}. Seuraavaksi tutustut auton kuntoraporttiin.`,
  );
  renderPurchaseProgress('price');
  journey.focus();
}

async function continueToConditionReport() {
  const button = document.getElementById('btnReviewCondition');
  button.disabled = true;
  document.getElementById('dealAgreement').classList.add('hidden');
  document.getElementById('purchaseJourney').classList.add('hidden');
  const step = document.getElementById('conditionReportStep');
  resetConditionReportView();
  step.classList.remove('hidden');
  step.focus();
  setConditionStatus('Kuntoraporttia ladataan…');
  try { await loadConditionReport(); }
  catch (error) { showConditionFailure(error); }
  finally { button.disabled = false; }
}

async function loadConditionReport() {
  setConditionStatus('Kuntoraporttia ladataan…');
  const report = await purchaseApi.openReport();
  renderConditionReport(report);
  await afterNextPaint();
  await purchaseApi.markDisplayed();
  setConditionStatus(`Kuntoraportti ${report.version} on avattu. Tutustu kaikkiin raportin osioihin ennen kuittausta.`);
  const form = document.getElementById('conditionAcknowledgementForm');
  form.classList.remove('hidden');
  document.getElementById('conditionAcknowledgement').focus();
}

function renderConditionReport(report) {
  setText('conditionReportMeta', `Raportti ${report.id} · versio ${report.version} · tarkastettu ${formatDate(report.inspectedAt)}`);
  const sections = document.getElementById('conditionReportSections');
  sections.replaceChildren(...report.sections.map((section) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'condition-section';
    const heading = document.createElement('h3');
    heading.textContent = section.title;
    const content = document.createElement('p');
    content.textContent = section.content;
    wrapper.append(heading, content);
    return wrapper;
  }));

  const photographSection = document.getElementById('conditionPhotographs');
  const grid = document.getElementById('conditionPhotoGrid');
  grid.replaceChildren(...report.photographs.map((photo) => {
    const figure = document.createElement('figure');
    figure.className = 'condition-photo';
    const image = document.createElement('img');
    image.src = purchaseApi.assetUrl(photo.url);
    image.alt = photo.alt;
    const caption = document.createElement('figcaption');
    caption.textContent = photo.caption || photo.alt;
    figure.append(image, caption);
    return figure;
  }));
  photographSection.classList.toggle('hidden', report.photographs.length === 0);

  const source = document.getElementById('conditionReportSource');
  if (report.sourceDocumentUrl) {
    source.href = purchaseApi.assetUrl(report.sourceDocumentUrl);
    source.classList.remove('hidden');
  } else {
    source.removeAttribute('href');
    source.classList.add('hidden');
  }
  document.getElementById('conditionReportContent').classList.remove('hidden');
}

async function submitConditionAcknowledgement(event) {
  event.preventDefault();
  const checkbox = document.getElementById('conditionAcknowledgement');
  const button = document.getElementById('btnProceedAfterCondition');
  if (!checkbox.checked || button.disabled) return;
  button.disabled = true;
  setText('conditionReportError', '');
  try {
    await purchaseApi.acknowledge();
    showPaymentSelection();
  } catch (error) {
    if (error.code === 'CONDITION_REPORT_CHANGED') {
      setConditionStatus('Auton kuntoraportti on päivittynyt. Tutustu uuteen versioon ennen kuin jatkat.', 'review');
      resetAcknowledgement();
      try { await loadConditionReport(); } catch (loadError) { showConditionFailure(loadError); }
    } else {
      setText('conditionReportError', 'Kuittausta ei voitu tallentaa. Emme siirry rahoitukseen tai maksamiseen ennen kuin palvelinyhteys toimii.');
    }
  }
}

function showPaymentSelection() {
  document.getElementById('conditionReportStep').classList.add('hidden');
  const journey = document.getElementById('purchaseJourney');
  journey.classList.remove('hidden');
  document.getElementById('paymentMethods').classList.remove('hidden');
  document.getElementById('demoConfirmation').classList.add('hidden');
  document.getElementById('dealAgreement').classList.add('hidden');
  setText('purchaseJourneyTitle', 'Hinnasta sovittu');
  setPurchaseStatus('Kuntoraportti kuitattu', 'Valitse, haluatko jatkaa maksamiseen vai hakea rahoitusta.');
  renderPurchaseProgress('provider');
  journey.focus();
}

async function selectPayment(event) {
  const button = event.target.closest('button[data-payment-method]');
  if (!button) return;
  const method = button.dataset.paymentMethod;
  document.querySelectorAll('[data-payment-method]').forEach((control) => { control.disabled = true; });
  setPurchaseStatus(method === 'PAYMENT' ? 'Maksua käynnistetään' : 'Rahoitushakemusta käynnistetään', 'Odotetaan palveluyhteyttä…');
  try {
    await purchaseApi.selectPaymentMethod(method);
    const pending = await purchaseApi.startProvider();
    document.getElementById('paymentMethods').classList.add('hidden');
    renderProviderStatus(pending);
  } catch (error) {
    const message = method === 'PAYMENT'
      ? 'Maksupalveluun ei saatu yhteyttä. Maksua ei ole vahvistettu.'
      : 'Rahoituspalveluun ei saatu yhteyttä. Rahoitusta ei ole vahvistettu.';
    setPurchaseStatus('Yhteys ei onnistunut', message);
    document.querySelectorAll('[data-payment-method]').forEach((control) => { control.disabled = false; });
  }
}

function renderProviderStatus(session) {
  const payment = session.paymentMethod === 'PAYMENT';
  setText('purchaseJourneyTitle', 'Maksu odottaa vahvistusta');
  setPurchaseStatus(
    'Auto on varattu. Maksua odotetaan.',
    payment
      ? 'Jatkamme heti, kun maksupalvelu on vahvistanut maksun.'
      : 'Rahoitushakemuksesi on käsittelyssä. Rahoituksen vahvistaa erillinen rahoitusyhtiö.',
  );
  renderPurchaseProgress('provider');
  if (session.simulated) showDemoConfirmation(session.paymentMethod);
}

function showDemoConfirmation(method) {
  const container = document.getElementById('demoConfirmation');
  const note = document.createElement('p');
  note.className = 'purchase-fineprint';
  note.textContent = 'Simuloitu vahvistus on käytettävissä vain tässä konseptidemossa.';
  const button = createAction(method === 'PAYMENT' ? 'Demon maksuvahvistus' : 'Demon rahoitusvahvistus', () => confirmDemo(method), true);
  container.replaceChildren(note, button);
  container.classList.remove('hidden');
  button.focus();
}

async function confirmDemo(method) {
  const container = document.getElementById('demoConfirmation');
  const button = container.querySelector('button');
  button.disabled = true;
  try {
    const session = await purchaseApi.confirmDemo(method);
    container.classList.add('hidden');
    renderConfirmedStatus(session);
  } catch (_error) {
    setPurchaseStatus('Vahvistus ei onnistunut', method === 'PAYMENT' ? 'Maksua ei ole vahvistettu.' : 'Rahoitusta ei ole vahvistettu.');
    button.disabled = false;
    button.focus();
  }
}

function renderConfirmedStatus(session) {
  if (session.status === 'READY_FOR_HANDOVER') {
    setText('purchaseJourneyTitle', 'Valmis noudettavaksi');
    setPurchaseStatus('Valmis noudettavaksi', `${vehicleIdentity(state.vehicle)}. Auton luovutuksen edellytykset ovat kunnossa. Saat seuraavaksi nouto- tai toimitusohjeet.`);
    renderPurchaseProgress('handover');
    return;
  }
  const payment = session.status === 'PAYMENT_CONFIRMED';
  setText('purchaseJourneyTitle', payment ? 'Maksu vahvistettu' : 'Rahoitus vahvistettu');
  setPurchaseStatus(
    payment ? 'Maksu vahvistettu' : 'Rahoitus vahvistettu',
    payment
      ? 'Maksu on vahvistettu. Tarkistamme seuraavaksi auton luovutuksen edellytykset.'
      : 'Rahoitus on vahvistettu. Tarkistamme seuraavaksi auton luovutuksen edellytykset.',
  );
}

function setPurchaseStatus(title, message) {
  const panel = document.getElementById('purchaseStatus');
  const heading = document.createElement('strong');
  const text = document.createElement('span');
  heading.textContent = title;
  text.textContent = message;
  panel.replaceChildren(heading, text);
  if (!document.getElementById('purchaseJourney').classList.contains('hidden')) panel.focus();
}

function renderPurchaseProgress(current) {
  const order = ['price', 'condition', 'provider', 'handover'];
  const index = order.indexOf(current);
  document.querySelectorAll('[data-progress]').forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.progress);
    item.classList.toggle('complete', itemIndex < index);
    item.classList.toggle('current', itemIndex === index);
    if (itemIndex === index) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  });
}

function showConditionFailure(error) {
  document.getElementById('conditionReportContent').classList.add('hidden');
  document.getElementById('conditionAcknowledgementForm').classList.add('hidden');
  if (error.code === 'CONDITION_REPORT_REVIEW_REQUIRED') {
    setConditionStatus('Auton kuntotiedot vaativat myyjän tarkistuksen. Pyyntö on välitetty eteenpäin.', 'review');
  } else {
    setConditionStatus('Auton kuntoraporttia ei saatu avattua. Emme siirry rahoitukseen tai maksamiseen ennen kuin raportti on saatavilla.', 'error');
  }
}

function resetConditionReportView() {
  document.getElementById('conditionReportContent').classList.add('hidden');
  document.getElementById('conditionAcknowledgementForm').classList.add('hidden');
  document.getElementById('conditionReportSections').replaceChildren();
  document.getElementById('conditionPhotoGrid').replaceChildren();
  setText('conditionReportError', '');
  resetAcknowledgement();
}

function resetAcknowledgement() {
  const checkbox = document.getElementById('conditionAcknowledgement');
  checkbox.checked = false;
  document.getElementById('btnProceedAfterCondition').disabled = true;
}

function closeConditionReport() {
  document.getElementById('conditionReportStep').classList.add('hidden');
  if (purchaseApi.session) {
    const journey = document.getElementById('purchaseJourney');
    document.getElementById('dealAgreement').classList.remove('hidden');
    journey.classList.remove('hidden');
    journey.focus();
  } else if (state.conditionReturnFocus?.isConnected) state.conditionReturnFocus.focus();
}

function setConditionStatus(text, variant = '') {
  const status = document.getElementById('conditionReportStatus');
  status.textContent = text;
  status.className = `condition-status ${variant}`.trim();
}

function afterNextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function parseEuro(value) { return Number(String(value).replace(/[^0-9]/g, '')); }
function formatEuro(value) { return `${formatNumber(value)} €`; }
function formatNumber(value) { return Number(value).toLocaleString('fi-FI'); }
function formatDate(value) { return new Date(value).toLocaleString('fi-FI', { dateStyle: 'medium', timeStyle: 'short' }); }
function setText(id, value) { document.getElementById(id).textContent = value; }
function vehicleIdentity(vehicle) { return `${vehicle.makeModel} · ${vehicle.registration}`; }

const DEMO_STEPS = [
  ['condition', 'Kuntoraportti avattu'],
  ['offer', 'Hintaehdotus'],
  ['agreement', `Hinnasta sovittu: ${formatEuro(DEMO_VEHICLE.agreedPrice)}`],
  ['payment', 'Maksutavaksi valittu käteinen / tilisiirto'],
  ['waiting', 'Auto on varattu. Maksua odotetaan. Varaus voimassa 22.7.2026 klo 18.00 asti.'],
  ['confirmed', 'Maksu vahvistettu. Auto valmistellaan luovutukseen.'],
  ['ready', 'Valmis noudettavaksi'],
];

async function runDemo() {
  const run = ++state.demoRun;
  markPreNegotiationReportOpened();
  const button = document.getElementById('btnRunDemo');
  const timeline = document.getElementById('journeyDemoTimeline');
  button.disabled = true;
  timeline.classList.remove('hidden');
  document.querySelectorAll('[data-demo-step]').forEach((item) => item.classList.remove('current', 'complete'));
  const delay = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? REDUCED_MOTION_DEMO_STEP_DELAY_MS
    : DEMO_STEP_DELAY_MS;
  for (let index = 0; index < DEMO_STEPS.length; index += 1) {
    if (run !== state.demoRun) return;
    const [key, message] = DEMO_STEPS[index];
    document.querySelectorAll('[data-demo-step]').forEach((item, itemIndex) => {
      item.classList.toggle('complete', itemIndex < index);
      item.classList.toggle('current', item.dataset.demoStep === key);
    });
    setText('journeyDemoStatus', message);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  document.querySelectorAll('[data-demo-step]').forEach((item) => { item.classList.remove('current'); item.classList.add('complete'); });
  setText('journeyDemoStatus', 'Valmis noudettavaksi');
  button.disabled = false;
  button.textContent = 'Run Demo uudelleen';
  button.focus();
}

document.getElementById('btnStartDigitalSalesperson').addEventListener('click', openFlow);
document.getElementById('btnOpenPreNegotiationReport').addEventListener('click', openPreNegotiationConditionReport);
document.getElementById('btnClosePreNegotiationReport').addEventListener('click', closePreNegotiationConditionReport);
document.getElementById('preNegotiationConditionReport').addEventListener('close', restoreFocusAfterPreNegotiationReport);
document.getElementById('btnCloseFlow').addEventListener('click', closeFlow);
document.getElementById('btnRunDemo').addEventListener('click', runDemo);
document.getElementById('btnReviewCondition').addEventListener('click', continueToConditionReport);
document.getElementById('priceForm').addEventListener('submit', submitPrice);
document.getElementById('priceInput').addEventListener('input', updateDealSummary);
document.getElementById('conditionAcknowledgement').addEventListener('change', (event) => {
  document.getElementById('btnProceedAfterCondition').disabled = !event.currentTarget.checked;
});
document.getElementById('conditionAcknowledgementForm').addEventListener('submit', submitConditionAcknowledgement);
document.getElementById('btnBackFromCondition').addEventListener('click', closeConditionReport);
document.getElementById('paymentMethods').addEventListener('click', selectPayment);
document.getElementById('btnContactSeller').addEventListener('click', () => {
  setPurchaseStatus('Ota yhteys myyjään', 'Tämä konseptidemo ei lähetä oikeaa yhteydenottopyyntöä. Myyjä voi auttaa poikkeustilanteissa ja lisäkysymyksissä.');
});
loadVehicle().catch(() => {
  setText('vehicleTitle', 'Ajoneuvotietoja ei voitu ladata');
  setText('vehicleSubtitle', 'Palaa takaisin autoihin ja yritä uudelleen.');
});
