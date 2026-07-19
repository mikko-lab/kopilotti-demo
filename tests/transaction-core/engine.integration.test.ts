import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BusinessCalendar, JsonTransactionRepository, KopilottiEngine, KopilottiEventEmitter, PaymentTimeoutDaemon, StatusEventDispatcher,
  createVersionedHandoverPolicy, type HandoverFacts, type PaymentMethod,
  type ProviderAdapter, type VerifiedProviderCallback,
} from '../../src/transaction-core/index.ts';

const inventoryRevision = 'b'.repeat(64);
const vehicle = { vehicleId: 'alfa-qf-2026', registrationIdentifier: 'XYZ-123', inventoryRevision } as const;
const defaultRules = {
  requireCeramicCoatingCompleted: false, requireHandoverInspectionCompleted: true,
  requireIdentityVerified: false, requireRegistrationCompleted: false,
  requireInsuranceInformationReceived: false, requireManualApproval: false,
};
const policy = createVersionedHandoverPolicy({
  tenantId: 'dealer-1', version: 'v2.1-high-performance', defaultRules,
  vehicleRules: { 'alfa-qf-2026': { ...defaultRules, requireCeramicCoatingCompleted: true } },
});

class SignedTestProvider implements ProviderAdapter {
  readonly method: PaymentMethod;
  readonly sourceName: 'PAYMENT_PROVIDER_ADAPTER' | 'FINANCING_PROVIDER_ADAPTER';
  readonly #secret: string;
  constructor(method: PaymentMethod, secret: string) {
    this.method = method; this.#secret = secret;
    this.sourceName = method === 'CASH' ? 'PAYMENT_PROVIDER_ADAPTER' : 'FINANCING_PROVIDER_ADAPTER';
  }
  async verifyCallback(rawBody: Uint8Array, headers: Readonly<Record<string, string | undefined>>): Promise<VerifiedProviderCallback> {
    if (headers['x-test-signature'] !== this.#secret) throw Object.assign(new Error('CALLBACK_NOT_VERIFIED'), { code: 'CALLBACK_NOT_VERIFIED' });
    return JSON.parse(new TextDecoder().decode(rawBody)) as VerifiedProviderCallback;
  }
}

async function integrationFixture(start = '2026-07-16T12:00:00.000Z') {
  const directory = await mkdtemp(join(tmpdir(), 'kopilotti-transaction-test-'));
  const repository = new JsonTransactionRepository(join(directory, 'transactions.json'));
  let now = new Date(start); let sequence = 0;
  const clock = { now: () => new Date(now) };
  const machine = new KopilottiEngine({
    repository,
    policies: { getCurrent: async () => policy, getByVersion: async (_tenant, version) => version === policy.version ? policy : null },
    paymentProvider: new SignedTestProvider('CASH', 'cash-secret'),
    financingProvider: new SignedTestProvider('FINANCING', 'finance-secret'),
    authorizer: { requireHandoverPermission: async (credential) => {
      if (credential !== 'authorized-dealer-credential') throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      return { actorId: 'dealer-user-1' };
    } },
    calendar: new BusinessCalendar(['2026-06-19', '2026-06-20']), clock,
    ids: { next: () => `integration-event-${++sequence}` },
  });
  return {
    repository, machine, clock,
    setNow(value: string) { now = new Date(value); },
    async cleanup() { await rm(directory, { recursive: true, force: true }); },
  };
}

async function agreePrice(context: Awaited<ReturnType<typeof integrationFixture>>, dealId: string) {
  const negotiating = await context.machine.createNegotiation({ dealId, tenantId: 'dealer-1', vehicle });
  return context.machine.agreePrice({ dealId, expectedVersion: negotiating.version, agreedPriceCents: 9_250_000 });
}

function callback(value: VerifiedProviderCallback): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }

