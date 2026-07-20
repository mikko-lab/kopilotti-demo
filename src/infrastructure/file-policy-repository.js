'use strict';

const fs = require('node:fs/promises');
const { validatePolicy } = require('../domain/policy');

class FilePolicyRepository {
  constructor(filePath) { this.filePath = filePath; }

  async getForVehicle(vehicleId, dealerId = null) {
    const records = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    const matching = records.filter((candidate) => candidate.vehicleId === vehicleId);
    const record = matching.find((candidate) => dealerId && candidate.dealerId === dealerId)
      ?? matching.find((candidate) => candidate.dealerId === undefined || candidate.dealerId === null)
      ?? (dealerId === null && matching.length === 1 ? matching[0] : null);
    return record ? validatePolicy(record) : null;
  }
}

module.exports = { FilePolicyRepository };
