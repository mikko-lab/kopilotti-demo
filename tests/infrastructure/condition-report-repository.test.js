'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileConditionReportRepository } = require('../../src/infrastructure/file-condition-report-repository');

test('returns the newest published customer-safe report and strips dealer-only fields', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kopilotti-reports-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'reports.json');
  await fs.writeFile(filePath, JSON.stringify([
    { id: 'draft', vehicleId: 'veh-0001', status: 'draft', version: 'v3', inspectedAt: '2026-07-20T11:00:00Z', sections: { generalCondition: 'Luonnos.' } },
    { id: 'old', vehicleId: 'veh-0001', status: 'published', version: 'v1', inspectedAt: '2026-07-19T09:00:00Z', sections: { generalCondition: 'Vanha.' } },
    { id: 'current', vehicleId: 'veh-0001', status: 'published', version: 'v2', inspectedAt: '2026-07-20T09:00:00Z', sections: { generalCondition: 'Fiktiivinen testitieto.', internalDealerNotes: 'SALAINEN' }, internalDealerNotes: 'SALAINEN' },
  ]));
  const report = await new FileConditionReportRepository(filePath).getCurrentForVehicle('veh-0001');
  assert.equal(report.id, 'current');
  assert.equal(report.internalDealerNotes, undefined);
  assert.equal(report.sections.internalDealerNotes, undefined);
});

test('returns null when no configured report source exists', async () => {
  const repository = new FileConditionReportRepository('/tmp/kopilotti-definitely-missing-condition-report.json');
  assert.equal(await repository.getCurrentForVehicle('veh-0001'), null);
});
