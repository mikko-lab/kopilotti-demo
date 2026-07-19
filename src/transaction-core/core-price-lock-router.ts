import express, { type Request, type Response, type Router } from 'express';
import { ZodError } from 'zod';
import type { Customer, Deal, LockedVehicle } from './model.ts';
import type { PriceAgreementVerifier, PriceLockEngine, TransactionReader } from './AgentBridge.ts';
import { LockPriceRequestSchema, type ApiErrorResponse, type CoreApiErrorCode, type LockPriceResponse } from './openapi-core-spec.ts';
import { coreMetrics, type LockFailureType, type PriceLockErrorCode, type TransactionCoreMetrics } from './metrics.ts';

export interface CoreServiceAuthorizer {
  authorize(request: Request): Promise<{ readonly tenantId: string; readonly serviceId: string }>;
}

export interface TokenizedBuyerSessionResolver {
  resolveStronglyAuthenticatedBuyer(input: {
    readonly sessionToken: string;
    readonly tenantId: string;
    readonly dealId: string;
  }): Promise<Customer | null>;
}

export interface ProtectedVehicleReader {
  getById(vehicleId: string): Promise<LockedVehicle | null>;
}

export function createCorePriceLockRouter(input: {
  readonly authorizer: CoreServiceAuthorizer;
  readonly buyers: TokenizedBuyerSessionResolver;
  readonly transactions: TransactionReader;
  readonly inventory: ProtectedVehicleReader;
  readonly verifier: PriceAgreementVerifier;
  readonly engine: PriceLockEngine;
  readonly metrics?: TransactionCoreMetrics;
}): Router {
  const metrics = input.metrics ?? coreMetrics;
  const router = express.Router();
  router.post('/api/v1/transactions/lock-price', async (request: Request, response: Response): Promise<void> => {
    let caller: Awaited<ReturnType<CoreServiceAuthorizer['authorize']>>;
    try { caller = await input.authorizer.authorize(request); }
    catch { recordFailure(metrics, 'unauthorized'); sendError(response, 401, 'UNAUTHORIZED'); return; }

    let body: ReturnType<typeof LockPriceRequestSchema.parse>;
    try { body = LockPriceRequestSchema.parse(request.body); }
    catch (error) { if (error instanceof ZodError) { recordFailure(metrics, 'invalid_request'); sendError(response, 400, 'INVALID_REQUEST'); return; } throw error; }

    const sessionToken = request.header('x-buyer-session-token');
    if (!sessionToken || sessionToken.length > 2048) { recordFailure(metrics, 'strong_auth_required'); sendError(response, 401, 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED'); return; }

    try {
      const deal = await input.transactions.getDeal(body.dealId);
      if (!deal || deal.tenantId !== caller.tenantId || deal.vehicle.vehicleId !== body.vehicleId) {
        recordFailure(metrics, 'transaction_conflict', 'concurrency_conflict'); sendError(response, 409, 'TRANSACTION_CONFLICT'); return;
      }
      if (deal.state !== 'NEGOTIATING') { recordFailure(metrics, 'transaction_conflict', 'concurrency_conflict'); sendError(response, 409, 'TRANSACTION_CONFLICT'); return; }

      const vehicle = await input.inventory.getById(body.vehicleId);
      if (!vehicle || vehicle.vehicleId !== body.vehicleId) { recordFailure(metrics, 'vehicle_not_available'); sendError(response, 409, 'VEHICLE_NOT_AVAILABLE'); return; }
      if (!sameRevision(vehicle.inventoryRevision, body.inventoryRevisionAtLock)
        || !sameRevision(deal.vehicle.inventoryRevision, body.inventoryRevisionAtLock)
        || vehicle.registrationIdentifier !== deal.vehicle.registrationIdentifier) {
        recordFailure(metrics, 'revision_mismatch', 'revision_mismatch'); sendError(response, 409, 'REVISION_MISMATCH'); return;
      }

      let decision: Awaited<ReturnType<PriceAgreementVerifier['verify']>>;
      try {
        decision = await input.verifier.verify({
          transactionId: deal.id,
          registrationNumber: vehicle.registrationIdentifier,
          claimedPriceCents: Math.round(body.agreedPrice * 100),
        });
      } catch { recordFailure(metrics, 'price_not_authorized'); sendError(response, 403, 'PRICE_NOT_AUTHORIZED'); return; }
      if (decision.dealId !== deal.id || !Number.isSafeInteger(decision.approvedPriceCents) || decision.approvedPriceCents <= 0) {
        recordFailure(metrics, 'price_not_authorized'); sendError(response, 403, 'PRICE_NOT_AUTHORIZED'); return;
      }

      const buyer = await input.buyers.resolveStronglyAuthenticatedBuyer({ sessionToken, tenantId: caller.tenantId, dealId: deal.id });
      if (!buyer?.ssnVerified) { recordFailure(metrics, 'strong_auth_required'); sendError(response, 401, 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED'); return; }

      const locked = await input.engine.agreePrice({
        dealId: deal.id, expectedVersion: deal.version, agreedPriceCents: decision.approvedPriceCents,
        commercialDecisionId: decision.commercialDecisionId, buyer,
      });
      const result: LockPriceResponse = { success: true, transactionId: locked.id, status: 'PRICE_AGREED', createdAt: locked.updatedAt };
      metrics.recordPriceLock('success', 'none');
      response.status(201).json(result);
    } catch (error) {
      const code = domainErrorCode(error);
      if (code === 'VEHICLE_NOT_AVAILABLE') { recordFailure(metrics, 'vehicle_not_available'); sendError(response, 409, 'VEHICLE_NOT_AVAILABLE'); return; }
      if (code === 'STALE_INVENTORY' || code === 'POSTGRES_INVENTORY_REVISION_REQUIRED') { recordFailure(metrics, 'revision_mismatch', 'revision_mismatch'); sendError(response, 409, 'REVISION_MISMATCH'); return; }
      if (code === 'VERSION_CONFLICT' || code === 'NEGOTIATION_LOCKED' || code === 'INVALID_TRANSITION') {
        recordFailure(metrics, 'transaction_conflict', 'concurrency_conflict'); sendError(response, 409, 'TRANSACTION_CONFLICT'); return;
      }
      recordFailure(metrics, 'core_unavailable', 'db_timeout');
      sendError(response, 503, 'INTERNAL_ERROR');
    }
  });
  return router;
}

function recordFailure(metrics: TransactionCoreMetrics, errorCode: PriceLockErrorCode, lockFailure?: LockFailureType): void {
  metrics.recordPriceLock('failed', errorCode);
  if (lockFailure) metrics.recordLockFailure(lockFailure);
}

function sameRevision(actual: LockedVehicle['inventoryRevision'], claimed: number): boolean {
  return typeof actual === 'number' && Number.isSafeInteger(actual) && actual === claimed;
}

const PUBLIC_MESSAGES: Readonly<Record<CoreApiErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: 'Pyyntö on virheellinen.',
  CUSTOMER_STRONG_AUTHENTICATION_REQUIRED: 'Vahva tunnistautuminen vaaditaan.',
  VEHICLE_NOT_AVAILABLE: 'Ajoneuvo ei ole saatavilla.',
  REVISION_MISMATCH: 'Ajoneuvon tiedot ovat muuttuneet.',
  PRICE_NOT_AUTHORIZED: 'Hinnan lukitusta ei voitu vahvistaa.',
  TRANSACTION_CONFLICT: 'Transaktion tila on muuttunut.',
  UNAUTHORIZED: 'Palvelukutsu ei ole valtuutettu.',
  INTERNAL_ERROR: 'Palvelu ei ole käytettävissä.',
});

function sendError(response: Response, status: number, errorCode: CoreApiErrorCode): void {
  const body: ApiErrorResponse = { errorCode, message: PUBLIC_MESSAGES[errorCode] };
  response.status(status).json(body);
}

function domainErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}
