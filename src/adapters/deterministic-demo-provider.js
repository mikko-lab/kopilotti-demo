'use strict';

class DeterministicDemoProvider {
  constructor({ kind, enabled = false, outcome = 'PENDING' }) { this.kind = kind; this.enabled = enabled; this.outcome = outcome; }
  async startPayment(command) { return this.start(command); }
  async startApplication(command) { return this.start(command); }
  async start(command) {
    if (!this.enabled) throw providerError('DEMO_PROVIDER_DISABLED');
    if (this.outcome === 'FAILURE') throw providerError('PROVIDER_UNAVAILABLE');
    return { providerReference: `DEMO-${this.kind}-${command.sessionId}`, status: this.outcome, simulated: true };
  }
  async verifyCallback(payload) {
    if (!this.enabled) throw providerError('DEMO_PROVIDER_DISABLED');
    if (!payload || payload.simulated !== true || !['CONFIRMED','REJECTED','PENDING'].includes(payload.status)
      || !validIdentifier(payload.sessionId) || !validIdentifier(payload.providerReference)
      || !validIdentifier(payload.idempotencyKey)) throw providerError('CALLBACK_NOT_VERIFIED');
    return { sessionId: payload.sessionId, providerReference: payload.providerReference, status: payload.status, idempotencyKey: payload.idempotencyKey, simulated: true };
  }
  async getPaymentStatus(reference) { return { providerReference: reference, status: this.outcome, simulated: true }; }
  async getFinancingStatus(reference) { return this.getPaymentStatus(reference); }
}
function validIdentifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value); }
function providerError(code) { const error = new Error(code); error.code = code; return error; }
module.exports = { DeterministicDemoProvider };
