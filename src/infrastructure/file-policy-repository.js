'use strict';

const fs = require('node:fs/promises');
const { validatePolicy } = require('../domain/policy');

class FilePolicyRepository {
  constructor(filePath) { this.filePath = filePath; }

  async getForVehicle(vehicleId) {
    const records = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    const record = records.find((candidate) => candidate.vehicleId === vehicleId);
    return record ? validatePolicy(record) : null;
  }
}

module.exports = { FilePolicyRepository };
