'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readiness, validateHandoverPolicy } = require('../../src/domain/handover-policy');

const rules = { requireConditionReportAcknowledged: true, requirePaymentConfirmed: false, requireFinancingConfirmed: false, requireContractSigned: false, requireIdentityVerified: false, requireRegistrationCompleted: false, requireInsuranceInformationReceived: false, requireVehiclePrepared: false, requireManualApproval: false };
const policy = { policyVersion: 'handover-v1', cashPurchase: { ...rules, requirePaymentConfirmed: true, requireManualApproval: true }, financedPurchase: { ...rules, requireFinancingConfirmed: true, requireContractSigned: true } };

test('readiness requires every configured prerequisite', () => {
  assert.deepEqual(readiness(policy, 'PAYMENT', { conditionReportAcknowledged: true, paymentConfirmed: true, manualApproval: false }), { ready: false, missing: ['manualApproval'] });
  assert.equal(readiness(policy, 'PAYMENT', { conditionReportAcknowledged: true, paymentConfirmed: true, manualApproval: true }).ready, true);
});
test('policy version and every requirement are explicit', () => {
  assert.equal(validateHandoverPolicy(policy).policyVersion, 'handover-v1');
  assert.throws(() => validateHandoverPolicy({ ...policy, policyVersion: '' }), { code: 'VALIDATION_ERROR' });
});
