'use strict';

const { DomainValidationError, requireEuroAmount } = require('./money');

const CONFIDENTIAL_POLICY_FIELDS = Object.freeze([
  'targetPrice',
  'floorPrice',
  'minimumNegotiableOffer',
  'counterStep',
]);

function validatePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainValidationError('Policy must be an object', 'policy');
  }
  const policy = {
    vehicleId: requireString(input.vehicleId, 'vehicleId'),
    listPrice: requireEuroAmount(input.listPrice, 'listPrice'),
    targetPrice: requireEuroAmount(input.targetPrice, 'targetPrice'),
    floorPrice: requireEuroAmount(input.floorPrice, 'floorPrice'),
    maxRounds: requireBoundedInteger(input.maxRounds, 'maxRounds', 1, 20),
    minimumNegotiableOffer: requireEuroAmount(input.minimumNegotiableOffer, 'minimumNegotiableOffer'),
    counterStep: requireEuroAmount(input.counterStep, 'counterStep'),
    reservationEligible: requireBoolean(input.reservationEligible, 'reservationEligible'),
    policyVersion: requireString(input.policyVersion, 'policyVersion'),
  };

  if (policy.floorPrice > policy.targetPrice || policy.targetPrice > policy.listPrice) {
    throw new DomainValidationError('Policy prices must satisfy floorPrice <= targetPrice <= listPrice', 'policy');
  }
  if (policy.minimumNegotiableOffer < policy.floorPrice || policy.minimumNegotiableOffer > policy.targetPrice) {
    throw new DomainValidationError('minimumNegotiableOffer must be between floorPrice and targetPrice', 'minimumNegotiableOffer');
  }
  if (policy.counterStep > policy.listPrice - policy.floorPrice) {
    throw new DomainValidationError('counterStep exceeds the negotiable price range', 'counterStep');
  }
  return Object.freeze(policy);
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainValidationError(`${field} is required`, field);
  return value.trim();
}

function requireBoundedInteger(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DomainValidationError(`${field} must be an integer between ${min} and ${max}`, field);
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') throw new DomainValidationError(`${field} must be boolean`, field);
  return value;
}

module.exports = { CONFIDENTIAL_POLICY_FIELDS, validatePolicy };
