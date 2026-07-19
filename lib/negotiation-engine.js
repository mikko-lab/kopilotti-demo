const path = require('node:path');
const { decideNegotiation } = require('../src/domain/negotiation-engine');
const { FilePolicyRepository } = require('../src/infrastructure/file-policy-repository');

function evaluateNegotiation({ vehicleId, customerOffer, sessionId, previousOffers = [], negotiationRound = 1, policies = {} }) {
  const policy = policies[vehicleId];
  if (!policy) {
    return { status: 'ESCALATE', reasonCode: 'POLICY_NOT_FOUND' };
  }
  try {
    const result = decideNegotiation({
      policy,
      vehicle: { id: vehicleId, listPrice: policy.listPrice, availability: 'available' },
      offerAmount: customerOffer,
      currency: 'EUR',
      round: negotiationRound,
    });
    return {
      ...result,
      approvedPrice: result.approvedAmount,
      counterOffer: result.counterAmount,
      reasonCode: result.reasonCode === 'OFFER_BELOW_POLICY' ? 'OFFER_TOO_LOW' : result.reasonCode,
    };
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') return { status: 'REJECT', reasonCode: 'INVALID_OFFER', mayContinue: false };
    throw error;
  }
}

async function loadNegotiationPolicies() {
  const filePath = path.join(__dirname, '..', 'config', 'demo-policy.json');
  const raw = require(filePath);
  const repository = new FilePolicyRepository(filePath);
  const result = {};
  for (const record of raw) result[record.vehicleId] = await repository.getForVehicle(record.vehicleId);
  return result;
}

module.exports = {
  evaluateNegotiation,
  loadNegotiationPolicies
};
