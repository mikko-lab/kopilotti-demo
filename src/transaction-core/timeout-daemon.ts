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
    const ids = await this.#repository.findExpiredAwaitingPayment(this.#clock.now().toISOString(), this.#batchSize);
    let voided = 0; let skipped = 0;
    for (const id of ids) {
      try { await this.#machine.voidExpired(id); voided += 1; }
      catch (error) {
        if (isConcurrentOrNoLongerEligible(error)) skipped += 1; else throw error;
      }
    }
    return { scanned: ids.length, voided, skipped };
  }
}

function isConcurrentOrNoLongerEligible(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return ['INVALID_TRANSITION', 'PAYMENT_DEADLINE_ACTIVE', 'VERSION_CONFLICT'].includes(code);
}
