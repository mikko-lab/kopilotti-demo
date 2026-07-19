import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addBusinessDays, BusinessCalendar, createVersionedHandoverPolicy, KopilottiEngine, PaymentTimeoutDaemon, TransactionMachine, type AuditEvent, type Deal, type HandoverPolicy,
  type PaymentMethod, type TransactionContext, type TransactionRepository, type TransactionStatusEvent, type VerifiedProviderCallback,
} from '../../src/transaction-core/index.ts';

const revision = 'a'.repeat(64);
const buyer = { id: 'customer-1', ssnVerified: true, fullName: 'Testi Ostaja', email: 'ostaja@example.test', phone: '+358401234567' } as const;
const rules = {
  requireCeramicCoatingCompleted: false, requireHandoverInspectionCompleted: true,
  requireIdentityVerified: false, requireRegistrationCompleted: false,
  requireInsuranceInformationReceived: false, requireManualApproval: false,
};
const policy: HandoverPolicy = {
  tenantId: 'dealer-1', version: 'policy-v1', defaultRules: rules,
  vehicleRules: { 'alfa-qv-1': { ...rules, requireCeramicCoatingCompleted: true } },
};

class MemoryRepository implements TransactionRepository {
  deals = new Map<string, Deal>(); audits: AuditEvent[] = []; callbacks = new Map<string, string>(); released: string[] = []; locked = new Set<string>(); outbox: Array<{ event: TransactionStatusEvent; published: boolean }> = [];
  async transaction<T>(operation: (context: TransactionContext) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({ deals: [...this.deals], audits: this.audits, callbacks: [...this.callbacks], released: this.released, locked: [...this.locked], outbox: this.outbox });
    try { return await operation(this.context()); }
    catch (error) { this.deals = new Map(snapshot.deals); this.audits = snapshot.audits; this.callbacks = new Map(snapshot.callbacks); this.released = snapshot.released; this.locked = new Set(snapshot.locked); this.outbox = snapshot.outbox; throw error; }
  }
  async findExpiredAwaitingPayment(now: string, limit: number): Promise<readonly string[]> { return [...this.deals.values()].filter((deal) => deal.state === 'AWAITING_PAYMENT' && Date.parse(String(deal.paymentDeadline)) <= Date.parse(now)).slice(0, limit).map((deal) => deal.id); }
  async processExpiredAwaitingPayment(now: string, limit: number, operation: (context: TransactionContext, dealId: string) => Promise<void>): Promise<{ processed: number; skipped: number }> { const ids = await this.findExpiredAwaitingPayment(now, limit); for (const id of ids) await this.transaction((context) => operation(context, id)); return { processed: ids.length, skipped: 0 }; }
  async claimPendingStatusEvents(limit: number): Promise<readonly TransactionStatusEvent[]> { return this.outbox.filter((record) => !record.published).slice(0, limit).map((record) => structuredClone(record.event)); }
  async markStatusEventPublished(eventId: string): Promise<void> { const record = this.outbox.find((item) => item.event.eventId === eventId); if (record) record.published = true; }
  context(): TransactionContext {
    return {
      getDeal: async (id) => structuredClone(this.deals.get(id) ?? null),
      saveDeal: async (deal, version) => { const current = this.deals.get(deal.id); if ((version === 0 && current) || (version > 0 && current?.version !== version)) throw Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' }); this.deals.set(deal.id, structuredClone(deal)); },
      appendAudit: async (event) => { this.audits.push(structuredClone(event)); },
      enqueueStatusEvent: async (event) => { this.outbox.push({ event: structuredClone(event), published: false }); },
      getProcessedCallbackDealId: async (provider, key) => this.callbacks.get(`${provider}:${key}`) ?? null,
      recordProcessedCallback: async (provider, key, dealId) => { this.callbacks.set(`${provider}:${key}`, dealId); },
      lockInventory: async (vehicleId) => { if (this.locked.has(vehicleId)) throw Object.assign(new Error('locked'), { code: 'VEHICLE_NOT_AVAILABLE' }); this.locked.add(vehicleId); },
      lockInventoryForHandover: async (vehicleId) => { if (!this.locked.has(vehicleId)) throw Object.assign(new Error('not locked'), { code: 'VEHICLE_LOCK_MISMATCH' }); },
      releaseInventory: async (vehicleId) => { this.locked.delete(vehicleId); this.released.push(vehicleId); },
    };
  }
}

function fixture(start = '2026-07-17T12:00:00.000Z') {
  const repository = new MemoryRepository(); let now = new Date(start); let id = 0;
  let paymentCallback: VerifiedProviderCallback | null = null; let financingCallback: VerifiedProviderCallback | null = null;
  const common = { verifyCallback: async () => { throw new Error('not configured'); } };
  const machine = new TransactionMachine({
    repository, policies: { getCurrent: async () => policy, getByVersion: async (_tenant, version) => version === policy.version ? policy : null },
    paymentProvider: { ...common, providerId: 'test-bank-provider', method: 'CASH', sourceName: 'PAYMENT_PROVIDER_ADAPTER', verifyCallback: async () => { if (!paymentCallback) throw new Error('unverified'); return paymentCallback; } },
    financingProvider: { ...common, providerId: 'test-finance-provider', method: 'FINANCING', sourceName: 'FINANCING_PROVIDER_ADAPTER', verifyCallback: async () => { if (!financingCallback) throw new Error('unverified'); return financingCallback; } },
    authorizer: { requireHandoverPermission: async (credential) => { if (credential !== 'dealer-secret') throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); return { actorId: 'dealer-user-1' }; } },
    clock: { now: () => new Date(now) }, ids: { next: () => `event-${++id}` }, calendar: { addBusinessDays },
  });
  return { repository, machine, clock: { now: () => new Date(now) }, setNow: (value: string) => { now = new Date(value); }, setCallback: (method: PaymentMethod, value: VerifiedProviderCallback) => { if (method === 'CASH') paymentCallback = value; else financingCallback = value; } };
}

