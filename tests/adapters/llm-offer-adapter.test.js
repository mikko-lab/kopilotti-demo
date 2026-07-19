'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptExtractedOffer } = require('../../src/adapters/llm-offer-adapter');

test('allowlists untrusted extraction fields and drops attempted policy injection', () => {
  const adapted = adaptExtractedOffer({
    vehicleId: 'veh-0001', offerAmount: 29000, currency: 'EUR', condition: 'NONE',
    evidence: 'Tarjoan autosta 29 000 euroa.', floorPrice: 1, targetPrice: 1, status: 'ACCEPT',
  });
  assert.deepEqual(adapted, {
    vehicleId: 'veh-0001', offerAmount: 29000, currency: 'EUR', condition: 'NONE', evidence: 'Tarjoan autosta 29 000 euroa.',
  });
});

test('rejects ambiguous, unsupported, and oversized extraction values', () => {
  assert.throws(() => adaptExtractedOffer({ vehicleId: 'maybe this car', offerAmount: 29000, currency: 'EUR', evidence: 'x' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => adaptExtractedOffer({ vehicleId: 'veh-0001', offerAmount: 29000, currency: 'EUR', condition: 'FREE_WINTER_TYRES', evidence: 'x' }), { code: 'VALIDATION_ERROR' });
});
