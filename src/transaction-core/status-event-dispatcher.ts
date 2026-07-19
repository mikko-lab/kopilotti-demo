import { KopilottiEventEmitter } from './events.ts';
import type { TransactionRepository } from './ports.ts';

export class StatusEventDispatcher {
  readonly #repository: TransactionRepository;
  readonly #events: KopilottiEventEmitter;
  readonly #batchSize: number;

  constructor(input: { repository: TransactionRepository; events: KopilottiEventEmitter; batchSize?: number }) {
    this.#repository = input.repository; this.#events = input.events; this.#batchSize = input.batchSize ?? 100;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) throw new TypeError('batchSize must be 1..1000');
  }

  async dispatchOnce(): Promise<number> {
    const pending = await this.#repository.listPendingStatusEvents(this.#batchSize);
    for (const event of pending) {
      this.#events.emitStatusChange(event);
      await this.#repository.markStatusEventPublished(event.eventId);
    }
    return pending.length;
  }

  start(input: { intervalMs?: number; onError: (error: unknown) => void }): () => void {
    const intervalMs = input.intervalMs ?? 1_000;
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000) throw new TypeError('intervalMs must be 100..60000');
    let stopped = false; let running = false;
    const tick = async () => {
      if (stopped || running) return; running = true;
      try { await this.dispatchOnce(); } catch (error) { input.onError(error); }
      finally { running = false; }
    };
    const timer = setInterval(() => { void tick(); }, intervalMs); timer.unref();
    void tick();
    return () => { stopped = true; clearInterval(timer); };
  }
}