async function priceAgreed(context: ReturnType<typeof fixture>) {
  const negotiating = await context.machine.createNegotiation({ dealId: 'deal-1', tenantId: 'dealer-1', vehicle: { vehicleId: 'alfa-qv-1', registrationIdentifier: 'ABC-123', inventoryRevision: revision } });
  return context.machine.agreePrice({ dealId: negotiating.id, expectedVersion: negotiating.version, agreedPriceCents: 8_990_000, commercialDecisionId: 'decision-1', buyer });
}

test('locks price and vehicle at PRICE_AGREED and rejects later negotiation input', async () => {
  const context = fixture(); const agreed = await priceAgreed(context);
  assert.equal(agreed.state, 'PRICE_AGREED'); assert.equal(agreed.agreedPriceCents, 8_990_000); assert.equal(context.repository.locked.has('alfa-qv-1'), true);
  assert.equal(context.repository.audits.at(-1)?.payload.commercialDecisionId, 'decision-1');
  assert.equal(context.repository.audits.at(-1)?.payload.buyerId, 'customer-1');
  assert.doesNotMatch(JSON.stringify(context.repository.audits.at(-1)), /Testi Ostaja|ostaja@example|358401234567/);
  await assert.rejects(context.machine.agreePrice({ dealId: agreed.id, expectedVersion: agreed.version, agreedPriceCents: 1, commercialDecisionId: 'decision-2', buyer }), { code: 'NEGOTIATION_LOCKED' });
});

