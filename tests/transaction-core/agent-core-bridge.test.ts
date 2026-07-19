import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCoreBridge } from '../../src/transaction-core/index.ts';

const context = { dealId: 'deal-1', vehicleId: 'vehicle-1', buyerSessionToken: 'protected-session' };

test('bridge uses protected headers and retries an explicit 503 with the same request ID', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []; let attempt = 0; const waits: number[] = [];
  const bridge = new AgentCoreBridge({
    coreServiceUrl: 'https://core.internal/base', serviceAuthorization: 'Bearer service-secret', retryDelayMs: 25,
    wait: async (milliseconds) => { waits.push(milliseconds); },
    fetch: async (url, init) => {
      calls.push({ url: String(url), ...(init === undefined ? {} : { init }) }); attempt += 1;
      return attempt === 1
        ? new Response(JSON.stringify({ errorCode: 'INTERNAL_ERROR', message: 'unavailable' }), { status: 503 })
        : new Response(JSON.stringify({ success: true, transactionId: 'deal-1', status: 'PRICE_AGREED', createdAt: '2026-07-20T10:01:00.000Z' }), { status: 201 });
    },
  });
  const result = await bridge.handleAgentLockPrice(context, 90_000, 7);
  assert.equal(result.success, true); assert.equal(calls.length, 2); assert.deepEqual(waits, [25]);
  assert.equal(calls[0]?.url, 'https://core.internal/api/v1/transactions/lock-price');
  const firstHeaders = new Headers(calls[0]?.init?.headers); const secondHeaders = new Headers(calls[1]?.init?.headers);
  assert.equal(firstHeaders.get('authorization'), 'Bearer service-secret'); assert.equal(firstHeaders.get('x-buyer-session-token'), 'protected-session');
  assert.equal(firstHeaders.get('x-request-id'), secondHeaders.get('x-request-id'));
  assert.doesNotMatch(String(calls[0]?.init?.body), /buyerSessionToken|protected-session|service-secret/);
});

test('timeout is not replayed because the core transaction outcome is ambiguous', async () => {
  let calls = 0;
  const bridge = new AgentCoreBridge({
    coreServiceUrl: 'https://core.internal', serviceAuthorization: 'Bearer service-secret', timeoutMs: 100,
    maxServiceUnavailableRetries: 3,
    fetch: async (_url, init) => {
      calls += 1;
      await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      throw new Error('unreachable');
    },
  });
  const result = await bridge.handleAgentLockPrice(context, 90_000, 7);
  assert.deepEqual(result, { success: false, retryable: true, errorCode: 'CORE_BUSY', message: 'Järjestelmä on varattu, yritä hetken kuluttua uudelleen.' });
  assert.equal(calls, 1);
});

test('bridge maps strong-auth error without forwarding core response details', async () => {
  const bridge = new AgentCoreBridge({
    coreServiceUrl: 'https://core.internal', serviceAuthorization: 'Bearer service-secret',
    fetch: async () => new Response(JSON.stringify({ errorCode: 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED', message: 'secret identity detail' }), { status: 401 }),
  });
  const result = await bridge.handleAgentLockPrice(context, 90_000, 7);
  assert.deepEqual(result, { success: false, retryable: false, errorCode: 'STRONG_AUTH_REQUIRED', message: 'Ohjaa asiakas suorittamaan vahva tunnistautuminen.' });
  assert.doesNotMatch(JSON.stringify(result), /secret identity/);
});

test('invalid local input fails before any network request', async () => {
  let calls = 0;
  const bridge = new AgentCoreBridge({ coreServiceUrl: 'https://core.internal', serviceAuthorization: 'Bearer service-secret', fetch: async () => { calls += 1; return new Response(); } });
  const result = await bridge.handleAgentLockPrice(context, 90_000.001, 7);
  assert.equal(result.success, false); assert.equal(calls, 0);
});
