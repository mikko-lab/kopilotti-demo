import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { createTransactionSseHandler, KopilottiEventEmitter, type Deal } from '../../src/transaction-core/index.ts';

const deal: Deal = {
  id: 'deal-1', tenantId: 'dealer-1', state: 'AWAITING_PAYMENT', version: 3,
  vehicle: { vehicleId: 'vehicle-1', registrationIdentifier: 'ABC-123', inventoryRevision: 'a'.repeat(64) },
  agreedPriceCents: 3_000_000, currency: 'EUR', paymentMethod: 'CASH',
  paymentDeadline: '2026-07-22T12:00:00.000Z', providerReference: 'payment-1',
  handoverPolicyVersion: 'secret-policy-v1', createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-17T12:00:00.000Z',
};

class FakeResponse extends EventEmitter {
  statusCode = 0; headers: Record<string, string> = {}; writes: string[] = []; jsonBody: unknown = null; writableEnded = false;
  status(code: number) { this.statusCode = code; return this; }
  set(headers: Record<string, string>) { Object.assign(this.headers, headers); return this; }
  flushHeaders() {}
  write(value: string) { this.writes.push(value); return true; }
  json(value: unknown) { this.jsonBody = value; return this; }
  end() { this.writableEnded = true; return this; }
}

function request(transactionId: string): Request {
  const value = new EventEmitter() as EventEmitter & { params: Record<string, string> };
  value.params = { transactionId };
  return value as unknown as Request;
}

test('authorized SSE sends only safe status data and removes listener on close', async () => {
  const events = new KopilottiEventEmitter(); const response = new FakeResponse(); const req = request('deal-1'); let authorized = false;
  const handler = createTransactionSseHandler({
    repository: { getDeal: async () => deal }, events, heartbeatMs: 5_000,
    authorizer: { authorize: async (_request, candidate) => { authorized = candidate.tenantId === 'dealer-1'; } },
    now: () => new Date('2026-07-18T12:00:00.000Z'),
  });
  await handler(req, response as unknown as Response);
  assert.equal(authorized, true); assert.equal(response.statusCode, 200); assert.equal(events.listenerCount(), 1);
  assert.match(response.writes[0] ?? '', /event: statusChange/); assert.doesNotMatch(response.writes[0] ?? '', /agreedPrice|handoverPolicyVersion|providerReference/);
  events.emitStatusChange({ eventId: 'event-4', transactionId: 'deal-1', registrationNumber: 'ABC-123', status: 'PAID', paymentDeadline: deal.paymentDeadline, timestamp: '2026-07-18T12:01:00.000Z' });
  assert.match(response.writes.at(-1) ?? '', /"status":"PAID"/);
  (req as unknown as EventEmitter).emit('close');
  assert.equal(events.listenerCount(), 0); assert.equal(response.writableEnded, true);
});

test('SSE rejects unknown transaction before opening stream', async () => {
  const response = new FakeResponse(); const events = new KopilottiEventEmitter(); let authorized = false;
  const handler = createTransactionSseHandler({ repository: { getDeal: async () => null }, events, authorizer: { authorize: async () => { authorized = true; } } });
  await handler(request('missing'), response as unknown as Response);
  assert.equal(response.statusCode, 404); assert.deepEqual(response.jsonBody, { error: 'TRANSACTION_NOT_FOUND' }); assert.equal(authorized, false); assert.equal(events.listenerCount(), 0);
});
