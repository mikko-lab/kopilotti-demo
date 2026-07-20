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
const { FileHandoverPolicyRepository } = require('./infrastructure/file-handover-policy-repository');
const { DisabledPaymentProvider } = require('./adapters/disabled-payment-provider');
const { DisabledFinancingProvider } = require('./adapters/disabled-financing-provider');
const { DeterministicDemoProvider } = require('./adapters/deterministic-demo-provider');
const { DemoSalesInventory } = require('./adapters/demo-sales-inventory');

function createNegotiationService({ projectRoot = path.join(__dirname, '..'), dataDirectory = process.env.NEGOTIATION_DATA_DIR } = {}) {
  return createBackendServices({ projectRoot, dataDirectory }).negotiationService;
}

function createBackendServices({ projectRoot = path.join(__dirname, '..'), dataDirectory = process.env.NEGOTIATION_DATA_DIR } = {}) {
  const durableDirectory = dataDirectory || path.join(projectRoot, '.data', 'negotiations');
  const customerDemoEnabled = process.env.ENABLE_CUSTOMER_NEGOTIATION_DEMO === 'true';
  // Production can inject its confidential policy through NEGOTIATION_POLICY_PATH.
  // The local static server exposes only allowlisted browser assets and never
  // serves either policy file or this backend bootstrap module.
  const defaultPolicyFile = customerDemoEnabled ? 'sales-demo-policy.json' : 'demo-policy.json';
  const policyPath = process.env.NEGOTIATION_POLICY_PATH || path.join(projectRoot, 'config', defaultPolicyFile);
  const audits = new FileAuditRepository(path.join(durableDirectory, 'audit.json'));
  const fileInventory = new FileInventoryRepository(path.join(projectRoot, 'inventory.json'));
  const inventory = customerDemoEnabled
    ? new DemoSalesInventory(fileInventory)
    : fileInventory;
  const negotiationService = new NegotiationService({
    negotiations: new FileNegotiationRepository(path.join(durableDirectory, 'sessions.json')),
    audits,
    policies: new FilePolicyRepository(policyPath),
    inventory,
  });
  const conditionReportFile = customerDemoEnabled ? 'sales-demo-condition-reports.json' : 'condition-reports.json';
  const handoverPolicyFile = customerDemoEnabled ? 'sales-demo-handover-policy.json' : 'handover-policy.json';
  const conditionReportPath = process.env.CONDITION_REPORT_PATH || path.join(projectRoot, 'config', conditionReportFile);
  const handoverPolicyPath = process.env.HANDOVER_POLICY_PATH || path.join(projectRoot, 'config', handoverPolicyFile);
  const simulatedProviders = process.env.ENABLE_SIMULATED_PURCHASE_PROVIDERS === 'true';
  const purchaseFlowService = new PurchaseFlowService({
    purchases: new FilePurchaseRepository(path.join(durableDirectory, 'purchase-sessions.json')),
    conditionReports: new FileConditionReportRepository(conditionReportPath),
    inventory,
    negotiations: negotiationService,
    audits,
    handoverPolicies: new FileHandoverPolicyRepository(handoverPolicyPath),
    paymentProvider: simulatedProviders ? new DeterministicDemoProvider({ kind: 'PAYMENT', enabled: true }) : new DisabledPaymentProvider(),
    financingProvider: simulatedProviders ? new DeterministicDemoProvider({ kind: 'FINANCING', enabled: true }) : new DisabledFinancingProvider(),
  });
  return { negotiationService, purchaseFlowService };
}

module.exports = { createBackendServices, createNegotiationService };
