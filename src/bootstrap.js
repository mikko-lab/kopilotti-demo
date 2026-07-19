'use strict';

const path = require('node:path');
const { NegotiationService } = require('./application/negotiation-service');
const { FileAuditRepository } = require('./infrastructure/file-audit-repository');
const { FileInventoryRepository } = require('./infrastructure/file-inventory-repository');
const { FileNegotiationRepository } = require('./infrastructure/file-negotiation-repository');
const { FilePolicyRepository } = require('./infrastructure/file-policy-repository');

function createNegotiationService({ projectRoot = path.join(__dirname, '..'), dataDirectory = process.env.NEGOTIATION_DATA_DIR } = {}) {
  const durableDirectory = dataDirectory || path.join(projectRoot, '.data', 'negotiations');
  // Policy values are intentionally external to the repository: this same
  // repository is published by GitHub Pages, so a checked-in policy JSON
  // would be directly downloadable by browsers.
  const policyPath = process.env.NEGOTIATION_POLICY_PATH || path.join(projectRoot, 'config', 'demo-policy.json');
  return new NegotiationService({
    negotiations: new FileNegotiationRepository(path.join(durableDirectory, 'sessions.json')),
    audits: new FileAuditRepository(path.join(durableDirectory, 'audit.json')),
    policies: new FilePolicyRepository(policyPath),
    inventory: new FileInventoryRepository(path.join(projectRoot, 'inventory.json')),
  });
}

module.exports = { createNegotiationService };
