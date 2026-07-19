'use strict';

const { DomainValidationError, requireCurrency, requireEuroAmount } = require('./money');
const { validatePolicy } = require('./policy');

const DECISION_STATUS = Object.freeze({
  ACCEPT: 'ACCEPT',
  COUNTER: 'COUNTER',
  REJECT: 'REJECT',
  ESCALATE: 'ESCALATE',
});

/** Pure decision function. It performs no I/O and emits no presentation text. */
function decideNegotiation(input) {
  if (!input || typeof input !== 'object') throw new DomainValidationError('Decision input is required', 'input');
  const policy = validatePolicy(input.policy);
  const offerAmount = requireEuroAmount(input.offerAmount, 'offerAmount');
  requireCurrency(input.currency);
  const round = requireRound(input.round);

  if (input.vehicle?.id !== policy.vehicleId) {
    return decision(DECISION_STATUS.ESCALATE, 'VEHICLE_POLICY_MISMATCH', round, policy);
  }
  if (input.vehicle.listPrice !== policy.listPrice) {
    return decision(DECISION_STATUS.ESCALATE, 'STALE_PRICE', round, policy);
  }
  if (input.vehicle.availability !== 'available') {
    return decision(DECISION_STATUS.ESCALATE, 'VEHICLE_NOT_AVAILABLE', round, policy);
  }
  if (round > policy.maxRounds) {
    return decision(DECISION_STATUS.REJECT, 'MAX_ROUNDS_REACHED', round, policy, { mayContinue: false });
  }

  const acceptanceThreshold = Math.max(policy.targetPrice, policy.minimumNegotiableOffer);
  if (offerAmount >= acceptanceThreshold) {
    return decision(DECISION_STATUS.ACCEPT, 'OFFER_ACCEPTED', round, policy, {
      approvedAmount: offerAmount,
      reservationEligible: policy.reservationEligible,
      mayContinue: false,
    });
  }
  if (offerAmount < policy.floorPrice) {
    return decision(DECISION_STATUS.REJECT, 'OFFER_BELOW_POLICY', round, policy, {
      mayContinue: round < policy.maxRounds,
    });
  }

  const counterAmount = Math.min(
    policy.listPrice,
    Math.max(policy.targetPrice, offerAmount + policy.counterStep)
  );
  return decision(DECISION_STATUS.COUNTER, 'COUNTER_WITHIN_POLICY', round, policy, {
    counterAmount,
    mayContinue: round < policy.maxRounds,
  });
}

function decision(status, reasonCode, round, policy, extra = {}) {
  return Object.freeze({
    status,
    reasonCode,
    round,
    policyVersion: policy.policyVersion,
    ...extra,
  });
}

function requireRound(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainValidationError('round must be a positive integer', 'round');
  }
  return value;
}

module.exports = { DECISION_STATUS, decideNegotiation };
