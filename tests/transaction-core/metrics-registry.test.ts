import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { AgentCoreBridge, createMetricsRegistry, createMetricsServer, PROMETHEUS_CONTENT_TYPE } from '../../src/transaction-core/index.ts';

test('isolated registry records bounded transaction labels and validates CDC lag', async () => {
  const metrics = createMetricsRegistry({ collectDefaults: false });
  metrics.recordPriceLock('success', 'none');
  metrics.recordPriceLock('failed', 'price_not_authorized');
  metrics.recordLockFailure('revision_mismatch');
  metrics.setCdcLagSeconds(1.25);

  const exposition = await metrics.registry.metrics();
  assert.match(exposition, /kopilotti_transaction_lock_attempts_total\{status="success",error_code="none"\} 1/);
  assert.match(exposition, /kopilotti_transaction_lock_attempts_total\{status="failed",error_code="price_not_authorized"\} 1/);
  assert.match(exposition, /kopilotti_transaction_lock_failures_total\{failure_type="revision_mismatch"\} 1/);
  assert.match(exposition, /kopilotti_kafka_cdc_lag_seconds 1\.25/);
  assert.throws(() => metrics.setCdcLagSeconds(-1), /non-negative/);
});

test('metrics HTTP server exposes only the registry with Prometheus text content type', async () => {
  const metrics = createMetricsRegistry({ collectDefaults: false });
  metrics.recordPriceLock('success', 'none');
  const server = createMetricsServer(metrics.registry);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), PROMETHEUS_CONTENT_TYPE);
    assert.match(await response.text(), /kopilotti_transaction_lock_attempts_total/);
    const missing = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(missing.status, 404);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('AgentCoreBridge records one final outcome and a 503 lock failure without leaking identifiers to labels', async () => {
  const metrics = createMetricsRegistry({ collectDefaults: false });
  const bridge = new AgentCoreBridge({
    coreServiceUrl: 'https://core.internal', serviceAuthorization: 'Bearer service-secret', metrics,
    maxServiceUnavailableRetries: 0,
    fetch: async () => new Response(JSON.stringify({ errorCode: 'INTERNAL_ERROR', message: 'unavailable' }), { status: 503 }),
  });
  const result = await bridge.handleAgentLockPrice({ dealId: 'deal-secret', vehicleId: 'vehicle-secret', buyerSessionToken: 'session-secret' }, 90_000, 7);
  assert.equal(result.success, false);
  const exposition = await metrics.registry.metrics();
  assert.match(exposition, /status="failed",error_code="core_unavailable"\} 1/);
  assert.match(exposition, /failure_type="db_timeout"\} 1/);
  assert.doesNotMatch(exposition, /deal-secret|vehicle-secret|session-secret/);
});
