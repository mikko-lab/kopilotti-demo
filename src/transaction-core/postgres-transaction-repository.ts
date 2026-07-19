import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { invariant } from './errors.ts';
import type { TransactionStatusEvent } from './events.ts';
import type { AuditEvent, Customer, Deal, DealState, PaymentMethod, TransitionSource } from './model.ts';
import type { TransactionContext, TransactionRepository } from './ports.ts';

export interface CustomerVault {
  getById(tenantId: string, buyerId: string): Promise<Customer | null>;
}

interface DealRow extends QueryResultRow {
  id: string; tenant_id: string; vehicle_id: string; registration_number: string; status: DealState;
  version: number; agreed_price_cents: string | number | null; currency: 'EUR'; buyer_id: string | null;
  payment_method: PaymentMethod | null; payment_deadline: Date | string | null; provider_reference: string | null;
  handover_policy_version: string | null; inventory_revision_at_lock: string | number;
  created_at: Date | string; updated_at: Date | string;
}
interface VehicleLockRow extends QueryResultRow { id: string; inventory_revision: string | number; is_available: boolean; locked_deal_id: string | null; }
interface CallbackRow extends QueryResultRow { transaction_id: string; }
interface IdRow extends QueryResultRow { id: string; }
interface OutboxRow extends QueryResultRow { payload: unknown; }

const DEAL_COLUMNS = `id, tenant_id, vehicle_id, registration_number, status, version,
  agreed_price_cents, currency, buyer_id, payment_method, payment_deadline, provider_reference,
  handover_policy_version, inventory_revision_at_lock, created_at, updated_at`;

export class PostgresTransactionRepository implements TransactionRepository {
  readonly #pool: Pool;
  readonly #customers: CustomerVault;
  readonly #workerId: string;
  readonly #claimLeaseSeconds: number;

