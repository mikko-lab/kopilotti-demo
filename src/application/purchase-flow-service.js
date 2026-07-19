'use strict';

const crypto = require('node:crypto');
const { ApplicationError } = require('./errors');
const {
  PURCHASE_PATH, PURCHASE_STATUS, createPurchaseSession, recordAcknowledgement,
  recordHumanReviewRequired, recordProceeding, recordReportDisplayed, recordReportServed,
} = require('../domain/purchase-session');
const { sameReportIdentity } = require('../domain/condition-report');

class PurchaseFlowService {
  constructor({ purchases, conditionReports, inventory, negotiations, audits, clock = () => new Date(), idGenerator = () => crypto.randomUUID() }) {
    Object.assign(this, { purchases, conditionReports, inventory, negotiations, audits, clock, idGenerator });
  }

  async create({ tenantId, actorId, vehicleId, purchasePath, negotiationSessionId, correlationId }) {
    requireCorrelationId(correlationId);
    const vehicle = await this.inventory.getById(vehicleId);
    if (!vehicle || vehicle.availability !== 'available') throw new ApplicationError('VEHICLE_NOT_AVAILABLE', 'Ajoneuvo ei ole saatavilla', 409);
    if (purchasePath === PURCHASE_PATH.NEGOTIATED) await this.validateNegotiatedPath(tenantId, vehicleId, negotiationSessionId);
    const occurredAt = this.now();
    const session = createPurchaseSession({ id: this.idGenerator(), tenantId, vehicleId, purchasePath, negotiationSessionId, createdAt: occurredAt });
    await this.purchases.create(session);
    await this.audit('PURCHASE_FLOW_STARTED', session, actorId, correlationId, occurredAt, { acknowledgement: false });
    return session;
  }

  async get({ tenantId, sessionId }) { return this.requireSession(tenantId, sessionId); }

  async openConditionReport({ tenantId, actorId, sessionId, expectedVersion, correlationId }) {
    requireCorrelationId(correlationId);
    const session = await this.requireVersion(tenantId, sessionId, expectedVersion);
    const report = await this.conditionReports.getCurrentForVehicle(session.vehicleId);
    const occurredAt = this.now();
    if (!report) {
      const blocked = recordHumanReviewRequired(session, correlationId, occurredAt);
      await this.purchases.save(blocked, expectedVersion);
      await this.audit('CONDITION_REPORT_REVIEW_REQUIRED', blocked, actorId, correlationId, occurredAt, { acknowledgement: false });
      throw new ApplicationError('CONDITION_REPORT_REVIEW_REQUIRED', 'Auton kuntotiedot vaativat myyjän tarkistuksen', 409);
    }
    const updated = recordReportServed(session, report, correlationId, occurredAt);
    await this.purchases.save(updated, expectedVersion);
    await this.audit('CONDITION_REPORT_OPENED', updated, actorId, correlationId, occurredAt, reportPayload(report, false));
    return { session: updated, report };
  }

  async markReportDisplayed({ tenantId, actorId, sessionId, expectedVersion, reportIdentity, correlationId }) {
    requireCorrelationId(correlationId);
    const session = await this.requireVersion(tenantId, sessionId, expectedVersion);
    const current = await this.requireCurrentReport(session.vehicleId, reportIdentity);
    const occurredAt = this.now();
    const updated = recordReportDisplayed(session, current, correlationId, occurredAt);
    await this.purchases.save(updated, expectedVersion);
    await this.audit('CONDITION_REPORT_VERSION_DISPLAYED', updated, actorId, correlationId, occurredAt, reportPayload(current, false));
    return updated;
  }

  async acknowledge({ tenantId, actorId, sessionId, expectedVersion, reportIdentity, acknowledged, correlationId }) {
    requireCorrelationId(correlationId);
    const session = await this.requireVersion(tenantId, sessionId, expectedVersion);
    const current = await this.requireCurrentReport(session.vehicleId, reportIdentity);
    const occurredAt = this.now();
    const updated = recordAcknowledgement(session, current, acknowledged, correlationId, occurredAt);
    await this.purchases.save(updated, expectedVersion);
    await this.audit('CONDITION_REPORT_ACKNOWLEDGED', updated, actorId, correlationId, occurredAt, reportPayload(current, true));
    return updated;
  }

  async proceed({ tenantId, actorId, sessionId, expectedVersion, reportIdentity, correlationId }) {
    requireCorrelationId(correlationId);
    const session = await this.requireVersion(tenantId, sessionId, expectedVersion);
    const current = await this.requireCurrentReport(session.vehicleId, reportIdentity);
    const occurredAt = this.now();
    const updated = recordProceeding(session, current, correlationId, occurredAt);
    await this.purchases.save(updated, expectedVersion);
    await this.audit('PURCHASE_PROCEEDED_TO_FINANCE_OR_PAYMENT', updated, actorId, correlationId, occurredAt, reportPayload(current, true));
    return updated;
  }

  async validateNegotiatedPath(tenantId, vehicleId, negotiationSessionId) {
    const negotiation = await this.negotiations.get({ tenantId, sessionId: negotiationSessionId });
    if (negotiation.vehicleId !== vehicleId) throw new ApplicationError('NEGOTIATION_VEHICLE_MISMATCH', 'Neuvottelu ei vastaa ajoneuvoa', 409);
    const latest = negotiation.decisions.at(-1);
    if (!(negotiation.status === 'ACCEPTED' || latest?.status === 'COUNTER')) {
      throw new ApplicationError('NEGOTIATED_PRICE_NOT_AVAILABLE', 'Sovittua hintaa ei ole vahvistettu', 409);
    }
  }

  async requireCurrentReport(vehicleId, identity) {
    const current = await this.conditionReports.getCurrentForVehicle(vehicleId);
    if (!current) throw new ApplicationError('CONDITION_REPORT_REVIEW_REQUIRED', 'Auton kuntotiedot vaativat myyjän tarkistuksen', 409);
    if (!sameReportIdentity(identity, current)) throw new ApplicationError('CONDITION_REPORT_CHANGED', 'Auton kuntoraportti on päivittynyt', 409);
    return current;
  }

  async requireVersion(tenantId, sessionId, expectedVersion) {
    const session = await this.requireSession(tenantId, sessionId);
    if (session.version !== expectedVersion) throw new ApplicationError('VERSION_CONFLICT', 'Ostosession versio on vanhentunut', 409);
    return session;
  }

  async requireSession(tenantId, sessionId) {
    const session = await this.purchases.getById(sessionId);
    if (!session || session.tenantId !== tenantId) throw new ApplicationError('PURCHASE_SESSION_NOT_FOUND', 'Ostosessiota ei löytynyt', 404);
    return session;
  }

  now() { return this.clock().toISOString(); }
  audit(eventType, session, actorId, correlationId, occurredAt, payload) {
    return this.audits.append({
      eventId: this.idGenerator(), sessionId: session.id, tenantId: session.tenantId,
      eventType, actorId, occurredAt,
      payload: { vehicleId: session.vehicleId, purchasePath: session.purchasePath, correlationId, ...payload },
    });
  }
}

function reportPayload(report, acknowledgement) {
  return { conditionReportId: report.id, reportVersion: report.version, contentHash: report.contentHash, acknowledgement };
}

function requireCorrelationId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new ApplicationError('CORRELATION_ID_REQUIRED', 'Kelvollinen korrelaatiotunniste vaaditaan', 400);
}

module.exports = { PurchaseFlowService, PURCHASE_PATH, PURCHASE_STATUS };
