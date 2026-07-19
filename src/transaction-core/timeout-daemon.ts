import type { Clock, TransactionRepository } from './ports.ts';
import type { DaemonMonitor, OperationalLogger } from './monitoring-types.ts';
import { TransactionMachine } from './transaction-machine.ts';

export class PaymentTimeoutDaemon {
  readonly #repository: TransactionRepository;
  readonly #machine: TransactionMachine;
  readonly #clock: Clock;
  readonly #batchSize: number;
  readonly #monitor: DaemonMonitor | null;
  readonly #logger: OperationalLogger | null;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(input: { repository: TransactionRepository; machine: TransactionMachine; clock: Clock; batchSize?: number; monitor?: DaemonMonitor; logger?: OperationalLogger }) {
    this.#repository = input.repository; this.#machine = input.machine; this.#clock = input.clock;
    this.#monitor = input.monitor ?? null; this.#logger = input.logger ?? null;
    this.#batchSize = input.batchSize ?? 100;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) throw new TypeError('batchSize must be 1..1000');
  }

  async runOnce(): Promise<{ scanned: number; voided: number; skipped: number }> {
    try {
      const occurredAt = this.#clock.now(); const timestamp = occurredAt.toISOString();
      const result = await this.#repository.processExpiredAwaitingPayment(timestamp, this.#batchSize, async (context, dealId) => {
        await this.#machine.voidExpiredInTransaction(context, dealId, timestamp);
      });
      safeCall(() => this.#monitor?.registerDaemonHeartbeat(occurredAt));
      return { scanned: result.processed + result.skipped, voided: result.processed, skipped: result.skipped };
    } catch (error) { safeCall(() => this.#monitor?.registerDaemonError()); throw error; }
  }

  start(intervalMs = 10_000): () => void {
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 300_000) throw new TypeError('intervalMs must be 100..300000');
    if (this.#timer) return () => this.stop();
    const tick = async () => {
      if (this.#running) return; this.#running = true;
      try { await this.runOnce(); }
      catch (error) { safeCall(() => this.#logger?.error('payment_timeout_daemon_cycle_failed', { errorCode: safeErrorCode(error) })); }
      finally { this.#running = false; }
    };
    this.#timer = setInterval(() => { void tick(); }, intervalMs); this.#timer.unref(); void tick();
    return () => this.stop();
  }

  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}

function safeCall(operation: () => void): void { try { operation(); } catch { /* monitoring must not change domain outcome */ } }
function safeErrorCode(error: unknown): string { return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNEXPECTED_ERROR'; }
