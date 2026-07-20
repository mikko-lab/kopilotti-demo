'use strict';

const { DomainValidationError } = require('./money');
const { sameReportIdentity } = require('./condition-report');

const PURCHASE_PATH = Object.freeze({ DIRECT: 'DIRECT_LIST_PRICE', NEGOTIATED: 'NEGOTIATED_PRICE' });
const PURCHASE_STATUS = Object.freeze({
  PRICE_AGREED: 'PRICE_AGREED',
  CONDITION_REPORT_REQUIRED: 'CONDITION_REPORT_REQUIRED',
  CONDITION_REPORT_ACKNOWLEDGED: 'CONDITION_REPORT_ACKNOWLEDGED',
  PAYMENT_METHOD_SELECTED: 'PAYMENT_METHOD_SELECTED',
  PAYMENT_PENDING: 'PAYMENT_PENDING', FINANCING_PENDING: 'FINANCING_PENDING',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED', FINANCING_CONFIRMED: 'FINANCING_CONFIRMED',
  READY_FOR_HANDOVER: 'READY_FOR_HANDOVER', HANDED_OVER: 'HANDED_OVER',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
});

function createPurchaseSession({ id, tenantId, vehicleId, purchasePath, negotiationSessionId = null, negotiationHistory = null, agreedPrice, handoverPolicyVersion, createdAt }) {
  for (const [field, value] of Object.entries({ id, tenantId, vehicleId, createdAt })) requireString(value, field);
  if (!Object.values(PURCHASE_PATH).includes(purchasePath)) throw new DomainValidationError('Unsupported purchase path', 'purchasePath');
  if (purchasePath === PURCHASE_PATH.NEGOTIATED) requireString(negotiationSessionId, 'negotiationSessionId');
  if (purchasePath === PURCHASE_PATH.NEGOTIATED && !negotiationHistory) throw new DomainValidationError('negotiationHistory is required', 'negotiationHistory');
  if (!Number.isSafeInteger(agreedPrice) || agreedPrice <= 0) throw new DomainValidationError('agreedPrice is required', 'agreedPrice');
  requireString(handoverPolicyVersion, 'handoverPolicyVersion');
  return {
    id, tenantId, vehicleId, purchasePath, negotiationSessionId,
    negotiationHistory: negotiationHistory ? structuredClone(negotiationHistory) : null,
    agreedPrice, handoverPolicyVersion, status: PURCHASE_STATUS.PRICE_AGREED,
    version: 1,
    report: null,
    paymentMethod: null, providerReference: null, processedCallbacks: {},
    prerequisites: { conditionReportAcknowledged: false, paymentConfirmed: false, financingConfirmed: false, contractSigned: false, identityVerified: false, registrationCompleted: false, insuranceInformationReceived: false, vehiclePrepared: false, manualApproval: false },
    createdAt,
    updatedAt: createdAt,
  };
}

