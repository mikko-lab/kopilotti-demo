'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPurchaseIntegrationRouter } = require('../../src/http/purchase-integration-routes');
const { negotiationErrorHandler } = require('../../src/http/http-response');

async function withServer(service, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/purchase-integrations', createPurchaseIntegrationRouter(service, { integrationSecret: 'test-secret' }));
  app.use(negotiationErrorHandler);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

for (const kind of ['payment', 'financing']) {
  test(`rejects forged ${kind} confirmation before the application service`, async () => {
    let called = false;
    await withServer({ handleProviderCallback: async () => { called = true; } }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/purchase-integrations/callbacks/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'correlation-1', authorization: 'Bearer forged' },
        body: JSON.stringify({ status: 'CONFIRMED' }),
      });
      assert.equal(response.status, 401);
      assert.equal(called, false);
    });
  });
}
