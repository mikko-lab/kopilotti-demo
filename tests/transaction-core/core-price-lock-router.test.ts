import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createCorePriceLockRouter, type Customer, type Deal, type LockedVehicle } from '../../src/transaction-core/index.ts';

const vehicle: LockedVehicle = { vehicleId: 'vehicle-1', registrationIdentifier: 'XYZ-123', inventoryRevision: 7 };
const buyer: Customer = { id: 'customer-1', ssnVerified: true, fullName: 'Testi Ostaja', email: 'ostaja@example.test', phone: '+358401234567' };
const deal: Deal = {
  id: 'deal-1', tenantId: 'dealer-1', state: 'NEGOTIATING', version: 2, vehicle, buyer: null,
  agreedPriceCents: null, currency: 'EUR', paymentMethod: null, paymentDeadline: null, providerReference: null,
  handoverPolicyVersion: null, createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z',
};

function fixture(input: { authenticatedBuyer?: Customer | null; engineFailure?: Error } = {}) {
  const locks: Array<{ agreedPriceCents: number; buyer: Customer }> = [];
  const router = createCorePriceLockRouter({
    authorizer: { authorize: async (request) => {
      if (request.header('authorization') !== 'Bearer service-secret') throw new Error('secret auth detail');
      return { tenantId: 'dealer-1', serviceId: 'chat-service' };
    } },
    buyers: { resolveStronglyAuthenticatedBuyer: async ({ sessionToken }) => sessionToken === 'protected-session' ? (input.authenticatedBuyer === undefined ? buyer : input.authenticatedBuyer) : null },
    transactions: { getDeal: async (id) => id === deal.id ? deal : null },
    inventory: { getById: async (id) => id === vehicle.vehicleId ? vehicle : null },
    verifier: { verify: async ({ claimedPriceCents }) => {
      if (claimedPriceCents !== 90_000_00) throw new Error('SECRET_FLOOR_PRICE');
      return { dealId: deal.id, approvedPriceCents: 92_500_00, commercialDecisionId: 'decision-1' };
    } },
    engine: {
      createNegotiation: async () => { throw new Error('endpoint must not create deals'); },
      agreePrice: async (command) => {
        if (input.engineFailure) throw input.engineFailure;
        locks.push({ agreedPriceCents: command.agreedPriceCents, buyer: command.buyer });
        return { ...deal, state: 'PRICE_AGREED', version: 3, buyer: command.buyer, agreedPriceCents: command.agreedPriceCents, updatedAt: '2026-07-20T10:01:00.000Z' };
      },
    },
  });
  return { router, locks };
}

async function request(router: ReturnType<typeof fixture>['router'], body: unknown, headers: Record<string, string> = {}) {
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/transactions/lock-price`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

const validBody = { dealId: 'deal-1', vehicleId: 'vehicle-1', agreedPrice: 90_000, inventoryRevisionAtLock: 7 };
const validHeaders = { authorization: 'Bearer service-secret', 'x-buyer-session-token': 'protected-session' };

test('service boundary locks only verifier-approved price and returns a minimal public contract', async () => {
  const context = fixture(); const result = await request(context.router, validBody, validHeaders);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { success: true, transactionId: 'deal-1', status: 'PRICE_AGREED', createdAt: '2026-07-20T10:01:00.000Z' });
  assert.equal(context.locks[0]?.agreedPriceCents, 92_500_00); assert.equal(context.locks[0]?.buyer.id, 'customer-1');
  assert.doesNotMatch(JSON.stringify(result.body), /agreedPrice|inventoryRevision|buyer|decision|policy/i);
});

test('service authentication and buyer token are required outside the LLM request body', async () => {
  const context = fixture();
  const unauthorized = await request(context.router, validBody);
  assert.deepEqual(unauthorized, { status: 401, body: { errorCode: 'UNAUTHORIZED', message: 'Palvelukutsu ei ole valtuutettu.' } });
  const tokenInBody = await request(context.router, { ...validBody, buyerSessionToken: 'protected-session' }, { authorization: 'Bearer service-secret' });
  assert.equal(tokenInBody.status, 400); assert.equal(tokenInBody.body.errorCode, 'INVALID_REQUEST'); assert.equal(context.locks.length, 0);
});

test('strong authentication and exact inventory revision fail closed before price lock', async () => {
  const unauthenticated = fixture({ authenticatedBuyer: { ...buyer, ssnVerified: false } });
  const denied = await request(unauthenticated.router, validBody, validHeaders);
  assert.equal(denied.status, 401); assert.equal(denied.body.errorCode, 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED');
  const stale = fixture(); const staleResult = await request(stale.router, { ...validBody, inventoryRevisionAtLock: 6 }, validHeaders);
  assert.equal(staleResult.status, 409); assert.equal(staleResult.body.errorCode, 'REVISION_MISMATCH');
  assert.equal(unauthenticated.locks.length, 0); assert.equal(stale.locks.length, 0);
});

test('deterministic verifier rejection does not leak commercial policy details', async () => {
  const context = fixture(); const result = await request(context.router, { ...validBody, agreedPrice: 1 }, validHeaders);
  assert.equal(result.status, 403); assert.deepEqual(result.body, { errorCode: 'PRICE_NOT_AUTHORIZED', message: 'Hinnan lukitusta ei voitu vahvistaa.' });
  assert.doesNotMatch(JSON.stringify(result.body), /floor|threshold|secret/i); assert.equal(context.locks.length, 0);
});

test('unexpected repository failure is unavailable, not a misleading transaction conflict', async () => {
  const context = fixture({ engineFailure: new Error('postgres://secret@internal') });
  const result = await request(context.router, validBody, validHeaders);
  assert.equal(result.status, 503); assert.deepEqual(result.body, { errorCode: 'INTERNAL_ERROR', message: 'Palvelu ei ole käytettävissä.' });
  assert.doesNotMatch(JSON.stringify(result.body), /postgres:\/\/|secret@|database host/i);
});
