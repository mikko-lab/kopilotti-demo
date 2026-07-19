const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { createNegotiationService } = require('./src/bootstrap');
const { createNegotiationRouter } = require('./src/http/negotiation-routes');
const { negotiationErrorHandler } = require('./src/http/http-response');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS']
}));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Backend-only negotiation boundary. It is intentionally independent of
// browser session state and is never passed to the Claude analysis prompt.
app.use('/api/negotiations', createNegotiationRouter(createNegotiationService()));

const SYSTEM_PROMPT = `Olet autokaupan myyntiassistentin AI. Analysoi myyntikeskustelun transkriptio.

Kutsu AINA emit_analysis-työkalua vastauksenasi ja täytä sen kentät analyysisi perusteella. Älä vastaa pelkällä tekstillä.

Säännöt:
- Anna 1–3 hintiä relevanttien signaalien perusteella
- type: green=mahdollisuus, blue=informaatio, yellow=varoitus, red=kiireellinen
- meter.value arvioi ostohalukkuus 0–100
- cars: lista 1–3 sopivimmista (kaikki ovat KÄYTETTYJÄ autoja): 1=Volvo XC60 B4 AWD -21 (34900€), 2=Toyota RAV4 Hybrid -20 (28900€), 3=Skoda Octavia Combi -22 (21900€), 4=VW Passat Variant -19 (17500€), 5=BMW 320d Touring -21 (29500€), 6=Ford Kuga PHEV -22 (27900€)
- Myyntikatalogiin kuuluu myös pakettiautoja (N1-luokka, esim. VW Transporter, Mercedes Sprinter, Renault Trafic, Citroën Berlingo) — nämä ovat ALV-vähennyskelpoisia liiketoimintakäytön ja ajopäiväkirjan perusteella, toisin kuin henkilöautot
- Kirjoita suomeksi, ole konkreettinen`;

// Structured-output schema for the forced tool call below. Replaces the old
// HINT:/METER:/CARS: line-prefix text protocol entirely — the shape here
// (hints/meter/cars) is deliberately identical to what that protocol used
// to carry, just expressed as a JSON Schema instead of a prompt instruction
// Claude could deviate from.
const EMIT_ANALYSIS_TOOL = {
  name: 'emit_analysis',
  description: 'Palauta strukturoitu myyntianalyysi transkriptiosta: 1-3 myyntivihjettä, ostohalukkuusmittari ja suositellut autot.',
  input_schema: {
    type: 'object',
    properties: {
      hints: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['green', 'blue', 'yellow', 'red'] },
            icon: { type: 'string', description: 'Yksi emoji' },
            title: { type: 'string', description: 'Lyhyt otsikko ISOLLA' },
            text: { type: 'string', description: 'Konkreettinen ohje myyjälle' },
            action: { type: 'string', description: 'Lyhyt nappiteksti' },
          },
          required: ['type', 'icon', 'title', 'text', 'action'],
        },
      },
      meter: {
        type: 'object',
        properties: {
          value: { type: 'number', minimum: 0, maximum: 100, description: 'Ostohalukkuus 0-100' },
          desc: { type: 'string', description: 'Lyhyt kuvaus tilanteesta' },
        },
        required: ['value', 'desc'],
      },
      cars: {
        type: 'array',
        items: { type: 'integer', minimum: 1, maximum: 6 },
        description: '1-3 sopivimman auton ID:t yllä olevasta autolistasta',
      },
    },
    required: ['hints', 'meter', 'cars'],
  },
};