function recordReportServed(session, report, correlationId, occurredAt) {
  assertNotProceeding(session);
  return {
    ...session,
    status: PURCHASE_STATUS.CONDITION_REPORT_REQUIRED,
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
  requireState(session, PURCHASE_STATUS.CONDITION_REPORT_REQUIRED);
  requireServedReport(session, reportIdentity);
  return {
    ...session,
    status: PURCHASE_STATUS.CONDITION_REPORT_REQUIRED,
    version: session.version + 1,
    report: { ...session.report, displayedAt: occurredAt, correlationId },
    updatedAt: occurredAt,
  };
}

function recordAcknowledgement(session, reportIdentity, acknowledged, correlationId, occurredAt) {
  requireState(session, PURCHASE_STATUS.CONDITION_REPORT_REQUIRED);
  if (!session.report?.displayedAt) throw transitionError('Report must be displayed before acknowledgement');
  requireServedReport(session, reportIdentity);
  if (acknowledged !== true) throw new DomainValidationError('Explicit acknowledgement is required', 'acknowledged');
  return {
    ...session,
    status: PURCHASE_STATUS.CONDITION_REPORT_ACKNOWLEDGED,
    version: session.version + 1,
    report: { ...session.report, acknowledgedAt: occurredAt, acknowledgement: true, correlationId },
    prerequisites: { ...session.prerequisites, conditionReportAcknowledged: true },
    updatedAt: occurredAt,
  };
}

function selectPaymentMethod(session, method, occurredAt) { requireState(session, PURCHASE_STATUS.CONDITION_REPORT_ACKNOWLEDGED); if (!['PAYMENT','FINANCING'].includes(method)) throw new DomainValidationError('Invalid payment method','paymentMethod'); return evolve(session, { status: PURCHASE_STATUS.PAYMENT_METHOD_SELECTED, paymentMethod: method }, occurredAt); }
function startProviderFlow(session, providerReference, occurredAt) { requireState(session, PURCHASE_STATUS.PAYMENT_METHOD_SELECTED); requireString(providerReference,'providerReference'); return evolve(session, { status: session.paymentMethod === 'PAYMENT' ? PURCHASE_STATUS.PAYMENT_PENDING : PURCHASE_STATUS.FINANCING_PENDING, providerReference }, occurredAt); }
function confirmProvider(session, method, providerReference, idempotencyKey, occurredAt) {
  const expected = method === 'PAYMENT' ? PURCHASE_STATUS.PAYMENT_PENDING : PURCHASE_STATUS.FINANCING_PENDING;
  requireState(session, expected);
  requireString(idempotencyKey, 'idempotencyKey');
  if (session.providerReference !== providerReference) throw transitionError('Provider reference mismatch', 'PROVIDER_REFERENCE_MISMATCH');
  if (session.processedCallbacks[idempotencyKey]) return session;
  const fact = method === 'PAYMENT' ? 'paymentConfirmed' : 'financingConfirmed';
  const status = method === 'PAYMENT' ? PURCHASE_STATUS.PAYMENT_CONFIRMED : PURCHASE_STATUS.FINANCING_CONFIRMED;
  return evolve(session, {
    status,
    prerequisites: { ...session.prerequisites, [fact]: true },
    processedCallbacks: { ...session.processedCallbacks, [idempotencyKey]: true },
  }, occurredAt);
}
function recordPrerequisites(session, facts, occurredAt) {
  const allowed = ['contractSigned', 'identityVerified', 'registrationCompleted', 'insuranceInformationReceived', 'vehiclePrepared', 'manualApproval'];
  if (!facts || typeof facts !== 'object' || Object.keys(facts).some((key) => !allowed.includes(key) || typeof facts[key] !== 'boolean')) {
    throw new DomainValidationError('Invalid operational prerequisites', 'facts');
  }
  return evolve(session, { prerequisites: { ...session.prerequisites, ...facts } }, occurredAt);
}
function recordProviderCallback(session, idempotencyKey, occurredAt) {
  requireString(idempotencyKey, 'idempotencyKey');
  if (session.processedCallbacks[idempotencyKey]) return session;
  return evolve(session, { processedCallbacks: { ...session.processedCallbacks, [idempotencyKey]: true } }, occurredAt);
}
function markReady(session, occurredAt) { if (![PURCHASE_STATUS.PAYMENT_CONFIRMED,PURCHASE_STATUS.FINANCING_CONFIRMED].includes(session.status)) throw transitionError('Confirmation required'); return evolve(session,{status:PURCHASE_STATUS.READY_FOR_HANDOVER},occurredAt); }
function markHandedOver(session, occurredAt) { requireState(session,PURCHASE_STATUS.READY_FOR_HANDOVER); return evolve(session,{status:PURCHASE_STATUS.HANDED_OVER},occurredAt); }
function evolve(session, changes, occurredAt) { return { ...session, ...changes, version: session.version + 1, updatedAt: occurredAt }; }

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
  if ([PURCHASE_STATUS.READY_FOR_HANDOVER, PURCHASE_STATUS.HANDED_OVER].includes(session.status)) throw transitionError('Purchase flow cannot be reopened');
}
function transitionError(message, code='PURCHASE_TRANSITION_NOT_ALLOWED') { const error = new Error(message); error.code=code; return error; }

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainValidationError(`${field} is required`, field);
}

module.exports = {
  PURCHASE_PATH, PURCHASE_STATUS, createPurchaseSession, recordAcknowledgement,
  confirmProvider, markHandedOver, markReady, recordHumanReviewRequired, recordPrerequisites,
  recordProviderCallback, recordReportDisplayed, recordReportServed, selectPaymentMethod, startProviderFlow,
};
