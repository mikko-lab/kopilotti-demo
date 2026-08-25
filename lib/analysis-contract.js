const { z } = require('zod');

const TRANSCRIPT_MAX_LENGTH = 12_000;

const ANALYZE_REQUEST_SCHEMA = z
  .object({
    transcript: z.string().trim().min(1).max(TRANSCRIPT_MAX_LENGTH),
  })
  .strict();

const HINT_SCHEMA = z
  .object({
    type: z.enum(['green', 'blue', 'yellow', 'red']),
    icon: z.string().trim().min(1).max(16),
    title: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(500),
    action: z.string().trim().min(1).max(80),
  })
  .strict();

const ANALYSIS_SCHEMA = z
  .object({
    hints: z.array(HINT_SCHEMA).min(1).max(3),
    meter: z
      .object({
        value: z.number().finite().min(0).max(100),
        desc: z.string().trim().min(1).max(200),
      })
      .strict(),
    cars: z
      .array(z.number().int().min(1).max(6))
      .min(1)
      .max(3)
      .refine((cars) => new Set(cars).size === cars.length, {
        message: 'Car recommendations must be unique',
      }),
  })
  .strict();

// Keep the provider-side tool contract aligned with the runtime Zod contract.
// Provider schema enforcement improves response quality; Zod remains the
// authoritative trust boundary before any model output leaves this server.
const EMIT_ANALYSIS_TOOL = {
  name: 'emit_analysis',
  description:
    'Palauta strukturoitu myyntianalyysi transkriptiosta: 1-3 myyntivihjetta, ostohalukkuusmittari ja suositellut autot.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      hints: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['green', 'blue', 'yellow', 'red'] },
            icon: { type: 'string', minLength: 1, maxLength: 16 },
            title: { type: 'string', minLength: 1, maxLength: 80 },
            text: { type: 'string', minLength: 1, maxLength: 500 },
            action: { type: 'string', minLength: 1, maxLength: 80 },
          },
          required: ['type', 'icon', 'title', 'text', 'action'],
        },
      },
      meter: {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: { type: 'number', minimum: 0, maximum: 100 },
          desc: { type: 'string', minLength: 1, maxLength: 200 },
        },
        required: ['value', 'desc'],
      },
      cars: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: { type: 'integer', minimum: 1, maximum: 6 },
      },
    },
    required: ['hints', 'meter', 'cars'],
  },
};

function validationIssueSummary(error) {
  if (!(error instanceof z.ZodError)) return 'unknown_validation_error';

  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'root'}:${issue.code}`)
    .join(',');
}

module.exports = {
  ANALYSIS_SCHEMA,
  ANALYZE_REQUEST_SCHEMA,
  EMIT_ANALYSIS_TOOL,
  TRANSCRIPT_MAX_LENGTH,
  validationIssueSummary,
};
