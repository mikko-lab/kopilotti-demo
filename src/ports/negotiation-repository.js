'use strict';

/**
 * Negotiation repository port:
 * getById(id), create(session), save(session, expectedVersion).
 * Implementations must make create/save durable before resolving and reject
 * optimistic-version conflicts rather than overwriting concurrent updates.
 */
module.exports = {};
