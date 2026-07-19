import { validatePolicy } from './handover-policy.ts';
import type { HandoverPolicy, HandoverRules } from './model.ts';

/** Creates immutable, validated server-side policy data without executable browser rules. */
export function createVersionedHandoverPolicy(input: {
  readonly tenantId: string;
  readonly version: string;
  readonly defaultRules: HandoverRules;
  readonly vehicleRules?: Readonly<Record<string, HandoverRules>>;
}): HandoverPolicy {
  const policy: HandoverPolicy = Object.freeze({
    tenantId: input.tenantId,
    version: input.version,
    defaultRules: Object.freeze({ ...input.defaultRules }),
    vehicleRules: Object.freeze(Object.fromEntries(Object.entries(input.vehicleRules ?? {}).map(([id, rules]) => [id, Object.freeze({ ...rules })]))),
  });
  validatePolicy(policy);
  return policy;
}
