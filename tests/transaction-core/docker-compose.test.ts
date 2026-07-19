import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composePath = new URL('../../docker-compose.yml', import.meta.url);
const initPath = new URL('../../deploy/postgres/002-create-debezium-user.sh', import.meta.url);

test('local CDC stack pins official images, enables logical WAL, and requires external passwords', async () => {
  const compose = await readFile(composePath, 'utf8');
  assert.match(compose, /wal_level=logical/); assert.match(compose, /max_replication_slots=4/); assert.match(compose, /max_wal_senders=4/);
  assert.match(compose, /postgres:15\.13-alpine/); assert.match(compose, /quay\.io\/debezium\/kafka:3\.6/); assert.match(compose, /quay\.io\/debezium\/connect:3\.6/);
  assert.match(compose, /NODE_ROLE: combined/); assert.doesNotMatch(compose, /zookeeper|:latest|local_secure_password|deemate/i);
  assert.match(compose, /POSTGRES_PASSWORD:\s+\$\{POSTGRES_PASSWORD:\?/); assert.match(compose, /DEBEZIUM_DATABASE_PASSWORD:\s+\$\{DEBEZIUM_DATABASE_PASSWORD:\?/);
  assert.match(compose, /condition: service_healthy/); assert.match(compose, /connector-init:/);
  assert.match(compose, /--request PUT/); assert.match(compose, /connectors\/kopilotti-outbox-connector\/config/);
  assert.match(compose, /CONNECT_CONFIG_PROVIDERS:\s+env/); assert.match(compose, /CONNECT_CONFIG_PROVIDERS_ENV_CLASS:/);
  assert.match(compose, /"state":"FAILED"/); assert.match(compose, /"state":"RUNNING"/);
});

test('database init creates a least-privilege CDC role and fixed-scope publication', async () => {
  const script = await readFile(initPath, 'utf8');
  assert.match(script, /LOGIN REPLICATION/); assert.match(script, /GRANT SELECT ON TABLE public\.transactional_outbox/);
  assert.match(script, /CREATE PUBLICATION kopilotti_outbox_publication FOR TABLE public\.transactional_outbox/);
  assert.doesNotMatch(script, /GRANT ALL|SUPERUSER/);
});
