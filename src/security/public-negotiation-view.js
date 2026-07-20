'use strict';

function publicSession(session) {
  return {
    id: session.id,
    vehicleId: session.vehicleId,
    status: session.status,
    version: session.version,
    nextRound: session.nextRound,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    decisions: session.decisions.map(publicDecision),
  };
}

function publicDecision(decision) {
  const result = {
    decisionId: decision.decisionId,
    status: decision.status,
    reasonCode: publicReasonCode(decision.reasonCode),
    round: decision.round,
    mayContinue: decision.mayContinue ?? false,
    occurredAt: decision.occurredAt,
  };
  if (Number.isInteger(decision.approvedAmount)) result.approvedAmount = decision.approvedAmount;
  if (Number.isInteger(decision.counterAmount)) result.counterAmount = decision.counterAmount;
  return result;
}

// Internal policy reasons are deliberately collapsed before leaving the server.
function publicReasonCode(reasonCode) {
  if (['STALE_PRICE', 'VEHICLE_POLICY_MISMATCH', 'VEHICLE_NOT_AVAILABLE'].includes(reasonCode)) return 'HUMAN_REVIEW_REQUIRED';
  if (reasonCode === 'OFFER_BELOW_POLICY') return 'OFFER_NOT_ACCEPTED';
  if (reasonCode === 'COUNTER_WITHIN_POLICY') return 'COUNTER_OFFERED';
  if (reasonCode === 'MAX_ROUNDS_REACHED') return 'NEGOTIATION_CLOSED';
  return reasonCode;
}

function publicCustomerDecision(decision, session) {
  const result = {
    status: decision.status,
    customerOffer: decision.offerAmount,
    negotiationRound: decision.round,
    canSubmitNewOffer: decision.status === 'COUNTER' && decision.mayContinue === true,
    canAcceptCounterOffer: decision.status === 'COUNTER',
    messageCode: decision.messageCode ?? messageCodeFor(decision),
    sessionVersion: session.version,
    sessionStatus: session.status,
  };
  if (Number.isInteger(decision.approvedAmount)) result.approvedAmount = decision.approvedAmount;
  if (Number.isInteger(decision.counterAmount)) result.counterOffer = decision.counterAmount;
  return result;
}

function publicCustomerSession(session) {
  const customerOffers = session.decisions.map((entry) => entry.offerAmount);
  const counterOffers = session.decisions
    .filter((entry) => Number.isSafeInteger(entry.counterAmount))
    .map((entry) => entry.counterAmount);
  const latest = session.decisions.at(-1);
  const result = {
    id: session.id,
    vehicleId: session.vehicleId,
    status: session.status,
    version: session.version,
    negotiationRound: session.decisions.length,
    customerOffers,
    counterOffers,
    latestDecision: latest?.status ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  if (Number.isSafeInteger(session.agreedPrice)) result.agreedPrice = session.agreedPrice;
  return result;
}

function messageCodeFor(decision) {
  if (decision.status === 'ACCEPT') return 'OFFER_ACCEPTED';
  if (decision.status === 'COUNTER') return `COUNTER_ROUND_${decision.round}`;
  if (decision.status === 'ESCALATE') return 'HUMAN_REVIEW_REQUIRED';
  return 'OFFER_NOT_ACCEPTED';
}

module.exports = { publicCustomerDecision, publicCustomerSession, publicDecision, publicSession };
