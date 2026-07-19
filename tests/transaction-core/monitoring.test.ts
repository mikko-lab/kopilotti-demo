import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { Response } from 'express';
import { HealthRouter, PrometheusMetricsCollector } from '../../src/transaction-core/index.ts';

class MetricsPool {
  outboxLag = 12.5; outboxCount = 5; databaseFailure: Error | null = null; queries: unknown[] = [];
  async query(query: unknown) {
    this.queries.push(query); if (this.databaseFailure) throw this.databaseFailure;
    if (typeof query === 'string' && query.includes('transactional_outbox')) return { rows: [{ total_unprocessed: String(this.outboxCount), max_lag_seconds: String(this.outboxLag) }] };
    return { rows: [{ '?column?': 1 }] };
  }
}

class FakeResponse {
  statusCode = 0; contentType = ''; body: unknown = null;
  status(code: number) { this.statusCode = code; return this; }
  type(value: string) { this.contentType = value; return this; }
  set(name: string, value: string) { if (name.toLowerCase() === 'content-type') this.contentType = value; return this; }
  send(value: unknown) { this.body = value; return this; }
  json(value: unknown) { this.body = value; return this; }
}

const now = new Date('2026-07-20T10:00:20.000Z');

test('collector queries unpublished outbox and exposes valid low-cardinality Prometheus metrics', async () => {
  const database = new MetricsPool(); const collector = new PrometheusMetricsCollector({ pool: database as unknown as Pool, clock: () => now });
  collector.registerDaemonHeartbeat(new Date('2026-07-20T10:00:10.000Z')); collector.registerDaemonError();
  const metrics = await collector.collectMetrics();
  assert.deepEqual(metrics, { outboxLagSeconds: 12.5, unprocessedOutboxCount: 5, daemonLastHeartbeat: '2026-07-20T10:00:10.000Z', daemonExecutionCount: 1, daemonErrorCount: 1 });
  const exposition = await collector.getExpositionFormat();
  assert.match(exposition, /# TYPE kopilotti_outbox_lag_seconds gauge/); assert.match(exposition, /kopilotti_timeout_daemon_errors_total 1/);
  assert.doesNotMatch(exposition, /transactionId|vehicleId|buyerId|providerId|idempotency/);
  assert.ok(database.queries.some((query) => typeof query === 'string' && query.includes('WHERE published_at IS NULL')));
});

test('readiness evaluates heartbeat and outbox policy without leaking dependency errors', async () => {
  const database = new MetricsPool(); const collector = new PrometheusMetricsCollector({ pool: database as unknown as Pool, clock: () => now });
  const health = new HealthRouter({ pool: database as unknown as Pool, metrics: collector, clock: () => now });
  const missingHeartbeat = new FakeResponse(); await health.handleReadiness({} as never, missingHeartbeat as unknown as Response);
  assert.equal(missingHeartbeat.statusCode, 503); assert.equal((missingHeartbeat.body as { reason: string }).reason, 'TIMEOUT_DAEMON_STALLED');

  collector.registerDaemonHeartbeat(new Date('2026-07-20T10:00:10.000Z'));
  const ready = new FakeResponse(); await health.handleReadiness({} as never, ready as unknown as Response);
  assert.equal(ready.statusCode, 200); assert.deepEqual(ready.body, { status: 'READY' });

  database.outboxLag = 300;
  const lagged = new FakeResponse(); await health.handleReadiness({} as never, lagged as unknown as Response);
  assert.equal(lagged.statusCode, 503); assert.equal((lagged.body as { reason: string }).reason, 'OUTBOX_LAG_CRITICAL');

  database.databaseFailure = new Error('postgres://secret-user:secret-password@internal/database');
  const failed = new FakeResponse(); await health.handleReadiness({} as never, failed as unknown as Response);
  assert.deepEqual(failed.body, { status: 'UNHEALTHY', reason: 'DEPENDENCY_UNAVAILABLE' });
  assert.doesNotMatch(JSON.stringify(failed.body), /secret|postgres/);
});

test('HTTP-only worker can disable local daemon heartbeat readiness requirement', async () => {
  const database = new MetricsPool(); const collector = new PrometheusMetricsCollector({ pool: database as unknown as Pool, clock: () => now });
  const health = new HealthRouter({ pool: database as unknown as Pool, metrics: collector, policy: { requireDaemonHeartbeat: false }, clock: () => now });
  const response = new FakeResponse(); await health.handleReadiness({} as never, response as unknown as Response);
  assert.equal(response.statusCode, 200);
});

test('liveness does not depend on database or background workers', () => {
  const database = new MetricsPool(); database.databaseFailure = new Error('offline');
  const collector = new PrometheusMetricsCollector({ pool: database as unknown as Pool });
  const health = new HealthRouter({ pool: database as unknown as Pool, metrics: collector });
  const response = new FakeResponse(); health.handleLiveness({} as never, response as unknown as Response);
  assert.equal(response.statusCode, 200); assert.equal(response.body, 'OK'); assert.equal(database.queries.length, 0);
});

test('metrics failure returns constant safe response', async () => {
  const database = new MetricsPool(); database.databaseFailure = new Error('sensitive database detail');
  const collector = new PrometheusMetricsCollector({ pool: database as unknown as Pool });
  const health = new HealthRouter({ pool: database as unknown as Pool, metrics: collector });
  const response = new FakeResponse(); await health.handleMetrics({} as never, response as unknown as Response);
  assert.equal(response.statusCode, 500); assert.equal(response.body, '# ERROR metrics unavailable\n');
});
