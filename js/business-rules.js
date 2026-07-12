/**
 * Deterministic business-rules layer: signals in, {purchaseIntent, confidence,
 * recommendedVehicles} out. This is the layer between Claude's structured
 * output and the UI — nothing here is an LLM call, everything is a plain,
 * reproducible function of the signals already collected.
 *
 * Confidence is a deterministic score calculated by the application from the
 * quantity, consistency and quality of detected customer signals. It is NOT
 * the language model's self-reported confidence.
 */

import { getTopMatches } from './inventory-engine.js';

// Signal-type pairs that reinforce each other — seeing both together is
// stronger evidence of a coherent, advancing conversation than either alone.
const REINFORCING_PAIRS = [
  ['financing', 'purchase_ready'],
  ['trade_in', 'purchase_ready'],
  ['family', 'purchase_ready'],
  ['trade_in', 'financing'],
];

function hasType(signals, type) {
  return signals.some(s => s.type === type);
}

function countByType(signals, type) {
  return signals.filter(s => s.type === type).length;
}

/**
 * confidence = signalCount*weight + consistency + conversationLength - contradictions
 *
 * - signalCount: number of distinct signals collected so far (capped — a 9th
 *   signal shouldn't keep moving the needle as much as the 2nd did).
 * - weight: average per-signal weight (Signal.weight; Claude-sourced signals
 *   are 1.0, offline regex-fallback signals are 0.7 — see signals.js).
 * - consistency: capped bonus per known reinforcing signal-type pair that
 *   co-occurs (e.g. financing + purchase_ready appearing together).
 * - conversationLength: word count, scaled and capped — a longer exchange
 *   gives more opportunity to surface genuine evidence, but this term alone
 *   should never dominate the score.
 * - contradictions: a plain, honestly-scoped proxy (this signal taxonomy has
 *   no natural opposing pairs, e.g. no "wants_to_buy" vs "wants_to_leave"):
 *   penalize when price-sensitivity signals dominate with no other signal
 *   type ever showing up, i.e. repeated hesitation with nothing resolving it.
 */
export function computeConfidence(signals, transcriptWordCount = 0) {
  if (!signals.length) return 0;

  const signalCount = Math.min(signals.length, 8);
  const avgWeight = signals.reduce((sum, s) => sum + s.weight, 0) / signals.length;

  let consistency = 0;
  for (const [a, b] of REINFORCING_PAIRS) {
    if (hasType(signals, a) && hasType(signals, b)) consistency += 3;
  }
  consistency = Math.min(consistency, 15);

  const conversationLength = Math.min(transcriptWordCount / 20, 10);

  const priceOnly = countByType(signals, 'price_sensitivity');
  const distinctTypes = new Set(signals.map(s => s.type)).size;
  const contradictions = (priceOnly >= 3 && distinctTypes === 1) ? 10 : 0;

  const raw = signalCount * avgWeight * 8 + consistency + conversationLength - contradictions;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Purchase Intent is intentionally a pass-through, not a second competing
 * formula. Spec explicitly requires purchase-intent logic to stay unchanged
 * (the existing SSE METER: value / local regex-fallback heuristic already
 * computes it) — this function is the single normalizing call site so both
 * gauges update from one place, without inventing a second number that could
 * drift out of sync with what the AI panel already streams.
 */
export function computePurchaseIntent(currentValue) {
  return currentValue;
}

export async function recommendVehicles(signals) {
  return getTopMatches(signals, 3);
}

export async function runBusinessRules({ signals, transcriptWordCount, meterValue }) {
  return {
    purchaseIntent: computePurchaseIntent(meterValue),
    confidence: computeConfidence(signals, transcriptWordCount),
    recommendedVehicles: await recommendVehicles(signals),
  };
}
