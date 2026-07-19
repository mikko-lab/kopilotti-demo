'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PURCHASE_PATH, createPurchaseSession, recordAcknowledgement,
  recordProceeding, recordReportDisplayed, recordReportServed,
} = require('../../src/domain/purchase-session');

const report = { id: 'report-1', version: 'v1', contentHash: 'a'.repeat(64) };
const time = '2026-07-20T10:00:00.000Z';
const create = () => createPurchaseSession({ id: 'purchase-1', tenantId: 'dealer-1', vehicleId: 'veh-0001', purchasePath: PURCHASE_PATH.DIRECT, createdAt: time });

test('enforces served, displayed, acknowledged and proceeding order', () => {
  const started = create();
  assert.throws(() => recordAcknowledgement(started, report, true, 'correlation-1', time), { code: 'PURCHASE_TRANSITION_NOT_ALLOWED' });
  const served = recordReportServed(started, report, 'correlation-1', time);
  assert.throws(() => recordAcknowledgement(served, report, true, 'correlation-1', time), { code: 'PURCHASE_TRANSITION_NOT_ALLOWED' });
  const displayed = recordReportDisplayed(served, report, 'correlation-1', time);
  const acknowledged = recordAcknowledgement(displayed, report, true, 'correlation-1', time);
  const proceeding = recordProceeding(acknowledged, report, 'correlation-1', time);
  assert.equal(proceeding.status, 'PROCEEDING_TO_FINANCE_OR_PAYMENT');
  assert.equal(proceeding.report.acknowledgement, true);
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
  assert.throws(() => recordProceeding(acknowledged, changed, 'correlation-2', time), { code: 'REPORT_VERSION_MISMATCH' });
  const servedAgain = recordReportServed(acknowledged, changed, 'correlation-2', time);
  assert.equal(servedAgain.status, 'REPORT_SERVED');
  assert.equal(servedAgain.report.acknowledgement, false);
});
