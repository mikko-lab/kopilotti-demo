'use strict';

const { DomainValidationError, requireEuroAmount } = require('./money');

const CONFIDENTIAL_POLICY_FIELDS = Object.freeze([
  'targetPrice',
  'floorPrice',
  'minimumNegotiableOffer',
  'counterStep',
  'acceptanceFloor',
  'minimumOfferForAutomation',
  'counterSteps',
]);

function validatePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainValidationError('Policy must be an object', 'policy');
  }
  const legacyTarget = requireEuroAmount(input.targetPrice, 'targetPrice');
  const legacyFloor = requireEuroAmount(input.floorPrice, 'floorPrice');
  const acceptanceFloor = input.acceptanceFloor === undefined
    ? Math.max(legacyTarget, requireEuroAmount(input.minimumNegotiableOffer, 'minimumNegotiableOffer'))
    : requireEuroAmount(input.acceptanceFloor, 'acceptanceFloor');
  const minimumOfferForAutomation = input.minimumOfferForAutomation === undefined
    ? legacyFloor
    : requireEuroAmount(input.minimumOfferForAutomation, 'minimumOfferForAutomation');
  const maxRounds = requireBoundedInteger(input.maxAutomatedRounds ?? input.maxRounds, 'maxAutomatedRounds', 1, 20);
  const counterSteps = input.counterSteps === undefined
    ? null
    : validateCounterSteps(input.counterSteps, maxRounds);
  const policy = {
    vehicleId: requireString(input.vehicleId, 'vehicleId'),
    dealerId: input.dealerId === undefined ? null : requireString(input.dealerId, 'dealerId'),
    listPrice: requireEuroAmount(input.listPrice, 'listPrice'),
    targetPrice: legacyTarget,
    floorPrice: legacyFloor,
    maxRounds,
    maxAutomatedRounds: maxRounds,
    minimumNegotiableOffer: requireEuroAmount(input.minimumNegotiableOffer, 'minimumNegotiableOffer'),
    counterStep: requireEuroAmount(input.counterStep, 'counterStep'),
    acceptanceFloor,
    minimumOfferForAutomation,
    counterSteps,
    escalationRules: Object.freeze({
      repeatedOrLowerOffer: input.escalationRules?.repeatedOrLowerOffer ?? 'ESCALATE',
      roundsExhausted: input.escalationRules?.roundsExhausted ?? 'REJECT',
    }),
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
  if (policy.acceptanceFloor > policy.listPrice) {
    throw new DomainValidationError('acceptanceFloor must not exceed listPrice', 'acceptanceFloor');
  }
  if (policy.minimumOfferForAutomation > policy.acceptanceFloor) {
    throw new DomainValidationError('minimumOfferForAutomation must not exceed acceptanceFloor', 'minimumOfferForAutomation');
  }
  if (!['ESCALATE', 'REJECT'].includes(policy.escalationRules.repeatedOrLowerOffer)
      || !['ESCALATE', 'REJECT'].includes(policy.escalationRules.roundsExhausted)) {
    throw new DomainValidationError('Unsupported escalation rule', 'escalationRules');
  }
  if (policy.counterSteps) {
    let previous = policy.listPrice;
    for (const step of policy.counterSteps) {
      if (step.counterPrice > previous || step.counterPrice < policy.acceptanceFloor || step.counterPrice > policy.listPrice) {
        throw new DomainValidationError('counterSteps must be non-increasing and stay between acceptanceFloor and listPrice', 'counterSteps');
      }
      previous = step.counterPrice;
    }
  }
  return Object.freeze(policy);
}

function validateCounterSteps(value, maxRounds) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxRounds) {
    throw new DomainValidationError('counterSteps must contain one step per automated round', 'counterSteps');
  }
  return Object.freeze(value.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || step.round !== index + 1) {
      throw new DomainValidationError('counterSteps rounds must be sequential', 'counterSteps');
    }
    return Object.freeze({ round: step.round, counterPrice: requireEuroAmount(step.counterPrice, 'counterPrice') });
  }));
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
