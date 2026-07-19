import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { invariant } from './errors.ts';
import type { AuditEvent, Deal, PaymentMethod } from './model.ts';
import type { TransactionContext, TransactionRepository } from './ports.ts';
import type { TransactionStatusEvent } from './events.ts';

interface InventoryRecord { readonly revision: string; availability: 'AVAILABLE' | 'LOCKED'; dealId: string | null; }
interface StoreData {
  schemaVersion: 1;
  deals: Record<string, Deal>;
  auditEvents: AuditEvent[];
  processedCallbacks: Record<string, string>;
  inventory: Record<string, InventoryRecord>;
  statusOutbox: Array<{ event: TransactionStatusEvent; published: boolean }>;
}

/**
 * Single-process durable adapter for demos and one-worker deployments.
 * Production clusters should implement TransactionRepository with a database
 * transaction and a unique constraint on (provider, idempotency_key).
 */
export class JsonTransactionRepository implements TransactionRepository {
  readonly #filePath: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(filePath: string) { invariant(filePath.length > 0, 'INVALID_STORAGE_PATH', 'Storage path is required'); this.#filePath = filePath; }

  transaction<T>(operation: (context: TransactionContext) => Promise<T>): Promise<T> {
    const run = this.#queue.then(async () => {
      const current = await this.#read(); const working = structuredClone(current);
      const result = await operation(contextFor(working));
      await this.#write(working); return result;
    });
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async findExpiredAwaitingPayment(now: string, limit: number): Promise<readonly string[]> {
    await this.#queue; const data = await this.#read(); const nowMs = Date.parse(now);
    return Object.values(data.deals)
      .filter((deal) => deal.state === 'AWAITING_PAYMENT' && deal.paymentDeadline !== null && Date.parse(deal.paymentDeadline) <= nowMs)
      .sort((left, right) => String(left.paymentDeadline).localeCompare(String(right.paymentDeadline)))
      .slice(0, limit).map((deal) => deal.id);
  }

  async listPendingStatusEvents(limit: number): Promise<readonly TransactionStatusEvent[]> {
    await this.#queue; const data = await this.#read();
    return data.statusOutbox.filter((record) => !record.published).slice(0, limit).map((record) => structuredClone(record.event));
  }

  async markStatusEventPublished(eventId: string): Promise<void> {
    const run = this.#queue.then(async () => {
      const data = await this.#read(); const record = data.statusOutbox.find((candidate) => candidate.event.eventId === eventId);
      invariant(Boolean(record), 'OUTBOX_EVENT_NOT_FOUND', 'Outbox event was not found');
      if (record && !record.published) { record.published = true; await this.#write(data); }
    });
    this.#queue = run.then(() => undefined, () => undefined); await run;
  }

  async getDeal(dealId: string): Promise<Deal | null> {
    await this.#queue; const data = await this.#read();
    return data.deals[dealId] ? structuredClone(data.deals[dealId]) : null;
  }

  async listAuditEvents(dealId: string): Promise<readonly AuditEvent[]> {
    await this.#queue; const data = await this.#read();
    return data.auditEvents.filter((event) => event.dealId === dealId).map((event) => structuredClone(event));
  }

  async #read(): Promise<StoreData> {
    try { return validateStore(JSON.parse(await readFile(this.#filePath, 'utf8'))); }
    catch (error) {
      if (isNotFound(error)) return { schemaVersion: 1, deals: {}, auditEvents: [], processedCallbacks: {}, inventory: {}, statusOutbox: [] };
      throw error;
    }
  }
  async #write(data: StoreData): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.#filePath);
  }
}

function contextFor(data: StoreData): TransactionContext {
  return {
    async getDeal(id) { return data.deals[id] ? structuredClone(data.deals[id]) : null; },
    async saveDeal(deal, expectedVersion) {
      const current = data.deals[deal.id];
      if (expectedVersion === 0) invariant(!current, 'DEAL_ALREADY_EXISTS', 'Deal already exists');
      else invariant(current?.version === expectedVersion, 'VERSION_CONFLICT', 'Deal version is stale');
      data.deals[deal.id] = structuredClone(deal);
    },
    async appendAudit(event) { data.auditEvents.push(structuredClone(event)); },
    async enqueueStatusEvent(event) {
      invariant(!data.statusOutbox.some((record) => record.event.eventId === event.eventId), 'OUTBOX_EVENT_EXISTS', 'Outbox event already exists');
      data.statusOutbox.push({ event: structuredClone(event), published: false });
    },
    async getProcessedCallbackDealId(provider, key) { return data.processedCallbacks[callbackKey(provider, key)] ?? null; },
    async recordProcessedCallback(provider, key, dealId) {
      const composite = callbackKey(provider, key);
      invariant(!(composite in data.processedCallbacks), 'DUPLICATE_CALLBACK', 'Callback already processed');
      data.processedCallbacks[composite] = dealId;
    },
    async lockInventory(vehicleId, revision, dealId) {
      const record = data.inventory[vehicleId];
      if (!record) data.inventory[vehicleId] = { revision, availability: 'LOCKED', dealId };
      else {
        invariant(record.revision === revision, 'STALE_INVENTORY', 'Inventory revision is stale');
        invariant(record.availability === 'AVAILABLE' || record.dealId === dealId, 'VEHICLE_NOT_AVAILABLE', 'Vehicle is not available');
        record.availability = 'LOCKED'; record.dealId = dealId;
      }
    },
    async releaseInventory(vehicleId, revision) {
      const record = data.inventory[vehicleId];
      invariant(record?.revision === revision, 'STALE_INVENTORY', 'Inventory revision is stale');
      record.availability = 'AVAILABLE'; record.dealId = null;
    },
  };
}

function validateStore(value: unknown): StoreData {
  invariant(typeof value === 'object' && value !== null, 'CORRUPT_TRANSACTION_STORE', 'Transaction store is invalid');
  const candidate = value as Partial<StoreData>;
  invariant(candidate.schemaVersion === 1 && Boolean(candidate.deals) && Array.isArray(candidate.auditEvents)
    && Boolean(candidate.processedCallbacks) && Boolean(candidate.inventory), 'CORRUPT_TRANSACTION_STORE', 'Transaction store schema is invalid');
  candidate.statusOutbox ??= [];
  return candidate as StoreData;
}
function callbackKey(provider: PaymentMethod, key: string): string { return `${provider}:${key}`; }
function isNotFound(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
