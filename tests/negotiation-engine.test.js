const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateNegotiation, loadNegotiationPolicies } = require('../lib/negotiation-engine');

const policyFixture = {
  vehicleId: 'veh-0001',
  listPrice: 30686,
  targetPrice: 29200,
  floorPrice: 28500,
  maxRounds: 4,
  minimumNegotiableOffer: 29000,
  counterStep: 500,
  reservationEligible: true,
  policyVersion: 'demo-v1'
};

test('accepts an offer at or above the minimum negotiable threshold', () => {
  const result = evaluateNegotiation({
    vehicleId: 'veh-0001',
    customerOffer: 29200,
    sessionId: 'session-1',
    previousOffers: [],
    negotiationRound: 1,
    policies: { 'veh-0001': policyFixture }
  });

  assert.equal(result.status, 'ACCEPT');
  assert.equal(result.approvedPrice, 29200);
  assert.equal(result.reasonCode, 'OFFER_ACCEPTED');
});

test('returns a deterministic counteroffer for a realistic but below-threshold offer', () => {
  const first = evaluateNegotiation({
    vehicleId: 'veh-0001',
    customerOffer: 28900,
    sessionId: 'session-2',
    previousOffers: [],
    negotiationRound: 1,
    policies: { 'veh-0001': policyFixture }
  });
  const second = evaluateNegotiation({
    vehicleId: 'veh-0001',
    customerOffer: 28900,
    sessionId: 'session-2',
    previousOffers: [],
    negotiationRound: 1,
    policies: { 'veh-0001': policyFixture }
  });

  assert.equal(first.status, 'COUNTER');
  assert.equal(first.counterOffer, 29400);
  assert.equal(first.reasonCode, 'COUNTER_WITHIN_POLICY');
  assert.deepEqual(first, second);
});

test('never accepts below the configured floor price', () => {
  const result = evaluateNegotiation({
    vehicleId: 'veh-0001',
    customerOffer: 28000,
    sessionId: 'session-3',
    previousOffers: [28000],
    negotiationRound: 2,
    policies: { 'veh-0001': policyFixture }
  });

  assert.equal(result.status, 'REJECT');
  assert.equal(result.reasonCode, 'OFFER_TOO_LOW');
  assert.equal(result.mayContinue, true);
});

test('fails closed for a missing policy', () => {
  const result = evaluateNegotiation({
    vehicleId: 'veh-9999',
    customerOffer: 28000,
    sessionId: 'session-4',
    previousOffers: [],
    negotiationRound: 1,
    policies: { 'veh-0001': policyFixture }
  });

  assert.equal(result.status, 'ESCALATE');
  assert.equal(result.reasonCode, 'POLICY_NOT_FOUND');
});

test('rejects invalid offers', () => {
  const result = evaluateNegotiation({
    vehicleId: 'veh-0001',
    customerOffer: -10,
    sessionId: 'session-5',
    previousOffers: [],
    negotiationRound: 1,
    policies: { 'veh-0001': policyFixture }
  });

  assert.equal(result.status, 'REJECT');
  assert.equal(result.reasonCode, 'INVALID_OFFER');
});

test('stops negotiation after the configured maximum rounds', () => {
  const result = evaluateNegotiation({
    vehicleId: 'veh-0001',
    customerOffer: 28600,
    sessionId: 'session-6',
    previousOffers: [28600, 28650, 28700, 28750],
    negotiationRound: 5,
    policies: { 'veh-0001': policyFixture }
  });

  assert.equal(result.status, 'REJECT');
  assert.equal(result.reasonCode, 'MAX_ROUNDS_REACHED');
});

test('loads negotiation policy data from disk', async () => {
  const policies = await loadNegotiationPolicies();
  assert.ok(policies['veh-0001']);
  assert.equal(policies['veh-0001'].policyVersion, 'demo-v1');
});
