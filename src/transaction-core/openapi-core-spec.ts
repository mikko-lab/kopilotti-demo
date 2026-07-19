import { z } from 'zod';

export const LockPriceRequestSchema = z.object({
  dealId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  vehicleId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  agreedPrice: z.number().finite().positive().max(100_000_000)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Price may have at most two decimal places'),
  inventoryRevisionAtLock: z.number().int().nonnegative().safe(),
}).strict();

/** The buyer session token is deliberately transported in a protected header, not this body. */
export type LockPriceRequest = z.infer<typeof LockPriceRequestSchema>;

export interface LockPriceResponse {
  readonly success: true;
  readonly transactionId: string;
  readonly status: 'PRICE_AGREED';
  readonly createdAt: string;
}

export type CoreApiErrorCode =
  | 'INVALID_REQUEST'
  | 'CUSTOMER_STRONG_AUTHENTICATION_REQUIRED'
  | 'VEHICLE_NOT_AVAILABLE'
  | 'REVISION_MISMATCH'
  | 'PRICE_NOT_AUTHORIZED'
  | 'TRANSACTION_CONFLICT'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  readonly errorCode: CoreApiErrorCode;
  readonly message: string;
}
