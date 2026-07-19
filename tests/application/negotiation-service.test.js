'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NegotiationService } = require('../../src/application/negotiation-service');
const { adaptExtractedOffer } = require('../../src/adapters/llm-offer-adapter');

const policy = { vehicleId: 'veh-0001', listPrice: 30686, targetPrice: 29200, floorPrice: 28500, maxRounds: 4, minimumNegotiableOffer: 29000, counterStep: 500, reservationEligible: true, policyVersion: 'demo-v1' };
const vehicle = { id: 'veh-0001', listPrice: 30686, availability: 'available', revision: 'inventory-v1' };

function fixture() {
  const sessions = new Map();
  const events = [];
  let id = 0;
  const negotiations = {
    getById: async (key) => structuredClone(sessions.get(key) ?? null),
    create: async (session) => { sessions.set(session.id, structuredClone(session)); return session; },
    save: async (session, expected) => {
      if (sessions.get(session.id).version !== expected) throw Object.assign(new Error(), { code: 'VERSION_CONFLICT' });
      sessions.set(session.id, structuredClone(session)); return session;
    },
  };
  const service = new NegotiationService({
    negotiations,
    audits: { append: async (event) => { events.push(event); return event; } },
    policies: { getForVehicle: async () => policy },
    inventory: { getById: async () => vehicle },
    clock: () => new Date('2026-07-19T10:00:00.000Z'),
    idGenerator: () => `id-${++id}`,
  });
  return { service, sessions, events };
}

test('creates a server-owned session pinned to policy and inventory revisions', async () => {
  const { service, events } = fixture();
  const session = await service.create({ tenantId: 'dealer-1', actorId: 'seller-1', vehicleId: 'veh-0001' });
  assert.equal(session.nextRound, 1);
  assert.equal(session.policyVersion, 'demo-v1');
  assert.equal(session.inventoryRevision, 'inventory-v1');
  assert.equal(events[0].eventType, 'NEGOTIATION_CREATED');
});

test('uses server-owned round and makes a repeated command idempotent', async () => {
  const { service, events } = fixture();
  const session = await service.create({ tenantId: 'dealer-1', actorId: 'seller-1', vehicleId: 'veh-0001' });
  const offer = adaptExtractedOffer({ vehicleId: 'veh-0001', offerAmount: 28900, currency: 'EUR', evidence: '28 900 euroa' });
  const command = { tenantId: 'dealer-1', actorId: 'seller-1', sessionId: session.id, commandId: 'command-1', expectedVersion: 1, offer };
  const first = await service.submitOffer(command);
  const repeated = await service.submitOffer(command);
  assert.deepEqual(repeated, first);
  assert.equal(first.round, 1);
  assert.equal(events.filter((event) => event.eventType === 'NEGOTIATION_DECIDED').length, 1);
});

test('enforces tenant isolation and optimistic session versions', async () => {
  const { service } = fixture();
  const session = await service.create({ tenantId: 'dealer-1', actorId: 'seller-1', vehicleId: 'veh-0001' });
  await assert.rejects(service.get({ tenantId: 'dealer-2', sessionId: session.id }), { code: 'SESSION_NOT_FOUND' });
  const offer = adaptExtractedOffer({ vehicleId: 'veh-0001', offerAmount: 28900, currency: 'EUR', evidence: 'offer' });
  await assert.rejects(service.submitOffer({ tenantId: 'dealer-1', actorId: 'seller-1', sessionId: session.id, commandId: 'c1', expectedVersion: 99, offer }), { code: 'VERSION_CONFLICT' });
});
