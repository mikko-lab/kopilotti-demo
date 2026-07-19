'use strict';

const { DomainValidationError } = require('../domain/money');
const { ApplicationError } = require('../application/errors');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function negotiationErrorHandler(error, _req, res, _next) {
  if (error instanceof ApplicationError || error instanceof DomainValidationError) {
    return res.status(error.statusCode || 400).json({ error: { code: error.code, message: error.message, field: error.field } });
  }
  if (error?.code === 'SESSION_NOT_OPEN') {
    return res.status(409).json({ error: { code: error.code, message: 'Negotiation session is not open' } });
  }
  console.error('Negotiation request failed:', error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Request failed' } });
}

module.exports = { asyncRoute, negotiationErrorHandler };
