'use strict';

const crypto = require('node:crypto');
const { ApplicationError } = require('./errors');
const {
  PURCHASE_PATH, PURCHASE_STATUS, createPurchaseSession, recordAcknowledgement,
  confirmProvider, markHandedOver, markReady, recordHumanReviewRequired, recordPrerequisites,
  recordProviderCallback, recordReportDisplayed, recordReportServed, selectPaymentMethod, startProviderFlow,
} = require('../domain/purchase-session');
const { sameReportIdentity } = require('../domain/condition-report');
const { readiness } = require('../domain/handover-policy');

class PurchaseFlowService {
  constructor({ purchases, conditionReports, inventory, negotiations, audits, handoverPolicies, paymentProvider, financingProvider, clock = () => new Date(), idGenerator = () => crypto.randomUUID() }) {
    Object.assign(this, { purchases, conditionReports, inventory, negotiations, audits, handoverPolicies, paymentProvider, financingProvider, clock, idGenerator });
  }

  async create({ tenantId, actorId, vehicleId, purchasePath, negotiationSessionId, correlationId }) {
    requireCorrelationId(correlationId);
    const vehicle = await this.inventory.getById(vehicleId);
    if (!vehicle || vehicle.availability !== 'available') throw new ApplicationError('VEHICLE_NOT_AVAILABLE', 'Ajoneuvo ei ole saatavilla', 409);
    const policy = await this.handoverPolicies.getCurrent();
    if (!policy) throw new ApplicationError('HANDOVER_POLICY_NOT_FOUND', 'Ostopolku vaatii myyjän tarkistuksen', 409);
    const agreedPrice = purchasePath === PURCHASE_PATH.NEGOTIATED
      ? await this.validateNegotiatedPath(tenantId, actorId, vehicleId, negotiationSessionId)
      : vehicle.listPrice;
    const occurredAt = this.now();
    const session = createPurchaseSession({ id: this.idGenerator(), tenantId, vehicleId, purchasePath, negotiationSessionId, agreedPrice, handoverPolicyVersion: policy.policyVersion, createdAt: occurredAt });
    await this.purchases.create(session);
    await this.audit('PRICE_AGREED', session, actorId, correlationId, occurredAt, { acknowledgement: false, agreedPrice, handoverPolicyVersion: policy.policyVersion });
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

  async selectPaymentMethod({ tenantId, actorId, sessionId, expectedVersion, method, correlationId }) {
    requireCorrelationId(correlationId); const session=await this.requireVersion(tenantId,sessionId,expectedVersion); const occurredAt=this.now();
    const updated=selectPaymentMethod(session,method,occurredAt); await this.purchases.save(updated,expectedVersion);
    await this.audit('PAYMENT_METHOD_SELECTED',updated,actorId,correlationId,occurredAt,{previousState:session.status,newState:updated.status,transitionSource:'CUSTOMER'}); return updated;
  }

  async startProvider({ tenantId, actorId, sessionId, expectedVersion, correlationId }) {
    requireCorrelationId(correlationId); const session=await this.requireVersion(tenantId,sessionId,expectedVersion); const occurredAt=this.now();
    try {
      const result=session.paymentMethod==='PAYMENT' ? await this.paymentProvider.startPayment({sessionId,vehicleId:session.vehicleId,amount:session.agreedPrice,currency:'EUR'}) : await this.financingProvider.startApplication({sessionId,vehicleId:session.vehicleId,amount:session.agreedPrice,currency:'EUR'});
      const updated=startProviderFlow(session,result.providerReference,occurredAt); await this.purchases.save(updated,expectedVersion);
      await this.audit(`${session.paymentMethod}_STARTED`,updated,actorId,correlationId,occurredAt,{previousState:session.status,newState:updated.status,transitionSource:result.simulated?'SIMULATED_DEMO_PROVIDER':'PROVIDER',externalProviderReference:result.providerReference,simulated:result.simulated===true}); return {...updated,simulated:result.simulated===true};
    } catch(error) { await this.audit(`${session.paymentMethod}_START_FAILED`,session,actorId,correlationId,occurredAt,{previousState:session.status,newState:session.status,transitionSource:'PROVIDER',success:false}); throw new ApplicationError('PROVIDER_UNAVAILABLE',session.paymentMethod==='PAYMENT'?'Maksupalveluun ei saatu yhteyttä':'Rahoituspalveluun ei saatu yhteyttä',503); }
  }

  async handleProviderCallback({ tenantId = 'demo-dealership', kind, payload, headers, actorId, correlationId }) {
    requireCorrelationId(correlationId); const provider=kind==='PAYMENT'?this.paymentProvider:this.financingProvider; let verified;
    try { verified=await provider.verifyCallback(payload,headers); }
    catch (_error) { throw new ApplicationError('CALLBACK_NOT_VERIFIED','Provider callback could not be verified',401); }
    const session=await this.requireSession(tenantId,verified.sessionId); if(session.processedCallbacks[verified.idempotencyKey]) return session;
    if(verified.status!=='CONFIRMED') { const occurredAt=this.now(); const updated=recordProviderCallback(session,verified.idempotencyKey,occurredAt); await this.purchases.save(updated,session.version); await this.audit(`${kind}_CALLBACK_${verified.status}`,updated,actorId,correlationId,occurredAt,{previousState:session.status,newState:updated.status,transitionSource:verified.simulated?'SIMULATED_DEMO_PROVIDER':'PROVIDER',externalProviderReference:verified.providerReference,idempotencyKey:verified.idempotencyKey,success:false}); return updated; }
    const occurredAt=this.now(); let updated=confirmProvider(session,kind,verified.providerReference,verified.idempotencyKey,occurredAt); const policy=await this.handoverPolicies.getByVersion(session.handoverPolicyVersion);
    if(!policy) throw new ApplicationError('HANDOVER_POLICY_NOT_FOUND','Luovutuspolicy vaatii tarkistuksen',409);
    if(readiness(policy,session.paymentMethod,updated.prerequisites).ready) updated=markReady(updated,occurredAt);
    await this.purchases.save(updated,session.version); await this.audit(`${kind}_CONFIRMED`,updated,actorId,correlationId,occurredAt,{agreedPrice:session.agreedPrice,previousState:session.status,newState:updated.status,transitionSource:verified.simulated?'SIMULATED_DEMO_PROVIDER':'PROVIDER',externalProviderReference:verified.providerReference,idempotencyKey:verified.idempotencyKey,handoverPolicyVersion:session.handoverPolicyVersion,success:true}); return {...updated,simulated:verified.simulated===true};
  }

  async recordOperationalPrerequisites({tenantId,actorId,sessionId,expectedVersion,facts,correlationId,authorized}) { if(!authorized) throw new ApplicationError('FORBIDDEN','Valtuutus vaaditaan',403); requireCorrelationId(correlationId); const session=await this.requireVersion(tenantId,sessionId,expectedVersion); const occurredAt=this.now(); let updated=recordPrerequisites(session,facts,occurredAt); const policy=await this.handoverPolicies.getByVersion(session.handoverPolicyVersion); if(!policy) throw new ApplicationError('HANDOVER_POLICY_NOT_FOUND','Luovutuspolicy vaatii tarkistuksen',409); if(readiness(policy,session.paymentMethod,updated.prerequisites).ready&&['PAYMENT_CONFIRMED','FINANCING_CONFIRMED'].includes(updated.status)) updated=markReady(updated,occurredAt); await this.purchases.save(updated,expectedVersion); await this.audit('OPERATIONAL_PREREQUISITES_RECORDED',updated,actorId,correlationId,occurredAt,{previousState:session.status,newState:updated.status,transitionSource:'AUTHORIZED_DEALERSHIP_ACTOR',handoverPolicyVersion:session.handoverPolicyVersion,success:true}); return updated; }
  async handOver({tenantId,actorId,sessionId,expectedVersion,correlationId,authorized}) { if(!authorized) throw new ApplicationError('FORBIDDEN','Valtuutus vaaditaan',403); requireCorrelationId(correlationId); const session=await this.requireVersion(tenantId,sessionId,expectedVersion); const occurredAt=this.now(); const updated=markHandedOver(session,occurredAt); await this.purchases.save(updated,expectedVersion); await this.audit('VEHICLE_HANDED_OVER',updated,actorId,correlationId,occurredAt,{previousState:session.status,newState:updated.status,transitionSource:'AUTHORIZED_DEALERSHIP_ACTOR'}); return updated; }

  async validateNegotiatedPath(tenantId, actorId, vehicleId, negotiationSessionId) {
    const negotiation = await this.negotiations.get({ tenantId, sessionId: negotiationSessionId });
    if (negotiation.vehicleId !== vehicleId) throw new ApplicationError('NEGOTIATION_VEHICLE_MISMATCH', 'Neuvottelu ei vastaa ajoneuvoa', 409);
    const latest = negotiation.decisions.at(-1);
    if (negotiation.status === 'ACCEPTED' && Number.isSafeInteger(latest?.approvedAmount)) return latest.approvedAmount;
    if (negotiation.status === 'PRICE_AGREED' && Number.isSafeInteger(negotiation.agreedPrice)) return negotiation.agreedPrice;
    if (latest?.status === 'COUNTER') return (await this.negotiations.agreeLatestCounter({ tenantId, actorId, sessionId: negotiationSessionId })).agreedPrice;
    throw new ApplicationError('NEGOTIATED_PRICE_NOT_AVAILABLE', 'Sovittua hintaa ei ole vahvistettu', 409);
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
