# Kopilotti outbox CDC

The connector publishes immutable outbox inserts to `kopilotti.transactions.events` with the transaction ID as the Kafka key, the outbox event ID in the `id` header, and `event_type` in the `eventType` header. Delivery is at least once: consumers must deduplicate by event ID.

Kafka Connect must enable the `env` and `file` configuration providers before this configuration is installed. Database credentials must not be committed. The replication user should have only the PostgreSQL replication and table-read privileges required by Debezium.

`transactional_outbox` is also used by the application SSE dispatcher, which updates delivery metadata. `skipped.operations=u,d,t` prevents those application-owned updates from becoming Kafka messages. Removing this setting can create invalid outbox records and must be treated as a breaking deployment change.

Debezium does not acknowledge Kafka delivery by updating a source-table `processed_at` column. Connector progress lives in Kafka Connect offsets. Monitor the Debezium PostgreSQL connector JMX metrics, particularly `Connected`, `MilliSecondsBehindSource`, and queue metrics. Adapt those values to the backend `KafkaCdcMetricsProvider` only in a deployment where Kafka CDC is a required readiness dependency.

Do not delete outbox rows until the deployment's independently monitored retention period has elapsed. A connector snapshot can republish rows, so downstream idempotency remains mandatory.