test('strongly authenticated buyer is required before inventory lock', async () => {
  const context = fixture();
  const negotiating = await context.machine.createNegotiation({ dealId: 'deal-unauthenticated', tenantId: 'dealer-1', vehicle: { vehicleId: 'alfa-qv-1', registrationIdentifier: 'ABC-123', inventoryRevision: revision } });
  await assert.rejects(context.machine.agreePrice({ dealId: negotiating.id, expectedVersion: negotiating.version, agreedPriceCents: 8_990_000, commercialDecisionId: 'decision-unauthenticated', buyer: { ...buyer, ssnVerified: false } }), { code: 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED' });
  assert.equal(context.repository.locked.has('alfa-qv-1'), false); assert.equal(context.repository.deals.get(negotiating.id)?.state, 'NEGOTIATING');
});

test('sets a three-business-day payment deadline in UTC', async () => {
  const context = fixture('2026-07-17T12:00:00.000Z'); const agreed = await priceAgreed(context);
  const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'FINANCING', providerReference: 'finance-1' });
  assert.equal(awaiting.state, 'AWAITING_PAYMENT'); assert.equal(awaiting.paymentDeadline, '2026-07-22T12:00:00.000Z');
});

test('business calendar can exclude configured public holidays', () => {
  const holidays = new Set(['2026-12-24', '2026-12-25']);
  assert.equal(addBusinessDays(new Date('2026-12-23T10:00:00.000Z'), 3, holidays).toISOString(), '2026-12-30T10:00:00.000Z');
  const calendar = new BusinessCalendar([...holidays]);
  assert.equal(calendar.calculateDeadline('2026-12-23T10:00:00.000Z', 3), '2026-12-30T10:00:00.000Z');
  assert.equal(calendar.isBusinessDay(new Date('2026-12-25T10:00:00.000Z')), false);
});

test('named Kopilotti modules retain the hardened engine and immutable policy', () => {
  assert.equal(KopilottiEngine, TransactionMachine);
  const created = createVersionedHandoverPolicy(policy);
  assert.equal(created.version, 'policy-v1'); assert.equal(Object.isFrozen(created.vehicleRules['alfa-qv-1']), true);
});

test('keeps rejected financing and missing payment in the symmetric awaiting state', async () => {
  const context = fixture(); const agreed = await priceAgreed(context);
  const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'FINANCING', providerReference: 'finance-1' });
  context.setCallback('FINANCING', { dealId: awaiting.id, idempotencyKey: 'callback-1', providerReference: 'finance-1', outcome: 'REJECTED', simulated: false });
  const rejected = await context.machine.handleProviderCallback('FINANCING', new Uint8Array(), {});
  assert.equal(rejected.state, 'AWAITING_PAYMENT'); assert.equal(context.repository.audits.at(-1)?.event, 'PROVIDER_REJECTED');
});

test('accepts verified confirmation once and makes callback replay idempotent', async () => {
  const context = fixture(); const agreed = await priceAgreed(context);
  const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'CASH', providerReference: 'payment-1' });
  context.setCallback('CASH', { dealId: awaiting.id, idempotencyKey: 'callback-1', providerReference: 'payment-1', outcome: 'CONFIRMED', simulated: true });
  const paid = await context.machine.handleProviderCallback('CASH', new Uint8Array(), {}); const auditCount = context.repository.audits.length;
  const replay = await context.machine.handleProviderCallback('CASH', new Uint8Array(), {});
  assert.equal(paid.state, 'PAID'); assert.equal(replay.version, paid.version); assert.equal(context.repository.audits.length, auditCount);
  assert.equal(context.repository.audits.at(-1)?.source, 'PROVIDER_ADAPTER_SIMULATED');
});

test('unverified callback cannot reach transaction state or audit storage', async () => {
  const context = fixture(); const agreed = await priceAgreed(context);
  const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'CASH', providerReference: 'payment-1' });
  const auditCount = context.repository.audits.length;
  await assert.rejects(context.machine.handleProviderCallback('CASH', new Uint8Array(), {}), /unverified/);
  assert.equal(context.repository.deals.get(awaiting.id)?.state, 'AWAITING_PAYMENT'); assert.equal(context.repository.audits.length, auditCount);
});

