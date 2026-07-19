'use strict';

const express = require('express');
const { adaptExtractedOffer } = require('../adapters/llm-offer-adapter');
const { ApplicationError } = require('../application/errors');
const { SESSION_STATUS } = require('../domain/negotiation-session');
const { requireActor } = require('../security/negotiation-authorization');
const { publicDecision, publicSession } = require('../security/public-negotiation-view');
const { asyncRoute } = require('./http-response');

function createNegotiationRouter(service) {
  const router = express.Router();

  router.post('/', asyncRoute(async (req, res) => {
    const actor = requireActor(req);
    const session = await service.create({ ...actor, vehicleId: req.body?.vehicleId });
    res.status(201).location(`/api/negotiations/${session.id}`).json(publicSession(session));
  }));

  router.get('/:sessionId', asyncRoute(async (req, res) => {
    const actor = requireActor(req);
    const session = await service.get({ tenantId: actor.tenantId, sessionId: req.params.sessionId });
    res.json(publicSession(session));
  }));

  router.post('/:sessionId/offers', asyncRoute(async (req, res) => {
    const actor = requireActor(req);
    const commandId = requireCommandId(req);
    const expectedVersion = requireExpectedVersion(req);
    const offer = adaptExtractedOffer(req.body);
    const decision = await service.submitOffer({ ...actor, sessionId: req.params.sessionId, commandId, expectedVersion, offer });
    res.json(publicDecision(decision));
  }));

  router.post('/:sessionId/escalate', transitionRoute(service, SESSION_STATUS.ESCALATED));
  router.post('/:sessionId/cancel', transitionRoute(service, SESSION_STATUS.CANCELLED));
  return router;
}

function transitionRoute(service, status) {
  return asyncRoute(async (req, res) => {
    const actor = requireActor(req);
    const expectedVersion = requireExpectedVersion(req);
    const session = await service.transition({ ...actor, sessionId: req.params.sessionId, expectedVersion, status });
    res.json(publicSession(session));
  });
}

function requireCommandId(req) {
  const value = req.get('Idempotency-Key');
  if (!value || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
    throw new ApplicationError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required', 400);
  }
  return value;
}

function requireExpectedVersion(req) {
  const raw = req.get('If-Match');
  const match = raw?.match(/^(?:W\/)?"?(\d+)"?$/);
  if (!match || Number(match[1]) < 1) throw new ApplicationError('SESSION_VERSION_REQUIRED', 'If-Match session version is required', 428);
  return Number(match[1]);
}

module.exports = { createNegotiationRouter };
