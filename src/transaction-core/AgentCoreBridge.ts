import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LockPriceRequestSchema, type LockPriceRequest } from './openapi-core-spec.ts';

const LockPriceResponseSchema = z.object({
  success: z.literal(true), transactionId: z.string().min(1).max(128), status: z.literal('PRICE_AGREED'), createdAt: z.string().datetime(),
}).strict();
const ErrorResponseSchema = z.object({ errorCode: z.string().max(128), message: z.string().max(500) }).strict();

export type AgentCoreBridgeResult =
  | { readonly success: true; readonly directive: 'NEGOTIATION_CLOSED_SELECT_PAYMENT'; readonly transactionId: string; readonly message: string }
  | { readonly success: false; readonly retryable: boolean; readonly errorCode: 'STRONG_AUTH_REQUIRED' | 'CORE_BUSY' | 'LOCK_REJECTED'; readonly message: string };

export interface AgentCoreBridgeContext {
  readonly dealId: string;
  readonly vehicleId: string;
  readonly buyerSessionToken: string;
}

type FetchTransport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class AgentCoreBridge {
  readonly #endpoint: URL;
  readonly #serviceAuthorization: string;
  readonly #fetch: FetchTransport;
  readonly #timeoutMs: number;
  readonly #maxServiceUnavailableRetries: number;
  readonly #retryDelayMs: number;
  readonly #wait: (milliseconds: number) => Promise<void>;

  constructor(input: {
    readonly coreServiceUrl: string;
    readonly serviceAuthorization: string;
    readonly fetch?: FetchTransport;
    readonly timeoutMs?: number;
    readonly maxServiceUnavailableRetries?: number;
    readonly retryDelayMs?: number;
    readonly wait?: (milliseconds: number) => Promise<void>;
  }) {
    const base = new URL(input.coreServiceUrl);
    if (!['http:', 'https:'].includes(base.protocol)) throw new TypeError('Core service URL must use HTTP or HTTPS');
    if (!input.serviceAuthorization || input.serviceAuthorization.length > 4096) throw new TypeError('Service authorization is required');
    this.#endpoint = new URL('/api/v1/transactions/lock-price', base);
    this.#serviceAuthorization = input.serviceAuthorization;
    this.#fetch = input.fetch ?? fetch;
    this.#timeoutMs = input.timeoutMs ?? 3_000;
    this.#maxServiceUnavailableRetries = input.maxServiceUnavailableRetries ?? 1;
    this.#retryDelayMs = input.retryDelayMs ?? 150;
    this.#wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    requireIntegerRange(this.#timeoutMs, 100, 30_000, 'timeoutMs');
    requireIntegerRange(this.#maxServiceUnavailableRetries, 0, 3, 'maxServiceUnavailableRetries');
    requireIntegerRange(this.#retryDelayMs, 0, 5_000, 'retryDelayMs');
  }

  async handleAgentLockPrice(context: AgentCoreBridgeContext, agreedPrice: number, currentRevision: number): Promise<AgentCoreBridgeResult> {
    let payload: LockPriceRequest;
    try { payload = LockPriceRequestSchema.parse({ dealId: context.dealId, vehicleId: context.vehicleId, agreedPrice, inventoryRevisionAtLock: currentRevision }); }
    catch { return rejected(); }
    if (!context.buyerSessionToken || context.buyerSessionToken.length > 2048) return strongAuthRequired();

    const requestId = randomUUID();
    for (let attempt = 0; attempt <= this.#maxServiceUnavailableRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(this.#endpoint, {
          method: 'POST', signal: AbortSignal.timeout(this.#timeoutMs), body: JSON.stringify(payload),
          headers: {
            authorization: this.#serviceAuthorization, 'content-type': 'application/json',
            'x-buyer-session-token': context.buyerSessionToken, 'x-request-id': requestId,
          },
        });
      } catch { return busy(); }

      if (response.status === 503 && attempt < this.#maxServiceUnavailableRetries) {
        await this.#wait(this.#retryDelayMs * (attempt + 1)); continue;
      }
      if (!response.ok) return await this.#mapError(response);
      try {
        const result = LockPriceResponseSchema.parse(await response.json());
        return {
          success: true, directive: 'NEGOTIATION_CLOSED_SELECT_PAYMENT', transactionId: result.transactionId,
          message: 'Hinta on lukittu. Neuvottelu on päättynyt. Ohjaa asiakas valitsemaan maksutapa.',
        };
      } catch { return rejected(); }
    }
    return busy();
  }

  async #mapError(response: Response): Promise<AgentCoreBridgeResult> {
    if (response.status === 503 || response.status === 429) return busy();
    try {
      const parsed = ErrorResponseSchema.parse(await response.json());
      if (parsed.errorCode === 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED') return strongAuthRequired();
    } catch { /* Fail closed without forwarding an untrusted response body to the LLM. */ }
    return rejected();
  }
}

function busy(): AgentCoreBridgeResult {
  return { success: false, retryable: true, errorCode: 'CORE_BUSY', message: 'Järjestelmä on varattu, yritä hetken kuluttua uudelleen.' };
}
function strongAuthRequired(): AgentCoreBridgeResult {
  return { success: false, retryable: false, errorCode: 'STRONG_AUTH_REQUIRED', message: 'Ohjaa asiakas suorittamaan vahva tunnistautuminen.' };
}
function rejected(): AgentCoreBridgeResult {
  return { success: false, retryable: false, errorCode: 'LOCK_REJECTED', message: 'Hinnan lukitusta ei voitu vahvistaa.' };
}
function requireIntegerRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${name} is outside its supported range`);
}
