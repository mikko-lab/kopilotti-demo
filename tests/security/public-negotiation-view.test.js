'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicCustomerDecision, publicCustomerSession, publicDecision, publicSession } = require('../../src/security/public-negotiation-view');

test('public views cannot serialize confidential policy values', () => {
  const decision = publicDecision({
    decisionId: 'd1', status: 'REJECT', reasonCode: 'OFFER_BELOW_POLICY', round: 1,
    mayContinue: true, occurredAt: 'now', floorPrice: 28500, targetPrice: 29200,
    minimumNegotiableOffer: 29000, counterStep: 500, policyVersion: 'secret-policy', reservationEligible: true,
  });
  assert.equal(decision.reservationEligible, undefined);
  assert.deepEqual(decision, {
    decisionId: 'd1', status: 'REJECT', reasonCode: 'OFFER_NOT_ACCEPTED', round: 1,
    mayContinue: true, occurredAt: 'now',
  });
  const session = publicSession({ id: 's1', vehicleId: 'v1', status: 'OPEN', version: 1, nextRound: 1, createdAt: 'now', updatedAt: 'now', decisions: [], tenantId: 'secret-tenant', policyVersion: 'secret-policy', inventoryRevision: 'secret-revision' });
  assert.equal(session.tenantId, undefined);
  assert.equal(session.policyVersion, undefined);
  assert.equal(session.inventoryRevision, undefined);
});

test('customer decision omits internal reason codes and commercial policy metadata', () => {
  const view = publicCustomerDecision({
    status: 'COUNTER', reasonCode: 'COUNTER_WITHIN_POLICY', offerAmount: 28900, counterAmount: 29400,
    round: 1, mayContinue: true, messageCode: 'COUNTER_ROUND_1',
    policyVersion: 'internal-v1', reservationEligible: true,
  }, { version: 2, status: 'OPEN' });
  assert.deepEqual(view, { status: 'COUNTER', customerOffer: 28900, counterOffer: 29400, negotiationRound: 1, canSubmitNewOffer: true, canAcceptCounterOffer: true, messageCode: 'COUNTER_ROUND_1', sessionVersion: 2, sessionStatus: 'OPEN' });
  assert.equal(JSON.stringify(view).includes('acceptanceFloor'), false);
});

test('customer session history is safe and excludes policy metadata', () => {
  const view = publicCustomerSession({ id: 's1', vehicleId: 'v1', tenantId: 'dealer-secret', policyVersion: 'secret-v1', inventoryRevision: 'r1', status: 'OPEN', version: 3, createdAt: 't1', updatedAt: 't2', decisions: [
    { status: 'COUNTER', offerAmount: 92500, counterAmount: 94700 },
    { status: 'COUNTER', offerAmount: 93300, counterAmount: 94300 },
  ] });
  assert.deepEqual(view.customerOffers, [92500, 93300]);
  assert.deepEqual(view.counterOffers, [94700, 94300]);
  assert.equal(view.negotiationRound, 2);
  assert.equal(view.policyVersion, undefined);
  assert.equal(view.inventoryRevision, undefined);
});
