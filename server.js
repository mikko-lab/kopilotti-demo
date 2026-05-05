const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS']
}));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Olet autokaupan myyntiassistentin AI. Analysoi myyntikeskustelun transkriptio.

TÄRKEÄÄ: Tulosta VAIN seuraavat rivit tässä järjestyksessä, ei muuta tekstiä:

HINT:{"type":"green|blue|yellow|red","icon":"emoji","title":"ISOLLA","text":"konkreettinen ohje","action":"nappi teksti"}
METER:{"value":0-100,"desc":"lyhyt kuvaus tilanteesta"}
CARS:[1,2,3]

Säännöt:
- Anna 1–3 HINT-riviä relevanttien signaalien perusteella
- type: green=mahdollisuus, blue=informaatio, yellow=varoitus, red=kiireellinen
- METER value arvioi ostohalukkuus 0–100
- CARS lista 1–3 sopivimmista: 1=Volvo XC60 B4 AWD (34900€), 2=Toyota RAV4 Hybrid (28900€), 3=Skoda Octavia Combi (21900€), 4=VW Passat Variant (17500€), 5=BMW 320d Touring (29500€), 6=Ford Kuga PHEV (27900€)
- Kirjoita suomeksi, ole konkreettinen
- EI selityksiä, EI muuta tekstiä`;

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
    const stream = anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript }]
    });

    let buffer = '';

    const flush = (line) => {
      const t = line.trim();
      if (t.startsWith('HINT:')) {
        try { send('hint', JSON.parse(t.slice(5))); } catch (_) {}
      } else if (t.startsWith('METER:')) {
        try { send('meter', JSON.parse(t.slice(6))); } catch (_) {}
      } else if (t.startsWith('CARS:')) {
        try { send('cars', JSON.parse(t.slice(5))); } catch (_) {}
      }
    };

    stream.on('text', (text) => {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(flush);
    });

    await stream.finalMessage();
    if (buffer) flush(buffer);
    send('done', {});
  } catch (err) {
    send('error', { message: 'Analysointi epäonnistui' });
  }

  res.end();
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(port, () => console.log(`Kopilotti backend :${port}`));
