'use strict';

const path = require('node:path');
const { NegotiationService } = require('./application/negotiation-service');
const { FileAuditRepository } = require('./infrastructure/file-audit-repository');
const { FileInventoryRepository } = require('./infrastructure/file-inventory-repository');
const { FileNegotiationRepository } = require('./infrastructure/file-negotiation-repository');
const { FilePolicyRepository } = require('./infrastructure/file-policy-repository');
const { FilePurchaseRepository } = require('./infrastructure/file-purchase-repository');
const { FileConditionReportRepository } = require('./infrastructure/file-condition-report-repository');
const { PurchaseFlowService } = require('./application/purchase-flow-service');

function createNegotiationService({ projectRoot = path.join(__dirname, '..'), dataDirectory = process.env.NEGOTIATION_DATA_DIR } = {}) {
  return createBackendServices({ projectRoot, dataDirectory }).negotiationService;
}

function createBackendServices({ projectRoot = path.join(__dirname, '..'), dataDirectory = process.env.NEGOTIATION_DATA_DIR } = {}) {
  const durableDirectory = dataDirectory || path.join(projectRoot, '.data', 'negotiations');
  // Policy values are intentionally external to the repository: this same
  // repository is published by GitHub Pages, so a checked-in policy JSON
  // would be directly downloadable by browsers.
  const policyPath = process.env.NEGOTIATION_POLICY_PATH || path.join(projectRoot, 'config', 'demo-policy.json');
  const audits = new FileAuditRepository(path.join(durableDirectory, 'audit.json'));
  const inventory = new FileInventoryRepository(path.join(projectRoot, 'inventory.json'));
  const negotiationService = new NegotiationService({
    negotiations: new FileNegotiationRepository(path.join(durableDirectory, 'sessions.json')),
    audits,
    policies: new FilePolicyRepository(policyPath),
    inventory,
  });
  const conditionReportPath = process.env.CONDITION_REPORT_PATH || path.join(projectRoot, 'config', 'condition-reports.json');
  const purchaseFlowService = new PurchaseFlowService({
    purchases: new FilePurchaseRepository(path.join(durableDirectory, 'purchase-sessions.json')),
    conditionReports: new FileConditionReportRepository(conditionReportPath),
    inventory,
    negotiations: negotiationService,
    audits,
  });
  return { negotiationService, purchaseFlowService };
}

module.exports = { createBackendServices, createNegotiationService };
