export type DealState = 'NEGOTIATING' | 'PRICE_AGREED' | 'AWAITING_PAYMENT' | 'PAID' | 'HANDED_OVER' | 'VOIDED';
export type PaymentMethod = 'CASH' | 'FINANCING';
export type TransitionSource =
  | 'DETERMINISTIC_NEGOTIATION_ENGINE'
  | 'CUSTOMER_INTERFACE_ACTION'
  | 'PAYMENT_PROVIDER_ADAPTER'
  | 'FINANCING_PROVIDER_ADAPTER'
  | 'PROVIDER_ADAPTER_SIMULATED'
  | 'AUTHORIZED_DEALERSHIP_ACTION'
  | 'SYSTEM_DAEMON';

export interface LockedVehicle {
  readonly vehicleId: string;
  readonly registrationIdentifier: string;
  readonly inventoryRevision: string;
}

export interface Deal {
  readonly id: string;
  readonly tenantId: string;
  readonly state: DealState;
  readonly version: number;
  readonly vehicle: LockedVehicle;
  readonly agreedPriceCents: number | null;
  readonly currency: 'EUR';
  readonly paymentMethod: PaymentMethod | null;
  readonly paymentDeadline: string | null;
  readonly providerReference: string | null;
  readonly handoverPolicyVersion: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuditEvent {
  readonly id: string;
  readonly dealId: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly event: string;
  readonly fromState: DealState;
  readonly toState: DealState;
  readonly source: TransitionSource;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

export interface HandoverFacts {
  readonly ceramicCoatingCompleted: boolean;
  readonly handoverInspectionCompleted: boolean;
  readonly identityVerified: boolean;
  readonly registrationCompleted: boolean;
  readonly insuranceInformationReceived: boolean;
  readonly manualApproval: boolean;
}

export interface HandoverRules {
  readonly requireCeramicCoatingCompleted: boolean;
  readonly requireHandoverInspectionCompleted: boolean;
  readonly requireIdentityVerified: boolean;
  readonly requireRegistrationCompleted: boolean;
  readonly requireInsuranceInformationReceived: boolean;
  readonly requireManualApproval: boolean;
}

export interface HandoverPolicy {
  readonly tenantId: string;
  readonly version: string;
  readonly defaultRules: HandoverRules;
  readonly vehicleRules: Readonly<Record<string, HandoverRules>>;
}

export interface VerifiedProviderCallback {
  readonly dealId: string;
  readonly idempotencyKey: string;
  readonly providerReference: string;
  readonly outcome: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  readonly simulated: boolean;
}
