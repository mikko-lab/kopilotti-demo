'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PurchaseFlowService, PURCHASE_PATH } = require('../../src/application/purchase-flow-service');
const { normalizeConditionReport } = require('../../src/domain/condition-report');

const reportV1 = normalizeConditionReport({ id: 'report-1', vehicleId: 'veh-0001', version: 'v1', inspectedAt: '2026-07-20T09:00:00Z', sections: { generalCondition: 'Fiktiivinen testiraportti.' } });
const rules = { requireConditionReportAcknowledged: true, requirePaymentConfirmed: false, requireFinancingConfirmed: false, requireContractSigned: false, requireIdentityVerified: false, requireRegistrationCompleted: false, requireInsuranceInformationReceived: false, requireVehiclePrepared: false, requireManualApproval: false };
const handoverPolicy = { policyVersion: 'handover-v1', cashPurchase: { ...rules, requirePaymentConfirmed: true }, financedPurchase: { ...rules, requireFinancingConfirmed: true } };

function fixture(currentReport = reportV1, overrides = {}) {
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
    inventory: { getById: async () => ({ id: 'veh-0001', availability: 'available', listPrice: 30686 }) },
    negotiations: { get: async () => ({ vehicleId: 'veh-0001', status: 'ACCEPTED', decisions: [{ status: 'ACCEPT', approvedAmount: 29200 }] }) },
    handoverPolicies: overrides.handoverPolicies || { getCurrent: async () => handoverPolicy, getByVersion: async () => handoverPolicy },
    paymentProvider: overrides.paymentProvider || { startPayment: async ({sessionId}) => ({providerReference:`DEMO-PAYMENT-${sessionId}`,simulated:true}), verifyCallback: async p => p },
    financingProvider: overrides.financingProvider || { startApplication: async ({sessionId}) => ({providerReference:`DEMO-FINANCING-${sessionId}`,simulated:true}), verifyCallback: async p => p },
    audits: { append: async (event) => { events.push(event); return event; } },
    clock: () => new Date('2026-07-20T10:00:00.000Z'),
    idGenerator: () => `id-${++id}`,
  });
  return { service, sessions, events, setReport: (next) => { report = next; } };
}

async function progressToPending(context, method = 'PAYMENT') {
  const opened = await createAndOpen(context);
  const identity = { id: reportV1.id, version: reportV1.version, contentHash: reportV1.contentHash };
  const displayed = await context.service.markReportDisplayed({ tenantId: 'dealer-1', actorId: 'customer', sessionId: opened.session.id, expectedVersion: 2, reportIdentity: identity, correlationId: 'correlation-3' });
  const acknowledged = await context.service.acknowledge({ tenantId: 'dealer-1', actorId: 'customer', sessionId: displayed.id, expectedVersion: 3, reportIdentity: identity, acknowledged: true, correlationId: 'correlation-4' });
  const selected = await context.service.selectPaymentMethod({ tenantId: 'dealer-1', actorId: 'customer', sessionId: acknowledged.id, expectedVersion: 4, method, correlationId: 'correlation-5' });
  return context.service.startProvider({ tenantId: 'dealer-1', actorId: 'customer', sessionId: selected.id, expectedVersion: 5, correlationId: 'correlation-6' });
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
  const selected=await context.service.selectPaymentMethod({tenantId:'dealer-1',actorId:'customer',sessionId:acknowledged.id,expectedVersion:4,method:'PAYMENT',correlationId:'correlation-5'});
  const pending=await context.service.startProvider({tenantId:'dealer-1',actorId:'customer',sessionId:selected.id,expectedVersion:5,correlationId:'correlation-6'});
  await context.service.handleProviderCallback({tenantId:'dealer-1',kind:'PAYMENT',payload:{sessionId:pending.id,providerReference:pending.providerReference,status:'CONFIRMED',idempotencyKey:'callback-1',simulated:true},headers:{},actorId:'demo-provider',correlationId:'correlation-7'});
  assert.deepEqual(context.events.map((event) => event.eventType), [
    'PRICE_AGREED', 'CONDITION_REPORT_OPENED', 'CONDITION_REPORT_VERSION_DISPLAYED',
    'CONDITION_REPORT_ACKNOWLEDGED', 'PAYMENT_METHOD_SELECTED', 'PAYMENT_STARTED', 'PAYMENT_CONFIRMED',
  ]);
  const last = context.events.at(-1).payload;
  assert.equal(last.agreedPrice, 30686);
  assert.equal(last.purchasePath, 'DIRECT_LIST_PRICE');
});

