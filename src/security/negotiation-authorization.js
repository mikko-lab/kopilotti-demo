'use strict';

const { ApplicationError } = require('../application/errors');

const SAFE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;

/**
 * Backend foundation identity boundary. Production must populate these
 * values from a verified identity provider or trusted gateway, never accept
 * caller-selected headers directly from the public internet.
 */
function requireActor(req) {
  const tenantId = req.get('X-Tenant-Id');
  const actorId = req.get('X-Actor-Id');
  if (!SAFE_IDENTIFIER.test(tenantId || '') || !SAFE_IDENTIFIER.test(actorId || '')) {
    throw new ApplicationError('UNAUTHORIZED', 'Authenticated tenant and actor are required', 401);
  }
  return { tenantId, actorId };
}

module.exports = { requireActor };
