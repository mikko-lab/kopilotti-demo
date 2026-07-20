import { CustomerNegotiationApi } from './negotiation-api.js';
import { PurchaseFlowApi } from './purchase-flow-api.js';

const api = new CustomerNegotiationApi();
const purchaseApi = new PurchaseFlowApi();
const state = { vehicle: null, persona: 'laura', conditionReturnFocus: null, purchasePath: null, demoRun: 0 };
const PURCHASE_PATH = { DIRECT: 'DIRECT_LIST_PRICE', NEGOTIATED: 'NEGOTIATED_PRICE' };

const PERSONAS = {
  laura: {
    name: 'Laura',
    greeting: (vehicle) => `Hei! Olen Laura. Autan mielelläni ${vehicle.brand} ${vehicle.model} -auton kanssa. Mitä haluaisit tietää?`,
    condition: (vehicle) => `Tämän ${vehicle.year}-mallisen auton mittarilukema on ${formatNumber(vehicle.mileage)} km. Ennen rahoitusta tai maksamista avaamme aina ajoneuvokohtaisen kuntoraportin tutustuttavaksi.`,
    finance: (vehicle) => `Rahoitus on saatavilla tähän autoon. Suuntaa-antava kuukausierä on ${formatNumber(vehicle.estimatedMonthlyPayment)} €/kk, ja lopullinen rahoitus vahvistetaan erikseen.`,
    priceIntro: 'Totta kai. Voit kertoa hinnan, josta haluaisit keskustella. Välitän sen heti hinnoittelusta vastaavalle järjestelmälle.',
  },
  mika: {
    name: 'Mika',
    greeting: (vehicle) => `Hei, olen Mika. Käydään ${vehicle.brand} ${vehicle.model} ja kaupan eteneminen tehokkaasti läpi. Mistä aloitetaan?`,
    condition: (vehicle) => `Vuosimalli ${vehicle.year}, ajettu ${formatNumber(vehicle.mileage)} km. Ajoneuvokohtainen kuntoraportti avataan pakollisena vaiheena ennen rahoitusta tai maksamista.`,
    finance: (vehicle) => `Rahoitus saatavilla. Arvio ${formatNumber(vehicle.estimatedMonthlyPayment)} €/kk. Lopulliset ehdot vahvistetaan erikseen.`,
    priceIntro: 'Kerro hinta, josta haluat keskustella. Välitän sen heti päätettäväksi.',
  },
};

async function loadVehicle() {
  const requestedId = new URLSearchParams(location.search).get('id') || 'veh-0001';
  const inventory = await fetch('./inventory.json').then((response) => {
    if (!response.ok) throw new Error('Ajoneuvotietoja ei voitu ladata');
    return response.json();
  });
  const selected = inventory.find((vehicle) => vehicle.id === requestedId) || inventory[0];
  state.vehicle = { ...selected, registrationNumber: selected.registrationNumber || demoRegistrationNumber(selected.id) };
  renderVehicle(state.vehicle);
}

function renderVehicle(vehicle) {
  document.title = `${vehicle.brand} ${vehicle.model} ${vehicle.trim} — Kopilotti`;
  setText('breadcrumbVehicle', `${vehicle.brand} ${vehicle.model}`);
  setText('vehicleTitle', `${vehicle.brand} ${vehicle.model} ${vehicle.trim}`);
  setText('vehicleSubtitle', `${vehicle.year} · ${vehicle.fuel} · ${vehicle.transmission}`);
  setText('vehiclePrice', formatEuro(vehicle.price));
  setText('directPrice', formatEuro(vehicle.price));
  setText('vehicleMonthly', `alkaen ${formatNumber(vehicle.estimatedMonthlyPayment)} €/kk`);
  setText('vehicleAvailability', availabilityLabel(vehicle.available));
  const image = document.getElementById('vehicleImage');
  image.src = vehicle.image;
  image.alt = `${vehicle.brand} ${vehicle.model} -auton esimerkkikuva`;

  const specs = [
    ['Vuosimalli', vehicle.year], ['Mittarilukema', `${formatNumber(vehicle.mileage)} km`],
    ['Käyttövoima', vehicle.fuel], ['Vaihteisto', vehicle.transmission],
    ['Korimalli', bodyTypeLabel(vehicle.bodyType)], ['Väri', vehicle.color],
    ['Toimipiste', vehicle.dealershipLocation], ['Rekisteritunnus', vehicle.registrationNumber],
  ];
  const specsElement = document.getElementById('vehicleSpecs');
  specsElement.replaceChildren(...specs.map(([term, value]) => {
    const wrapper = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value;
    wrapper.append(dt, dd);
    return wrapper;
  }));
  document.getElementById('vehicleEquipment').replaceChildren(...vehicle.features.slice(0, 10).map((feature) => {
    const item = document.createElement('li');
    item.textContent = feature;
    return item;
  }));
}

