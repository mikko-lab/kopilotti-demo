'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PurchaseFlowService, PURCHASE_PATH } = require('../../src/application/purchase-flow-service');
const { normalizeConditionReport } = require('../../src/domain/condition-report');

const reportV1 = normalizeConditionReport({ id: 'report-1', vehicleId: 'veh-0001', version: 'v1', inspectedAt: '2026-07-20T09:00:00Z', sections: { generalCondition: 'Fiktiivinen testiraportti.' } });

function fixture(currentReport = reportV1) {
  const sessions = new Map();
  const events = [];
  let id = 0;
  let report = currentReport;
  const service = new PurchaseFlowService({
    purchases: {
      getById: async (key) => structuredClone(sessions.get(key) ?? null),
      create: async (session) => { sessions.set(session.id, structuredClone(session)); return session; },
      save: async (session, expected) => {
        if (sessions.get(session.id).version !== expected) throw Object.assign(new Error(), { code: 'VERSION_CONFLICT' });
        sessions.set(session.id, structuredClone(session)); return session;
      },
    },
    conditionReports: { getCurrentForVehicle: async () => report },
    inventory: { getById: async () => ({ id: 'veh-0001', availability: 'available' }) },
    negotiations: { get: async () => ({ vehicleId: 'veh-0001', status: 'ACCEPTED', decisions: [{ status: 'ACCEPT' }] }) },
    audits: { append: async (event) => { events.push(event); return event; } },
    clock: () => new Date('2026-07-20T10:00:00.000Z'),
    idGenerator: () => `id-${++id}`,
  });
  return { service, sessions, events, setReport: (next) => { report = next; } };
}

async function createAndOpen(context) {
  const session = await context.service.create({ tenantId: 'dealer-1', actorId: 'customer', vehicleId: 'veh-0001', purchasePath: PURCHASE_PATH.DIRECT, correlationId: 'correlation-1' });
  return context.service.openConditionReport({ tenantId: 'dealer-1', actorId: 'customer', sessionId: session.id, expectedVersion: 1, correlationId: 'correlation-2' });
}

test('normal flow records every required server audit event', async () => {
  const context = fixture();
  const opened = await createAndOpen(context);
  const identity = { id: reportV1.id, version: reportV1.version, contentHash: reportV1.contentHash };
  const displayed = await context.service.markReportDisplayed({ tenantId: 'dealer-1', actorId: 'customer', sessionId: opened.session.id, expectedVersion: 2, reportIdentity: identity, correlationId: 'correlation-3' });
  const acknowledged = await context.service.acknowledge({ tenantId: 'dealer-1', actorId: 'customer', sessionId: displayed.id, expectedVersion: 3, reportIdentity: identity, acknowledged: true, correlationId: 'correlation-4' });
  await context.service.proceed({ tenantId: 'dealer-1', actorId: 'customer', sessionId: acknowledged.id, expectedVersion: 4, reportIdentity: identity, correlationId: 'correlation-5' });
  assert.deepEqual(context.events.map((event) => event.eventType), [
    'PURCHASE_FLOW_STARTED', 'CONDITION_REPORT_OPENED', 'CONDITION_REPORT_VERSION_DISPLAYED',
    'CONDITION_REPORT_ACKNOWLEDGED', 'PURCHASE_PROCEEDED_TO_FINANCE_OR_PAYMENT',
  ]);
  const last = context.events.at(-1).payload;
  assert.equal(last.conditionReportId, 'report-1');
  assert.equal(last.reportVersion, 'v1');
  assert.equal(last.acknowledgement, true);
  assert.equal(last.purchasePath, 'DIRECT_LIST_PRICE');
});

test('missing report requires human review and blocks progression', async () => {
  const context = fixture(null);
  const session = await context.service.create({ tenantId: 'dealer-1', actorId: 'customer', vehicleId: 'veh-0001', purchasePath: PURCHASE_PATH.DIRECT, correlationId: 'correlation-1' });
  await assert.rejects(context.service.openConditionReport({ tenantId: 'dealer-1', actorId: 'customer', sessionId: session.id, expectedVersion: 1, correlationId: 'correlation-2' }), { code: 'CONDITION_REPORT_REVIEW_REQUIRED' });
  assert.equal(context.events.at(-1).eventType, 'CONDITION_REPORT_REVIEW_REQUIRED');
  assert.equal(context.sessions.get(session.id).status, 'HUMAN_REVIEW_REQUIRED');
});

test('changed current report invalidates acknowledgement and progression', async () => {
  const context = fixture();
  const opened = await createAndOpen(context);
  const identity = { id: reportV1.id, version: reportV1.version, contentHash: reportV1.contentHash };
  const displayed = await context.service.markReportDisplayed({ tenantId: 'dealer-1', actorId: 'customer', sessionId: opened.session.id, expectedVersion: 2, reportIdentity: identity, correlationId: 'correlation-3' });
  const changed = normalizeConditionReport({ id: 'report-1', vehicleId: 'veh-0001', version: 'v2', inspectedAt: '2026-07-20T09:30:00Z', sections: { generalCondition: 'Päivitetty fiktiivinen testiraportti.' } });
  context.setReport(changed);
  await assert.rejects(context.service.acknowledge({ tenantId: 'dealer-1', actorId: 'customer', sessionId: displayed.id, expectedVersion: 3, reportIdentity: identity, acknowledged: true, correlationId: 'correlation-4' }), { code: 'CONDITION_REPORT_CHANGED' });
});
