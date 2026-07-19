'use strict';

const { DomainValidationError } = require('./money');
const { sameReportIdentity } = require('./condition-report');

const PURCHASE_PATH = Object.freeze({ DIRECT: 'DIRECT_LIST_PRICE', NEGOTIATED: 'NEGOTIATED_PRICE' });
const PURCHASE_STATUS = Object.freeze({
  STARTED: 'PURCHASE_STARTED',
  REPORT_SERVED: 'REPORT_SERVED',
  REPORT_DISPLAYED: 'REPORT_DISPLAYED',
  REPORT_ACKNOWLEDGED: 'REPORT_ACKNOWLEDGED',
  PROCEEDING: 'PROCEEDING_TO_FINANCE_OR_PAYMENT',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
});

function createPurchaseSession({ id, tenantId, vehicleId, purchasePath, negotiationSessionId = null, createdAt }) {
  for (const [field, value] of Object.entries({ id, tenantId, vehicleId, createdAt })) requireString(value, field);
  if (!Object.values(PURCHASE_PATH).includes(purchasePath)) throw new DomainValidationError('Unsupported purchase path', 'purchasePath');
  if (purchasePath === PURCHASE_PATH.NEGOTIATED) requireString(negotiationSessionId, 'negotiationSessionId');
  return {
    id, tenantId, vehicleId, purchasePath, negotiationSessionId,
    status: PURCHASE_STATUS.STARTED,
    version: 1,
    report: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function recordReportServed(session, report, correlationId, occurredAt) {
  assertNotProceeding(session);
  return {
    ...session,
    status: PURCHASE_STATUS.REPORT_SERVED,
    version: session.version + 1,
    report: {
      id: report.id, version: report.version, contentHash: report.contentHash,
      servedAt: occurredAt, displayedAt: null, acknowledgedAt: null, acknowledgement: false,
      correlationId,
    },
    updatedAt: occurredAt,
  };
}

function recordReportDisplayed(session, reportIdentity, correlationId, occurredAt) {
  requireState(session, PURCHASE_STATUS.REPORT_SERVED);
  requireServedReport(session, reportIdentity);
  return {
    ...session,
    status: PURCHASE_STATUS.REPORT_DISPLAYED,
    version: session.version + 1,
    report: { ...session.report, displayedAt: occurredAt, correlationId },
    updatedAt: occurredAt,
  };
}

function recordAcknowledgement(session, reportIdentity, acknowledged, correlationId, occurredAt) {
  requireState(session, PURCHASE_STATUS.REPORT_DISPLAYED);
  requireServedReport(session, reportIdentity);
  if (acknowledged !== true) throw new DomainValidationError('Explicit acknowledgement is required', 'acknowledged');
  return {
    ...session,
    status: PURCHASE_STATUS.REPORT_ACKNOWLEDGED,
    version: session.version + 1,
    report: { ...session.report, acknowledgedAt: occurredAt, acknowledgement: true, correlationId },
    updatedAt: occurredAt,
  };
}

function recordProceeding(session, currentReportIdentity, correlationId, occurredAt) {
  requireState(session, PURCHASE_STATUS.REPORT_ACKNOWLEDGED);
  requireServedReport(session, currentReportIdentity);
  if (!session.report.acknowledgement) throw new DomainValidationError('Condition report acknowledgement is required', 'acknowledgement');
  return {
    ...session,
    status: PURCHASE_STATUS.PROCEEDING,
    version: session.version + 1,
    report: { ...session.report, correlationId },
    updatedAt: occurredAt,
  };
}

function recordHumanReviewRequired(session, correlationId, occurredAt) {
  assertNotProceeding(session);
  return {
    ...session,
    status: PURCHASE_STATUS.HUMAN_REVIEW_REQUIRED,
    version: session.version + 1,
    report: null,
    reviewCorrelationId: correlationId,
    updatedAt: occurredAt,
  };
}

function requireServedReport(session, identity) {
  if (!sameReportIdentity(session.report, identity)) {
    const error = new Error('Condition report version does not match the report served to this session');
    error.code = 'REPORT_VERSION_MISMATCH';
    throw error;
  }
}

function requireState(session, expected) {
  if (session.status !== expected) {
    const error = new Error(`Purchase session must be ${expected}`);
    error.code = 'PURCHASE_TRANSITION_NOT_ALLOWED';
    throw error;
  }
}

function assertNotProceeding(session) {
  if (session.status === PURCHASE_STATUS.PROCEEDING) requireState(session, PURCHASE_STATUS.STARTED);
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainValidationError(`${field} is required`, field);
}

module.exports = {
  PURCHASE_PATH, PURCHASE_STATUS, createPurchaseSession, recordAcknowledgement,
  recordHumanReviewRequired, recordProceeding, recordReportDisplayed, recordReportServed,
};