app.post('/api/analyze', async (req, res) => {
  const transcript = (req.body.transcript || '').trim();
  if (!transcript) return res.status(400).json({ error: 'Transcript required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let eventId = parseInt(req.headers['last-event-id'] || '0');
  const send = (type, data) => {
    res.write(`id: ${++eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('analyzing', { status: 'started' });

  try {
    // Structured output via forced tool use (tool_choice), not the old free-
    // text HINT:/METER:/CARS: line protocol: Claude MUST call emit_analysis
    // with input conforming to EMIT_ANALYSIS_TOOL's schema, so there is no
    // longer a "line didn't match the prefix" or "JSON.parse threw" failure
    // mode to hit in normal operation.
    //
    // Streaming choice: the tool's input arrives as ONE JSON object rather
    // than the old line-by-line stream, so this deliberately waits for the
    // complete tool_use block via stream.finalMessage() instead of emitting
    // hint/meter/cars incrementally off the SDK's input_json_delta events.
    // max_tokens is only 512 (a handful of short strings), so the
    // wait-for-complete-object latency is well under a second in practice —
    // not worth the added complexity and fragility of parsing partial JSON
    // mid-object for that saving. If sub-second incremental hint delivery
    // is ever needed, `stream.on('inputJson', ...)` (or the raw
    // input_json_delta stream events) could parse hints out as they
    // complete without changing the SSE contract below.
    const stream = anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      // 512 was enough for the old terse HINT:/METER:/CARS: line protocol,
      // but the structured tool_use JSON output (full hint objects with
      // type/icon/title/text/action per hint, plus meter+cars) is
      // consistently larger — verified against the real API to hit
      // stop_reason:'max_tokens' at 512 with only 2/3 fields emitted before
      // truncation. 1024 leaves headroom (observed 449-527 output tokens
      // for typical 1-3 hint responses) without the schema's `required`
      // fields silently disappearing off the end of a cut-off response.
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [EMIT_ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_analysis' },
      messages: [{ role: 'user', content: transcript }],
    });

    const finalMessage = await stream.finalMessage();
    const toolUse = finalMessage.content.find(
      (block) => block.type === 'tool_use' && block.name === 'emit_analysis'
    );

    if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
      throw new Error('Claude ei palauttanut emit_analysis-tool_use-lohkoa');
    }

    const { hints, meter, cars } = toolUse.input;

    if (!Array.isArray(hints) || hints.length === 0) {
      throw new Error('emit_analysis.hints puuttuu tai on tyhjä: ' + JSON.stringify(toolUse.input));
    }
    if (!meter || typeof meter.value !== 'number') {
      throw new Error('emit_analysis.meter puuttuu tai on virheellinen: ' + JSON.stringify(toolUse.input));
    }

    // Outward SSE contract is unchanged: 'hint' fires once per hint object,
    // 'meter' carries {value, desc}, 'cars' carries the array — identical to
    // what the old line-prefix protocol sent, so js/app.js's
    // handleSSEEvent() needs no changes.
    hints.forEach((hint) => send('hint', hint));
    send('meter', meter);
    send('cars', Array.isArray(cars) ? cars : []);
    send('done', {});
  } catch (err) {
    // No silent catches: every failure path here (missing/malformed
    // tool_use, SDK/network exception) is logged server-side AND surfaced
    // to the client as an 'error' SSE event, same as the pre-existing
    // stream-level error handling this replaces.
    console.error('Analyysi epäonnistui:', err);
    send('error', { message: 'Analysointi epäonnistui' });
  }

  res.end();
});

// Rekisterinumerohaku — MVP-mock, ei oikeaa Traficom-integraatiota.
// Merkki/malli/vuosimalli on ainoa tietoluokka jonka voi hakea Traficomin
// avoimesta tietopalvelusta ilman erillistä kaupallista sopimusta
// (omistajatieto vaatii oikeutetun edun perustelun ja usein maksullisen
// tietopalvelusopimuksen). mileage/estimatedTradeInValue ovat demo-mockia —
// samaa tapaa kuin muukin mock-data tässä sovelluksessa (autojen hinnat,
// rahoituslaskelmat) — ei mitään Traficomin tarjoamaa tietoa.
//
// ABC-123:n arvot on tarkoituksella sovitettu yhteen "vaihto"-demoskenaarion
// (js/app.js) omien lukujen kanssa (Passat -17, ~140 000 km, markkina-arvo
// 9 500-11 500 €, aloitushinta 9 800 €), jotta kumpikin demo-polku — canned
// scenario ja oikea rekisterihaku — kertovat saman tarinan eivätkä ole
// ristiriidassa jos molempia käytetään samassa esittelyssä.
const MOCK_VEHICLES = {
  'ABC-123': { make: 'Volkswagen', model: 'Passat Variant', year: 2017, mileage: 140000, estimatedTradeInValue: 9800 },
  'XYZ-789': { make: 'Toyota', model: 'Avensis', year: 2015, mileage: 186000, estimatedTradeInValue: 6200 },
  'KLM-456': { make: 'Skoda', model: 'Octavia Combi', year: 2019, mileage: 78000, estimatedTradeInValue: 15400 },
  'DEF-321': { make: 'Volvo', model: 'V60', year: 2018, mileage: 112000, estimatedTradeInValue: 13900 },
};

app.get('/api/vehicle/:plate', (req, res) => {
  const plate = req.params.plate.trim().toUpperCase();
  const vehicle = MOCK_VEHICLES[plate];
  if (!vehicle) {
    return res.status(404).json({
      error: 'Ajoneuvoa ei löytynyt. Demo-rekisterinumerot: ABC-123, XYZ-789, KLM-456, DEF-321'
    });
  }
  res.json({ plate, ...vehicle });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.use(negotiationErrorHandler);

app.listen(port, () => console.log(`Kopilotti backend :${port}`));
