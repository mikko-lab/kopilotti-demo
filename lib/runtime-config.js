const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:8090',
  'http://127.0.0.1:8090',
];

const DEFAULT_ANALYSIS_TIMEOUT_MS = 15_000;
const MIN_ANALYSIS_TIMEOUT_MS = 1_000;
const MAX_ANALYSIS_TIMEOUT_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 10;

function parseInteger(value, fallback, { min, max, name }) {
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseAllowedOrigins(value, isProduction) {
  const origins = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    throw new Error('ALLOWED_ORIGIN must not contain a wildcard');
  }

  if (origins.length > 0) return [...new Set(origins)];
  if (isProduction) throw new Error('ALLOWED_ORIGIN is required in production');
  return DEFAULT_LOCAL_ORIGINS;
}

// Explicit three-way-safe boolean: unset means "not enabled yet" (the safe
// default for a freshly bootstrapped service, before anyone has deliberately
// opted in), and only the exact strings "true"/"false" are accepted -
// anything else (a typo, "1", "True", "yes") fails closed instead of being
// silently coerced one way or the other. This is what lets a Render service
// be created and smoke-tested (health, vehicle lookup, the managed 503 on
// /api/analyze) with zero Anthropic spend risk before anyone deliberately
// flips it on.
function parseAnalysisEnabled(value) {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('ANALYSIS_ENABLED must be exactly "true" or "false"');
}

function readRuntimeConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const analysisEnabled = parseAnalysisEnabled(env.ANALYSIS_ENABLED);
  const anthropicApiKey = String(env.ANTHROPIC_API_KEY || '').trim();

  // Replaces the old blanket "production always needs a key" rule: the key
  // is only required when analysis is actually turned on, in any
  // environment, production included - a freshly bootstrapped production
  // service with ANALYSIS_ENABLED left at its default (false) must be able
  // to start and serve /health + vehicle lookup with no key configured yet.
  if (analysisEnabled && !anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when ANALYSIS_ENABLED is true');
  }

  return {
    nodeEnv,
    isProduction,
    analysisEnabled,
    port: parseInteger(env.PORT, 3001, {
      min: 1,
      max: 65_535,
      name: 'PORT',
    }),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGIN, isProduction),
    anthropicApiKey,
    analysisTimeoutMs: parseInteger(
      env.ANTHROPIC_TIMEOUT_MS,
      DEFAULT_ANALYSIS_TIMEOUT_MS,
      {
        min: MIN_ANALYSIS_TIMEOUT_MS,
        max: MAX_ANALYSIS_TIMEOUT_MS,
        name: 'ANTHROPIC_TIMEOUT_MS',
      }
    ),
    // Ten analyses per minute supports a live sales demo while bounding
    // accidental loops and direct model spend. Distributed deployments should
    // replace the in-memory store with a shared rate-limit store.
    rateLimitMax: parseInteger(env.ANALYZE_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX, {
      min: 1,
      max: 100,
      name: 'ANALYZE_RATE_LIMIT_MAX',
    }),
    trustProxy: isProduction ? 1 : false,
  };
}

module.exports = {
  DEFAULT_ANALYSIS_TIMEOUT_MS,
  DEFAULT_LOCAL_ORIGINS,
  readRuntimeConfig,
};
