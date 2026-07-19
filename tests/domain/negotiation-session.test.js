'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, recordDecision } = require('../../src/domain/negotiation-session');

test('server-owned session advances version and round exactly once per command', () => {
  const original = createSession({ id: 's1', tenantId: 'dealer-1', vehicleId: 'v1', policyVersion: 'p1', inventoryRevision: 'i1', createdAt: '2026-07-19T10:00:00.000Z' });
  const input = { commandId: 'cmd1', decisionId: 'd1', offerAmount: 29000, currency: 'EUR', decision: { status: 'COUNTER', reasonCode: 'COUNTER_WITHIN_POLICY', round: 1 }, occurredAt: '2026-07-19T10:01:00.000Z' };
  const updated = recordDecision(original, input);
  assert.equal(updated.version, 2);
  assert.equal(updated.nextRound, 2);
  assert.equal(recordDecision(updated, input), updated);
});
