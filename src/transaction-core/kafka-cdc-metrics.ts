import { invariant } from './errors.ts';

/** Values sourced from Debezium/Kafka Connect monitoring, never inferred from outbox rows. */
export interface KafkaCdcMetricsSnapshot {
  readonly connected: boolean;
  readonly lagSeconds: number | null;
  readonly queueSize: number | null;
}

export interface KafkaCdcMetricsProvider {
  collectKafkaCdcMetrics(): Promise<KafkaCdcMetricsSnapshot>;
}

export function validateKafkaCdcMetrics(snapshot: KafkaCdcMetricsSnapshot): KafkaCdcMetricsSnapshot {
  validateNullableMetric(snapshot.lagSeconds);
  validateNullableMetric(snapshot.queueSize);
  return Object.freeze({ ...snapshot });
}

function validateNullableMetric(value: number | null): void {
  invariant(value === null || (Number.isFinite(value) && value >= 0), 'INVALID_CDC_METRIC_VALUE', 'CDC metric value is invalid');
}
