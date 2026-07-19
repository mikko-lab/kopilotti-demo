import { assertValidDate, isDeadlineExpired } from './business-days.ts';
import { invariant } from './errors.ts';
import { assertHandoverReady } from './handover-policy.ts';
import type {
  AuditEvent, Deal, HandoverFacts, LockedVehicle, PaymentMethod, TransitionSource, VerifiedProviderCallback,
} from './model.ts';
import type {
  BusinessCalendarPort, Clock, DealershipAuthorizer, HandoverPolicyRepository, IdGenerator, ProviderAdapter,
  TransactionContext, TransactionRepository,
} from './ports.ts';
import type { TransactionStatusEvent } from './events.ts';

export interface TransactionMachineDependencies {
  readonly repository: TransactionRepository;
  readonly policies: HandoverPolicyRepository;
  readonly paymentProvider: ProviderAdapter;
  readonly financingProvider: ProviderAdapter;
  readonly authorizer: DealershipAuthorizer;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly calendar: BusinessCalendarPort;
}

export class TransactionMachine {
  readonly #repository: TransactionRepository;
  readonly #policies: HandoverPolicyRepository;
  readonly #paymentProvider: ProviderAdapter;
  readonly #financingProvider: ProviderAdapter;
  readonly #authorizer: DealershipAuthorizer;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #calendar: BusinessCalendarPort;

  constructor(dependencies: TransactionMachineDependencies) {
    this.#repository = dependencies.repository;
    this.#policies = dependencies.policies;
    this.#paymentProvider = dependencies.paymentProvider;
    this.#financingProvider = dependencies.financingProvider;
    this.#authorizer = dependencies.authorizer;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#calendar = dependencies.calendar;
    invariant(this.#paymentProvider.method === 'CASH', 'INVALID_PROVIDER_CONFIGURATION', 'Payment adapter must use CASH method');
    invariant(this.#financingProvider.method === 'FINANCING', 'INVALID_PROVIDER_CONFIGURATION', 'Financing adapter must use FINANCING method');
  }

  async createNegotiation(input: { readonly dealId: string; readonly tenantId: string; readonly vehicle: LockedVehicle }): Promise<Deal> {
    requireIdentifier(input.dealId, 'dealId'); requireIdentifier(input.tenantId, 'tenantId'); validateVehicle(input.vehicle);
    const timestamp = this.#now();
    const deal: Deal = Object.freeze({
      id: input.dealId, tenantId: input.tenantId, state: 'NEGOTIATING', version: 1,
      vehicle: Object.freeze({ ...input.vehicle }), agreedPriceCents: null, currency: 'EUR', paymentMethod: null,
      paymentDeadline: null, providerReference: null, handoverPolicyVersion: null,
      createdAt: timestamp, updatedAt: timestamp,
    });
    return this.#repository.transaction(async (context) => {
      invariant(await context.getDeal(deal.id) === null, 'DEAL_ALREADY_EXISTS', 'Deal already exists');
      await context.saveDeal(deal, 0);
      const audit = this.#event(deal, deal, 'NEGOTIATION_STARTED', 'CUSTOMER_INTERFACE_ACTION', timestamp, { vehicleId: deal.vehicle.vehicleId });
      await context.appendAudit(audit); await context.enqueueStatusEvent(statusEvent(deal, audit.id));
      return deal;
    });
  }

