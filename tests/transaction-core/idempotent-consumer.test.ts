import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { createMetricsRegistry, IdempotentEventConsumer } from '../../src/transaction-core/index.ts';

class FakeClient {
  readonly committedEvents = new Set<string>();
  pendingEvent: string | null = null;
  released = 0;

  async query(sql: string, values: readonly unknown[] = []): Promise<QueryResult> {
    if (sql === 'BEGIN') { this.pendingEvent = null; return result(0); }
    if (sql === 'COMMIT') {
      if (this.pendingEvent) this.committedEvents.add(this.pendingEvent);
      this.pendingEvent = null;
      return result(0);
    }
    if (sql === 'ROLLBACK') { this.pendingEvent = null; return result(0); }
    if (sql.includes('INSERT INTO processed_events')) {
      const eventId = String(values[0]);
      if (this.committedEvents.has(eventId)) return result(0);
      this.pendingEvent = eventId;
      return result(1);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  release(): void { this.released += 1; }
}

class FakePool {
  readonly client = new FakeClient();
  async connect(): Promise<PoolClient> { return this.client as unknown as PoolClient; }
}

test('same Kafka event is handled once, then acknowledged and flagged as a duplicate', async () => {
  const eventId = randomUUID();
  const pool = new FakePool();
  const metrics = createMetricsRegistry({ collectDefaults: false });
  const warnings: Array<{ message: string; fields: Readonly<Record<string, string>> }> = [];
  const consumer = new IdempotentEventConsumer({
    pool: pool as unknown as Pool,
    metrics,
    logger: { warn: (message, fields) => { warnings.push({ message, fields }); } },
  });
  let sideEffects = 0;
  const event = { eventId, eventType: 'TRANSACTION_STATUS_CHANGED', payload: { status: 'PAID' } } as const;

  const first = await consumer.consume(event, async (_received, client) => {
    assert.equal(client, pool.client as unknown as PoolClient);
    sideEffects += 1;
  });
  const second = await consumer.consume(event, async () => { sideEffects += 1; });

  assert.deepEqual(first, { acknowledged: true, duplicate: false });
  assert.deepEqual(second, { acknowledged: true, duplicate: true });
  assert.equal(sideEffects, 1);
  assert.equal(pool.client.released, 2);
  assert.deepEqual(warnings, [{
    message: 'duplicate_kafka_event_skipped',
    fields: { event_id: eventId, event_type: 'TRANSACTION_STATUS_CHANGED' },
  }]);
  const exposition = await metrics.registry.metrics();
  assert.match(exposition, /kopilotti_consumer_duplicate_events_total\{event_type="TRANSACTION_STATUS_CHANGED"\} 1/);
});

test('handler failure rolls back the marker and remains retryable', async () => {
  const pool = new FakePool();
  const consumer = new IdempotentEventConsumer({
    pool: pool as unknown as Pool,
    metrics: createMetricsRegistry({ collectDefaults: false }),
    logger: { warn: () => {} },
  });
  const event = { eventId: randomUUID(), eventType: 'TRANSACTION_STATUS_CHANGED', payload: {} } as const;
  await assert.rejects(consumer.consume(event, async () => { throw new Error('business failure'); }), /business failure/);
  let retries = 0;
  const retried = await consumer.consume(event, async () => { retries += 1; });
  assert.deepEqual(retried, { acknowledged: true, duplicate: false });
  assert.equal(retries, 1);
});

function result(rowCount: number): QueryResult {
  return { command: '', rowCount, oid: 0, fields: [], rows: [] };
}
