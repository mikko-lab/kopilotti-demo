'use strict';

const express = require('express');
const { adaptExtractedOffer } = require('../adapters/llm-offer-adapter');
const { ApplicationError } = require('../application/errors');
const { publicCustomerDecision, publicSession } = require('../security/public-negotiation-view');
const { asyncRoute } = require('./http-response');

const DEMO_TENANT_ID = 'demo-dealership';
const DEMO_ACTOR_ID = 'digital-customer';

/**
 * Anonymous demo BFF. It injects server-owned identity and never exposes the
 * privileged negotiation API headers to browser code. Mount only when the
 * explicit demo flag is enabled; production needs a real customer identity
 * session, CSRF protection and rate limiting before enabling this flow.
 */
function createDigitalSalespersonRouter(service) {
  const router = express.Router();

  router.post('/sessions', asyncRoute(async (req, res) => {
    const session = await service.create({ tenantId: DEMO_TENANT_ID, actorId: DEMO_ACTOR_ID, vehicleId: req.body?.vehicleId });
    res.status(201).json(publicSession(session));
  }));

  router.post('/sessions/:sessionId/offers', asyncRoute(async (req, res) => {
    const session = await service.get({ tenantId: DEMO_TENANT_ID, sessionId: req.params.sessionId });
    const expectedVersion = requireInteger(req.body?.expectedVersion, 'expectedVersion');
    const commandId = requireCommandId(req.body?.commandId);
    const offer = adaptExtractedOffer({
      vehicleId: session.vehicleId,
      offerAmount: req.body?.offerAmount,
      currency: req.body?.currency,
      evidence: req.body?.evidence,
      condition: req.body?.condition,
    });
    const decision = await service.submitOffer({
      tenantId: DEMO_TENANT_ID,
      actorId: DEMO_ACTOR_ID,
      sessionId: session.id,
      commandId,
      expectedVersion,
      offer,
    });
    const updated = await service.get({ tenantId: DEMO_TENANT_ID, sessionId: session.id });
    res.json(publicCustomerDecision(decision, updated));
  }));
  return router;
}

function requireInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new ApplicationError('INVALID_REQUEST', `${field} is required`, 400);
  return value;
}

function requireCommandId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
    throw new ApplicationError('INVALID_REQUEST', 'commandId is required', 400);
  }
  return value;
}

module.exports = { createDigitalSalespersonRouter };
