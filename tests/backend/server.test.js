import { createRequire } from 'node:module';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
// Aliased: this file already has its own local createAnthropicClient()
// helper below (a fake stream-capable stub for tests), unrelated to
// server.js's real ANALYSIS_ENABLED-gated constructor.
const { createAnthropicClient: buildAnthropicClient, createApp } = require('../../server');
const { readRuntimeConfig } = require('../../lib/runtime-config');

const VALID_ANALYSIS = {
  hints: [
    {
      type: 'green',
      icon: '✓',
      title: 'OSTOSIGNAALI',
      text: 'Asiakas kysyi toimitusajasta.',
      action: 'Vahvista toimitus',
    },
  ],
  meter: { value: 72, desc: 'Vahva kiinnostus' },
  cars: [1, 3],
};

const BASE_CONFIG = {
  allowedOrigins: ['https://demo.example'],
  analysisTimeoutMs: 250,
  rateLimitMax: 10,
  trustProxy: false,
};

function noLimit(_req, _res, next) {
  next();
}

function createLogger() {
  return {
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createAnthropicClient(input = VALID_ANALYSIS, onStream = vi.fn()) {
  return {
    messages: {
      stream(body, options) {
        onStream(body, options);
        return {
          async finalMessage() {
            return {
              content: [
                {
                  type: 'tool_use',
                  name: 'emit_analysis',
                  input,
                },
              ],
            };
          },
        };
      },
    },
  };
}

function createTestApp(overrides = {}) {
  return createApp({
    anthropicClient: createAnthropicClient(),
    config: BASE_CONFIG,
    analysisLimiter: noLimit,
    logger: createLogger(),
    ...overrides,
  });
}

describe('backend security boundary', () => {
  it('returns liveness and baseline security headers with a request ID', async () => {
    const response = await request(createTestApp()).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('preserves a safe request ID and replaces an unsafe one', async () => {
    const safe = await request(createTestApp())
      .get('/health')
      .set('X-Request-ID', 'demo-request:123')
      .expect(200);
    expect(safe.headers['x-request-id']).toBe('demo-request:123');

    const unsafe = await request(createTestApp())
      .get('/health')
      .set('X-Request-ID', '<script>alert(1)</script>')
      .expect(200);
    expect(unsafe.headers['x-request-id']).not.toContain('<script>');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows only configured browser origins', async () => {
    const allowed = await request(createTestApp())
      .get('/health')
      .set('Origin', 'https://demo.example')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://demo.example'
    );

    const denied = await request(createTestApp())
      .get('/health')
      .set('Origin', 'https://attacker.example')
      .expect(403);
    expect(denied.body.error).toBe('Origin ei ole sallittu.');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    [{}, 'missing transcript'],
    [{ transcript: 42 }, 'wrong transcript type'],
    [{ transcript: '   ' }, 'blank transcript'],
    [{ transcript: 'ok', extra: true }, 'unknown request field'],
    [{ transcript: 'x'.repeat(12_001) }, 'oversized transcript'],
  ])('rejects invalid analysis input: %s (%s)', async (body) => {
    const response = await request(createTestApp())
      .post('/api/analyze')
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('Virheellinen analyysipyyntö.');
  });

  it('rejects a JSON body larger than 16 KiB before model invocation', async () => {
    const onStream = vi.fn();
    const app = createTestApp({
      anthropicClient: createAnthropicClient(VALID_ANALYSIS, onStream),
    });

    const response = await request(app)
      .post('/api/analyze')
      .send({ transcript: 'x'.repeat(20_000) })
      .expect(413);

    expect(response.body.error).toBe('Pyyntö on liian suuri.');
    expect(onStream).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without invoking the model', async () => {
    const onStream = vi.fn();
    const app = createTestApp({
      anthropicClient: createAnthropicClient(VALID_ANALYSIS, onStream),
    });

    const response = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .send('{"transcript":')
      .expect(400);

    expect(response.body.error).toBe('Virheellinen JSON-pyyntö.');
    expect(onStream).not.toHaveBeenCalled();
  });

  it('returns 503 before opening SSE when the model client is unavailable', async () => {
    const response = await request(
      createTestApp({ anthropicClient: null })
    )
      .post('/api/analyze')
      .send({ transcript: 'Asiakas kysyy toimitusajasta.' })
      .expect(503);

    expect(response.type).toBe('application/json');
    expect(response.body.error).toBe('Analyysipalvelu ei ole käytettävissä.');
  });

  it('validates the model tool response and preserves the SSE event contract', async () => {
    const onStream = vi.fn();
    const app = createTestApp({
      anthropicClient: createAnthropicClient(VALID_ANALYSIS, onStream),
    });

    const response = await request(app)
      .post('/api/analyze')
      .set('Last-Event-ID', '7')
      .send({ transcript: '  Asiakas kysyy toimitusajasta.  ' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    expect(response.text).toContain('id: 8\nevent: analyzing');
    expect(response.text).toContain('event: hint');
    expect(response.text).toContain('event: meter');
    expect(response.text).toContain('event: cars');
    expect(response.text).toContain('event: done');
    expect(response.text).not.toContain('event: error');
    expect(onStream).toHaveBeenCalledOnce();
    expect(onStream.mock.calls[0][0].messages[0].content).toBe(
      'Asiakas kysyy toimitusajasta.'
    );
    expect(onStream.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('fails closed on malformed model output without leaking it to the client', async () => {
    const secretModelText = 'DO-NOT-LEAK-' + 'x'.repeat(600);
    const logger = createLogger();
    const app = createTestApp({
      anthropicClient: createAnthropicClient({
        ...VALID_ANALYSIS,
        hints: [{ ...VALID_ANALYSIS.hints[0], text: secretModelText }],
      }),
      logger,
    });

    const response = await request(app)
      .post('/api/analyze')
      .send({ transcript: 'Asiakas kysyy toimitusajasta.' })
      .expect(200);

    expect(response.text).toContain('event: error');
    expect(response.text).toContain('MODEL_OUTPUT_INVALID');
    expect(response.text).not.toContain(secretModelText);
    expect(logger.error).toHaveBeenCalledWith(
      'analysis_failed',
      expect.objectContaining({ code: 'MODEL_OUTPUT_INVALID' })
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretModelText);
  });

  it('aborts a slow provider call at the configured deadline', async () => {
    let observedSignal;
    const anthropicClient = {
      messages: {
        stream(_body, options) {
          observedSignal = options.signal;
          return {
            finalMessage() {
              return new Promise((_resolve, reject) => {
                options.signal.addEventListener(
                  'abort',
                  () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                  },
                  { once: true }
                );
              });
            },
          };
        },
      },
    };

    const response = await request(
      createTestApp({
        anthropicClient,
        config: { ...BASE_CONFIG, analysisTimeoutMs: 20 },
      })
    )
      .post('/api/analyze')
      .send({ transcript: 'Asiakas kysyy toimitusajasta.' })
      .expect(200);

    expect(observedSignal.aborted).toBe(true);
    expect(response.text).toContain('event: error');
    expect(response.text).toContain('ANALYSIS_TIMEOUT');
    expect(response.text).toContain('Analyysi aikakatkaistiin.');
  });

  it('rate limits analysis calls per process and returns 429', async () => {
    const app = createApp({
      anthropicClient: createAnthropicClient(),
      config: { ...BASE_CONFIG, rateLimitMax: 1 },
      logger: createLogger(),
    });

    await request(app)
      .post('/api/analyze')
      .send({ transcript: 'Ensimmäinen sallittu analyysipyyntö.' })
      .expect(200);

    const response = await request(app)
      .post('/api/analyze')
      .send({ transcript: 'Toinen liian nopea analyysipyyntö.' })
      .expect(429);

    expect(response.body.error).toContain('Liian monta analyysipyyntöä');
    expect(response.headers.ratelimit).toBeDefined();
  });

  it('validates vehicle lookup input before accessing mock data', async () => {
    const invalid = await request(createTestApp())
      .get('/api/vehicle/not-a-plate')
      .expect(400);
    expect(invalid.body.error).toBe('Virheellinen rekisterinumero.');

    const valid = await request(createTestApp())
      .get('/api/vehicle/abc-123')
      .expect(200);
    expect(valid.body).toMatchObject({
      plate: 'ABC-123',
      make: 'Volkswagen',
    });
  });
});

describe('server.js createAnthropicClient (ANALYSIS_ENABLED gate)', () => {
  it('never constructs a client when analysis is disabled, even with a key present', () => {
    expect(
      buildAnthropicClient({ analysisEnabled: false, anthropicApiKey: '' })
    ).toBeNull();

    // The key being present in the environment must not matter on its own -
    // only analysisEnabled decides whether a client is built.
    expect(
      buildAnthropicClient({
        analysisEnabled: false,
        anthropicApiKey: 'leftover-or-pre-provisioned-key',
      })
    ).toBeNull();
  });

  it('constructs a real client when analysis is enabled with a key', () => {
    const client = buildAnthropicClient({
      analysisEnabled: true,
      anthropicApiKey: 'test-key',
    });

    expect(client).not.toBeNull();
    expect(client.messages).toBeDefined();
  });
});

describe('Safe Render bootstrap: ANALYSIS_ENABLED=false end to end', () => {
  // A synthetic but otherwise real production environment - exactly the
  // shape of env vars the Render bootstrap (render.yaml) sets, with no
  // ANTHROPIC_API_KEY. Fed through the actual readRuntimeConfig() rather
  // than a hand-built config object, so this test exercises the real
  // parsing/validation path (NODE_ENV=production, the ALLOWED_ORIGIN
  // requirement, ANALYSIS_ENABLED's own parsing) and would fail if that
  // path ever stopped producing a startable, analysis-disabled config.
  const DISABLED_ANALYSIS_PRODUCTION_ENV = {
    NODE_ENV: 'production',
    ALLOWED_ORIGIN: 'https://demo.example',
    ANALYSIS_ENABLED: 'false',
    ANTHROPIC_TIMEOUT_MS: '5000',
    ANALYZE_RATE_LIMIT_MAX: '10',
    PORT: '3001',
    // Deliberately absent: ANTHROPIC_API_KEY - this is exactly the
    // production-bootstrap-with-analysis-off case under test.
  };

  // Mirrors exactly what startServer() itself wires up: readRuntimeConfig()
  // on a real env object, then server.js's own createAnthropicClient(config)
  // feeding createApp() - no hand-built config or stub standing in for
  // either step.
  function createDisabledAnalysisApp() {
    const config = readRuntimeConfig(DISABLED_ANALYSIS_PRODUCTION_ENV);
    return createApp({
      anthropicClient: buildAnthropicClient(config),
      config,
      analysisLimiter: noLimit,
      logger: createLogger(),
    });
  }

  it('serves /health and vehicle lookup normally with analysis disabled', async () => {
    const app = createDisabledAnalysisApp();

    const health = await request(app).get('/health').expect(200);
    expect(health.body.status).toBe('ok');

    const lookup = await request(app).get('/api/vehicle/ABC-123').expect(200);
    expect(lookup.body).toMatchObject({ plate: 'ABC-123', make: 'Volkswagen' });
  });

  it('/api/analyze returns the managed 503 without ever invoking a provider', async () => {
    const app = createDisabledAnalysisApp();

    const response = await request(app)
      .post('/api/analyze')
      .send({ transcript: 'Asiakas kysyy toimitusajasta.' })
      .expect(503);

    expect(response.type).toBe('application/json');
    expect(response.body.error).toBe('Analyysipalvelu ei ole käytettävissä.');
    // No anthropicClient was ever constructed for this app (analysisEnabled
    // is false) - there is no provider object in existence to have been
    // called, not merely one that returned unused.
  });
});
