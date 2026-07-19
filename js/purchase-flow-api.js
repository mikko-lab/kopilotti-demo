const DEFAULT_BACKEND_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : 'https://kopilotti-demo-production.up.railway.app';

export class PurchaseFlowApi {
  constructor({ backendUrl = DEFAULT_BACKEND_URL, fetchImpl = fetch } = {}) {
    this.backendUrl = backendUrl;
    this.fetchImpl = fetchImpl;
    this.session = null;
    this.report = null;
  }

  async start({ vehicleId, purchasePath, negotiationSessionId = null }) {
    this.session = await this.request('/api/digital-salesperson/purchase-sessions', {
      method: 'POST',
      body: JSON.stringify({ vehicleId, purchasePath, negotiationSessionId }),
    });
    return this.session;
  }

  async openReport() {
    this.requireSession();
    const result = await this.request(`/api/digital-salesperson/purchase-sessions/${encodeURIComponent(this.session.id)}/condition-report/open`, {
      method: 'POST', body: JSON.stringify({ expectedVersion: this.session.version }),
    });
    this.session = result.session;
    this.report = result.report;
    return result.report;
  }

  async markDisplayed() {
    this.requireReport();
    this.session = await this.reportCommand('displayed', {});
    return this.session;
  }

  async acknowledge() {
    this.requireReport();
    this.session = await this.reportCommand('acknowledge', { acknowledged: true });
    return this.session;
  }

  async proceed() {
    this.requireReport();
    this.session = await this.request(`/api/digital-salesperson/purchase-sessions/${encodeURIComponent(this.session.id)}/proceed`, {
      method: 'POST', body: JSON.stringify({ expectedVersion: this.session.version, ...this.reportIdentity() }),
    });
    return this.session;
  }

  reportCommand(action, extra) {
    return this.request(`/api/digital-salesperson/purchase-sessions/${encodeURIComponent(this.session.id)}/condition-report/${action}`, {
      method: 'POST', body: JSON.stringify({ expectedVersion: this.session.version, ...this.reportIdentity(), ...extra }),
    });
  }

  reportIdentity() {
    return { reportId: this.report.id, reportVersion: this.report.version, contentHash: this.report.contentHash };
  }

  assetUrl(value) { return new URL(value, this.backendUrl).href; }

  async request(path, options) {
    const response = await this.fetchImpl(`${this.backendUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || 'Palvelu ei ole juuri nyt käytettävissä');
      error.code = body.error?.code || 'SERVICE_UNAVAILABLE';
      throw error;
    }
    return body;
  }

  requireSession() { if (!this.session) throw new Error('Ostosessiota ei ole aloitettu'); }
  requireReport() { this.requireSession(); if (!this.report) throw new Error('Kuntoraporttia ei ole avattu'); }
}
