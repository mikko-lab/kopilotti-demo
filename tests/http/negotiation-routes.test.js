'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createNegotiationRouter } = require('../../src/http/negotiation-routes');
const { negotiationErrorHandler } = require('../../src/http/http-response');

async function withServer(service, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/negotiations', createNegotiationRouter(service));
  app.use(negotiationErrorHandler);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const session = { id: 'session-1', vehicleId: 'veh-0001', status: 'OPEN', version: 1, nextRound: 1, createdAt: 'now', updatedAt: 'now', decisions: [], tenantId: 'dealer-1', policyVersion: 'internal-v1', inventoryRevision: 'internal-revision' };

test('creates a session through the authenticated backend boundary without policy disclosure', async () => {
  const service = { create: async (command) => ({ ...session, tenantId: command.tenantId }) };
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/negotiations`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'dealer-1', 'x-actor-id': 'seller-1' },
      body: JSON.stringify({ vehicleId: 'veh-0001' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.id, 'session-1');
    assert.equal(body.policyVersion, undefined);
    assert.equal(JSON.stringify(body).includes('internal-v1'), false);
  });
});

test('requires identity, idempotency key, and optimistic version for offers', async () => {
  let called = false;
  const service = { submitOffer: async () => { called = true; return {}; } };
  await withServer(service, async (baseUrl) => {
    const noIdentity = await fetch(`${baseUrl}/api/negotiations/session-1/offers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noIdentity.status, 401);

    const noCommandId = await fetch(`${baseUrl}/api/negotiations/session-1/offers`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'dealer-1', 'x-actor-id': 'seller-1', 'if-match': '1' }, body: '{}' });
    assert.equal(noCommandId.status, 400);
    assert.equal(called, false);
  });
});

test('adapts an untrusted offer and returns only the public decision contract', async () => {
  let received;
  const service = {
    submitOffer: async (command) => {
      received = command;
      return { decisionId: 'd1', status: 'COUNTER', reasonCode: 'COUNTER_WITHIN_POLICY', round: 1, counterAmount: 29400, mayContinue: true, occurredAt: 'now', floorPrice: 1, targetPrice: 1 };
    },
  };
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/negotiations/session-1/offers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 'dealer-1', 'x-actor-id': 'seller-1', 'if-match': '1', 'idempotency-key': 'command-0001' },
      body: JSON.stringify({ vehicleId: 'veh-0001', offerAmount: 28900, currency: 'EUR', evidence: 'Tarjoan 28 900 euroa', floorPrice: 1, status: 'ACCEPT' }),
    });
    assert.equal(response.status, 200);
    assert.equal(received.offer.floorPrice, undefined);
    const body = await response.json();
    assert.equal(body.counterAmount, 29400);
    assert.equal(body.reasonCode, 'COUNTER_OFFERED');
    assert.equal(body.floorPrice, undefined);
    assert.equal(body.targetPrice, undefined);
  });
});
