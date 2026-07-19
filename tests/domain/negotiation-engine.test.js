'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideNegotiation } = require('../../src/domain/negotiation-engine');
const { validatePolicy } = require('../../src/domain/policy');

const policy = {
  vehicleId: 'veh-0001', listPrice: 30686, targetPrice: 29200, floorPrice: 28500,
  maxRounds: 4, minimumNegotiableOffer: 29000, counterStep: 500,
  reservationEligible: true, policyVersion: 'demo-v1',
};
const vehicle = { id: 'veh-0001', listPrice: 30686, availability: 'available', revision: 'inventory-v1' };
const decide = (offerAmount, overrides = {}) => decideNegotiation({
  policy, vehicle, offerAmount, currency: 'EUR', round: 1, ...overrides,
});

test('accepts at the effective threshold and never exposes thresholds in its result', () => {
  const result = decide(29200);
  assert.deepEqual(result, {
    status: 'ACCEPT', reasonCode: 'OFFER_ACCEPTED', round: 1, policyVersion: 'demo-v1',
    approvedAmount: 29200, reservationEligible: true, mayContinue: false,
  });
  assert.equal(result.floorPrice, undefined);
  assert.equal(result.targetPrice, undefined);
});

test('returns a reproducible counteroffer bounded by list price', () => {
  assert.deepEqual(decide(28900), decide(28900));
  assert.equal(decide(28900).counterAmount, 29400);
});

test('rejects below-policy offers without disclosing the floor', () => {
  const result = decide(28000);
  assert.equal(result.status, 'REJECT');
  assert.equal(result.reasonCode, 'OFFER_BELOW_POLICY');
  assert.equal(result.floorPrice, undefined);
});

test('fails closed when vehicle price or availability is stale', () => {
  assert.equal(decide(30000, { vehicle: { ...vehicle, listPrice: 31000 } }).reasonCode, 'STALE_PRICE');
  assert.equal(decide(30000, { vehicle: { ...vehicle, availability: 'reserved' } }).reasonCode, 'VEHICLE_NOT_AVAILABLE');
});

test('enforces maximum rounds', () => {
  const result = decide(29000, { round: 5 });
  assert.equal(result.status, 'REJECT');
  assert.equal(result.reasonCode, 'MAX_ROUNDS_REACHED');
});

test('rejects invalid money and currency inputs', () => {
  assert.throws(() => decide(10.5), { code: 'VALIDATION_ERROR' });
  assert.throws(() => decide(29000, { currency: 'USD' }), { code: 'VALIDATION_ERROR' });
});

test('validates policy invariants before any decision', () => {
  assert.throws(() => validatePolicy({ ...policy, floorPrice: 30000 }), /floorPrice <= targetPrice <= listPrice/);
  assert.throws(() => validatePolicy({ ...policy, minimumNegotiableOffer: 28000 }), /between floorPrice and targetPrice/);
});
