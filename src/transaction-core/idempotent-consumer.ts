import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { coreMetrics, type ConsumerEventType, type TransactionCoreMetrics } from './metrics.ts';

const ConsumerEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('TRANSACTION_STATUS_CHANGED'),
  payload: z.unknown(),
}).strict();

export interface ConsumerEvent<TPayload = unknown> {
  readonly eventId: string;
  readonly eventType: ConsumerEventType;
  readonly payload: TPayload;
}

export interface ConsumerLogger {
  warn(message: string, fields: Readonly<{ event_id: string; event_type: ConsumerEventType }>): void;
}

export type ConsumerResult = Readonly<{ acknowledged: true; duplicate: boolean }>;

export class IdempotentEventConsumer {
  readonly #pool: Pool;
  readonly #metrics: TransactionCoreMetrics;
  readonly #logger: ConsumerLogger;

  constructor(input: { readonly pool: Pool; readonly logger: ConsumerLogger; readonly metrics?: TransactionCoreMetrics }) {
    this.#pool = input.pool;
    this.#logger = input.logger;
    this.#metrics = input.metrics ?? coreMetrics;
  }

  async consume<TPayload>(rawEvent: unknown, handler: (event: ConsumerEvent<TPayload>, client: PoolClient) => Promise<void>): Promise<ConsumerResult> {
    const event = ConsumerEventSchema.parse(rawEvent) as ConsumerEvent<TPayload>;
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO processed_events (event_id) VALUES ($1)
         ON CONFLICT (event_id) DO NOTHING`,
        [event.eventId],
      );
      if (inserted.rowCount === 0) {
        safeWarn(this.#logger, event);
        this.#metrics.recordDuplicateEvent(event.eventType);
        await client.query('COMMIT');
        return Object.freeze({ acknowledged: true, duplicate: true });
      }
      if (inserted.rowCount !== 1) throw new Error('PROCESSED_EVENT_INSERT_RESULT_INVALID');

      await handler(event, client);
      await client.query('COMMIT');
      return Object.freeze({ acknowledged: true, duplicate: false });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function safeWarn(logger: ConsumerLogger, event: ConsumerEvent): void {
  try { logger.warn('duplicate_kafka_event_skipped', { event_id: event.eventId, event_type: event.eventType }); }
  catch { /* Logging must not turn an acknowledged duplicate into a Kafka retry loop. */ }
}

async function rollback(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK'); }
  catch { /* Preserve the original processing error. */ }
}
