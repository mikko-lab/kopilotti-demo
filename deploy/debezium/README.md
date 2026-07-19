# Kopilotti outbox CDC

The connector publishes immutable outbox inserts to `kopilotti.transactions.events` with the transaction ID as the Kafka key, the outbox event ID in the `id` header, and `event_type` in the `eventType` header. Delivery is at least once: consumers must deduplicate by event ID.

Kafka Connect must enable the `env` configuration provider before this configuration is installed. Database credentials must not be committed. The replication user has only PostgreSQL replication plus connection, schema usage, and outbox table read privileges. The publication is created by the database owner during initialization, so the connector cannot broaden its own capture scope.

`transactional_outbox` is also used by the application SSE dispatcher, which updates delivery metadata. `skipped.operations=u,d,t` prevents those application-owned updates from becoming Kafka messages. Removing this setting can create invalid outbox records and must be treated as a breaking deployment change.

Debezium does not acknowledge Kafka delivery by updating a source-table `processed_at` column. Connector progress lives in Kafka Connect offsets. Monitor the Debezium PostgreSQL connector JMX metrics, particularly `Connected`, `MilliSecondsBehindSource`, and queue metrics. Adapt those values to the backend `KafkaCdcMetricsProvider` only in a deployment where Kafka CDC is a required readiness dependency.

Do not delete outbox rows until the deployment's independently monitored retention period has elapsed. A connector snapshot can republish rows, so downstream idempotency remains mandatory.

## Local CDC stack

Copy `.env.example` to `.env`, replace both password placeholders, and run `docker compose up --wait`. The stack uses single-node Kafka in KRaft combined mode, PostgreSQL with logical WAL, Debezium Connect, and a one-shot connector reconciler. The connector JSON contains the Kafka Connect config object and is applied idempotently with the REST API's `PUT /connectors/{name}/config` operation. It is production-like for integration testing but not a production topology: Kafka and Connect have no replication, transport authentication, or TLS.

Inspect connector health with `curl --fail http://localhost:8083/connectors/kopilotti-outbox-connector/status`. A healthy Connect REST endpoint does not prove that the connector task is running; tests and monitoring must inspect the connector status response as well.

Debezium does not update the source outbox after Kafka acknowledgement. `kopilotti_kafka_cdc_lag_seconds` reacts only when the application is configured with a `KafkaCdcMetricsProvider` backed by Debezium's connector metrics. Docker Compose alone does not synthesize that metric.

Run the live tool-to-Kafka scenario after the stack is healthy:

```sh
E2E_DATABASE_URL='postgresql://kopilotti_user:<app-password>@127.0.0.1:5432/kopilotti_db' npm run test:e2e:cdc
```

The normal test suite reports this scenario as skipped instead of pretending to exercise CDC. The live test fails with connector, replication-slot, and deal-state diagnostics if any stage does not become observable before its deadline.
