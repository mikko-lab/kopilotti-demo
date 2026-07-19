const DEFAULT_BACKEND_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : 'https://kopilotti-demo-production.up.railway.app';

export class CustomerNegotiationApi {
  constructor({ backendUrl = DEFAULT_BACKEND_URL, fetchImpl = fetch } = {}) {
    this.backendUrl = backendUrl;
    this.fetchImpl = fetchImpl;
    this.session = null;
  }

  getSessionId() { return this.session?.id || null; }

  async ensureSession(vehicleId) {
    if (this.session?.vehicleId === vehicleId && this.session.status === 'OPEN') return this.session;
    this.session = await this.request('/api/digital-salesperson/sessions', {
      method: 'POST',
      body: JSON.stringify({ vehicleId }),
    });
    return this.session;
  }

  async discussPrice({ vehicleId, offerAmount, evidence }) {
    const session = await this.ensureSession(vehicleId);
    const decision = await this.request(`/api/digital-salesperson/sessions/${encodeURIComponent(session.id)}/offers`, {
      method: 'POST',
      body: JSON.stringify({
        offerAmount,
        currency: 'EUR',
        evidence,
        expectedVersion: session.version,
        commandId: crypto.randomUUID(),
      }),
    });
    this.session = { ...session, version: decision.sessionVersion, status: decision.sessionStatus };
    return decision;
  }

  async request(path, options) {
    const response = await this.fetchImpl(`${this.backendUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || 'Palvelu ei ole juuri nyt käytettävissä');
      error.code = body.error?.code || 'SERVICE_UNAVAILABLE';
      throw error;
    }
    return body;
  }
}
