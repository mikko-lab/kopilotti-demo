/**
 * Hash-chained, append-only audit log — same principle as the
 * ai-transparency-gate proto's auditLog.ts: every entry commits to the
 * SHA-256 hash of the previous entry, so a tampered or deleted entry breaks
 * the chain and is detectable by verifyChain(). Used here to make the
 * customer consent step (see giveConsent()/denyConsent() in app.js)
 * provable after the fact, rather than a plain "consent recorded" toast
 * that asserts something no one can actually verify happened.
 */

const GENESIS_HASH = '0'.repeat(64);

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Deterministic JSON stringification so hashing doesn't depend on key insertion order.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',');
  return `{${body}}`;
}

export class HashChainedAuditLog {
  #entries = [];

  async append(input) {
    const prevHash = this.#entries.length > 0 ? this.#entries[this.#entries.length - 1].hash : GENESIS_HASH;
    const draft = {
      seq: this.#entries.length,
      timestamp: new Date().toISOString(),
      eventType: input.eventType,
      stage: input.stage,
      verdict: input.verdict,
      payload: input.payload,
      prevHash,
    };
    const hash = await sha256Hex(canonicalize(draft));
    const record = { ...draft, hash };
    this.#entries.push(record);
    return record;
  }

  getEntries() {
    return this.#entries;
  }

  toJSON() {
    return JSON.stringify(this.#entries, null, 2);
  }

  /** Recomputes every hash from the raw fields and checks the prevHash linkage. */
  async verifyChain() {
    let expectedPrevHash = GENESIS_HASH;
    for (const entry of this.#entries) {
      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, checkedEntries: entry.seq, brokenAtSeq: entry.seq, reason: `prevHash mismatch at seq ${entry.seq}` };
      }
      const { hash, ...rest } = entry;
      const recomputed = await sha256Hex(canonicalize(rest));
      if (recomputed !== hash) {
        return { valid: false, checkedEntries: entry.seq, brokenAtSeq: entry.seq, reason: `hash mismatch at seq ${entry.seq}: entry content was edited after the fact` };
      }
      expectedPrevHash = entry.hash;
    }
    return { valid: true, checkedEntries: this.#entries.length };
  }
}
