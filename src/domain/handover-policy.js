'use strict';

const { DomainValidationError } = require('./money');

const REQUIREMENT_FIELDS = Object.freeze([
  'requireConditionReportAcknowledged', 'requirePaymentConfirmed', 'requireFinancingConfirmed',
  'requireContractSigned', 'requireIdentityVerified', 'requireRegistrationCompleted',
  'requireInsuranceInformationReceived', 'requireVehiclePrepared', 'requireManualApproval',
]);

function validateHandoverPolicy(input) {
  if (!input || typeof input !== 'object') throw new DomainValidationError('Handover policy is required', 'handoverPolicy');
  return Object.freeze({
    policyVersion: requireString(input.policyVersion, 'policyVersion'),
    cashPurchase: validateRules(input.cashPurchase, 'cashPurchase'),
    financedPurchase: validateRules(input.financedPurchase, 'financedPurchase'),
  });
}

function readiness(policy, method, prerequisites) {
  const validated = validateHandoverPolicy(policy);
  const rules = method === 'PAYMENT' ? validated.cashPurchase : method === 'FINANCING' ? validated.financedPurchase : null;
  if (!rules) return { ready: false, missing: ['paymentMethodSelected'] };
  const mapping = {
    requireConditionReportAcknowledged: 'conditionReportAcknowledged', requirePaymentConfirmed: 'paymentConfirmed',
    requireFinancingConfirmed: 'financingConfirmed', requireContractSigned: 'contractSigned',
    requireIdentityVerified: 'identityVerified', requireRegistrationCompleted: 'registrationCompleted',
    requireInsuranceInformationReceived: 'insuranceInformationReceived', requireVehiclePrepared: 'vehiclePrepared',
    requireManualApproval: 'manualApproval',
  };
  const missing = Object.entries(mapping).filter(([rule, fact]) => rules[rule] && prerequisites[fact] !== true).map(([, fact]) => fact);
  return { ready: missing.length === 0, missing };
}

function validateRules(input, field) {
  if (!input || typeof input !== 'object') throw new DomainValidationError(`${field} is required`, field);
  const result = {};
  for (const key of REQUIREMENT_FIELDS) {
    if (typeof input[key] !== 'boolean') throw new DomainValidationError(`${field}.${key} must be boolean`, `${field}.${key}`);
    result[key] = input[key];
  }
  return Object.freeze(result);
}
function requireString(value, field) { if (typeof value !== 'string' || !value.trim()) throw new DomainValidationError(`${field} is required`, field); return value.trim(); }

module.exports = { REQUIREMENT_FIELDS, readiness, validateHandoverPolicy };
