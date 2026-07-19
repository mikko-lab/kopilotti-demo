'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');

class FileInventoryRepository {
  constructor(filePath) { this.filePath = filePath; }

  async getById(vehicleId) {
    const raw = await fs.readFile(this.filePath, 'utf8');
    const records = JSON.parse(raw);
    const vehicle = records.find((candidate) => candidate.id === vehicleId);
    if (!vehicle) return null;
    return {
      id: vehicle.id,
      listPrice: vehicle.price,
      availability: vehicle.available,
      revision: crypto.createHash('sha256').update(raw).digest('hex'),
    };
  }
}

module.exports = { FileInventoryRepository };
