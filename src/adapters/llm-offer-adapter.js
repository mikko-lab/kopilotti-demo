'use strict';

const { DomainValidationError, requireCurrency, requireEuroAmount } = require('../domain/money');

const ALLOWED_CONDITIONS = new Set(['NONE', 'FINANCING_REQUIRED', 'TRADE_IN_INCLUDED']);

/** Converts untrusted structured extraction into a non-authoritative command. */
function adaptExtractedOffer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainValidationError('Extracted offer must be an object', 'extraction');
  }
  if (typeof input.vehicleId !== 'string' || !/^veh-[0-9]{4,}$/.test(input.vehicleId)) {
    throw new DomainValidationError('A valid vehicleId is required', 'vehicleId');
  }
  const condition = input.condition ?? 'NONE';
  if (!ALLOWED_CONDITIONS.has(condition)) throw new DomainValidationError('Unsupported offer condition', 'condition');
  if (typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 500) {
    throw new DomainValidationError('Evidence must contain 1-500 characters', 'evidence');
  }
  return Object.freeze({
    vehicleId: input.vehicleId,
    offerAmount: requireEuroAmount(input.offerAmount, 'offerAmount'),
    currency: requireCurrency(input.currency),
    condition,
    evidence: input.evidence.trim(),
  });
}

module.exports = { adaptExtractedOffer };
