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

module.exports = { publicDecision, publicSession };
