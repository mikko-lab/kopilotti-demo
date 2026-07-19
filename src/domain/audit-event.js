'use strict';

const crypto = require('node:crypto');

const GENESIS_HASH = '0'.repeat(64);

function createAuditEvent(input, previousEvent) {
  const event = {
    sequence: previousEvent ? previousEvent.sequence + 1 : 0,
    eventId: input.eventId,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    eventType: input.eventType,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: structuredClone(input.payload),
    previousHash: previousEvent ? previousEvent.hash : GENESIS_HASH,
  };
  return Object.freeze({ ...event, hash: hashAuditEvent(event) });
}

function hashAuditEvent(eventWithoutHash) {
  return crypto.createHash('sha256').update(canonicalize(eventWithoutHash)).digest('hex');
}

function verifyAuditChain(events) {
  let previous = null;
  for (const event of events) {
    const { hash, ...unsigned } = event;
    const expectedPreviousHash = previous ? previous.hash : GENESIS_HASH;
    if (event.previousHash !== expectedPreviousHash || hashAuditEvent(unsigned) !== hash) return false;
    previous = event;
  }
  return true;
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

module.exports = { GENESIS_HASH, createAuditEvent, verifyAuditChain };