function openFlow() {
  const flow = document.getElementById('digitalSalespersonFlow');
  flow.classList.remove('hidden');
  document.getElementById('btnStartDigitalSalesperson').setAttribute('aria-expanded', 'true');
  flow.focus();
}

function closeFlow() {
  document.getElementById('digitalSalespersonFlow').classList.add('hidden');
  document.getElementById('btnStartDigitalSalesperson').setAttribute('aria-expanded', 'false');
  document.getElementById('btnStartDigitalSalesperson').focus();
}

function startConversation(event) {
  event.preventDefault();
  state.persona = new FormData(event.currentTarget).get('persona');
  const persona = PERSONAS[state.persona];
  event.currentTarget.classList.add('hidden');
  document.getElementById('conversation').classList.remove('hidden');
  setText('personaStatus', `${persona.name} palvelee nyt`);
  addMessage('salesperson', persona.greeting(state.vehicle), persona.name);
  document.querySelector('[data-question="condition"]').focus();
}

function handleQuestion(event) {
  const button = event.target.closest('button[data-question]');
  if (!button) return;
  const persona = PERSONAS[state.persona];
  const question = button.dataset.question;
  if (question === 'condition') {
    addMessage('customer', 'Millainen auton kunto on?', 'Sinä');
    addMessage('salesperson', persona.condition(state.vehicle), persona.name);
  } else if (question === 'finance') {
    addMessage('customer', 'Onko tähän saatavilla rahoitus?', 'Sinä');
    addMessage('salesperson', persona.finance(state.vehicle), persona.name);
  } else if (question === 'price') {
    addMessage('customer', 'Haluaisin keskustella auton hinnasta.', 'Sinä');
    addMessage('salesperson', persona.priceIntro, persona.name);
    document.getElementById('priceForm').classList.remove('hidden');
    document.getElementById('priceInput').focus();
  }
  button.disabled = true;
}

async function submitPrice(event) {
  event.preventDefault();
  const input = document.getElementById('priceInput');
  const errorElement = document.getElementById('priceError');
  const offerAmount = parseEuro(input.value);
  errorElement.textContent = '';
  if (!Number.isSafeInteger(offerAmount) || offerAmount <= 0) {
    errorElement.textContent = 'Kirjoita hinta kokonaisina euroina, esimerkiksi 29 000.';
    input.focus();
    return;
  }

  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  addMessage('customer', `Haluaisin keskustella hinnasta ${formatEuro(offerAmount)}.`, 'Sinä');
  const waitingMessage = addMessage('salesperson pending', 'Tarkistan asian heti hinnoittelusta vastaavalta järjestelmältä…', PERSONAS[state.persona].name);
  try {
    const decision = await api.discussPrice({
      vehicleId: state.vehicle.id,
      offerAmount,
      evidence: `Asiakas haluaa keskustella hinnasta ${offerAmount} EUR.`,
    });
    waitingMessage.remove();
    renderDecision(decision);
    event.currentTarget.classList.add('hidden');
  } catch (_error) {
    waitingMessage.remove();
    addMessage('salesperson decision', 'Tarvitsemme automyyjän vahvistuksen. Välitämme asian eteenpäin, jotta sinun ei tarvitse aloittaa keskustelua alusta.', PERSONAS[state.persona].name);
    renderDecisionActions('escalate');
  } finally {
    submitButton.disabled = false;
  }
}

