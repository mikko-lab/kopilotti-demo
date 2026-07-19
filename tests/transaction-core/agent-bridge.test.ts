import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentBridge, AgreePriceToolSchema, agreePriceToolDefinition, type Deal, type LockedVehicle, type PriceLockEngine } from '../../src/transaction-core/index.ts';

const vehicle: LockedVehicle = { vehicleId: 'vehicle-1', registrationIdentifier: 'XYZ-123', inventoryRevision: 'a'.repeat(64) };

function fixture() {
  const deals = new Map<string, Deal>(); const lockedPrices: number[] = []; const decisionIds: string[] = [];
  const engine: PriceLockEngine = {
    async createNegotiation(input) {
      const deal: Deal = { id: input.dealId, tenantId: input.tenantId, state: 'NEGOTIATING', version: 1, vehicle: input.vehicle, agreedPriceCents: null, currency: 'EUR', paymentMethod: null, paymentDeadline: null, providerReference: null, handoverPolicyVersion: null, createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z' };
      deals.set(deal.id, deal); return deal;
    },
    async agreePrice(input) {
      const current = deals.get(input.dealId); if (!current || current.state !== 'NEGOTIATING') throw new Error('SECRET_INTERNAL_POLICY_FAILURE');
      lockedPrices.push(input.agreedPriceCents); decisionIds.push(input.commercialDecisionId);
      const updated: Deal = { ...current, state: 'PRICE_AGREED', version: current.version + 1, agreedPriceCents: input.agreedPriceCents, handoverPolicyVersion: 'secret-policy' };
      deals.set(updated.id, updated); return updated;
    },
  };
  const bridge = new AgentBridge({
    engine, transactions: { getDeal: async (id) => deals.get(id) ?? null },
    inventory: { getByRegistration: async (registration) => registration === 'XYZ-123' ? vehicle : null },
    verifier: { verify: async (claim) => {
      if (claim.claimedPriceCents !== 90_000_00) throw new Error('SECRET_FLOOR_PRICE');
      return { dealId: claim.transactionId ?? 'server-deal-1', approvedPriceCents: 92_500_00, commercialDecisionId: 'decision-verified-1' };
    } }, tenantId: 'dealer-1',
  });
  return { bridge, deals, lockedPrices, decisionIds };
}

test('tool schema rejects extra policy fields and ambiguous money', () => {
  assert.throws(() => AgreePriceToolSchema.parse({ transactionId: null, registrationNumber: 'XYZ-123', agreedPrice: 90_000, floorPrice: 1 }));
  assert.throws(() => AgreePriceToolSchema.parse({ transactionId: null, registrationNumber: 'XYZ-123', agreedPrice: 90_000.001 }));
  assert.deepEqual(agreePriceToolDefinition.function.parameters.required, ['transactionId', 'registrationNumber', 'agreedPrice']);
  assert.equal(agreePriceToolDefinition.function.parameters.additionalProperties, false);
});

test('bridge treats LLM price as a claim and locks only verifier-authorized price', async () => {
  const context = fixture();
  const result = await context.bridge.handleAgentToolCall({ transactionId: null, registrationNumber: 'xyz-123', agreedPrice: 90_000 });
  assert.equal(result.success, true); assert.deepEqual(context.lockedPrices, [92_500_00]); assert.deepEqual(context.decisionIds, ['decision-verified-1']);
  if (result.success) { assert.equal(result.directive, 'NEGOTIATION_CLOSED_SELECT_PAYMENT'); assert.match(result.message, /92500\.00 EUR/); }
});

test('bridge rejects unauthorized price without leaking verifier or policy errors', async () => {
  const context = fixture();
  const result = await context.bridge.handleAgentToolCall({ transactionId: null, registrationNumber: 'XYZ-123', agreedPrice: 1 });
  assert.deepEqual(result, { success: false, errorCode: 'PRICE_NOT_AUTHORIZED', message: 'ERROR: PRICE_NOT_AUTHORIZED' });
  assert.equal(JSON.stringify(result).includes('FLOOR_PRICE'), false); assert.equal(context.deals.size, 0);
});

test('bridge locks negotiation once and rejects subsequent price mutation', async () => {
  const context = fixture();
  const first = await context.bridge.handleAgentToolCall({ transactionId: null, registrationNumber: 'XYZ-123', agreedPrice: 90_000 });
  assert.equal(first.success, true);
  const second = await context.bridge.handleAgentToolCall({ transactionId: 'server-deal-1', registrationNumber: 'XYZ-123', agreedPrice: 90_000 });
  assert.deepEqual(second, { success: false, errorCode: 'PRICE_LOCK_REJECTED', message: 'ERROR: PRICE_LOCK_REJECTED' });
  assert.equal(JSON.stringify(second).includes('SECRET_INTERNAL'), false); assert.deepEqual(context.lockedPrices, [92_500_00]);
});
