# Transaction core

This directory is a server-only deterministic state machine. It must not be imported into browser bundles or included in LLM prompts.

The application boundary supplies authenticated provider adapters, a dealership authorizer, a confidential versioned policy repository, a business calendar, a clock, identifiers, and a transactional repository. Provider adapters must verify the raw webhook body before returning `VerifiedProviderCallback`; the state machine never accepts a client-supplied payment status.

`JsonTransactionRepository` gives one-process deployments atomic file replacement and serial transactions. A multi-worker production deployment should implement `TransactionRepository` with a database transaction, optimistic version checks, and a unique constraint on `(provider, idempotency_key)`. Deal update, callback key, audit append, and inventory lock/release belong to that same transaction.

Handover policy and pricing policy remain backend configuration. Public API serializers should expose only customer-safe state labels, never policy versions, missing policy facts, pricing thresholds, raw provider payloads, credentials, or secrets.

Status notifications use a transactional outbox. Run `StatusEventDispatcher.start(...)` in the backend worker and connect its emitter to the authorized SSE handler. Delivery is at-least-once; consumers must treat `eventId` idempotently. In a multi-worker deployment, the database outbox implementation must claim rows safely (for example `FOR UPDATE SKIP LOCKED`) before publishing.

LLM tool calls enter through `AgentBridge`. The model-provided price is only an untrusted claim: `PriceAgreementVerifier` must validate a server-issued deterministic commercial decision bound to the deal, registration identifier, and exact price. The bridge records the verifier's `commercialDecisionId` in the audit event and never returns verifier exceptions, policy thresholds, or inventory internals to the model.

Service-to-service price locking is exposed by `createCorePriceLockRouter`. Mount its versioned path only behind mutually authenticated service networking. The chat service sends its credential in `Authorization` and the opaque protected-buyer session in `X-Buyer-Session-Token`; neither credential belongs in the LLM tool schema or JSON body. Claimed price and inventory revision remain untrusted and are independently verified before `TransactionMachine.agreePrice` performs the transactional inventory lock and outbox write.

`AgentCoreBridge` applies a three-second request timeout and a bounded retry for explicit HTTP 503 responses. It deliberately does not automatically replay a timed-out or disconnected POST: that outcome is ambiguous because the core transaction may already have committed. The stable request ID is preserved across safe 503 retries. An ambiguous result is reported as retryable and should be reconciled from the transaction status stream before a new lock command is attempted.

`PRICE_AGREED` requires a customer retrieved from a protected strong-authentication session. The LLM tool schema contains no customer or identity fields. Customer contact details are part of the protected transaction record but never status events or audit payloads; production database implementations must apply encryption at rest, access logging, retention rules, and least-privilege access appropriate to personal data.

Use `PostgresTransactionRepository` with `migrations/001_transaction_core.sql` for multi-instance deployments. It combines PostgreSQL row locks with inventory revision checks, keeps callback uniqueness in the database, processes expired deals under `FOR UPDATE SKIP LOCKED`, and claims outbox events with expiring worker leases. The injected `CustomerVault` resolves `buyer_id`; customer contact data is not stored in the transaction schema.

`PrometheusMetricsCollector` exposes low-cardinality outbox and timeout-daemon metrics, while `HealthRouter` provides liveness, readiness, and metrics handlers. Daemon workers should keep `requireDaemonHeartbeat: true`; HTTP-only workers may disable the local heartbeat requirement while retaining database and outbox readiness checks. Never attach deal, vehicle, buyer, provider, callback, or correlation identifiers as Prometheus labels.

`metrics.ts` owns the process-wide `prom-client` registry for Node.js defaults, price-lock outcomes, concurrency failures, and CDC lag. Start the standalone management endpoint with `npm run start:metrics`; it listens on `METRICS_PORT` (3001 by default) and exposes only `GET /metrics`. Application tests should inject a registry created with `createMetricsRegistry({ collectDefaults: false })` so counters remain isolated and do not create timer side effects.

Kafka CDC monitoring must come from Debezium/Kafka Connect through a `KafkaCdcMetricsProvider`; source outbox rows cannot prove Kafka delivery. Enable `requireKafkaCdc` only for a workload whose readiness truly depends on CDC. The default keeps customer-facing HTTP pods available during a connector outage while alerting on connector metrics separately.
