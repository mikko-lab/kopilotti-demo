import { invariant } from './errors.ts';
import type { HandoverFacts, HandoverPolicy, HandoverRules, LockedVehicle } from './model.ts';

const RULE_TO_FACT: ReadonlyArray<readonly [keyof HandoverRules, keyof HandoverFacts]> = [
  ['requireCeramicCoatingCompleted', 'ceramicCoatingCompleted'],
  ['requireHandoverInspectionCompleted', 'handoverInspectionCompleted'],
  ['requireIdentityVerified', 'identityVerified'],
  ['requireRegistrationCompleted', 'registrationCompleted'],
  ['requireInsuranceInformationReceived', 'insuranceInformationReceived'],
  ['requireManualApproval', 'manualApproval'],
];

export function validatePolicy(policy: HandoverPolicy): void {
  invariant(Boolean(policy.tenantId && policy.version), 'INVALID_HANDOVER_POLICY', 'Policy identity is required');
  validateRules(policy.defaultRules);
  for (const rules of Object.values(policy.vehicleRules)) validateRules(rules);
}

export function assertHandoverReady(policy: HandoverPolicy, vehicle: LockedVehicle, facts: HandoverFacts): void {
  validatePolicy(policy);
  const rules = policy.vehicleRules[vehicle.vehicleId] ?? policy.defaultRules;
  const missing = RULE_TO_FACT.filter(([rule, fact]) => rules[rule] && facts[fact] !== true).map(([, fact]) => fact);
  invariant(missing.length === 0, 'HANDOVER_REQUIREMENTS_MISSING', `Missing handover facts: ${missing.join(',')}`);
}

function validateRules(rules: HandoverRules): void {
  invariant(Boolean(rules), 'INVALID_HANDOVER_POLICY', 'Handover rules are required');
  for (const [rule] of RULE_TO_FACT) invariant(typeof rules[rule] === 'boolean', 'INVALID_HANDOVER_POLICY', `${rule} must be boolean`);
}