describe('Kopilotti Core integration', () => {
  test('successful Alfa Romeo cash flow enforces protected handover policy', async () => {
    const context = await integrationFixture();
    try {
      const agreed = await agreePrice(context, 'deal-cash');
      assert.equal(agreed.state, 'PRICE_AGREED'); assert.equal(agreed.agreedPriceCents, 9_250_000);
      const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'CASH', providerReference: 'bank-payment-1' });
      assert.equal(awaiting.state, 'AWAITING_PAYMENT'); assert.ok(awaiting.paymentDeadline);
      const paid = await context.machine.handleProviderCallback('CASH', callback({ dealId: agreed.id, idempotencyKey: 'cash-key-123', providerReference: 'bank-payment-1', outcome: 'CONFIRMED', simulated: false }), { 'x-test-signature': 'cash-secret' });
      assert.equal(paid.state, 'PAID');
      const facts: HandoverFacts = { ceramicCoatingCompleted: true, handoverInspectionCompleted: true, identityVerified: false, registrationCompleted: false, insuranceInformationReceived: false, manualApproval: false };
      const handedOver = await context.machine.handOver({ dealId: paid.id, expectedVersion: paid.version, credential: 'authorized-dealer-credential', facts });
      assert.equal(handedOver.state, 'HANDED_OVER');
      const handoverAudit = (await context.repository.listAuditEvents(agreed.id)).find((event) => event.toState === 'HANDED_OVER');
      assert.equal(handoverAudit?.source, 'AUTHORIZED_DEALERSHIP_ACTION'); assert.equal(handoverAudit?.payload.handoverPolicyVersion, 'v2.1-high-performance');
      const events = new KopilottiEventEmitter(); const delivered: unknown[] = [];
      events.onStatusChange((event) => delivered.push(event));
      const dispatcher = new StatusEventDispatcher({ repository: context.repository, events });
      assert.equal(await dispatcher.dispatchOnce(), 5); assert.equal(await dispatcher.dispatchOnce(), 0);
      assert.deepEqual(delivered.map((event) => (event as { status: string }).status), ['NEGOTIATING', 'PRICE_AGREED', 'AWAITING_PAYMENT', 'PAID', 'HANDED_OVER']);
      assert.equal(JSON.stringify(delivered).includes('agreedPrice'), false); assert.equal(JSON.stringify(delivered).includes('handoverPolicy'), false);
    } finally { await context.cleanup(); }
  });

  test('persistent global idempotency permits only one financing confirmation transition', async () => {
    const context = await integrationFixture();
    try {
      const agreed = await agreePrice(context, 'deal-financing');
      await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'FINANCING', providerReference: 'finance-application-1' });
      const body = callback({ dealId: agreed.id, idempotencyKey: 'finance-key-2026', providerReference: 'finance-application-1', outcome: 'CONFIRMED', simulated: false });
      const paid = await context.machine.handleProviderCallback('FINANCING', body, { 'x-test-signature': 'finance-secret' });
      const replay = await context.machine.handleProviderCallback('FINANCING', body, { 'x-test-signature': 'finance-secret' });
      assert.equal(paid.state, 'PAID'); assert.equal(replay.version, paid.version);
      const paidTransitions = (await context.repository.listAuditEvents(agreed.id)).filter((event) => event.toState === 'PAID');
      assert.equal(paidTransitions.length, 1);
    } finally { await context.cleanup(); }
  });

  test('wrong provider method is rejected and daemon voids after business deadline', async () => {
    const context = await integrationFixture('2026-07-16T12:00:00.000Z');
    try {
      const agreed = await agreePrice(context, 'deal-timeout');
      const awaiting = await context.machine.beginPayment({ dealId: agreed.id, expectedVersion: agreed.version, method: 'FINANCING', providerReference: 'finance-application-2' });
      assert.equal(awaiting.paymentDeadline, '2026-07-21T12:00:00.000Z');
      await assert.rejects(context.machine.handleProviderCallback('CASH', callback({ dealId: agreed.id, idempotencyKey: 'wrong-method-key', providerReference: 'finance-application-2', outcome: 'CONFIRMED', simulated: false }), { 'x-test-signature': 'cash-secret' }), { code: 'PROVIDER_METHOD_MISMATCH' });
      context.setNow('2026-07-22T12:00:00.000Z');
      await assert.rejects(context.machine.handleProviderCallback('FINANCING', callback({ dealId: agreed.id, idempotencyKey: 'late-finance-key', providerReference: 'finance-application-2', outcome: 'CONFIRMED', simulated: false }), { 'x-test-signature': 'finance-secret' }), { code: 'PAYMENT_DEADLINE_EXPIRED' });
      const result = await new PaymentTimeoutDaemon({ repository: context.repository, machine: context.machine, clock: context.clock }).runOnce();
      assert.deepEqual(result, { scanned: 1, voided: 1, skipped: 0 }); assert.equal((await context.repository.getDeal(agreed.id))?.state, 'VOIDED');
      const timeoutAudit = (await context.repository.listAuditEvents(agreed.id)).at(-1);
      assert.equal(timeoutAudit?.source, 'SYSTEM_DAEMON'); assert.equal(timeoutAudit?.payload.vehicleReleased, true);
    } finally { await context.cleanup(); }
  });
});