  async agreePrice(input: { readonly dealId: string; readonly expectedVersion: number; readonly agreedPriceCents: number }): Promise<Deal> {
    requireMoney(input.agreedPriceCents); const timestamp = this.#now();
    return this.#repository.transaction(async (context) => {
      const current = await requireDeal(context, input.dealId, input.expectedVersion);
      invariant(current.state === 'NEGOTIATING', 'NEGOTIATION_LOCKED', 'Price negotiation is locked');
      const policy = await this.#policies.getCurrent(current.tenantId);
      invariant(policy !== null, 'HANDOVER_POLICY_NOT_FOUND', 'Handover policy is not configured');
      const updated = evolve(current, timestamp, {
        state: 'PRICE_AGREED', agreedPriceCents: input.agreedPriceCents, handoverPolicyVersion: policy.version,
      });
      await context.lockInventory(current.vehicle.vehicleId, current.vehicle.inventoryRevision, current.id);
      await persistTransition(context, current, updated, this.#event(updated, current, 'PRICE_AGREED', 'DETERMINISTIC_NEGOTIATION_ENGINE', timestamp, {
        agreedPriceCents: input.agreedPriceCents, currency: 'EUR', registrationIdentifier: current.vehicle.registrationIdentifier,
      }));
      return updated;
    });
  }

  async beginPayment(input: { readonly dealId: string; readonly expectedVersion: number; readonly method: PaymentMethod; readonly providerReference: string }): Promise<Deal> {
    requireIdentifier(input.providerReference, 'providerReference'); const timestamp = this.#now();
    return this.#repository.transaction(async (context) => {
      const current = await requireDeal(context, input.dealId, input.expectedVersion);
      invariant(current.state === 'PRICE_AGREED', 'INVALID_TRANSITION', 'Deal must have an agreed price');
      const deadlineDate = this.#calendar.addBusinessDays(new Date(timestamp), 3); assertValidDate(deadlineDate);
      const deadline = deadlineDate.toISOString();
      const updated = evolve(current, timestamp, { state: 'AWAITING_PAYMENT', paymentMethod: input.method, paymentDeadline: deadline, providerReference: input.providerReference });
      await persistTransition(context, current, updated, this.#event(updated, current, 'PAYMENT_AWAITING', 'CUSTOMER_INTERFACE_ACTION', timestamp, {
        paymentMethod: input.method, paymentDeadline: deadline, providerReference: input.providerReference,
      }));
      return updated;
    });
  }

  async handleProviderCallback(method: PaymentMethod, rawBody: Uint8Array, headers: Readonly<Record<string, string | undefined>>): Promise<Deal> {
    const adapter = method === 'CASH' ? this.#paymentProvider : this.#financingProvider;
    const verified = await adapter.verifyCallback(rawBody, headers);
    validateVerifiedCallback(verified);
    const timestamp = this.#now();
    return this.#repository.transaction(async (context) => {
      const current = await requireDeal(context, verified.dealId);
      const processedDealId = await context.getProcessedCallbackDealId(method, verified.idempotencyKey);
      if (processedDealId !== null) {
        invariant(processedDealId === verified.dealId, 'IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key belongs to another deal');
        return current;
      }
      invariant(current.state === 'AWAITING_PAYMENT', 'INVALID_TRANSITION', 'Deal is not awaiting payment');
      invariant(current.paymentMethod === method, 'PROVIDER_METHOD_MISMATCH', 'Callback provider does not match payment method');
      invariant(current.providerReference === verified.providerReference, 'STALE_PROVIDER_CALLBACK', 'Provider reference is stale');
      invariant(current.paymentDeadline !== null && !isDeadlineExpired(current.paymentDeadline, new Date(timestamp)), 'PAYMENT_DEADLINE_EXPIRED', 'Payment deadline has expired');
      const source: TransitionSource = verified.simulated ? 'PROVIDER_ADAPTER_SIMULATED' : adapter.sourceName;
      const updated = verified.outcome === 'CONFIRMED' ? evolve(current, timestamp, { state: 'PAID' }) : current;
      await context.recordProcessedCallback(method, verified.idempotencyKey, current.id);
      if (updated !== current) await context.saveDeal(updated, current.version);
      const audit = this.#event(updated, current, `PROVIDER_${verified.outcome}`, source, timestamp, {
        idempotencyKey: verified.idempotencyKey, providerReference: verified.providerReference, paymentMethod: method,
      });
      await context.appendAudit(audit);
      if (updated !== current) await context.enqueueStatusEvent(statusEvent(updated, audit.id));
      return updated;
    });
  }

  async handOver(input: { readonly dealId: string; readonly expectedVersion: number; readonly credential: unknown; readonly facts: HandoverFacts }): Promise<Deal> {
    const timestamp = this.#now();
    return this.#repository.transaction(async (context) => {
      const current = await requireDeal(context, input.dealId, input.expectedVersion);
      invariant(current.state === 'PAID', 'INVALID_TRANSITION', 'Deal must be paid before handover');
      const actor = await this.#authorizer.requireHandoverPermission(input.credential, current.tenantId);
      invariant(current.handoverPolicyVersion !== null, 'HANDOVER_POLICY_NOT_FOUND', 'Pinned policy version is missing');
      const policy = await this.#policies.getByVersion(current.tenantId, current.handoverPolicyVersion);
      invariant(policy !== null && policy.version === current.handoverPolicyVersion, 'HANDOVER_POLICY_NOT_FOUND', 'Pinned policy version is unavailable');
      assertHandoverReady(policy, current.vehicle, input.facts);
      const updated = evolve(current, timestamp, { state: 'HANDED_OVER' });
      await persistTransition(context, current, updated, this.#event(updated, current, 'VEHICLE_HANDED_OVER', 'AUTHORIZED_DEALERSHIP_ACTION', timestamp, {
        actorId: actor.actorId, handoverPolicyVersion: policy.version,
        ceramicCoatingCompleted: input.facts.ceramicCoatingCompleted,
        handoverInspectionCompleted: input.facts.handoverInspectionCompleted,
        identityVerified: input.facts.identityVerified,
        registrationCompleted: input.facts.registrationCompleted,
        insuranceInformationReceived: input.facts.insuranceInformationReceived,
        manualApproval: input.facts.manualApproval,
      }));
      return updated;
    });
  }

  async voidExpired(dealId: string): Promise<Deal> {
    const timestamp = this.#now();
    return this.#repository.transaction(async (context) => {
      const current = await requireDeal(context, dealId);
      if (current.state === 'VOIDED') return current;
      invariant(current.state === 'AWAITING_PAYMENT' && current.paymentDeadline !== null, 'INVALID_TRANSITION', 'Deal is not awaiting payment');
      invariant(isDeadlineExpired(current.paymentDeadline, new Date(timestamp)), 'PAYMENT_DEADLINE_ACTIVE', 'Payment deadline is still active');
      const updated = evolve(current, timestamp, { state: 'VOIDED' });
      await context.releaseInventory(current.vehicle.vehicleId, current.vehicle.inventoryRevision);
      await persistTransition(context, current, updated, this.#event(updated, current, 'PAYMENT_DEADLINE_EXPIRED', 'SYSTEM_DAEMON', timestamp, {
        paymentDeadline: current.paymentDeadline, vehicleReleased: true,
      }));
      return updated;
    });
  }

  #now(): string { const value = this.#clock.now(); assertValidDate(value); return value.toISOString(); }
  #event(target: Deal, previous: Deal, event: string, source: TransitionSource, timestamp: string, payload: AuditEvent['payload']): AuditEvent {
    return Object.freeze({ id: this.#ids.next(), dealId: target.id, tenantId: target.tenantId, timestamp, event, fromState: previous.state, toState: target.state, source, payload: Object.freeze({ ...payload }) });
  }
}

