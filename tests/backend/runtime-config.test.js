import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_ANALYSIS_TIMEOUT_MS,
  DEFAULT_LOCAL_ORIGINS,
  readRuntimeConfig,
} = require('../../lib/runtime-config');

describe('runtime configuration', () => {
  it('uses bounded local-development defaults', () => {
    const config = readRuntimeConfig({ NODE_ENV: 'development' });

    expect(config.allowedOrigins).toEqual(DEFAULT_LOCAL_ORIGINS);
    expect(config.analysisTimeoutMs).toBe(DEFAULT_ANALYSIS_TIMEOUT_MS);
    expect(config.rateLimitMax).toBe(10);
    expect(config.trustProxy).toBe(false);
  });

  it('requires explicit credentials and origins in production', () => {
    expect(() => readRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'ANTHROPIC_API_KEY is required in production'
    );

    expect(() =>
      readRuntimeConfig({
        NODE_ENV: 'production',
        ANTHROPIC_API_KEY: 'test-key',
      })
    ).toThrow('ALLOWED_ORIGIN is required in production');
  });

  it('parses a deduplicated comma-separated production allowlist', () => {
    const config = readRuntimeConfig({
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: 'test-key',
      ALLOWED_ORIGIN:
        'https://demo.example, https://admin.example,https://demo.example',
    });

    expect(config.allowedOrigins).toEqual([
      'https://demo.example',
      'https://admin.example',
    ]);
    expect(config.trustProxy).toBe(1);
  });

  it('rejects wildcard origins and out-of-range operational limits', () => {
    expect(() =>
      readRuntimeConfig({ NODE_ENV: 'development', ALLOWED_ORIGIN: '*' })
    ).toThrow('ALLOWED_ORIGIN must not contain a wildcard');

    expect(() =>
      readRuntimeConfig({
        NODE_ENV: 'development',
        ANTHROPIC_TIMEOUT_MS: '999',
      })
    ).toThrow('ANTHROPIC_TIMEOUT_MS must be an integer between 1000 and 60000');

    expect(() =>
      readRuntimeConfig({
        NODE_ENV: 'development',
        ANALYZE_RATE_LIMIT_MAX: '0',
      })
    ).toThrow('ANALYZE_RATE_LIMIT_MAX must be an integer between 1 and 100');
  });
});
