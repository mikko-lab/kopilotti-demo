import { EventEmitter } from 'node:events';
import type { DealState } from './model.ts';

export interface TransactionStatusEvent {
  readonly eventId: string;
  readonly transactionId: string;
  readonly registrationNumber: string;
  readonly status: DealState;
  readonly paymentDeadline: string | null;
  readonly timestamp: string;
}

export class KopilottiEventEmitter {
  readonly #emitter = new EventEmitter();

  emitStatusChange(event: TransactionStatusEvent): boolean {
    validateStatusEvent(event);
    return this.#emitter.emit('statusChange', Object.freeze({ ...event }));
  }

  onStatusChange(callback: (event: TransactionStatusEvent) => void): () => void {
    this.#emitter.on('statusChange', callback);
    return () => { this.#emitter.removeListener('statusChange', callback); };
  }

  listenerCount(): number { return this.#emitter.listenerCount('statusChange'); }
}

export const kopilottiEvents = new KopilottiEventEmitter();

function validateStatusEvent(event: TransactionStatusEvent): void {
  if (!event.eventId || !event.transactionId || !event.registrationNumber || !event.timestamp) throw new TypeError('Invalid transaction status event');
}
