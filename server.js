const { randomUUID } = require('node:crypto');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const {
  ANALYSIS_SCHEMA,
  ANALYZE_REQUEST_SCHEMA,
  EMIT_ANALYSIS_TOOL,
  validationIssueSummary,
} = require('./lib/analysis-contract');
const { readRuntimeConfig } = require('./lib/runtime-config');

const JSON_BODY_LIMIT = '16kb';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PLATE_PATTERN = /^[A-Z]{2,3}-[0-9]{1,3}$/;

const SYSTEM_PROMPT = `Olet autokaupan myyntiassistentin AI. Analysoi myyntikeskustelun transkriptio.

Kutsu AINA emit_analysis-työkalua vastauksenasi ja täytä sen kentät analyysisi perusteella. Älä vastaa pelkällä tekstillä.

Säännöt:
- Anna 1–3 hintiä relevanttien signaalien perusteella
- type: green=mahdollisuus, blue=informaatio, yellow=varoitus, red=kiireellinen
- meter.value arvioi ostohalukkuus 0–100
- cars: lista 1–3 sopivimmista (kaikki ovat KÄYTETTYJÄ autoja): 1=Volvo XC60 B4 AWD -21 (34900€), 2=Toyota RAV4 Hybrid -20 (28900€), 3=Skoda Octavia Combi -22 (21900€), 4=VW Passat Variant -19 (17500€), 5=BMW 320d Touring -21 (29500€), 6=Ford Kuga PHEV -22 (27900€)
- Myyntikatalogiin kuuluu myös pakettiautoja (N1-luokka, esim. VW Transporter, Mercedes Sprinter, Renault Trafic, Citroën Berlingo) — nämä ovat ALV-vähennyskelpoisia liiketoimintakäytön ja ajopäiväkirjan perusteella, toisin kuin henkilöautot
- Kirjoita suomeksi, ole konkreettinen`;

// Rekisterinumerohaku on MVP-mock, ei oikea Traficom-integraatio.
const MOCK_VEHICLES = {
  'ABC-123': {
    make: 'Volkswagen',
    model: 'Passat Variant',
    year: 2017,
    mileage: 140000,
    estimatedTradeInValue: 9800,
  },
  'XYZ-789': {
    make: 'Toyota',
    model: 'Avensis',
    year: 2015,
    mileage: 186000,
    estimatedTradeInValue: 6200,
  },
  'KLM-456': {
    make: 'Skoda',
    model: 'Octavia Combi',
    year: 2019,
    mileage: 78000,
    estimatedTradeInValue: 15400,
  },
  'DEF-321': {
    make: 'Volvo',
    model: 'V60',
    year: 2018,
    mileage: 112000,
    estimatedTradeInValue: 13900,
  },
};

function normalizeRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
    ? value
    : randomUUID();
}

function parseLastEventId(value) {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function createCorsMiddleware(allowedOrigins) {
  const allowlist = new Set(allowedOrigins);

  return cors({
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Last-Event-ID', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'RateLimit', 'RateLimit-Policy'],
    origin(origin, callback) {
      // Requests without Origin are server-to-server or same-origin requests.
      if (!origin || allowlist.has(origin)) return callback(null, true);

      const error = new Error('Origin is not allowed');
      error.statusCode = 403;
      error.code = 'ORIGIN_NOT_ALLOWED';
      return callback(error);
    },
  });
}

function createAnalysisLimiter(config) {
  return rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(req, res, _next, options) {
      res.status(options.statusCode).json({
        error: 'Liian monta analyysipyyntöä. Yritä hetken kuluttua uudelleen.',
        requestId: req.id,
      });
    },
  });
}

