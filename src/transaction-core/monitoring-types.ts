export interface MonitoringMetrics {
  readonly outboxLagSeconds: number;
  readonly unprocessedOutboxCount: number;
  readonly daemonLastHeartbeat: string | null;
  readonly daemonExecutionCount: number;
  readonly daemonErrorCount: number;
  readonly kafkaCdcConfigured: boolean;
  readonly kafkaCdcConnected: boolean | null;
  readonly kafkaCdcLagSeconds: number | null;
  readonly kafkaCdcQueueSize: number | null;
}

export interface DaemonHealthStatus {
  readonly isAlive: boolean;
  readonly isReady: boolean;
  readonly lastHeartbeatAgeMs: number | null;
  readonly outboxLagSeconds: number;
  readonly unprocessedOutboxCount: number;
  readonly kafkaCdcConfigured: boolean;
  readonly kafkaCdcConnected: boolean | null;
  readonly kafkaCdcLagSeconds: number | null;
}

export interface DaemonMonitor {
  registerDaemonHeartbeat(occurredAt?: Date): void;
  registerDaemonError(): void;
}

export interface OperationalLogger {
  error(event: string, context: Readonly<Record<string, string | number | boolean | null>>): void;
}
