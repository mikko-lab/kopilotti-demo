/** Public server-module names for the transaction-core domain types. */
export type { AuditEvent as AuditLogEntry, Deal as TransactionState, DealState as VehicleStatus } from './model.ts';
export type {
  AuditEvent, Deal, DealState, HandoverFacts, HandoverPolicy, HandoverRules,
  LockedVehicle, PaymentMethod, TransitionSource, VerifiedProviderCallback,
} from './model.ts';
export type {
  BusinessCalendarPort, Clock, DealershipAuthorizer, HandoverPolicyRepository, IdGenerator,
  ProviderAdapter, TransactionContext, TransactionRepository,
} from './ports.ts';
