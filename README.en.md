**English** | [Suomi](README.md)

# Kopilotti — AI-assisted sales copilot for automotive retail

Kopilotti is a public concept demonstrator for real-time decision support in automotive sales. It recognizes buying signals in a customer conversation, surfaces useful next actions and matches the customer's needs with vehicles in a synthetic demo inventory.

## [🚀 Try the public demo](https://mikko-lab.github.io/kopilotti-demo/)

> **Current public state:** the frontend is live on GitHub Pages and the backend is live on Render. Paid Anthropic analysis is intentionally disabled (`ANALYSIS_ENABLED=false`). When model analysis is unavailable, the browser makes that visible and uses a local rules-based assessment.

> **Public repository boundary:** this repository contains the concept UI, a safety-hardened analysis contract, local assessment logic and synthetic demo data. It does not contain the private Kopilotti Sales decision engine, dealer-specific business rules, production credentials or real CRM/ERP integrations.

[![Kopilotti's Finnish-language interface showing a pasted customer conversation, buying intent and confidence, detected signals, sales hints and conversation-based vehicle recommendations](assets/screenshot.png)](https://mikko-lab.github.io/kopilotti-demo/)

> The interactive demonstrator is currently presented in Finnish. This README provides the equivalent product and technical overview in English.

## Why Kopilotti was created

Kopilotti builds on more than 20 years of experience in automotive retail. A large dealership group may have thousands of vehicles across several locations, making it impossible for any salesperson to remember the entire inventory and match it to every customer's needs during a call or messaging conversation.

Sales outcomes also depend on timely services beyond the vehicle itself, including financing, insurance and service plans. Kopilotti is designed to help the salesperson recognize the customer's situation and the next useful action — not to replace the salesperson or make commercial decisions on their behalf.

## What the public demo shows

- Explicit customer consent before conversation analysis
- Speech as well as pasted or typed text conversations
- Buying signals, purchase intent, confidence and contextual sales hints
- Rules-based matching against a synthetic inventory of 375 vehicles
- A demo CRM summary and integration events without real external writes
- Safe example-data vehicle lookup using `ABC-123`

## Current implementation state

| Component | Current state |
| --- | --- |
| Frontend | Live on GitHub Pages, Finnish-language and responsive |
| Backend | Live on Render; `/health` and demo vehicle lookup are available |
| Anthropic analysis | Intentionally disabled; the public blueprint contains no API key |
| Local assessment | Active as a visible fallback when model analysis is unavailable |
| CRM/ERP | UI and event demonstrator only; no real production integration |
| Data retention | Browser-session scope; the demo does not create a permanent or externally verifiable audit log |

## How it works

```text
Speech or written conversation
→ consent gate
→ model analysis or local rules-based assessment
→ recognized customer information and buying signals
→ vehicle recommendations, sales hints and demo CRM events
```

The backend validates both analysis requests and model responses against Zod schemas. Model output, user-provided text and vehicle data are rendered through safe DOM APIs without executing untrusted HTML.

## Security and privacy boundaries

- A conversation cannot be analyzed before explicit customer acceptance.
- Denial blocks the session, automatic analysis and backend analysis calls.
- Audio is not stored; browser speech-recognition availability varies by browser.
- The session consent log exists only in the open browser tab.
- The public demo does not write to a real CRM, ERP or WhatsApp system.
- Vehicles, people, conversations and integration events are synthetic demo data.
- CORS restrictions and a process-local rate limiter reduce abuse risk but do not replace authentication.

## Technology

Vanilla JavaScript · Web Speech API · Node.js 22.23.2 · Express · Server-Sent Events · Zod · Vitest · Render · GitHub Pages

## Try the demo

1. Open the [public demo](https://mikko-lab.github.io/kopilotti-demo/).
2. Select **✓ Asiakas hyväksyi**. The controls remain locked without consent.
3. Choose **Rahoitus**, **Perhe**, **Pakettiauto** or **WhatsApp**, or open **Liitä keskustelu** and use synthetic demo text only.
4. Follow purchase intent, confidence, signals and hints in the **Tekoälyn havainnot** card.
5. Review **Suositellut autot** and the reasons matched to the needs detected in the conversation.
6. Select **Synkronoi CRM:ään** and open **Integraation tapahtumat (JSON)** to inspect the demo state — no real CRM write is made.
7. Try **Rekisterihaku** with `ABC-123`.

## Local development

```bash
npm ci
npm run check:backend
npm test
npm run dev
```

Start the static frontend separately with `npm run dev:static`.

## Known limitations

- This is a concept demonstrator, not a production-ready system.
- Paid Anthropic analysis has not been enabled in the public environment.
- Speech recognition behaves differently across browsers.
- The public analysis endpoint is anonymous; CORS is not authentication.
- Rate limiting is process-local rather than shared across instances.
- Real CRM/ERP/WhatsApp integrations, production identity management, persistent auditing and an approved retention model remain separate production requirements.

---

*Created by [Mikko Tarkiainen](https://www.linkedin.com/in/mikko-tarkiainen-accessibility/)*

© 2026 Mikko Tarkiainen. MIT License. See [LICENSE](LICENSE).
