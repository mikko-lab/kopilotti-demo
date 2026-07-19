'use strict';

const express = require('express');
const { ApplicationError } = require('../application/errors');
const { PURCHASE_PATH } = require('../domain/purchase-session');
const { publicConditionReport, publicPurchaseSession } = require('../security/public-condition-report-view');
const { asyncRoute } = require('./http-response');

const DEMO_TENANT_ID = 'demo-dealership';
const DEMO_ACTOR_ID = 'digital-customer';

function createPurchaseFlowRouter(service) {
  const router = express.Router();

  router.post('/purchase-sessions', asyncRoute(async (req, res) => {
    const correlationId = requireCorrelationId(req);
    const purchasePath = parsePurchasePath(req.body?.purchasePath);
    const session = await service.create({
      tenantId: DEMO_TENANT_ID, actorId: DEMO_ACTOR_ID,
      vehicleId: req.body?.vehicleId, purchasePath,
      negotiationSessionId: purchasePath === PURCHASE_PATH.NEGOTIATED ? req.body?.negotiationSessionId : null,
      correlationId,
    });
    res.status(201).json(publicPurchaseSession(session));
  }));

  router.post('/purchase-sessions/:sessionId/condition-report/open', asyncRoute(async (req, res) => {
    const result = await service.openConditionReport(command(req));
    res.json({ session: publicPurchaseSession(result.session), report: publicConditionReport(result.report) });
  }));

  router.post('/purchase-sessions/:sessionId/condition-report/displayed', asyncRoute(async (req, res) => {
    const session = await service.markReportDisplayed({ ...command(req), reportIdentity: parseReportIdentity(req.body) });
    res.json(publicPurchaseSession(session));
  }));

  router.post('/purchase-sessions/:sessionId/condition-report/acknowledge', asyncRoute(async (req, res) => {
    const session = await service.acknowledge({ ...command(req), reportIdentity: parseReportIdentity(req.body), acknowledged: req.body?.acknowledged });
    res.json(publicPurchaseSession(session));
  }));

  router.post('/purchase-sessions/:sessionId/proceed', asyncRoute(async (req, res) => {
    const session = await service.proceed({ ...command(req), reportIdentity: parseReportIdentity(req.body) });
    res.json(publicPurchaseSession(session));
  }));
  return router;
}

function command(req) {
  return {
    tenantId: DEMO_TENANT_ID,
    actorId: DEMO_ACTOR_ID,
    sessionId: req.params.sessionId,
    expectedVersion: requirePositiveInteger(req.body?.expectedVersion, 'expectedVersion'),
    correlationId: requireCorrelationId(req),
  };
}

function parseReportIdentity(body) {
  const identity = { id: body?.reportId, version: body?.reportVersion, contentHash: body?.contentHash };
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value !== 'string' || !value) throw new ApplicationError('INVALID_REPORT_IDENTITY', `${field} vaaditaan`, 400);
  }
  return identity;
}

function parsePurchasePath(value) {
  if (!Object.values(PURCHASE_PATH).includes(value)) throw new ApplicationError('INVALID_PURCHASE_PATH', 'Tuntematon ostopolku', 400);
  return value;
}

function requireCorrelationId(req) {
  const value = req.get('X-Correlation-Id');
  if (!value || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new ApplicationError('CORRELATION_ID_REQUIRED', 'Korrelaatiotunniste vaaditaan', 400);
  return value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new ApplicationError('INVALID_REQUEST', `${field} vaaditaan`, 400);
  return value;
}

module.exports = { createPurchaseFlowRouter };
