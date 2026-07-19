import express, { type Request, type Response, type Router } from 'express';
import type { Pool, QueryConfig } from 'pg';
import type { DaemonHealthStatus, MonitoringMetrics } from './monitoring-types.ts';
import { PrometheusMetricsCollector } from './PrometheusMetricsCollector.ts';

export interface HealthPolicy {
  readonly requireDaemonHeartbeat: boolean;
  readonly maxHeartbeatAgeMs: number;
  readonly maxOutboxLagSeconds: number;
  readonly maxUnprocessedOutboxCount: number;
  readonly databaseTimeoutMs: number;
}

const DEFAULT_POLICY: HealthPolicy = Object.freeze({
  requireDaemonHeartbeat: true, maxHeartbeatAgeMs: 30_000, maxOutboxLagSeconds: 300,
  maxUnprocessedOutboxCount: 100_000, databaseTimeoutMs: 1_000,
});

export class HealthRouter {
  readonly #pool: Pool;
  readonly #metrics: PrometheusMetricsCollector;
  readonly #policy: HealthPolicy;
  readonly #clock: () => Date;

  constructor(input: { pool: Pool; metrics: PrometheusMetricsCollector; policy?: Partial<HealthPolicy>; clock?: () => Date }) {
    this.#pool = input.pool; this.#metrics = input.metrics; this.#policy = Object.freeze({ ...DEFAULT_POLICY, ...input.policy }); this.#clock = input.clock ?? (() => new Date());
    validatePolicy(this.#policy);
  }

  router(): Router {
    const router = express.Router();
    router.get('/healthz/liveness', this.handleLiveness);
    router.get('/healthz/readiness', this.handleReadiness);
    router.get('/metrics', this.handleMetrics);
    return router;
  }

  readonly handleLiveness = (_request: Request, response: Response): void => { response.status(200).type('text/plain').send('OK'); };

  readonly handleReadiness = async (_request: Request, response: Response): Promise<void> => {
    try {
      const ping = { text: 'SELECT 1', query_timeout: this.#policy.databaseTimeoutMs } as QueryConfig;
      await this.#pool.query(ping);
      const metrics = await this.#metrics.collectMetrics(); const status = this.evaluate(metrics);
      if (!status.isReady) {
        response.status(503).json({ status: 'UNHEALTHY', reason: readinessReason(status, this.#policy), details: status }); return;
      }
      response.status(200).json({ status: 'READY' });
    } catch { response.status(503).json({ status: 'UNHEALTHY', reason: 'DEPENDENCY_UNAVAILABLE' }); }
  };

  readonly handleMetrics = async (_request: Request, response: Response): Promise<void> => {
    try {
      const body = await this.#metrics.getExpositionFormat();
      response.status(200).set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(body);
    } catch { response.status(500).type('text/plain').send('# ERROR metrics unavailable\n'); }
  };

  evaluate(metrics: MonitoringMetrics): DaemonHealthStatus {
    const now = this.#clock().getTime();
    const heartbeatMs = metrics.daemonLastHeartbeat ? Date.parse(metrics.daemonLastHeartbeat) : Number.NaN;
    const lastHeartbeatAgeMs = Number.isFinite(heartbeatMs) ? Math.max(0, now - heartbeatMs) : null;
    const daemonHealthy = !this.#policy.requireDaemonHeartbeat || (lastHeartbeatAgeMs !== null && lastHeartbeatAgeMs < this.#policy.maxHeartbeatAgeMs);
    const outboxHealthy = metrics.outboxLagSeconds < this.#policy.maxOutboxLagSeconds
      && metrics.unprocessedOutboxCount < this.#policy.maxUnprocessedOutboxCount;
    return { isAlive: true, isReady: daemonHealthy && outboxHealthy, lastHeartbeatAgeMs, outboxLagSeconds: metrics.outboxLagSeconds, unprocessedOutboxCount: metrics.unprocessedOutboxCount };
  }
}

function validatePolicy(policy: HealthPolicy): void {
  for (const value of [policy.maxHeartbeatAgeMs, policy.maxOutboxLagSeconds, policy.maxUnprocessedOutboxCount, policy.databaseTimeoutMs]) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError('Health policy thresholds must be positive integers');
  }
}
function readinessReason(status: DaemonHealthStatus, policy: HealthPolicy): string {
  if (policy.requireDaemonHeartbeat && (status.lastHeartbeatAgeMs === null || status.lastHeartbeatAgeMs >= policy.maxHeartbeatAgeMs)) return 'TIMEOUT_DAEMON_STALLED';
  if (status.outboxLagSeconds >= policy.maxOutboxLagSeconds) return 'OUTBOX_LAG_CRITICAL';
  return 'OUTBOX_BACKLOG_CRITICAL';
}
