# Transaction core

This directory is a server-only deterministic state machine. It must not be imported into browser bundles or included in LLM prompts.

The application boundary supplies authenticated provider adapters, a dealership authorizer, a confidential versioned policy repository, a business calendar, a clock, identifiers, and a transactional repository. Provider adapters must verify the raw webhook body before returning `VerifiedProviderCallback`; the state machine never accepts a client-supplied payment status.

`JsonTransactionRepository` gives one-process deployments atomic file replacement and serial transactions. A multi-worker production deployment should implement `TransactionRepository` with a database transaction, optimistic version checks, and a unique constraint on `(provider, idempotency_key)`. Deal update, callback key, audit append, and inventory lock/release belong to that same transaction.

Handover policy and pricing policy remain backend configuration. Public API serializers should expose only customer-safe state labels, never policy versions, missing policy facts, pricing thresholds, raw provider payloads, credentials, or secrets.

Status notifications use a transactional outbox. Run `StatusEventDispatcher.start(...)` in the backend worker and connect its emitter to the authorized SSE handler. Delivery is at-least-once; consumers must treat `eventId` idempotently. In a multi-worker deployment, the database outbox implementation must claim rows safely (for example `FOR UPDATE SKIP LOCKED`) before publishing.

LLM tool calls enter through `AgentBridge`. The model-provided price is only an untrusted claim: `PriceAgreementVerifier` must validate a server-issued deterministic commercial decision bound to the deal, registration identifier, and exact price. The bridge records the verifier's `commercialDecisionId` in the audit event and never returns verifier exceptions, policy thresholds, or inventory internals to the model.

`PRICE_AGREED` requires a customer retrieved from a protected strong-authentication session. The LLM tool schema contains no customer or identity fields. Customer contact details are part of the protected transaction record but never status events or audit payloads; production database implementations must apply encryption at rest, access logging, retention rules, and least-privilege access appropriate to personal data.
