'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileNegotiationRepository } = require('../../src/infrastructure/file-negotiation-repository');
const { FileAuditRepository } = require('../../src/infrastructure/file-audit-repository');

test('persists sessions and prevents lost updates with optimistic versions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kopilotti-session-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = new FileNegotiationRepository(path.join(directory, 'sessions.json'));
  const session = { id: 's1', version: 1 };
  await repository.create(session);
  await repository.save({ ...session, version: 2 }, 1);
  await assert.rejects(repository.save({ ...session, version: 3 }, 1), { code: 'VERSION_CONFLICT' });
  assert.equal((await repository.getById('s1')).version, 2);
});

test('persists a globally hash-chained audit log and detects tampering', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kopilotti-audit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'audit.json');
  const repository = new FileAuditRepository(filePath);
  const base = { sessionId: 's1', tenantId: 't1', actorId: 'a1', occurredAt: '2026-07-19T10:00:00.000Z', payload: {} };
  await repository.append({ ...base, eventId: 'e1', eventType: 'CREATED' });
  await repository.append({ ...base, eventId: 'e2', eventType: 'DECIDED' });
  assert.deepEqual(await repository.verify(), { valid: true, checkedEvents: 2 });

  const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
  stored.events[0].actorId = 'attacker';
  await fs.writeFile(filePath, JSON.stringify(stored));
  assert.equal((await repository.verify()).valid, false);
});
