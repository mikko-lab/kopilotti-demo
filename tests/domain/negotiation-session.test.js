'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptLatestCounter, createSession, recordDecision } = require('../../src/domain/negotiation-session');

test('server-owned session advances version and round exactly once per command', () => {
  const original = createSession({ id: 's1', tenantId: 'dealer-1', vehicleId: 'v1', policyVersion: 'p1', inventoryRevision: 'i1', createdAt: '2026-07-19T10:00:00.000Z' });
  const input = { commandId: 'cmd1', decisionId: 'd1', offerAmount: 29000, currency: 'EUR', decision: { status: 'COUNTER', reasonCode: 'COUNTER_WITHIN_POLICY', round: 1 }, occurredAt: '2026-07-19T10:01:00.000Z' };
  const updated = recordDecision(original, input);
  assert.equal(updated.version, 2);
  assert.equal(updated.nextRound, 2);
  assert.equal(recordDecision(updated, input), updated);
});

test('accepted counter locks negotiation at PRICE_AGREED', () => {
  const original = createSession({ id: 's1', tenantId: 'dealer-1', vehicleId: 'v1', policyVersion: 'p1', inventoryRevision: 'i1', createdAt: '2026-07-19T10:00:00.000Z' });
  const countered = recordDecision(original, { commandId: 'c1', decisionId: 'd1', offerAmount: 28000, currency: 'EUR', decision: { status: 'COUNTER', counterAmount: 29000, reasonCode: 'COUNTER_WITHIN_POLICY', round: 1 }, occurredAt: '2026-07-19T10:01:00.000Z' });
  const agreed = acceptLatestCounter(countered, '2026-07-19T10:02:00.000Z');
  assert.equal(agreed.status, 'PRICE_AGREED');
  assert.equal(agreed.agreedPrice, 29000);
  assert.throws(() => acceptLatestCounter(agreed, '2026-07-19T10:03:00.000Z'), { code: 'SESSION_NOT_OPEN' });
});
