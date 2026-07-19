import { ZodError } from 'zod';
import { AgreePriceToolSchema } from './agentTools.ts';
import type { Customer, Deal, LockedVehicle } from './model.ts';

export interface ProtectedInventory {
  getByRegistration(registrationNumber: string): Promise<LockedVehicle | null>;
}

export interface PriceAgreementVerifier {
  verify(input: {
    readonly transactionId: string | null;
    readonly registrationNumber: string;
    readonly claimedPriceCents: number;
  }): Promise<{
    readonly dealId: string;
    readonly approvedPriceCents: number;
    readonly commercialDecisionId: string;
  }>;
}

export interface TransactionReader { getDeal(dealId: string): Promise<Deal | null>; }
export interface ProtectedBuyerSession {
  getStronglyAuthenticatedBuyer(input: { readonly tenantId: string; readonly dealId: string }): Promise<Customer | null>;
}
export interface PriceLockEngine {
  createNegotiation(input: { readonly dealId: string; readonly tenantId: string; readonly vehicle: LockedVehicle }): Promise<Deal>;
  agreePrice(input: { readonly dealId: string; readonly expectedVersion: number; readonly agreedPriceCents: number; readonly commercialDecisionId: string; readonly buyer: Customer }): Promise<Deal>;
}

export type AgentBridgeResult =
  | { readonly success: true; readonly transactionId: string; readonly directive: 'NEGOTIATION_CLOSED_SELECT_PAYMENT'; readonly message: string }
  | { readonly success: false; readonly errorCode: 'INVALID_TOOL_INPUT' | 'VEHICLE_NOT_FOUND' | 'PRICE_NOT_AUTHORIZED' | 'TRANSACTION_MISMATCH' | 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED' | 'PRICE_LOCK_REJECTED'; readonly message: string };
type AgentBridgeErrorCode = Extract<AgentBridgeResult, { success: false }>['errorCode'];

export class AgentBridge {
  readonly #engine: PriceLockEngine;
  readonly #transactions: TransactionReader;
  readonly #inventory: ProtectedInventory;
  readonly #verifier: PriceAgreementVerifier;
  readonly #buyers: ProtectedBuyerSession;
  readonly #tenantId: string;

  constructor(input: { engine: PriceLockEngine; transactions: TransactionReader; inventory: ProtectedInventory; verifier: PriceAgreementVerifier; buyers: ProtectedBuyerSession; tenantId: string }) {
    this.#engine = input.engine; this.#transactions = input.transactions; this.#inventory = input.inventory; this.#verifier = input.verifier; this.#buyers = input.buyers; this.#tenantId = input.tenantId;
  }

  async handleAgentToolCall(rawInput: unknown): Promise<AgentBridgeResult> {
    let parsed: ReturnType<typeof AgreePriceToolSchema.parse>;
    try { parsed = AgreePriceToolSchema.parse(rawInput); }
    catch (error) { if (error instanceof ZodError) return failure('INVALID_TOOL_INPUT'); throw error; }

    const registrationNumber = parsed.registrationNumber.toUpperCase();
    const claimedPriceCents = Math.round(parsed.agreedPrice * 100);
    const vehicle = await this.#inventory.getByRegistration(registrationNumber);
    if (!vehicle || vehicle.registrationIdentifier.toUpperCase() !== registrationNumber) return failure('VEHICLE_NOT_FOUND');

    let authorization: Awaited<ReturnType<PriceAgreementVerifier['verify']>>;
    try { authorization = await this.#verifier.verify({ transactionId: parsed.transactionId, registrationNumber, claimedPriceCents }); }
    catch { return failure('PRICE_NOT_AUTHORIZED'); }
    if (parsed.transactionId !== null && authorization.dealId !== parsed.transactionId) return failure('TRANSACTION_MISMATCH');
    if (!Number.isSafeInteger(authorization.approvedPriceCents) || authorization.approvedPriceCents <= 0) return failure('PRICE_NOT_AUTHORIZED');
    const buyer = await this.#buyers.getStronglyAuthenticatedBuyer({ tenantId: this.#tenantId, dealId: authorization.dealId });
    if (!buyer?.ssnVerified) return failure('CUSTOMER_STRONG_AUTHENTICATION_REQUIRED');

    try {
      let transaction = await this.#transactions.getDeal(authorization.dealId);
      if (!transaction) transaction = await this.#engine.createNegotiation({ dealId: authorization.dealId, tenantId: this.#tenantId, vehicle });
      if (transaction.tenantId !== this.#tenantId || transaction.vehicle.vehicleId !== vehicle.vehicleId
        || transaction.vehicle.registrationIdentifier !== vehicle.registrationIdentifier
        || transaction.vehicle.inventoryRevision !== vehicle.inventoryRevision) return failure('TRANSACTION_MISMATCH');
      const locked = await this.#engine.agreePrice({
        dealId: transaction.id, expectedVersion: transaction.version,
        agreedPriceCents: authorization.approvedPriceCents,
        commercialDecisionId: authorization.commercialDecisionId,
        buyer,
      });
      return {
        success: true, transactionId: locked.id, directive: 'NEGOTIATION_CLOSED_SELECT_PAYMENT',
        message: `SUCCESS: Price locked to ${formatEuroCents(locked.agreedPriceCents)} EUR. SYSTEM_NOTICE: Negotiation is closed. Do not accept price or vehicle changes. Prompt the customer to select a payment method.`,
      };
    } catch { return failure('PRICE_LOCK_REJECTED'); }
  }
}

function failure(errorCode: AgentBridgeErrorCode): AgentBridgeResult {
  return { success: false, errorCode, message: `ERROR: ${errorCode}` };
}
function formatEuroCents(value: number | null): string { return value === null ? '0.00' : (value / 100).toFixed(2); }