  constructor(input: { pool: Pool; customers: CustomerVault; workerId?: string; claimLeaseSeconds?: number }) {
    this.#pool = input.pool; this.#customers = input.customers; this.#workerId = input.workerId ?? randomUUID();
    this.#claimLeaseSeconds = input.claimLeaseSeconds ?? 30;
    invariant(/^[A-Za-z0-9_.:-]{1,128}$/.test(this.#workerId), 'INVALID_WORKER_ID', 'workerId is invalid');
    invariant(Number.isInteger(this.#claimLeaseSeconds) && this.#claimLeaseSeconds >= 5 && this.#claimLeaseSeconds <= 3600, 'INVALID_CLAIM_LEASE', 'claimLeaseSeconds must be 5..3600');
  }

  async transaction<T>(operation: (context: TransactionContext) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(this.#context(client));
      await client.query('COMMIT'); return result;
    } catch (error) {
      await rollback(client); throw error;
    } finally { client.release(); }
  }

  async processExpiredAwaitingPayment(now: string, limit: number, operation: (context: TransactionContext, dealId: string) => Promise<void>): Promise<{ processed: number; skipped: number }> {
    validateLimit(limit); let processed = 0;
    for (let index = 0; index < limit; index += 1) {
      const client = await this.#pool.connect();
      try {
        await client.query('BEGIN');
        const selected = await client.query<IdRow>(
          `SELECT id FROM deals
           WHERE status = 'AWAITING_PAYMENT' AND payment_deadline < $1::timestamptz
           ORDER BY payment_deadline, id
           LIMIT 1 FOR UPDATE SKIP LOCKED`, [now],
        );
        const row = selected.rows[0];
        if (!row) { await client.query('COMMIT'); return { processed, skipped: 0 }; }
        await operation(this.#context(client), row.id);
        await client.query('COMMIT'); processed += 1;
      } catch (error) { await rollback(client); throw error; }
      finally { client.release(); }
    }
    return { processed, skipped: 0 };
  }

  async claimPendingStatusEvents(limit: number): Promise<readonly TransactionStatusEvent[]> {
    validateLimit(limit);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<OutboxRow>(
        `WITH candidates AS (
           SELECT event_id FROM transactional_outbox
           WHERE published_at IS NULL AND (claimed_at IS NULL OR claimed_at < now() - ($2 * interval '1 second'))
           ORDER BY created_at, event_id LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE transactional_outbox AS outbox
         SET claimed_at = now(), claim_token = $3
         FROM candidates WHERE outbox.event_id = candidates.event_id
         RETURNING outbox.payload`, [limit, this.#claimLeaseSeconds, this.#workerId],
      );
      await client.query('COMMIT'); return result.rows.map((row) => parseStatusEvent(row.payload));
    } catch (error) { await rollback(client); throw error; }
    finally { client.release(); }
  }

  async markStatusEventPublished(eventId: string): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE transactional_outbox SET published_at = now(), claim_token = NULL
       WHERE event_id = $1 AND claim_token = $2 AND published_at IS NULL`, [eventId, this.#workerId],
    );
    invariant(result.rowCount === 1, 'OUTBOX_CLAIM_LOST', 'Outbox event claim is missing or expired');
  }

  async getDeal(dealId: string): Promise<Deal | null> {
    const result = await this.#pool.query<DealRow>(`SELECT ${DEAL_COLUMNS} FROM deals WHERE id = $1`, [dealId]);
    return result.rows[0] ? this.#mapDeal(result.rows[0]) : null;
  }

  async listAuditEvents(dealId: string): Promise<readonly AuditEvent[]> {
    const result = await this.#pool.query<QueryResultRow & { event_id: string; transaction_id: string; tenant_id: string; occurred_at: Date | string; event: string; from_status: DealState; to_status: DealState; source: TransitionSource; payload: AuditEvent['payload'] }>(
      `SELECT event_id, transaction_id, tenant_id, occurred_at, event, from_status, to_status, source, payload
       FROM audit_logs WHERE transaction_id = $1 ORDER BY occurred_at, event_id`, [dealId],
    );
    return result.rows.map((row) => ({ id: row.event_id, dealId: row.transaction_id, tenantId: row.tenant_id, timestamp: iso(row.occurred_at), event: row.event, fromState: row.from_status, toState: row.to_status, source: row.source, payload: row.payload }));
  }

  #context(client: PoolClient): TransactionContext {
    return {
      getDeal: async (dealId) => {
        const result = await client.query<DealRow>(`SELECT ${DEAL_COLUMNS} FROM deals WHERE id = $1`, [dealId]);
        return result.rows[0] ? this.#mapDeal(result.rows[0]) : null;
      },
      saveDeal: async (deal, expectedVersion) => {
        const values = dealValues(deal);
        if (expectedVersion === 0) {
          await client.query(
            `INSERT INTO deals (${DEAL_COLUMNS}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})`, [...values],
          ); return;
        }
        const result = await client.query(
          `UPDATE deals SET tenant_id=$2, vehicle_id=$3, registration_number=$4, status=$5, version=$6,
             agreed_price_cents=$7, currency=$8, buyer_id=$9, payment_method=$10, payment_deadline=$11,
             provider_reference=$12, handover_policy_version=$13, inventory_revision_at_lock=$14,
             created_at=$15, updated_at=$16 WHERE id=$1 AND version=$17`, [...values, expectedVersion],
        );
        invariant(result.rowCount === 1, 'VERSION_CONFLICT', 'Deal version is stale');
      },
      appendAudit: async (event) => { await client.query(
        `INSERT INTO audit_logs (event_id, transaction_id, tenant_id, occurred_at, event, from_status, to_status, source, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [event.id, event.dealId, event.tenantId, event.timestamp, event.event, event.fromState, event.toState, event.source, JSON.stringify(event.payload)],
      ); },
      enqueueStatusEvent: async (event) => { await client.query(
        `INSERT INTO transactional_outbox (event_id, transaction_id, event_type, payload, created_at)
         VALUES ($1,$2,'TRANSACTION_STATUS_CHANGED',$3::jsonb,$4)`, [event.eventId, event.transactionId, JSON.stringify(event), event.timestamp],
      ); },
      getProcessedCallbackDealId: async (provider, key) => {
        const result = await client.query<CallbackRow>(`SELECT transaction_id FROM processed_callbacks WHERE provider=$1 AND idempotency_key=$2`, [provider, key]);
        return result.rows[0]?.transaction_id ?? null;
      },
      recordProcessedCallback: async (provider, key, dealId) => { await client.query(
        `INSERT INTO processed_callbacks (provider, idempotency_key, transaction_id) VALUES ($1,$2,$3)`, [provider, key, dealId],
      ); },
      lockInventory: async (vehicleId, revision, dealId) => {
        const expected = pgRevision(revision); const result = await client.query<VehicleLockRow>(
          `SELECT id, inventory_revision, is_available, locked_deal_id FROM vehicles
           WHERE id = $1 AND is_available = TRUE FOR UPDATE`, [vehicleId],
        );
        const row = result.rows[0]; invariant(Boolean(row), 'VEHICLE_NOT_AVAILABLE', 'Vehicle is unavailable');
        invariant(toSafeInteger(row?.inventory_revision) === expected, 'STALE_INVENTORY', 'Inventory revision is stale');
        await client.query(`UPDATE vehicles SET is_available=FALSE, locked_deal_id=$2, updated_at=now() WHERE id=$1`, [vehicleId, dealId]);
      },
      lockInventoryForHandover: async (vehicleId, revision, dealId) => {
        const expected = pgRevision(revision); const result = await client.query<VehicleLockRow>(
          `SELECT id, inventory_revision, is_available, locked_deal_id FROM vehicles WHERE id=$1 FOR UPDATE`, [vehicleId],
        );
        const row = result.rows[0];
        invariant(Boolean(row) && row?.is_available === false && row.locked_deal_id === dealId, 'VEHICLE_LOCK_MISMATCH', 'Vehicle lock does not belong to deal');
        invariant(toSafeInteger(row?.inventory_revision) === expected, 'STALE_INVENTORY', 'Inventory revision is stale');
      },
      releaseInventory: async (vehicleId, revision, dealId) => {
        const result = await client.query(
          `UPDATE vehicles SET is_available=TRUE, locked_deal_id=NULL, updated_at=now()
           WHERE id=$1 AND inventory_revision=$2 AND locked_deal_id=$3 AND is_available=FALSE`, [vehicleId, pgRevision(revision), dealId],
        );
        invariant(result.rowCount === 1, 'VEHICLE_LOCK_MISMATCH', 'Vehicle release lock does not match deal');
      },
    };
  }

  async #mapDeal(row: DealRow): Promise<Deal> {
    const buyer = row.buyer_id ? await this.#customers.getById(row.tenant_id, row.buyer_id) : null;
    invariant(row.status === 'NEGOTIATING' ? buyer === null : buyer?.ssnVerified === true, 'CUSTOMER_REFERENCE_INVALID', 'Strong customer reference cannot be resolved');
    return {
      id: row.id, tenantId: row.tenant_id, state: row.status, version: row.version,
      vehicle: { vehicleId: row.vehicle_id, registrationIdentifier: row.registration_number, inventoryRevision: toSafeInteger(row.inventory_revision_at_lock) },
      buyer, agreedPriceCents: nullableSafeInteger(row.agreed_price_cents), currency: row.currency,
      paymentMethod: row.payment_method, paymentDeadline: nullableIso(row.payment_deadline), providerReference: row.provider_reference,
      handoverPolicyVersion: row.handover_policy_version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    };
  }
}