function renderDecision(decision) {
  const salesperson = PERSONAS[state.persona].name;
  if (decision.status === 'ACCEPT') {
    document.getElementById('questionActions').classList.add('hidden');
    addMessage('salesperson decision', `Hinnasta on sovittu. Voin vahvistaa hinnaksi ${formatEuro(decision.approvedAmount)}. ${vehicleIdentity(state.vehicle)}.`, salesperson);
    renderDecisionActions('reserve');
  } else if (decision.status === 'COUNTER') {
    addMessage('salesperson decision', `Voimme jatkaa kauppaa hinnalla ${formatEuro(decision.counterAmount)}. Haluatko hyväksyä hinnan ja tutustua seuraavaksi auton kuntoraporttiin?`, salesperson);
    renderDecisionActions('counter');
  } else if (decision.status === 'REJECT') {
    addMessage('salesperson decision', 'Emme voi edetä ehdottamallasi hinnalla. Voit jatkaa keskustelua tai ostaa auton listahinnalla.', salesperson);
    renderDecisionActions('rejected');
  } else {
    addMessage('salesperson decision', 'Tarvitsemme automyyjän vahvistuksen. Välitämme asian eteenpäin.', salesperson);
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
  setText('purchaseJourneyTitle', negotiated ? 'Hinnasta sovittu' : 'Ostopolku aloitettu');
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
function availabilityLabel(value) { return ({ available: 'Heti saatavilla', reserved: 'Varattu', incoming: 'Tulossa' })[value] || 'Saatavuus tarkistettava'; }
function bodyTypeLabel(value) { return ({ sedan: 'Sedan', suv: 'SUV', van: 'Pakettiauto', hatchback: 'Viistoperä', combi: 'Farmari', mpv: 'Tila-auto' })[value] || value; }
function demoRegistrationNumber(vehicleId) { return `KPL-${String(vehicleId).replace(/\D/g, '').slice(-3).padStart(3, '0')}`; }
function vehicleIdentity(vehicle) { return `${vehicle.brand} ${vehicle.model} · ${vehicle.registrationNumber}`; }

const DEMO_STEPS = [
  ['conversation', 'Keskustelu hinnasta'],
  ['agreement', 'Hinnasta sovittu: 92 500 €'],
  ['payment', 'Maksutavaksi valittu käteinen / tilisiirto'],
  ['waiting', 'Auto on varattu. Maksua odotetaan. Varaus voimassa 22.7.2026 klo 18.00 asti.'],
  ['confirmed', 'Maksu vahvistettu. Auto valmistellaan luovutukseen.'],
  ['ready', 'Alfa Romeo Giulia Quadrifoglio · XYZ-123 on valmis noudettavaksi.'],
];

async function runDemo() {
  const run = ++state.demoRun;
  const button = document.getElementById('btnRunDemo');
  const timeline = document.getElementById('journeyDemoTimeline');
  button.disabled = true;
  timeline.classList.remove('hidden');
  document.querySelectorAll('[data-demo-step]').forEach((item) => item.classList.remove('current', 'complete'));
  const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 850;
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
document.getElementById('btnCloseFlow').addEventListener('click', closeFlow);
document.getElementById('btnDirectPurchase').addEventListener('click', (event) => beginPurchaseFlow(PURCHASE_PATH.DIRECT, event.currentTarget));
document.getElementById('btnRunDemo').addEventListener('click', runDemo);
document.getElementById('btnReviewCondition').addEventListener('click', continueToConditionReport);
document.getElementById('personaForm').addEventListener('submit', startConversation);
document.getElementById('questionActions').addEventListener('click', handleQuestion);
document.getElementById('priceForm').addEventListener('submit', submitPrice);
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
