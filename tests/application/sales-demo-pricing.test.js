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

test('Sales demo first low offer receives the first policy step without exposing the boundary', async () => {
  const decision = await decide(92_500);
  assert.equal(decision.status, 'COUNTER');
  assert.equal(decision.counterAmount, 94_700);
  assert.equal(decision.messageCode, 'COUNTER_ROUND_1');
  assert.equal(decision.acceptanceFloor, undefined);
});

test('Sales demo steps down only when the customer improves the offer', async () => {
  const [vehicle, policy] = await Promise.all([inventory.getById('veh-0001'), policies.getForVehicle('veh-0001')]);
  const second = decideNegotiation({ vehicle, policy, offerAmount: 93_300, currency: 'EUR', round: 2, previousCustomerOffers: [92_500], previousCounterOffers: [94_700] });
  assert.equal(second.status, 'COUNTER');
  assert.equal(second.counterAmount, 94_300);
  const third = decideNegotiation({ vehicle, policy, offerAmount: 93_500, currency: 'EUR', round: 3, previousCustomerOffers: [92_500, 93_300], previousCounterOffers: [94_700, 94_300] });
  assert.equal(third.status, 'COUNTER');
  assert.equal(third.counterAmount, 93_900);
});

test('Sales demo escalates a repeated or lower offer and rounds beyond the automated limit', async () => {
  const [vehicle, policy] = await Promise.all([inventory.getById('veh-0001'), policies.getForVehicle('veh-0001')]);
  const repeated = decideNegotiation({ vehicle, policy, offerAmount: 92_500, currency: 'EUR', round: 2, previousCustomerOffers: [92_500], previousCounterOffers: [94_700] });
  assert.equal(repeated.status, 'ESCALATE');
  const exhausted = decideNegotiation({ vehicle, policy, offerAmount: 93_800, currency: 'EUR', round: 4, previousCustomerOffers: [92_500, 93_300, 93_500], previousCounterOffers: [94_700, 94_300, 93_900] });
  assert.equal(exhausted.status, 'ESCALATE');
});

test('Sales demo inventory projection leaves the public inventory file unchanged', async () => {
  const publicVehicle = await new FileInventoryRepository(path.join(projectRoot, 'inventory.json')).getById('veh-0001');
  const salesVehicle = await inventory.getById('veh-0001');
  assert.equal(publicVehicle.listPrice, 30_686);
  assert.equal(salesVehicle.listPrice, 95_000);
});
