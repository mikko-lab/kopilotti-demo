'use strict';

const fs = require('node:fs/promises');
const { normalizeConditionReport } = require('../domain/condition-report');

class FileConditionReportRepository {
  constructor(filePath) { this.filePath = filePath; }

  async getCurrentForVehicle(vehicleId) {
    let raw;
    try { raw = await fs.readFile(this.filePath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error('Condition report source must be an array');
    const candidates = records
      .filter((record) => record.vehicleId === vehicleId && record.status === 'published')
      .map(normalizeConditionReport)
      .sort((a, b) => b.inspectedAt.localeCompare(a.inspectedAt) || b.version.localeCompare(a.version));
    return candidates[0] || null;
  }
}

module.exports = { FileConditionReportRepository };
