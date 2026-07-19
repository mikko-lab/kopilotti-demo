'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('js/transaction-status-stream.js', 'utf8');

test('transaction stream updates accessible status and closes at terminal states', () => {
  assert.match(source, /addEventListener\('statusChange'/);
  assert.match(source, /liveRegion\.textContent/);
  assert.match(source, /journey\.focus\(\)/);
  assert.match(source, /HANDED_OVER/);
  assert.match(source, /VOIDED/);
  assert.match(source, /stream\.close\(\)/);
});

test('transaction stream contains no commercial or handover policy rules', () => {
  for (const forbidden of ['agreedPrice', 'floorPrice', 'targetPrice', 'handoverPolicy', 'ceramicCoating']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
