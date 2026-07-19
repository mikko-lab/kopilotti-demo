'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PURCHASE_PATH, createPurchaseSession, recordAcknowledgement,
  confirmProvider, markHandedOver, markReady, recordReportDisplayed, recordReportServed,
  selectPaymentMethod, startProviderFlow,
} = require('../../src/domain/purchase-session');

const report = { id: 'report-1', version: 'v1', contentHash: 'a'.repeat(64) };
const time = '2026-07-20T10:00:00.000Z';
const create = () => createPurchaseSession({ id: 'purchase-1', tenantId: 'dealer-1', vehicleId: 'veh-0001', purchasePath: PURCHASE_PATH.DIRECT, agreedPrice: 30686, handoverPolicyVersion: 'policy-v1', createdAt: time });

test('enforces served, displayed, acknowledged and proceeding order', () => {
  const started = create();
  assert.throws(() => recordAcknowledgement(started, report, true, 'correlation-1', time), { code: 'PURCHASE_TRANSITION_NOT_ALLOWED' });
  const served = recordReportServed(started, report, 'correlation-1', time);
  assert.throws(() => recordAcknowledgement(served, report, true, 'correlation-1', time), { code: 'PURCHASE_TRANSITION_NOT_ALLOWED' });
  const displayed = recordReportDisplayed(served, report, 'correlation-1', time);
  const acknowledged = recordAcknowledgement(displayed, report, true, 'correlation-1', time);
  assert.equal(acknowledged.status, 'CONDITION_REPORT_ACKNOWLEDGED');
});

test('does not accept a forged or preselected acknowledgement', () => {
  const displayed = recordReportDisplayed(recordReportServed(create(), report, 'correlation-1', time), report, 'correlation-1', time);
  assert.throws(() => recordAcknowledgement(displayed, report, false, 'correlation-1', time), { code: 'VALIDATION_ERROR' });
  assert.throws(() => recordAcknowledgement(displayed, { ...report, contentHash: 'b'.repeat(64) }, true, 'correlation-1', time), { code: 'REPORT_VERSION_MISMATCH' });
});

test('requires acknowledgement again when a new report is served', () => {
  const displayed = recordReportDisplayed(recordReportServed(create(), report, 'correlation-1', time), report, 'correlation-1', time);
  const acknowledged = recordAcknowledgement(displayed, report, true, 'correlation-1', time);
  const changed = { ...report, version: 'v2', contentHash: 'b'.repeat(64) };
  const servedAgain = recordReportServed(acknowledged, changed, 'correlation-2', time);
  assert.equal(servedAgain.status, 'CONDITION_REPORT_REQUIRED');
  assert.equal(servedAgain.report.acknowledgement, false);
});

test('payment confirmation cannot skip pending and handover requires readiness', () => {
  const acknowledged = recordAcknowledgement(recordReportDisplayed(recordReportServed(create(), report, 'c-12345678', time), report, 'c-12345678', time), report, true, 'c-12345678', time);
  assert.throws(() => confirmProvider(acknowledged, 'PAYMENT', 'pay-1', 'callback-1', time), { code: 'PURCHASE_TRANSITION_NOT_ALLOWED' });
  const selected = selectPaymentMethod(acknowledged, 'PAYMENT', time);
  const pending = startProviderFlow(selected, 'pay-1', time);
  const confirmed = confirmProvider(pending, 'PAYMENT', 'pay-1', 'callback-1', time);
  assert.equal(confirmed.status, 'PAYMENT_CONFIRMED');
  assert.throws(() => markHandedOver(confirmed, time), { code: 'PURCHASE_TRANSITION_NOT_ALLOWED' });
  assert.equal(markHandedOver(markReady(confirmed, time), time).status, 'HANDED_OVER');
});

test('rejects a stale callback for another provider transaction', () => {
  const acknowledged = recordAcknowledgement(recordReportDisplayed(recordReportServed(create(), report, 'c-12345678', time), report, 'c-12345678', time), report, true, 'c-12345678', time);
  const pending = startProviderFlow(selectPaymentMethod(acknowledged, 'FINANCING', time), 'finance-current', time);
  assert.throws(() => confirmProvider(pending, 'FINANCING', 'finance-stale', 'callback-1', time), { code: 'PROVIDER_REFERENCE_MISMATCH' });
});
