'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConditionReport } = require('../../src/domain/condition-report');

test('creates an immutable hash from customer-safe report content only', () => {
  const report = normalizeConditionReport({
    id: 'report-1', vehicleId: 'veh-0001', version: 'v1', inspectedAt: '2026-07-20T09:00:00Z',
    sections: { generalCondition: 'Testiraportin yleiskunto.', internalDealerNotes: 'EI ASIAKKAALLE' },
    photographs: [{ url: '/reports/damage.jpg', alt: 'Testivaurio etuovessa' }],
    internalDealerNotes: 'EI ASIAKKAALLE',
  });
  assert.equal(report.sections.internalDealerNotes, undefined);
  assert.equal(report.internalDealerNotes, undefined);
  assert.match(report.contentHash, /^[a-f0-9]{64}$/);
});

test('rejects an empty report rather than inventing missing condition data', () => {
  assert.throws(() => normalizeConditionReport({ id: 'r', vehicleId: 'v', version: '1', inspectedAt: '2026-07-20T09:00:00Z', sections: {} }), { code: 'VALIDATION_ERROR' });
});