test('rejects stale and post-deadline provider confirmations', async () => {
  const context = fixture(); const agreed = await priceAgreed(context);
  const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'CASH', providerReference: 'payment-current' });
  context.setCallback('CASH', { dealId: awaiting.id, idempotencyKey: 'callback-stale', providerReference: 'payment-old', outcome: 'CONFIRMED', simulated: false });
  await assert.rejects(context.machine.handleProviderCallback('CASH', new Uint8Array(), {}), { code: 'STALE_PROVIDER_CALLBACK' });
  context.setNow(String(awaiting.paymentDeadline));
  context.setCallback('CASH', { dealId: awaiting.id, idempotencyKey: 'callback-late', providerReference: 'payment-current', outcome: 'CONFIRMED', simulated: false });
  await assert.rejects(context.machine.handleProviderCallback('CASH', new Uint8Array(), {}), { code: 'PAYMENT_DEADLINE_EXPIRED' });
});

test('daemon voids expired deal, audits source, and atomically releases inventory', async () => {
  const context = fixture(); const agreed = await priceAgreed(context);
  const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'CASH', providerReference: 'payment-1' });
  context.setNow(String(awaiting.paymentDeadline));
  const result = await new PaymentTimeoutDaemon({ repository: context.repository, machine: context.machine, clock: context.clock }).runOnce();
  assert.deepEqual(result, { scanned: 1, voided: 1, skipped: 0 }); assert.equal(context.repository.deals.get(awaiting.id)?.state, 'VOIDED');
  assert.deepEqual(context.repository.released, ['alfa-qv-1']); assert.equal(context.repository.audits.at(-1)?.source, 'SYSTEM_DAEMON');
});

test('daemon records successful heartbeat and failed cycles without changing errors', async () => {
  const context = fixture(); let heartbeats = 0; let errors = 0;
  const daemon = new PaymentTimeoutDaemon({ repository: context.repository, machine: context.machine, clock: context.clock, monitor: { registerDaemonHeartbeat: () => { heartbeats += 1; }, registerDaemonError: () => { errors += 1; } } });
  assert.deepEqual(await daemon.runOnce(), { scanned: 0, voided: 0, skipped: 0 }); assert.equal(heartbeats, 1); assert.equal(errors, 0);
  const original = context.repository.processExpiredAwaitingPayment.bind(context.repository);
  context.repository.processExpiredAwaitingPayment = async () => { throw Object.assign(new Error('sensitive failure'), { code: 'DATABASE_UNAVAILABLE' }); };
  await assert.rejects(daemon.runOnce(), { code: 'DATABASE_UNAVAILABLE' }); assert.equal(heartbeats, 1); assert.equal(errors, 1);
  context.repository.processExpiredAwaitingPayment = original;
});

test('handover requires authorization and all pinned vehicle-policy facts', async () => {
  const context = fixture(); const agreed = await priceAgreed(context);
  const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'CASH', providerReference: 'payment-1' });
  context.setCallback('CASH', { dealId: awaiting.id, idempotencyKey: 'callback-1', providerReference: 'payment-1', outcome: 'CONFIRMED', simulated: false });
  const paid = await context.machine.handleProviderCallback('CASH', new Uint8Array(), {});
  const incomplete = { ceramicCoatingCompleted: false, handoverInspectionCompleted: true, identityVerified: false, registrationCompleted: false, insuranceInformationReceived: false, manualApproval: false };
  await assert.rejects(context.machine.handOver({ dealId: paid.id, expectedVersion: paid.version, credential: 'dealer-secret', facts: incomplete }), { code: 'HANDOVER_REQUIREMENTS_MISSING' });
  await assert.rejects(context.machine.handOver({ dealId: paid.id, expectedVersion: paid.version, credential: 'forged', facts: { ...incomplete, ceramicCoatingCompleted: true } }), { code: 'FORBIDDEN' });
  const handedOver = await context.machine.handOver({ dealId: paid.id, expectedVersion: paid.version, credential: 'dealer-secret', facts: { ...incomplete, ceramicCoatingCompleted: true } });
  assert.equal(handedOver.state, 'HANDED_OVER'); assert.equal(context.repository.audits.at(-1)?.payload.actorId, 'dealer-user-1');
});
