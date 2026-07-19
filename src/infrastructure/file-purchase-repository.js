'use strict';

const { AtomicJsonStore } = require('./atomic-json-store');
const { ApplicationError } = require('../application/errors');

class FilePurchaseRepository {
  constructor(filePath) { this.store = new AtomicJsonStore(filePath, { schemaVersion: 1, sessions: {} }); }

  async getById(id) {
    const data = await this.store.read();
    return data.sessions[id] ? structuredClone(data.sessions[id]) : null;
  }

  create(session) {
    return this.store.update((data) => {
      if (data.sessions[session.id]) throw new ApplicationError('PURCHASE_SESSION_EXISTS', 'Ostosessio on jo olemassa', 409);
      data.sessions[session.id] = structuredClone(session);
      return structuredClone(session);
    });
  }

  save(session, expectedVersion) {
    return this.store.update((data) => {
      const current = data.sessions[session.id];
      if (!current) throw new ApplicationError('PURCHASE_SESSION_NOT_FOUND', 'Ostosessiota ei löytynyt', 404);
      if (current.version !== expectedVersion) throw new ApplicationError('VERSION_CONFLICT', 'Ostosessiota muutettiin toisessa pyynnössä', 409);
      data.sessions[session.id] = structuredClone(session);
      return structuredClone(session);
    });
  }
}

module.exports = { FilePurchaseRepository };
