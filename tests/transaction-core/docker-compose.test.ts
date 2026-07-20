import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composePath = new URL('../../docker-compose.yml', import.meta.url);
const initPath = new URL('../../deploy/postgres/002-create-debezium-user.sh', import.meta.url);
const debeziumImagePath = new URL('../../deploy/debezium/Dockerfile', import.meta.url);
const prometheusPath = new URL('../../deploy/monitoring/prometheus.yml', import.meta.url);
const alertsPath = new URL('../../deploy/monitoring/alerts.yml', import.meta.url);
const jmxPath = new URL('../../deploy/monitoring/debezium-jmx.yml', import.meta.url);
const dashboardPath = new URL('../../deploy/monitoring/grafana/dashboards/kopilotti-cdc.json', import.meta.url);
const datasourcePath = new URL('../../deploy/monitoring/grafana/provisioning/datasources/prometheus.yml', import.meta.url);

test('local CDC stack pins official images, enables logical WAL, and requires external passwords', async () => {
  const compose = await readFile(composePath, 'utf8');
  assert.match(compose, /wal_level=logical/); assert.match(compose, /max_replication_slots=4/); assert.match(compose, /max_wal_senders=4/);
  assert.match(compose, /postgres:15\.13-alpine/); assert.match(compose, /quay\.io\/debezium\/kafka:3\.6/); assert.match(compose, /kopilotti-sales\/debezium-connect-jmx:3\.6-jmx-1\.0\.1/);
  assert.match(compose, /NODE_ROLE: combined/); assert.doesNotMatch(compose, /zookeeper|:latest|local_secure_password|deemate/i);
  assert.match(compose, /POSTGRES_PASSWORD:\s+\$\{POSTGRES_PASSWORD:\?/); assert.match(compose, /DEBEZIUM_DATABASE_PASSWORD:\s+\$\{DEBEZIUM_DATABASE_PASSWORD:\?/);
  assert.match(compose, /condition: service_healthy/); assert.match(compose, /connector-init:/);
  assert.match(compose, /migrations\/002_processed_events\.sql/);
  assert.match(compose, /--request PUT/); assert.match(compose, /connectors\/kopilotti-outbox-connector\/config/);
  assert.match(compose, /CONNECT_CONFIG_PROVIDERS:\s+env/); assert.match(compose, /CONNECT_CONFIG_PROVIDERS_ENV_CLASS:/);
  assert.match(compose, /"state":"FAILED"/); assert.match(compose, /"state":"RUNNING"/);
});

test('monitoring stack uses pinned images and scrapes the real Debezium JMX endpoint', async () => {
  const [compose, dockerfile, prometheus, alerts, jmx, datasource] = await Promise.all([
    readFile(composePath, 'utf8'),
    readFile(debeziumImagePath, 'utf8'),
    readFile(prometheusPath, 'utf8'),
    readFile(alertsPath, 'utf8'),
    readFile(jmxPath, 'utf8'),
    readFile(datasourcePath, 'utf8'),
  ]);

  assert.match(compose, /prom\/prometheus:v3\.12\.0/);
  assert.match(compose, /grafana\/grafana:12\.4\.0/);
  assert.doesNotMatch(compose, /:latest/);
  assert.match(compose, /GF_SECURITY_ADMIN_PASSWORD:\s+\$\{GRAFANA_ADMIN_PASSWORD:\?/);
  assert.match(compose, /deploy\/monitoring\/prometheus\.yml/);
  assert.match(compose, /deploy\/monitoring\/grafana\/provisioning/);
  assert.match(dockerfile, /FROM quay\.io\/debezium\/connect:3\.6/);
  assert.match(dockerfile, /JMX_EXPORTER_VERSION=1\.0\.1/);
  assert.match(dockerfile, /sha256sum --check --strict/);
  assert.match(prometheus, /debezium-connect:9404/);
  assert.doesNotMatch(prometheus, /debezium-connect:8083/);
  assert.match(prometheus, /host\.docker\.internal:3001/);
  assert.match(alerts, /DebeziumMetricsDown/);
  assert.match(alerts, /DebeziumSourceLagHigh/);
  assert.match(jmx, /MilliSecondsBehindSource/);
  assert.match(datasource, /http:\/\/prometheus:9090/);
});

test('Grafana dashboard is valid JSON and contains no hidden pricing data', async () => {
  const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8')) as { panels?: unknown[] };
  assert.ok(Array.isArray(dashboard.panels));
  assert.ok(dashboard.panels.length > 0);
  const serialized = JSON.stringify(dashboard);
  assert.doesNotMatch(serialized, /floor[_ -]?price|target[_ -]?price|acceptance[_ -]?threshold/i);
});

test('database init creates a least-privilege CDC role and fixed-scope publication', async () => {
  const script = await readFile(initPath, 'utf8');
  assert.match(script, /LOGIN REPLICATION/); assert.match(script, /GRANT SELECT ON TABLE public\.transactional_outbox/);
  assert.match(script, /CREATE PUBLICATION kopilotti_outbox_publication FOR TABLE public\.transactional_outbox/);
  assert.doesNotMatch(script, /GRANT ALL|SUPERUSER/);
});