function dealValues(deal: Deal): readonly unknown[] {
  return [deal.id, deal.tenantId, deal.vehicle.vehicleId, deal.vehicle.registrationIdentifier, deal.state, deal.version,
    deal.agreedPriceCents, deal.currency, deal.buyer?.id ?? null, deal.paymentMethod, deal.paymentDeadline,
    deal.providerReference, deal.handoverPolicyVersion, pgRevision(deal.vehicle.inventoryRevision), deal.createdAt, deal.updatedAt];
}
function validateLimit(limit: number): void { invariant(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'INVALID_LIMIT', 'limit must be 1..1000'); }
function pgRevision(value: string | number): number { invariant(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'POSTGRES_INVENTORY_REVISION_REQUIRED', 'Postgres inventory revision must be a non-negative integer'); return value; }
function toSafeInteger(value: string | number | undefined): number { const parsed = typeof value === 'number' ? value : Number(value); invariant(Number.isSafeInteger(parsed), 'INVALID_DATABASE_VALUE', 'Database integer is outside safe range'); return parsed; }
function nullableSafeInteger(value: string | number | null): number | null { return value === null ? null : toSafeInteger(value); }
function iso(value: Date | string): string { const date = value instanceof Date ? value : new Date(value); invariant(Number.isFinite(date.getTime()), 'INVALID_DATABASE_VALUE', 'Database timestamp is invalid'); return date.toISOString(); }
function nullableIso(value: Date | string | null): string | null { return value === null ? null : iso(value); }
function parseStatusEvent(value: unknown): TransactionStatusEvent {
  invariant(typeof value === 'object' && value !== null, 'INVALID_OUTBOX_EVENT', 'Outbox payload is invalid');
  const event = value as Partial<TransactionStatusEvent>;
  invariant(typeof event.eventId === 'string' && typeof event.transactionId === 'string' && typeof event.registrationNumber === 'string'
    && typeof event.status === 'string' && ['NEGOTIATING', 'PRICE_AGREED', 'AWAITING_PAYMENT', 'PAID', 'HANDED_OVER', 'VOIDED'].includes(event.status)
    && (typeof event.paymentDeadline === 'string' || event.paymentDeadline === null)
    && typeof event.timestamp === 'string', 'INVALID_OUTBOX_EVENT', 'Outbox payload is invalid');
  return event as TransactionStatusEvent;
}
async function rollback(client: PoolClient): Promise<void> { try { await client.query('ROLLBACK'); } catch { /* original error remains authoritative */ } }
