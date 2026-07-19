import type { Request, Response } from 'express';
import { KopilottiEventEmitter, type TransactionStatusEvent } from './events.ts';
import type { Deal } from './model.ts';

export interface TransactionStatusReader { getDeal(dealId: string): Promise<Deal | null>; }
export interface TransactionStreamAuthorizer { authorize(request: Request, deal: Deal): Promise<void>; }

export function createTransactionSseHandler(input: {
  readonly repository: TransactionStatusReader;
  readonly events: KopilottiEventEmitter;
  readonly authorizer: TransactionStreamAuthorizer;
  readonly heartbeatMs?: number;
  readonly now?: () => Date;
}) {
  const heartbeatMs = input.heartbeatMs ?? 30_000;
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 5_000 || heartbeatMs > 120_000) throw new TypeError('heartbeatMs must be 5000..120000');
  const now = input.now ?? (() => new Date());

  return async function handleTransactionSse(request: Request, response: Response): Promise<void> {
    const transactionId = request.params.transactionId;
    if (typeof transactionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(transactionId)) {
      response.status(400).json({ error: 'INVALID_TRANSACTION_ID' }); return;
    }
    const deal = await input.repository.getDeal(transactionId);
    if (!deal) { response.status(404).json({ error: 'TRANSACTION_NOT_FOUND' }); return; }
    await input.authorizer.authorize(request, deal);

    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff',
    });
    response.flushHeaders();
    writeEvent(response, {
      eventId: `snapshot-${deal.version}`, transactionId: deal.id,
      registrationNumber: deal.vehicle.registrationIdentifier, status: deal.state,
      paymentDeadline: deal.paymentDeadline, timestamp: now().toISOString(),
    });

    let closed = false;
    const unsubscribe = input.events.onStatusChange((event) => {
      if (!closed && event.transactionId === transactionId) writeEvent(response, event);
    });
    const heartbeat = setInterval(() => { if (!closed) response.write(': keep-alive\n\n'); }, heartbeatMs);
    heartbeat.unref();
    const close = () => {
      if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe();
      if (!response.writableEnded) response.end();
    };
    request.once('close', close);
    response.once('close', close);
  };
}

function writeEvent(response: Response, event: TransactionStatusEvent): void {
  response.write(`id: ${sanitizeSseId(event.eventId)}\nevent: statusChange\ndata: ${JSON.stringify(event)}\n\n`);
}
function sanitizeSseId(value: string): string { return value.replace(/[\r\n\0]/g, ''); }
