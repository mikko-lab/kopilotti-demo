import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const connectorPath = new URL('../../deploy/debezium/debezium-outbox-connector.json', import.meta.url);

test('Debezium connector uses the purpose-built outbox router and contains no committed credentials', async () => {
  const document = JSON.parse(await readFile(connectorPath, 'utf8')) as { config: Record<string, string> };
  const config = document.config;
  assert.equal(config['connector.class'], 'io.debezium.connector.postgresql.PostgresConnector');
  assert.equal(config['table.include.list'], 'public.transactional_outbox');
  assert.equal(config['transforms.outbox.type'], 'io.debezium.transforms.outbox.EventRouter');
  assert.equal(config['transforms.outbox.table.field.event.id'], 'event_id');
  assert.equal(config['transforms.outbox.table.field.event.key'], 'transaction_id');
  assert.equal(config['transforms.outbox.table.field.event.payload'], 'payload');
  assert.equal(config['skipped.operations'], 'u,d,t');
  assert.match(config['database.password'] ?? '', /^\$\{file:/);
  assert.match(config['database.hostname'] ?? '', /^\$\{env:/);
  assert.doesNotMatch(JSON.stringify(config), /postgres-service|secret-password|ContentBasedRouter|ExtractNewRecordState|processed_at/);
});
