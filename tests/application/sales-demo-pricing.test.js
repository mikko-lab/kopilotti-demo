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

test('Sales demo deterministically accepts 93 900 euros at the server-owned threshold', async () => {
  const decisions = await Promise.all(Array.from({ length: 5 }, () => decide(93_900)));
  for (const decision of decisions) {
    assert.equal(decision.status, 'ACCEPT');
    assert.equal(decision.approvedAmount, 93_900);
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
