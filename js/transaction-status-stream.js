const TERMINAL_STATES = new Set(['HANDED_OVER', 'VOIDED']);
const STATUS_TEXT = Object.freeze({
  NEGOTIATING: 'Keskustelu hinnasta on käynnissä', PRICE_AGREED: 'Hinnasta sovittu',
  AWAITING_PAYMENT: 'Auto on varattu ja maksu odottaa vahvistusta', PAID: 'Maksu vahvistettu ja auto valmistellaan luovutukseen',
  READY_FOR_HANDOVER: 'Auto on valmis noudettavaksi', HANDED_OVER: 'Auto on noudettu',
  VOIDED: 'Varaus ei ole enää voimassa',
});

export function initializeTransactionStream(transactionId, options = {}) {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(transactionId)) throw new TypeError('Virheellinen transaktiotunniste');
  const EventSourceClass = options.EventSourceClass ?? EventSource;
  const stream = new EventSourceClass(`/api/transactions/${encodeURIComponent(transactionId)}/stream`);
  const journey = document.getElementById(options.journeyId ?? 'purchaseJourney');
  const liveRegion = document.getElementById(options.liveRegionId ?? 'purchaseStatus');

  stream.addEventListener('statusChange', (message) => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    if (event.transactionId !== transactionId || !(event.status in STATUS_TEXT)) return;
    options.onStatusChange?.({ status: event.status, paymentDeadline: event.paymentDeadline });
    if (liveRegion) liveRegion.textContent = `Kaupan tila päivitetty: ${STATUS_TEXT[event.status]}.`;
    if (journey && document.activeElement !== journey) { journey.setAttribute('tabindex', '-1'); journey.focus(); }
    if (TERMINAL_STATES.has(event.status)) stream.close();
  });
  stream.addEventListener('error', () => { options.onConnectionError?.(); });
  return () => stream.close();
}
