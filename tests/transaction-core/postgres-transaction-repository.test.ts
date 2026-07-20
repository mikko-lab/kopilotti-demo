import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { PostgresTransactionRepository, type Deal, type TransactionStatusEvent } from '../../src/transaction-core/index.ts';

type QueryHandler = (sql: string, parameters: readonly unknown[]) => Promise<Partial<QueryResult>>;
class FakeClient {
  readonly queries: Array<{ sql: string; parameters: readonly unknown[] }> = []; released = false; readonly #handler: QueryHandler;
  constructor(handler: QueryHandler) { this.#handler = handler; }
  async query(sql: string, parameters: readonly unknown[] = []) {
    this.queries.push({ sql: compact(sql), parameters });
    return { rows: [], rowCount: 0, command: '', oid: 0, fields: [], ...(await this.#handler(compact(sql), parameters)) };
  }
  release() { this.released = true; }
}
class FakePool {
  readonly client: FakeClient; readonly directQueries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  constructor(handler: QueryHandler) { this.client = new FakeClient(handler); }
  async connect() { return this.client as unknown as PoolClient; }
  async query(sql: string, parameters: readonly unknown[] = []) { this.directQueries.push({ sql: compact(sql), parameters }); return this.client.query(sql, parameters); }
}

const buyer = { id: 'customer-1', ssnVerified: true, fullName: 'Testi Ostaja', email: 'ostaja@example.test', phone: '+358401234567' } as const;
const paidDeal: Deal = {
  id: 'deal-1', tenantId: 'dealer-1', state: 'PAID', version: 4,
  vehicle: { vehicleId: 'vehicle-1', registrationIdentifier: 'ABC-123', inventoryRevision: 7 }, buyer,
  agreedPriceCents: 3_000_000, currency: 'EUR', paymentMethod: 'CASH', paymentDeadline: '2026-07-22T12:00:00.000Z',
  providerReference: 'payment-1', handoverPolicyVersion: 'policy-v1', createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
};
const statusEvent: TransactionStatusEvent = { eventId: 'event-1', transactionId: 'deal-1', registrationNumber: 'ABC-123', status: 'PAID', paymentDeadline: paidDeal.paymentDeadline, timestamp: paidDeal.updatedAt };

test('processed event migration uses UUID primary-key deduplication and server timestamp', async () => {
  const migration = await readFile(new URL('../../migrations/002_processed_events.sql', import.meta.url), 'utf8');
  assert.match(migration, /event_id uuid PRIMARY KEY/i);
  assert.match(migration, /processed_at timestamp with time zone NOT NULL DEFAULT now\(\)/i);
});
const customers = { getById: async () => buyer };

test('DDL defines inventory, PII reference, callback uniqueness, audit and outbox indexes', async () => {
  const ddl = await readFile('migrations/001_transaction_core.sql', 'utf8');
  for (const table of ['vehicles', 'deals', 'audit_logs', 'processed_callbacks', 'transactional_outbox']) assert.match(ddl, new RegExp(`CREATE TABLE ${table}`));
  assert.match(ddl, /UNIQUE \(provider, idempotency_key\)/); assert.match(ddl, /buyer_id text/);
  assert.doesNotMatch(ddl, /full_name|email|phone|ssn/); assert.match(ddl, /transactional_outbox_pending_idx/);
  assert.match(ddl, /FOREIGN KEY \(vehicle_id, tenant_id\)/); assert.match(ddl, /audit_logs_append_only/);
});

test('vehicle price lock uses availability predicate, FOR UPDATE and revision check', async () => {
  const pool = new FakePool(async (sql) => sql.startsWith('SELECT id, inventory_revision')
    ? { rows: [{ id: 'vehicle-1', inventory_revision: '7', is_available: true, locked_deal_id: null }], rowCount: 1 }
    : { rowCount: 1 });
  const repository = new PostgresTransactionRepository({ pool: pool as unknown as Pool, customers, workerId: 'worker-1' });
  await repository.transaction((context) => context.lockInventory('vehicle-1', 7, 'deal-1'));
  const select = pool.client.queries.find((query) => query.sql.includes('FROM vehicles'))?.sql ?? '';
  assert.match(select, /WHERE id = \$1 AND is_available = TRUE FOR UPDATE/);
  assert.ok(pool.client.queries.some((query) => query.sql.startsWith('UPDATE vehicles SET is_available=FALSE')));
  assert.equal(pool.client.queries.at(0)?.sql, 'BEGIN'); assert.equal(pool.client.queries.at(-1)?.sql, 'COMMIT'); assert.equal(pool.client.released, true);
});

test('handover locks the vehicle row and verifies ownership by the same deal', async () => {
  const pool = new FakePool(async (sql) => sql.startsWith('SELECT id, inventory_revision')
    ? { rows: [{ id: 'vehicle-1', inventory_revision: 7, is_available: false, locked_deal_id: 'deal-1' }], rowCount: 1 }
    : { rowCount: 1 });
  const repository = new PostgresTransactionRepository({ pool: pool as unknown as Pool, customers, workerId: 'worker-1' });
  await repository.transaction((context) => context.lockInventoryForHandover('vehicle-1', 7, 'deal-1'));
  const select = pool.client.queries.find((query) => query.sql.includes('FROM vehicles'))?.sql ?? '';
  assert.match(select, /WHERE id=\$1 FOR UPDATE/); assert.equal(pool.client.queries.at(-1)?.sql, 'COMMIT');
});

test('callback key, PAID update and outbox insert share one SQL transaction', async () => {
  const pool = new FakePool(async (sql) => sql.startsWith('UPDATE deals') ? { rowCount: 1 } : { rowCount: 1 });
  const repository = new PostgresTransactionRepository({ pool: pool as unknown as Pool, customers, workerId: 'worker-1' });
  await repository.transaction(async (context) => {
    await context.recordProcessedCallback('CASH', 'callback-1', 'deal-1');
    await context.saveDeal(paidDeal, 3);
    await context.enqueueStatusEvent(statusEvent);
  });
  const sql = pool.client.queries.map((query) => query.sql);
  assert.deepEqual([sql[0], sql.at(-1)], ['BEGIN', 'COMMIT']);
  assert.ok(sql.some((value) => value.startsWith('INSERT INTO processed_callbacks')));
  assert.ok(sql.some((value) => value.startsWith('UPDATE deals')));
  assert.ok(sql.some((value) => value.startsWith('INSERT INTO transactional_outbox')));
});

test('callback unique violation rolls transaction back without subsequent writes', async () => {
  const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
  const pool = new FakePool(async (sql) => { if (sql.startsWith('INSERT INTO processed_callbacks')) throw duplicate; return { rowCount: 1 }; });
  const repository = new PostgresTransactionRepository({ pool: pool as unknown as Pool, customers, workerId: 'worker-1' });
  await assert.rejects(repository.transaction(async (context) => {
    await context.recordProcessedCallback('CASH', 'callback-1', 'deal-1');
    await context.saveDeal(paidDeal, 3);
    await context.enqueueStatusEvent(statusEvent);
  }), { code: '23505' });
  const sql = pool.client.queries.map((query) => query.sql);
  assert.deepEqual(sql, ['BEGIN', 'INSERT INTO processed_callbacks (provider, idempotency_key, transaction_id) VALUES ($1,$2,$3)', 'ROLLBACK']);
});

test('distributed timeout processing holds SKIP LOCKED row through operation commit', async () => {
  let selected = false;
  const pool = new FakePool(async (sql) => {
    if (sql.includes("status = 'AWAITING_PAYMENT'") && !selected) { selected = true; return { rows: [{ id: 'deal-1' }], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  });
  const repository = new PostgresTransactionRepository({ pool: pool as unknown as Pool, customers, workerId: 'daemon-1' });
  let operated = false;
  const result = await repository.processExpiredAwaitingPayment('2026-07-23T00:00:00.000Z', 1, async (_context, dealId) => { operated = dealId === 'deal-1'; });
  assert.deepEqual(result, { processed: 1, skipped: 0 }); assert.equal(operated, true);
  assert.match(pool.client.queries[1]?.sql ?? '', /FOR UPDATE SKIP LOCKED/); assert.equal(pool.client.queries.at(-1)?.sql, 'COMMIT');
});

test('outbox claim is atomic, leased and uses SKIP LOCKED', async () => {
  const pool = new FakePool(async (sql) => sql.startsWith('WITH candidates') ? { rows: [{ payload: statusEvent }], rowCount: 1 } : { rowCount: 1 });
  const repository = new PostgresTransactionRepository({ pool: pool as unknown as Pool, customers, workerId: 'outbox-1', claimLeaseSeconds: 45 });
  const events = await repository.claimPendingStatusEvents(10);
  assert.deepEqual(events, [statusEvent]); const claim = pool.client.queries[1];
  assert.match(claim?.sql ?? '', /FOR UPDATE SKIP LOCKED/); assert.match(claim?.sql ?? '', /claim_token = \$3/); assert.deepEqual(claim?.parameters, [10, 45, 'outbox-1']);
});

function compact(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