function createApp({
  anthropicClient = null,
  config = readRuntimeConfig(),
  analysisLimiter,
  logger = console,
} = {}) {
  const app = express();
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use((req, res, next) => {
    req.id = normalizeRequestId(req.get('x-request-id'));
    res.setHeader('X-Request-ID', req.id);
    next();
  });
  app.use(createCorsMiddleware(config.allowedOrigins));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.post(
    '/api/analyze',
    analysisLimiter || createAnalysisLimiter(config),
    async (req, res) => {
      const requestResult = ANALYZE_REQUEST_SCHEMA.safeParse(req.body);
      if (!requestResult.success) {
        return res.status(400).json({
          error: 'Virheellinen analyysipyyntö.',
          requestId: req.id,
        });
      }

      if (!anthropicClient) {
        return res.status(503).json({
          error: 'Analyysipalvelu ei ole käytettävissä.',
          requestId: req.id,
        });
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let eventId = parseLastEventId(req.get('last-event-id'));
      const send = (type, data) => {
        if (res.destroyed || res.writableEnded) return false;
        eventId += 1;
        res.write(
          `id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`
        );
        return true;
      };

      const controller = new AbortController();
      let clientDisconnected = false;
      let timeoutTriggered = false;
      const abortForDisconnect = () => {
        if (res.writableEnded) return;
        clientDisconnected = true;
        controller.abort();
      };
      const timeout = setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
      }, config.analysisTimeoutMs);

      req.once('aborted', abortForDisconnect);
      res.once('close', abortForDisconnect);
      send('analyzing', { status: 'started', requestId: req.id });

      try {
        const stream = anthropicClient.messages.stream(
          {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            tools: [EMIT_ANALYSIS_TOOL],
            tool_choice: { type: 'tool', name: 'emit_analysis' },
            messages: [
              { role: 'user', content: requestResult.data.transcript },
            ],
          },
          { signal: controller.signal }
        );

        const finalMessage = await stream.finalMessage();
        const toolUse = Array.isArray(finalMessage?.content)
          ? finalMessage.content.find(
              (block) =>
                block?.type === 'tool_use' && block.name === 'emit_analysis'
            )
          : undefined;

        const analysisResult = ANALYSIS_SCHEMA.safeParse(toolUse?.input);
        if (!analysisResult.success) {
          const error = new Error('Model output failed runtime validation');
          error.code = 'MODEL_OUTPUT_INVALID';
          error.validationSummary = validationIssueSummary(analysisResult.error);
          throw error;
        }

        const { hints, meter, cars } = analysisResult.data;
        hints.forEach((hint) => send('hint', hint));
        send('meter', meter);
        send('cars', cars);
        send('done', {});
      } catch (error) {
        const code = timeoutTriggered
          ? 'ANALYSIS_TIMEOUT'
          : clientDisconnected
            ? 'CLIENT_DISCONNECTED'
            : error?.code === 'MODEL_OUTPUT_INVALID'
              ? 'MODEL_OUTPUT_INVALID'
              : 'ANALYSIS_FAILED';

        logger.error('analysis_failed', {
          requestId: req.id,
          code,
          errorName: error?.name || 'Error',
          validationSummary: error?.validationSummary,
          providerRequestId: error?.request_id,
        });

        if (!clientDisconnected) {
          send('error', {
            code,
            message:
              code === 'ANALYSIS_TIMEOUT'
                ? 'Analyysi aikakatkaistiin. Yritä uudelleen.'
                : 'Analysointi epäonnistui.',
            requestId: req.id,
          });
        }
      } finally {
        clearTimeout(timeout);
        req.off('aborted', abortForDisconnect);
        res.off('close', abortForDisconnect);
        if (!res.writableEnded && !res.destroyed) res.end();
      }
    }
  );

  app.get('/api/vehicle/:plate', (req, res) => {
    const plate = String(req.params.plate || '').trim().toUpperCase();
    if (!PLATE_PATTERN.test(plate)) {
      return res.status(400).json({
        error: 'Virheellinen rekisterinumero.',
        requestId: req.id,
      });
    }

    const vehicle = MOCK_VEHICLES[plate];
    if (!vehicle) {
      return res.status(404).json({
        error:
          'Ajoneuvoa ei löytynyt. Demo-rekisterinumerot: ABC-123, XYZ-789, KLM-456, DEF-321',
        requestId: req.id,
      });
    }

    return res.json({ plate, ...vehicle });
  });

  app.get('/health', (req, res) =>
    res.json({ status: 'ok', requestId: req.id })
  );

  app.use((error, req, res, _next) => {
    if (res.headersSent) return res.end();

    if (error?.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'Pyyntö on liian suuri.',
        requestId: req.id,
      });
    }

    if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) {
      return res.status(400).json({
        error: 'Virheellinen JSON-pyyntö.',
        requestId: req.id,
      });
    }

    if (error?.code === 'ORIGIN_NOT_ALLOWED') {
      return res.status(403).json({
        error: 'Origin ei ole sallittu.',
        requestId: req.id,
      });
    }

    logger.error('request_failed', {
      requestId: req.id,
      errorName: error?.name || 'Error',
    });
    return res.status(500).json({
      error: 'Palvelinvirhe.',
      requestId: req.id,
    });
  });

  return app;
}

// The ONLY place an Anthropic client is ever constructed. Gated on
// config.analysisEnabled, not merely on whether a key happens to be present
// - readRuntimeConfig() already guarantees a key exists whenever
// analysisEnabled is true, but this function's own job is to guarantee the
// converse just as strictly: analysisEnabled=false must never construct a
// client, even if ANTHROPIC_API_KEY is set in the environment (e.g. left
// over from a previous configuration, or set ahead of a deliberate future
// enable). No network call happens here either way - constructing an
// Anthropic client is local object setup, not a request.
function createAnthropicClient(config) {
  if (!config.analysisEnabled) return null;
  return new Anthropic({ apiKey: config.anthropicApiKey });
}

function startServer({ env = process.env, logger = console } = {}) {
  const config = readRuntimeConfig(env);
  const anthropicClient = createAnthropicClient(config);
  const app = createApp({ anthropicClient, config, logger });

  return app.listen(config.port, '0.0.0.0', () => {
    logger.log(`Kopilotti backend listening on 0.0.0.0:${config.port}`);
  });
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error('Backend startup failed:', error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  MOCK_VEHICLES,
  createAnthropicClient,
  createApp,
  startServer,
};