test('direct and negotiated purchases enter the same downstream state model', async () => {
  const directContext = fixture();
  const negotiatedContext = fixture();
  const direct = await directContext.service.create({ tenantId: 'dealer-1', actorId: 'customer', vehicleId: 'veh-0001', purchasePath: PURCHASE_PATH.DIRECT, correlationId: 'correlation-1' });
  const negotiated = await negotiatedContext.service.create({ tenantId: 'dealer-1', actorId: 'customer', vehicleId: 'veh-0001', purchasePath: PURCHASE_PATH.NEGOTIATED, negotiationSessionId: 'negotiation-1', correlationId: 'correlation-1' });
  assert.equal(direct.status, 'PRICE_AGREED');
  assert.equal(negotiated.status, 'PRICE_AGREED');
  assert.equal(direct.agreedPrice, 30686);
  assert.equal(negotiated.agreedPrice, 29200);
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

test('duplicate provider callback is idempotent', async () => {
  const context = fixture();
  const pending = await progressToPending(context);
  const command = { tenantId: 'dealer-1', kind: 'PAYMENT', payload: { sessionId: pending.id, providerReference: pending.providerReference, status: 'CONFIRMED', idempotencyKey: 'callback-1', simulated: true }, headers: {}, actorId: 'demo-provider', correlationId: 'correlation-7' };
  const first = await context.service.handleProviderCallback(command);
  const second = await context.service.handleProviderCallback(command);
  assert.equal(second.version, first.version);
  assert.equal(context.events.filter((event) => event.eventType === 'PAYMENT_CONFIRMED').length, 1);
});

test('rejected provider outcome and provider outage preserve the authoritative state', async () => {
  const context = fixture();
  const pending = await progressToPending(context);
  const rejected = await context.service.handleProviderCallback({ tenantId: 'dealer-1', kind: 'PAYMENT', payload: { sessionId: pending.id, providerReference: pending.providerReference, status: 'REJECTED', idempotencyKey: 'callback-rejected', simulated: true }, headers: {}, actorId: 'demo-provider', correlationId: 'correlation-7' });
  assert.equal(rejected.status, 'PAYMENT_PENDING');

  const outage = fixture(reportV1, { paymentProvider: { startPayment: async () => { throw new Error('offline'); }, verifyCallback: async (payload) => payload } });
  const opened = await createAndOpen(outage);
  const identity = { id: reportV1.id, version: reportV1.version, contentHash: reportV1.contentHash };
  const displayed = await outage.service.markReportDisplayed({ tenantId: 'dealer-1', actorId: 'customer', sessionId: opened.session.id, expectedVersion: 2, reportIdentity: identity, correlationId: 'correlation-3' });
  const acknowledged = await outage.service.acknowledge({ tenantId: 'dealer-1', actorId: 'customer', sessionId: displayed.id, expectedVersion: 3, reportIdentity: identity, acknowledged: true, correlationId: 'correlation-4' });
  const selected = await outage.service.selectPaymentMethod({ tenantId: 'dealer-1', actorId: 'customer', sessionId: acknowledged.id, expectedVersion: 4, method: 'PAYMENT', correlationId: 'correlation-5' });
  await assert.rejects(outage.service.startProvider({ tenantId: 'dealer-1', actorId: 'customer', sessionId: selected.id, expectedVersion: 5, correlationId: 'correlation-6' }), { code: 'PROVIDER_UNAVAILABLE' });
  assert.equal(outage.sessions.get(selected.id).status, 'PAYMENT_METHOD_SELECTED');
});

test('session pins the policy version and handover requires an authorized action', async () => {
  const newer = { ...handoverPolicy, policyVersion: 'handover-v2' };
  const policies = { getCurrent: async () => handoverPolicy, getByVersion: async (version) => version === 'handover-v1' ? handoverPolicy : newer };
  const context = fixture(reportV1, { handoverPolicies: policies });
  const pending = await progressToPending(context);
  const ready = await context.service.handleProviderCallback({ tenantId: 'dealer-1', kind: 'PAYMENT', payload: { sessionId: pending.id, providerReference: pending.providerReference, status: 'CONFIRMED', idempotencyKey: 'callback-1', simulated: true }, headers: {}, actorId: 'demo-provider', correlationId: 'correlation-7' });
  assert.equal(ready.status, 'READY_FOR_HANDOVER');
  await assert.rejects(context.service.handOver({ tenantId: 'dealer-1', actorId: 'customer', sessionId: ready.id, expectedVersion: ready.version, correlationId: 'correlation-8', authorized: false }), { code: 'FORBIDDEN' });
  const handedOver = await context.service.handOver({ tenantId: 'dealer-1', actorId: 'dealer-user', sessionId: ready.id, expectedVersion: ready.version, correlationId: 'correlation-8', authorized: true });
  assert.equal(handedOver.status, 'HANDED_OVER');
  assert.equal(context.events.at(-1).eventType, 'VEHICLE_HANDED_OVER');
});
