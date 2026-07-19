'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class AtomicJsonStore {
  #queue = Promise.resolve();

  constructor(filePath, initialValue) {
    this.filePath = filePath;
    this.initialValue = initialValue;
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return structuredClone(this.initialValue);
    }
  }

  update(mutator) {
    const operation = this.#queue.then(async () => {
      const current = await this.read();
      const result = await mutator(current);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
      return result;
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { AtomicJsonStore };
