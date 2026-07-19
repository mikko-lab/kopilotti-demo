'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicDecision, publicSession } = require('../../src/security/public-negotiation-view');

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
