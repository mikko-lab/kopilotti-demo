export function calculateDealSummary(listPrice, offerPrice) {
  if (!Number.isSafeInteger(listPrice) || listPrice <= 0 || !Number.isSafeInteger(offerPrice) || offerPrice <= 0) return null;
  const difference = offerPrice - listPrice;
  return Object.freeze({ offerPrice, difference, percentageDifference: (difference / listPrice) * 100 });
}

export function parseEuroInput(value) {
  const normalized = String(value).trim().replace(/\s/g, '').replace(/€$/, '');
  if (!/^\d+$/.test(normalized)) return Number.NaN;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : Number.NaN;
}

export function formatSignedEuro(value) {
  return `${signFor(value)}${localizedNumber(Math.abs(value))} €`;
}

export function formatSignedPercent(value) {
  const magnitude = localizedNumber(Math.abs(value), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${signFor(value)}${magnitude} %`;
}

function localizedNumber(value, options) {
  return value.toLocaleString('fi-FI', options).replace(/\u00a0/g, ' ');
}

function signFor(value) {
  if (value < 0) return '−';
  if (value > 0) return '+';
  return '';
}
