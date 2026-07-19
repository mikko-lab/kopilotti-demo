import type { AuditEvent, Deal, HandoverPolicy, PaymentMethod, VerifiedProviderCallback } from './model.ts';
import type { TransactionStatusEvent } from './events.ts';

export interface TransactionContext {
  getDeal(dealId: string): Promise<Deal | null>;
  saveDeal(deal: Deal, expectedVersion: number): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  enqueueStatusEvent(event: TransactionStatusEvent): Promise<void>;
  getProcessedCallbackDealId(provider: PaymentMethod, idempotencyKey: string): Promise<string | null>;
  recordProcessedCallback(provider: PaymentMethod, idempotencyKey: string, dealId: string): Promise<void>;
  lockInventory(vehicleId: string, expectedInventoryRevision: string, dealId: string): Promise<void>;
  releaseInventory(vehicleId: string, expectedInventoryRevision: string): Promise<void>;
}

export interface TransactionRepository {
  transaction<T>(operation: (context: TransactionContext) => Promise<T>): Promise<T>;
  findExpiredAwaitingPayment(now: string, limit: number): Promise<readonly string[]>;
  listPendingStatusEvents(limit: number): Promise<readonly TransactionStatusEvent[]>;
  markStatusEventPublished(eventId: string): Promise<void>;
}

export interface ProviderAdapter {
  readonly method: PaymentMethod;
  readonly sourceName: 'PAYMENT_PROVIDER_ADAPTER' | 'FINANCING_PROVIDER_ADAPTER';
  verifyCallback(rawBody: Uint8Array, headers: Readonly<Record<string, string | undefined>>): Promise<VerifiedProviderCallback>;
}

export interface HandoverPolicyRepository {
  getCurrent(tenantId: string): Promise<HandoverPolicy | null>;
  getByVersion(tenantId: string, version: string): Promise<HandoverPolicy | null>;
}

export interface Clock { now(): Date; }
export interface IdGenerator { next(): string; }
export interface BusinessCalendarPort { addBusinessDays(input: Date, count: number): Date; }

export interface DealershipAuthorizer {
  requireHandoverPermission(credential: unknown, tenantId: string): Promise<{ readonly actorId: string }>;
}
