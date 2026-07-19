'use strict';

const { AtomicJsonStore } = require('./atomic-json-store');
const { createAuditEvent, verifyAuditChain } = require('../domain/audit-event');

class FileAuditRepository {
  constructor(filePath) {
    this.store = new AtomicJsonStore(filePath, { schemaVersion: 1, events: [] });
  }

  append(input) {
    return this.store.update((data) => {
      const previous = data.events.at(-1);
      const event = createAuditEvent(input, previous);
      data.events.push(event);
      return structuredClone(event);
    });
  }

  async listBySession(sessionId) {
    const data = await this.store.read();
    return data.events.filter((event) => event.sessionId === sessionId).map((event) => structuredClone(event));
  }

  async verify() {
    const data = await this.store.read();
    return { valid: verifyAuditChain(data.events), checkedEvents: data.events.length };
  }
}

module.exports = { FileAuditRepository };
