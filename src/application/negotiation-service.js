'use strict';

const crypto = require('node:crypto');
const { decideNegotiation } = require('../domain/negotiation-engine');
const { acceptLatestCounter, createSession, recordDecision, transitionSession, SESSION_STATUS } = require('../domain/negotiation-session');
const { ApplicationError } = require('./errors');

class NegotiationService {
  constructor({ negotiations, audits, policies, inventory, clock = () => new Date(), idGenerator = () => crypto.randomUUID() }) {
    Object.assign(this, { negotiations, audits, policies, inventory, clock, idGenerator });
  }

  async create({ tenantId, actorId, vehicleId }) {
    const [policy, vehicle] = await Promise.all([
      this.policies.getForVehicle(vehicleId, tenantId),
      this.inventory.getById(vehicleId),
    ]);
    if (!policy) throw new ApplicationError('POLICY_NOT_FOUND', 'Negotiation requires human review', 409);
    if (!vehicle) throw new ApplicationError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    if (vehicle.listPrice !== policy.listPrice || vehicle.availability !== 'available') {
      throw new ApplicationError('VEHICLE_NOT_NEGOTIABLE', 'Vehicle requires human review', 409);
    }
    const occurredAt = this.clock().toISOString();
    const session = createSession({ id: this.idGenerator(), tenantId, vehicleId, policyVersion: policy.policyVersion, inventoryRevision: vehicle.revision, createdAt: occurredAt });
    await this.negotiations.create(session);
    await this.audit('NEGOTIATION_CREATED', session, actorId, occurredAt, { vehicleId, policyVersion: policy.policyVersion, inventoryRevision: vehicle.revision });
    return session;
  }

  async get({ tenantId, sessionId }) {
    return this.requireSession(tenantId, sessionId);
  }

  async submitOffer({ tenantId, actorId, sessionId, commandId, expectedVersion, offer }) {
    const session = await this.requireSession(tenantId, sessionId);
    const priorDecisionId = session.processedCommands[commandId];
    if (priorDecisionId) return session.decisions.find((entry) => entry.decisionId === priorDecisionId);
    if (session.version !== expectedVersion) throw new ApplicationError('VERSION_CONFLICT', 'Session version is stale', 409);
    if (offer.vehicleId !== session.vehicleId) throw new ApplicationError('VEHICLE_MISMATCH', 'Offer vehicle does not match session', 400);

    const [policy, vehicle] = await Promise.all([
      this.policies.getForVehicle(session.vehicleId, tenantId),
      this.inventory.getById(session.vehicleId),
    ]);
    if (!policy || policy.policyVersion !== session.policyVersion) {
      throw new ApplicationError('POLICY_UNAVAILABLE', 'Negotiation requires human review', 409);
    }
    if (!vehicle) throw new ApplicationError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);

    const occurredAt = this.clock().toISOString();
    const decisionId = this.idGenerator();
    const decision = decideNegotiation({
      policy, vehicle, offerAmount: offer.offerAmount, currency: offer.currency, round: session.nextRound,
      previousCustomerOffers: session.decisions.map((entry) => entry.offerAmount),
      previousCounterOffers: session.decisions.filter((entry) => Number.isSafeInteger(entry.counterAmount)).map((entry) => entry.counterAmount),
    });
    const updated = recordDecision(session, { commandId, decisionId, offerAmount: offer.offerAmount, currency: offer.currency, decision, occurredAt });
    await this.negotiations.save(updated, expectedVersion);
    await this.audit('NEGOTIATION_DECIDED', updated, actorId, occurredAt, {
      decisionId, commandId, offerAmount: offer.offerAmount, currency: offer.currency,
      condition: offer.condition, evidence: offer.evidence, decision,
      policyVersion: session.policyVersion, inventoryRevision: vehicle.revision,
    });
    return updated.decisions.at(-1);
  }

  async transition({ tenantId, actorId, sessionId, expectedVersion, status }) {
    const session = await this.requireSession(tenantId, sessionId);
    if (session.version !== expectedVersion) throw new ApplicationError('VERSION_CONFLICT', 'Session version is stale', 409);
    const occurredAt = this.clock().toISOString();
    const updated = transitionSession(session, status, occurredAt);
    await this.negotiations.save(updated, expectedVersion);
    await this.audit(`NEGOTIATION_${status}`, updated, actorId, occurredAt, {});
    return updated;
  }

  async agreeLatestCounter({ tenantId, actorId, sessionId }) {
    const session = await this.requireSession(tenantId, sessionId);
    const occurredAt = this.clock().toISOString();
    const updated = acceptLatestCounter(session, occurredAt);
    await this.negotiations.save(updated, session.version);
    await this.audit('NEGOTIATION_PRICE_AGREED', updated, actorId, occurredAt, { agreedPrice: updated.agreedPrice });
    return updated;
  }

  async requireSession(tenantId, sessionId) {
    const session = await this.negotiations.getById(sessionId);
    if (!session || session.tenantId !== tenantId) throw new ApplicationError('SESSION_NOT_FOUND', 'Session not found', 404);
    return session;
  }

  audit(eventType, session, actorId, occurredAt, payload) {
    return this.audits.append({ eventId: this.idGenerator(), sessionId: session.id, tenantId: session.tenantId, eventType, actorId, occurredAt, payload });
  }
}

module.exports = { NegotiationService, SESSION_STATUS };
