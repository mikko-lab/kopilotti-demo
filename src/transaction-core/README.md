# Transaction core

This directory is a server-only deterministic state machine. It must not be imported into browser bundles or included in LLM prompts.

The application boundary supplies authenticated provider adapters, a dealership authorizer, a confidential versioned policy repository, a business calendar, a clock, identifiers, and a transactional repository. Provider adapters must verify the raw webhook body before returning `VerifiedProviderCallback`; the state machine never accepts a client-supplied payment status.

`JsonTransactionRepository` gives one-process deployments atomic file replacement and serial transactions. A multi-worker production deployment should implement `TransactionRepository` with a database transaction, optimistic version checks, and a unique constraint on `(provider, idempotency_key)`. Deal update, callback key, audit append, and inventory lock/release belong to that same transaction.

Handover policy and pricing policy remain backend configuration. Public API serializers should expose only customer-safe state labels, never policy versions, missing policy facts, pricing thresholds, raw provider payloads, credentials, or secrets.