async function requireDeal(context: TransactionContext, dealId: string, expectedVersion?: number): Promise<Deal> {
  requireIdentifier(dealId, 'dealId'); const deal = await context.getDeal(dealId);
  invariant(deal !== null, 'DEAL_NOT_FOUND', 'Deal was not found');
  if (expectedVersion !== undefined) invariant(deal.version === expectedVersion, 'VERSION_CONFLICT', 'Deal version is stale');
  return deal;
}

async function persistTransition(context: TransactionContext, previous: Deal, updated: Deal, event: AuditEvent): Promise<void> {
  await context.saveDeal(updated, previous.version); await context.appendAudit(event); await context.enqueueStatusEvent(statusEvent(updated, event.id));
}

function statusEvent(deal: Deal, eventId: string): TransactionStatusEvent {
  return Object.freeze({ eventId, transactionId: deal.id, registrationNumber: deal.vehicle.registrationIdentifier, status: deal.state, paymentDeadline: deal.paymentDeadline, timestamp: deal.updatedAt });
}

function evolve<T extends Partial<Deal>>(deal: Deal, timestamp: string, changes: T): Deal {
  return Object.freeze({ ...deal, ...changes, vehicle: deal.vehicle, version: deal.version + 1, updatedAt: timestamp });
}
function requireIdentifier(value: string, field: string): void { invariant(typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value), 'INVALID_INPUT', `${field} is invalid`); }
function requireMoney(value: number): void { invariant(Number.isSafeInteger(value) && value > 0, 'INVALID_MONEY', 'Price must be positive integer cents'); }
function validateVehicle(vehicle: LockedVehicle): void { invariant(Boolean(vehicle), 'INVALID_INPUT', 'vehicle is required'); requireIdentifier(vehicle.vehicleId, 'vehicleId'); requireIdentifier(vehicle.registrationIdentifier, 'registrationIdentifier'); invariant(/^[a-fA-F0-9]{64}$/.test(vehicle.inventoryRevision), 'INVALID_INPUT', 'inventoryRevision is invalid'); }
function validateVerifiedCallback(value: VerifiedProviderCallback): void { invariant(Boolean(value), 'CALLBACK_NOT_VERIFIED', 'Provider callback was not verified'); requireIdentifier(value.dealId, 'dealId'); requireIdentifier(value.idempotencyKey, 'idempotencyKey'); requireIdentifier(value.providerReference, 'providerReference'); invariant(['PENDING', 'CONFIRMED', 'REJECTED'].includes(value.outcome), 'CALLBACK_NOT_VERIFIED', 'Provider outcome is invalid'); invariant(typeof value.simulated === 'boolean', 'CALLBACK_NOT_VERIFIED', 'Provider simulation marker is required'); }
