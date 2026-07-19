'use strict';

const { DomainValidationError } = require('./money');

const SESSION_STATUS = Object.freeze({
  OPEN: 'OPEN',
  ACCEPTED: 'ACCEPTED',
  ESCALATED: 'ESCALATED',
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
});

function createSession({ id, tenantId, vehicleId, policyVersion, inventoryRevision, createdAt }) {
  for (const [field, value] of Object.entries({ id, tenantId, vehicleId, policyVersion, inventoryRevision, createdAt })) {
    if (typeof value !== 'string' || !value) throw new DomainValidationError(`${field} is required`, field);
  }
  return {
    id,
    tenantId,
    vehicleId,
    policyVersion,
    inventoryRevision,
    status: SESSION_STATUS.OPEN,
    version: 1,
    nextRound: 1,
    decisions: [],
    processedCommands: {},
    createdAt,
    updatedAt: createdAt,
  };
}

function recordDecision(session, { commandId, decisionId, offerAmount, currency, decision, occurredAt }) {
  assertOpen(session);
  if (session.processedCommands[commandId]) return session;
  return {
    ...session,
    status: statusAfterDecision(decision.status),
    version: session.version + 1,
    nextRound: session.nextRound + 1,
    updatedAt: occurredAt,
    decisions: [...session.decisions, { decisionId, commandId, offerAmount, currency, ...decision, occurredAt }],
    processedCommands: { ...session.processedCommands, [commandId]: decisionId },
  };
}

function transitionSession(session, status, occurredAt) {
  assertOpen(session);
  if (![SESSION_STATUS.ESCALATED, SESSION_STATUS.CANCELLED].includes(status)) {
    throw new DomainValidationError('Unsupported session transition', 'status');
  }
  return { ...session, status, version: session.version + 1, updatedAt: occurredAt };
}

function assertOpen(session) {
  if (session.status !== SESSION_STATUS.OPEN) {
    const error = new Error(`Negotiation session is ${session.status}`);
    error.code = 'SESSION_NOT_OPEN';
    throw error;
  }
}

function statusAfterDecision(status) {
  if (status === 'ACCEPT') return SESSION_STATUS.ACCEPTED;
  if (status === 'ESCALATE') return SESSION_STATUS.ESCALATED;
  return SESSION_STATUS.OPEN;
}

module.exports = { SESSION_STATUS, createSession, recordDecision, transitionSession };
