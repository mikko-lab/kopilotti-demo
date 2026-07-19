import type { Pool, QueryResultRow } from 'pg';
import { invariant } from './errors.ts';
import type { DaemonMonitor, MonitoringMetrics } from './monitoring-types.ts';
import type { KafkaCdcMetricsProvider, KafkaCdcMetricsSnapshot } from './kafka-cdc-metrics.ts';
import { validateKafkaCdcMetrics } from './kafka-cdc-metrics.ts';

interface OutboxMetricRow extends QueryResultRow { total_unprocessed: string | number; max_lag_seconds: string | number | null; }

export class PrometheusMetricsCollector implements DaemonMonitor {
  readonly #pool: Pool;
  readonly #clock: () => Date;
  readonly #kafkaCdcMetrics: KafkaCdcMetricsProvider | null;
  #daemonLastHeartbeat: Date | null = null;
  #daemonExecutionCount = 0;
  #daemonErrorCount = 0;

  constructor(input: { pool: Pool; clock?: () => Date; kafkaCdcMetrics?: KafkaCdcMetricsProvider }) {
    this.#pool = input.pool; this.#clock = input.clock ?? (() => new Date()); this.#kafkaCdcMetrics = input.kafkaCdcMetrics ?? null;
  }

  registerDaemonHeartbeat(occurredAt = this.#clock()): void {
    invariant(Number.isFinite(occurredAt.getTime()), 'INVALID_HEARTBEAT_TIME', 'Heartbeat time is invalid');
    this.#daemonLastHeartbeat = new Date(occurredAt); this.#daemonExecutionCount += 1;
  }
  registerDaemonError(): void { this.#daemonErrorCount += 1; }

  async collectMetrics(): Promise<MonitoringMetrics> {
    const result = await this.#pool.query<OutboxMetricRow>(`
      SELECT COUNT(*)::bigint AS total_unprocessed,
             COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at))), 0)::double precision AS max_lag_seconds
      FROM transactional_outbox
      WHERE published_at IS NULL
    `);
    const row = result.rows[0];
    invariant(Boolean(row), 'METRICS_QUERY_EMPTY', 'Metrics query returned no aggregate row');
    const cdc = await this.#collectKafkaCdcMetrics();
    return {
      outboxLagSeconds: nonNegativeNumber(row?.max_lag_seconds),
      unprocessedOutboxCount: nonNegativeSafeInteger(row?.total_unprocessed),
      daemonLastHeartbeat: this.#daemonLastHeartbeat?.toISOString() ?? null,
      daemonExecutionCount: this.#daemonExecutionCount,
      daemonErrorCount: this.#daemonErrorCount,
      kafkaCdcConfigured: this.#kafkaCdcMetrics !== null,
      kafkaCdcConnected: cdc?.connected ?? null,
      kafkaCdcLagSeconds: cdc?.lagSeconds ?? null,
      kafkaCdcQueueSize: cdc?.queueSize ?? null,
    };
  }

  async getExpositionFormat(): Promise<string> {
    const metrics = await this.collectMetrics();
    const heartbeatSeconds = metrics.daemonLastHeartbeat ? Math.floor(Date.parse(metrics.daemonLastHeartbeat) / 1000) : 0;
    return `${[
      '# HELP kopilotti_outbox_lag_seconds Age of the oldest unpublished outbox event in seconds.',
      '# TYPE kopilotti_outbox_lag_seconds gauge', `kopilotti_outbox_lag_seconds ${metrics.outboxLagSeconds}`,
      '# HELP kopilotti_outbox_unprocessed_count Number of unpublished outbox events.',
      '# TYPE kopilotti_outbox_unprocessed_count gauge', `kopilotti_outbox_unprocessed_count ${metrics.unprocessedOutboxCount}`,
      '# HELP kopilotti_timeout_daemon_executions_total Successful timeout daemon cycles.',
      '# TYPE kopilotti_timeout_daemon_executions_total counter', `kopilotti_timeout_daemon_executions_total ${metrics.daemonExecutionCount}`,
      '# HELP kopilotti_timeout_daemon_errors_total Failed timeout daemon cycles.',
      '# TYPE kopilotti_timeout_daemon_errors_total counter', `kopilotti_timeout_daemon_errors_total ${metrics.daemonErrorCount}`,
      '# HELP kopilotti_timeout_daemon_last_heartbeat_timestamp_seconds Last successful timeout daemon cycle as Unix time.',
      '# TYPE kopilotti_timeout_daemon_last_heartbeat_timestamp_seconds gauge', `kopilotti_timeout_daemon_last_heartbeat_timestamp_seconds ${heartbeatSeconds}`,
      '# HELP kopilotti_kafka_cdc_metrics_configured Whether a Debezium metrics provider is configured.',
      '# TYPE kopilotti_kafka_cdc_metrics_configured gauge', `kopilotti_kafka_cdc_metrics_configured ${metrics.kafkaCdcConfigured ? 1 : 0}`,
      '# HELP kopilotti_kafka_cdc_connected Whether the Debezium PostgreSQL connector is connected.',
      '# TYPE kopilotti_kafka_cdc_connected gauge', `kopilotti_kafka_cdc_connected ${metrics.kafkaCdcConnected ? 1 : 0}`,
      '# HELP kopilotti_kafka_cdc_lag_seconds Debezium source lag in seconds.',
      '# TYPE kopilotti_kafka_cdc_lag_seconds gauge', `kopilotti_kafka_cdc_lag_seconds ${prometheusNullable(metrics.kafkaCdcLagSeconds)}`,
      '# HELP kopilotti_kafka_cdc_queue_size Records currently buffered in the Debezium connector queue.',
      '# TYPE kopilotti_kafka_cdc_queue_size gauge', `kopilotti_kafka_cdc_queue_size ${prometheusNullable(metrics.kafkaCdcQueueSize)}`,
    ].join('\n')}\n`;
  }

  async #collectKafkaCdcMetrics(): Promise<KafkaCdcMetricsSnapshot | null> {
    if (!this.#kafkaCdcMetrics) return null;
    try { return validateKafkaCdcMetrics(await this.#kafkaCdcMetrics.collectKafkaCdcMetrics()); }
    catch { return Object.freeze({ connected: false, lagSeconds: null, queueSize: null }); }
  }
}

function nonNegativeNumber(value: string | number | null | undefined): number { const parsed = Number(value ?? 0); invariant(Number.isFinite(parsed) && parsed >= 0, 'INVALID_METRIC_VALUE', 'Metric value is invalid'); return parsed; }
function nonNegativeSafeInteger(value: string | number | undefined): number { const parsed = Number(value ?? 0); invariant(Number.isSafeInteger(parsed) && parsed >= 0, 'INVALID_METRIC_VALUE', 'Metric count is invalid'); return parsed; }
function prometheusNullable(value: number | null): number | 'NaN' { return value ?? 'NaN'; }
