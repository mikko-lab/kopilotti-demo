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
  const previousCustomerOffers = requireAmountHistory(input.previousCustomerOffers, 'previousCustomerOffers');
  const previousCounterOffers = requireAmountHistory(input.previousCounterOffers, 'previousCounterOffers');

  if (input.vehicle?.id !== policy.vehicleId) {
    return decision(DECISION_STATUS.ESCALATE, 'VEHICLE_POLICY_MISMATCH', round, policy);
  }
  if (input.vehicle.listPrice !== policy.listPrice) {
    return decision(DECISION_STATUS.ESCALATE, 'STALE_PRICE', round, policy);
  }
  if (input.vehicle.availability !== 'available') {
    return decision(DECISION_STATUS.ESCALATE, 'VEHICLE_NOT_AVAILABLE', round, policy);
  }
  if (round > policy.maxAutomatedRounds) {
    return decision(policy.escalationRules.roundsExhausted, 'MAX_ROUNDS_REACHED', round, policy, { mayContinue: false });
  }

  if (offerAmount >= policy.acceptanceFloor) {
    return decision(DECISION_STATUS.ACCEPT, 'OFFER_ACCEPTED', round, policy, {
      approvedAmount: offerAmount,
      reservationEligible: policy.reservationEligible,
      mayContinue: false,
    });
  }
  if (offerAmount < policy.minimumOfferForAutomation) {
    return decision(DECISION_STATUS.REJECT, 'OFFER_BELOW_POLICY', round, policy, {
      mayContinue: policy.counterSteps ? false : round < policy.maxAutomatedRounds,
    });
  }

  const previousOffer = previousCustomerOffers.at(-1);
  if (previousOffer !== undefined && offerAmount <= previousOffer) {
    return decision(policy.escalationRules.repeatedOrLowerOffer, 'OFFER_DID_NOT_IMPROVE', round, policy, { mayContinue: false });
  }

  const configuredStep = policy.counterSteps?.find((step) => step.round === round);
  if (policy.counterSteps && !configuredStep) {
    return decision(policy.escalationRules.roundsExhausted, 'MAX_ROUNDS_REACHED', round, policy, { mayContinue: false });
  }
  const calculatedCounter = configuredStep?.counterPrice ?? Math.min(
    policy.listPrice,
    Math.max(policy.targetPrice, offerAmount + policy.counterStep)
  );
  const previousCounter = previousCounterOffers.at(-1);
  const counterAmount = Math.max(policy.acceptanceFloor, calculatedCounter, offerAmount);
  if (counterAmount > policy.listPrice || (previousCounter !== undefined && counterAmount > previousCounter)) {
    return decision(DECISION_STATUS.ESCALATE, 'COUNTER_POLICY_CONFLICT', round, policy, { mayContinue: false });
  }
  return decision(DECISION_STATUS.COUNTER, 'COUNTER_WITHIN_POLICY', round, policy, {
    counterAmount,
    mayContinue: round < policy.maxAutomatedRounds,
    messageCode: `COUNTER_ROUND_${round}`,
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

function requireAmountHistory(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DomainValidationError(`${field} must be an array`, field);
  return value.map((amount) => requireEuroAmount(amount, field));
}

module.exports = { DECISION_STATUS, decideNegotiation };
