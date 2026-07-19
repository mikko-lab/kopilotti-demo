'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPurchaseFlowRouter } = require('../../src/http/purchase-flow-routes');
const { negotiationErrorHandler } = require('../../src/http/http-response');

async function withServer(service, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/digital-salesperson', createPurchaseFlowRouter(service));
  app.use(negotiationErrorHandler);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const baseSession = { id: 'purchase-1', vehicleId: 'veh-0001', purchasePath: 'DIRECT_LIST_PRICE', status: 'PURCHASE_STARTED', version: 1, report: null };
const report = {
  id: 'report-1', vehicleId: 'veh-0001', version: 'v1', contentHash: 'a'.repeat(64), inspectedAt: '2026-07-20T09:00:00.000Z',
  sections: { generalCondition: 'Fiktiivinen testitieto.' }, photographs: [], sourceDocumentUrl: null,
  internalDealerNotes: 'SALAINEN',
};

test('serves a customer-safe HTML report contract and server session version', async () => {
  const service = {
    create: async () => baseSession,
    openConditionReport: async () => ({ session: { ...baseSession, status: 'REPORT_SERVED', version: 2, report: { id: report.id, version: report.version, contentHash: report.contentHash } }, report }),
  };
  await withServer(service, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/digital-salesperson/purchase-sessions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'correlation-1' }, body: JSON.stringify({ vehicleId: 'veh-0001', purchasePath: 'DIRECT_LIST_PRICE' }) });
    assert.equal(created.status, 201);
    const opened = await fetch(`${baseUrl}/api/digital-salesperson/purchase-sessions/purchase-1/condition-report/open`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'correlation-2' }, body: JSON.stringify({ expectedVersion: 1 }) });
    assert.equal(opened.status, 200);
    const body = await opened.json();
    assert.equal(body.session.version, 2);
    assert.deepEqual(body.report.sections, [{ key: 'generalCondition', title: 'Yleiskunto', content: 'Fiktiivinen testitieto.' }]);
    assert.equal(body.report.internalDealerNotes, undefined);
  });
});

test('does not trust forged acknowledgement identity or missing correlation metadata', async () => {
  let received;
  const { ApplicationError } = require('../../src/application/errors');
  const service = { acknowledge: async (command) => { received = command; throw new ApplicationError('CONDITION_REPORT_CHANGED', 'Auton kuntoraportti on päivittynyt', 409); } };
  await withServer(service, async (baseUrl) => {
    const noCorrelation = await fetch(`${baseUrl}/api/digital-salesperson/purchase-sessions/purchase-1/condition-report/acknowledge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noCorrelation.status, 400);

    const response = await fetch(`${baseUrl}/api/digital-salesperson/purchase-sessions/purchase-1/condition-report/acknowledge`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'correlation-3' },
      body: JSON.stringify({ expectedVersion: 3, reportId: 'forged', reportVersion: 'fake', contentHash: 'fake', acknowledged: true, vehicleId: 'veh-attacker' }),
    });
    assert.equal(response.status, 409);
    assert.equal(received.reportIdentity.id, 'forged');
    assert.equal(received.vehicleId, undefined);
  });
});

test('returns an accessible human-review error contract when report is missing', async () => {
  const service = { openConditionReport: async () => { const error = new (require('../../src/application/errors').ApplicationError)('CONDITION_REPORT_REVIEW_REQUIRED', 'Auton kuntotiedot vaativat myyjän tarkistuksen', 409); throw error; } };
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/digital-salesperson/purchase-sessions/purchase-1/condition-report/open`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'correlation-4' }, body: JSON.stringify({ expectedVersion: 1 }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'CONDITION_REPORT_REVIEW_REQUIRED');
  });
});

test('returns a closed backend failure without allowing progression', async () => {
  const { ApplicationError } = require('../../src/application/errors');
  const service = { startProvider: async () => { throw new ApplicationError('BACKEND_FAILURE', 'Palvelu ei ole käytettävissä', 500); } };
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/digital-salesperson/purchase-sessions/purchase-1/provider/start`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'correlation-5' },
      body: JSON.stringify({ expectedVersion: 4, reportId: 'report-1', reportVersion: 'v1', contentHash: 'a'.repeat(64) }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, 'BACKEND_FAILURE');
  });
});
