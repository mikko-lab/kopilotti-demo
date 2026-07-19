import { z } from 'zod';

export const AgreePriceToolSchema = z.object({
  transactionId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).nullable(),
  registrationNumber: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9ÅÄÖåäö-]+$/),
  agreedPrice: z.number().finite().positive().max(100_000_000).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Price may have at most two decimal places'),
}).strict();

export type AgreePriceToolInput = z.infer<typeof AgreePriceToolSchema>;

export const agreePriceToolDefinition = Object.freeze({
  type: 'function' as const,
  function: Object.freeze({
    name: 'lock_vehicle_price',
    description: 'Requests a backend price lock after the deterministic negotiation service has authorized the exact vehicle and price.',
    strict: true,
    parameters: Object.freeze({
      type: 'object', additionalProperties: false,
      properties: Object.freeze({
        transactionId: Object.freeze({ type: ['string', 'null'], description: 'Server-issued transaction ID, or null only when the backend has an authorized unmatched decision.' }),
        registrationNumber: Object.freeze({ type: 'string', minLength: 1, maxLength: 16, pattern: '^[A-Za-z0-9ÅÄÖåäö-]+$', description: 'Vehicle registration identifier from server-backed conversation context.' }),
        agreedPrice: Object.freeze({ type: 'number', exclusiveMinimum: 0, maximum: 100_000_000, multipleOf: 0.01, description: 'Claimed agreed price in euros; backend verification remains authoritative.' }),
      }),
      required: Object.freeze(['transactionId', 'registrationNumber', 'agreedPrice']),
    }),
  }),
});
