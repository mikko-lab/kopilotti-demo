'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDigitalSalespersonRouter } = require('../../src/http/digital-salesperson-routes');
const { negotiationErrorHandler } = require('../../src/http/http-response');

async function withServer(service, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/digital-salesperson', createDigitalSalespersonRouter(service));
  app.use(negotiationErrorHandler);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('customer BFF injects server-owned demo identity and returns no decision reason code', async () => {
  const session = { id: 'session-1', tenantId: 'demo-dealership', vehicleId: 'veh-0001', status: 'OPEN', version: 1, nextRound: 1, createdAt: 'now', updatedAt: 'now', decisions: [] };
  let submitted;
  const service = {
    create: async (command) => {
      assert.equal(command.tenantId, 'demo-dealership');
      assert.equal(command.actorId, 'digital-customer');
      return session;
    },
    get: async () => submitted ? { ...session, version: 2 } : session,
    submitOffer: async (command) => {
      submitted = command;
      return { status: 'COUNTER', reasonCode: 'COUNTER_WITHIN_POLICY', counterAmount: 29400, policyVersion: 'internal-v1' };
    },
  };
  await withServer(service, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/digital-salesperson/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vehicleId: 'veh-0001', tenantId: 'attacker' }) });
    assert.equal(created.status, 201);

    const response = await fetch(`${baseUrl}/api/digital-salesperson/sessions/session-1/offers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerAmount: 28900, currency: 'EUR', evidence: '28 900 euroa', expectedVersion: 1, commandId: 'command-0001', persona: 'mika', targetPrice: 1 }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { status: 'COUNTER', counterAmount: 29400, sessionVersion: 2, sessionStatus: 'OPEN' });
    assert.equal(submitted.offer.persona, undefined);
    assert.equal(submitted.offer.targetPrice, undefined);
  });
});
