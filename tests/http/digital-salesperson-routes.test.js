'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { NegotiationService } = require('../../src/application/negotiation-service');
const { DemoSalesInventory } = require('../../src/adapters/demo-sales-inventory');
const { FileInventoryRepository } = require('../../src/infrastructure/file-inventory-repository');
const { FilePolicyRepository } = require('../../src/infrastructure/file-policy-repository');
const { createDigitalSalespersonRouter } = require('../../src/http/digital-salesperson-routes');
const { negotiationErrorHandler } = require('../../src/http/http-response');

const projectRoot = path.join(__dirname, '..', '..');

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
      return { status: 'COUNTER', reasonCode: 'COUNTER_WITHIN_POLICY', offerAmount: 28900, counterAmount: 29400, round: 1, mayContinue: true, messageCode: 'COUNTER_ROUND_1', policyVersion: 'internal-v1' };
    },
  };
  await withServer(service, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/digital-salesperson/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vehicleId: 'veh-0001', tenantId: 'attacker' }) });
    assert.equal(created.status, 201);
    const restored = await fetch(`${baseUrl}/api/digital-salesperson/sessions/session-1`);
    assert.equal(restored.status, 200);
    assert.deepEqual(await restored.json(), { id: 'session-1', vehicleId: 'veh-0001', status: 'OPEN', version: 1, negotiationRound: 0, customerOffers: [], counterOffers: [], latestDecision: null, createdAt: 'now', updatedAt: 'now' });

    const response = await fetch(`${baseUrl}/api/digital-salesperson/sessions/session-1/offers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerAmount: 28900, currency: 'EUR', evidence: '28 900 euroa', expectedVersion: 1, commandId: 'command-0001', persona: 'mika', targetPrice: 1 }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { status: 'COUNTER', customerOffer: 28900, counterOffer: 29400, negotiationRound: 1, canSubmitNewOffer: true, canAcceptCounterOffer: true, messageCode: 'COUNTER_ROUND_1', sessionVersion: 2, sessionStatus: 'OPEN' });
    assert.equal(submitted.offer.persona, undefined);
    assert.equal(submitted.offer.targetPrice, undefined);
  });
});

test('manual 94 100 euro request reaches the deterministic engine and returns ACCEPT', async () => {
  const sessions = new Map();
  let id = 0;
  const service = new NegotiationService({
    negotiations: {
      create: async (session) => { sessions.set(session.id, structuredClone(session)); return session; },
      getById: async (sessionId) => structuredClone(sessions.get(sessionId) ?? null),
      save: async (session, expectedVersion) => {
        assert.equal(sessions.get(session.id)?.version, expectedVersion);
        sessions.set(session.id, structuredClone(session));
        return session;
      },
    },
    audits: { append: async (event) => event },
    policies: new FilePolicyRepository(path.join(projectRoot, 'config', 'sales-demo-policy.json')),
    inventory: new DemoSalesInventory(new FileInventoryRepository(path.join(projectRoot, 'inventory.json'))),
    clock: () => new Date('2026-07-20T10:00:00.000Z'),
    idGenerator: () => `regression-id-${++id}`,
  });

  await withServer(service, async (baseUrl) => {
    const createdResponse = await fetch(`${baseUrl}/api/digital-salesperson/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vehicleId: 'veh-0001' }),
    });
    assert.equal(createdResponse.status, 201);
    const session = await createdResponse.json();

    const offerResponse = await fetch(`${baseUrl}/api/digital-salesperson/sessions/${session.id}/offers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerAmount: 94_100, currency: 'EUR', evidence: 'Asiakkaan hintaehdotus on 94100 EUR.', expectedVersion: 1, commandId: 'regression-94100' }),
    });
    assert.equal(offerResponse.status, 200);
    assert.deepEqual(await offerResponse.json(), { status: 'ACCEPT', customerOffer: 94_100, negotiationRound: 1, canSubmitNewOffer: false, canAcceptCounterOffer: false, messageCode: 'OFFER_ACCEPTED', approvedAmount: 94_100, sessionVersion: 2, sessionStatus: 'ACCEPTED' });

    const persisted = await service.get({ tenantId: 'demo-dealership', sessionId: session.id });
    assert.equal(persisted.decisions.at(-1).status, 'ACCEPT');
    assert.equal(persisted.decisions.at(-1).approvedAmount, 94_100);
  });
});
