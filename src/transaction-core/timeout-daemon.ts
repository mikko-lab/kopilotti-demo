import type { Clock, TransactionRepository } from './ports.ts';
import { TransactionMachine } from './transaction-machine.ts';

export class PaymentTimeoutDaemon {
  readonly #repository: TransactionRepository;
  readonly #machine: TransactionMachine;
  readonly #clock: Clock;
  readonly #batchSize: number;

  constructor(input: { repository: TransactionRepository; machine: TransactionMachine; clock: Clock; batchSize?: number }) {
    this.#repository = input.repository; this.#machine = input.machine; this.#clock = input.clock;
    this.#batchSize = input.batchSize ?? 100;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) throw new TypeError('batchSize must be 1..1000');
  }

  async runOnce(): Promise<{ scanned: number; voided: number; skipped: number }> {
    const timestamp = this.#clock.now().toISOString();
    const result = await this.#repository.processExpiredAwaitingPayment(timestamp, this.#batchSize, async (context, dealId) => {
      await this.#machine.voidExpiredInTransaction(context, dealId, timestamp);
    });
    return { scanned: result.processed + result.skipped, voided: result.processed, skipped: result.skipped };
  }
}
