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

  it('requires an explicit ALLOWED_ORIGIN in production regardless of analysis state', () => {
    // No ANALYSIS_ENABLED at all -> defaults to false -> no key required,
    // but ALLOWED_ORIGIN is still mandatory in production either way.
    expect(() => readRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'ALLOWED_ORIGIN is required in production'
    );

    expect(() =>
      readRuntimeConfig({
        NODE_ENV: 'production',
        ANALYSIS_ENABLED: 'true',
        ANTHROPIC_API_KEY: 'test-key',
      })
    ).toThrow('ALLOWED_ORIGIN is required in production');
  });

  it('production + analysis disabled + no key: configuration is accepted', () => {
    const config = readRuntimeConfig({
      NODE_ENV: 'production',
      ALLOWED_ORIGIN: 'https://demo.example',
    });

    expect(config.analysisEnabled).toBe(false);
    expect(config.anthropicApiKey).toBe('');
    expect(config.isProduction).toBe(true);
  });

  it('analysis enabled + no key: startup fails closed', () => {
    expect(() =>
      readRuntimeConfig({
        NODE_ENV: 'production',
        ALLOWED_ORIGIN: 'https://demo.example',
        ANALYSIS_ENABLED: 'true',
      })
    ).toThrow('ANTHROPIC_API_KEY is required when ANALYSIS_ENABLED is true');

    // Same rule outside production too - analysis cost/abuse exposure is
    // never environment-conditional, only ANALYSIS_ENABLED-conditional.
    expect(() =>
      readRuntimeConfig({ NODE_ENV: 'development', ANALYSIS_ENABLED: 'true' })
    ).toThrow('ANTHROPIC_API_KEY is required when ANALYSIS_ENABLED is true');
  });

  it('analysis enabled + key: configuration is accepted', () => {
    const config = readRuntimeConfig({
      NODE_ENV: 'production',
      ALLOWED_ORIGIN: 'https://demo.example',
      ANALYSIS_ENABLED: 'true',
      ANTHROPIC_API_KEY: 'test-key',
    });

    expect(config.analysisEnabled).toBe(true);
    expect(config.anthropicApiKey).toBe('test-key');
  });

  it('rejects any ANALYSIS_ENABLED value other than exactly "true" or "false"', () => {
    for (const invalid of ['1', '0', 'yes', 'no', 'True', 'FALSE', ' true', 'true ']) {
      expect(() => readRuntimeConfig({ ANALYSIS_ENABLED: invalid })).toThrow(
        'ANALYSIS_ENABLED must be exactly "true" or "false"'
      );
    }
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
