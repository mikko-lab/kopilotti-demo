'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DemoSalesInventory } = require('../../src/adapters/demo-sales-inventory');
const { FileInventoryRepository } = require('../../src/infrastructure/file-inventory-repository');
const { FilePolicyRepository } = require('../../src/infrastructure/file-policy-repository');
const { decideNegotiation } = require('../../src/domain/negotiation-engine');

const projectRoot = path.join(__dirname, '..', '..');
const inventory = new DemoSalesInventory(new FileInventoryRepository(path.join(projectRoot, 'inventory.json')));
const policies = new FilePolicyRepository(path.join(projectRoot, 'config', 'sales-demo-policy.json'));

async function decide(offerAmount) {
  const [vehicle, policy] = await Promise.all([inventory.getById('veh-0001'), policies.getForVehicle('veh-0001')]);
  return decideNegotiation({ vehicle, policy, offerAmount, currency: 'EUR', round: 1 });
}

test('Sales demo applies the server-owned acceptance boundary before lower-price branches', async () => {
  const cases = [
    [93_899, 'COUNTER'],
    [93_900, 'ACCEPT'],
    [94_100, 'ACCEPT'],
    [95_000, 'ACCEPT'],
  ];
  for (const [offerAmount, expectedStatus] of cases) {
    const decision = await decide(offerAmount);
    assert.equal(decision.status, expectedStatus, String(offerAmount));
    if (expectedStatus === 'ACCEPT') assert.equal(decision.approvedAmount, offerAmount);
  }
});

test('Sales demo does not accidentally accept 92 700 euros', async () => {
  const decision = await decide(92_700);
  assert.equal(decision.status, 'COUNTER');
  assert.equal(decision.counterAmount, 93_900);
});

test('Sales demo inventory projection leaves the public inventory file unchanged', async () => {
  const publicVehicle = await new FileInventoryRepository(path.join(projectRoot, 'inventory.json')).getById('veh-0001');
  const salesVehicle = await inventory.getById('veh-0001');
  assert.equal(publicVehicle.listPrice, 30_686);
  assert.equal(salesVehicle.listPrice, 95_000);
});
