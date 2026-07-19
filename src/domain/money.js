'use strict';

class DomainValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = 'VALIDATION_ERROR';
    this.field = field;
  }
}

function requireEuroAmount(value, field = 'amount') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainValidationError(`${field} must be a positive integer amount in euros`, field);
  }
  return value;
}

function requireCurrency(value) {
  if (value !== 'EUR') {
    throw new DomainValidationError('Only EUR is supported', 'currency');
  }
  return value;
}

module.exports = { DomainValidationError, requireEuroAmount, requireCurrency };
