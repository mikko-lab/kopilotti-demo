'use strict';

const SALES_DEMO_VEHICLE_ID = 'veh-0001';
const SALES_DEMO_LIST_PRICE = 95_000;

/** Server-only commerce projection for the explicitly enabled Sales demo. */
class DemoSalesInventory {
  constructor(inventory) { this.inventory = inventory; }

  async getById(vehicleId) {
    const vehicle = await this.inventory.getById(vehicleId);
    if (!vehicle || vehicleId !== SALES_DEMO_VEHICLE_ID) return vehicle;
    return Object.freeze({ ...vehicle, listPrice: SALES_DEMO_LIST_PRICE });
  }
}

module.exports = { DemoSalesInventory, SALES_DEMO_LIST_PRICE, SALES_DEMO_VEHICLE_ID };
