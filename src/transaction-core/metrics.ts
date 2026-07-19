import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export type PriceLockMetricStatus = 'success' | 'failed';
export type PriceLockErrorCode =
  | 'none'
  | 'invalid_request'
  | 'strong_auth_required'
  | 'vehicle_not_available'
  | 'revision_mismatch'
  | 'price_not_authorized'
  | 'transaction_conflict'
  | 'unauthorized'
  | 'core_unavailable'
  | 'invalid_response';
export type LockFailureType = 'db_timeout' | 'revision_mismatch' | 'concurrency_conflict';

export interface TransactionCoreMetrics {
  recordPriceLock(status: PriceLockMetricStatus, errorCode: PriceLockErrorCode): void;
  recordLockFailure(failureType: LockFailureType): void;
  setCdcLagSeconds(seconds: number): void;
}

export interface MetricsBundle extends TransactionCoreMetrics {
  readonly registry: Registry;
}

export function createMetricsRegistry(input: { readonly collectDefaults?: boolean; readonly prefix?: string } = {}): MetricsBundle {
  const registry = new Registry();
  if (input.collectDefaults !== false) collectDefaultMetrics({ register: registry, prefix: input.prefix ?? 'kopilotti_core_' });

  const priceLockAttempts = new Counter({
    name: 'kopilotti_transaction_lock_attempts_total',
    help: 'Total number of price lock attempts from the chat agent.',
    labelNames: ['status', 'error_code'] as const,
    registers: [registry],
  });
  const lockFailures = new Counter({
    name: 'kopilotti_transaction_lock_failures_total',
    help: 'Total number of database-level concurrency or locking failures.',
    labelNames: ['failure_type'] as const,
    registers: [registry],
  });
  const cdcLagGauge = new Gauge({
    name: 'kopilotti_kafka_cdc_lag_seconds',
    help: 'Calculated replication lag between PostgreSQL WAL commit and Kafka event processing.',
    registers: [registry],
  });

  return Object.freeze({
    registry,
    recordPriceLock: (status: PriceLockMetricStatus, errorCode: PriceLockErrorCode): void => {
      priceLockAttempts.inc({ status, error_code: errorCode });
    },
    recordLockFailure: (failureType: LockFailureType): void => { lockFailures.inc({ failure_type: failureType }); },
    setCdcLagSeconds: (seconds: number): void => {
      if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('CDC lag must be a non-negative finite number');
      cdcLagGauge.set(seconds);
    },
  });
}

export const coreMetrics = createMetricsRegistry();
export const registry = coreMetrics.registry;
