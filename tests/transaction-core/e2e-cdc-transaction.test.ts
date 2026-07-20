import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import {
  AgentCoreBridge, AgreePriceToolSchema, BusinessCalendar, KopilottiEngine, PostgresTransactionRepository,
  createCorePriceLockRouter, createVersionedHandoverPolicy, type Customer, type PaymentMethod, type ProviderAdapter,
} from '../../src/transaction-core/index.ts';

const runLive = process.env.RUN_CDC_E2E === '1';
const execFileAsync = promisify(execFile);

test('LLM tool call reaches ACID outbox and Debezium Kafka topic without protected data', { skip: runLive ? false : 'set RUN_CDC_E2E=1 and start docker compose', timeout: 45_000 }, async () => {
  const suffix = randomUUID();
  const dealId = `e2e-deal-${suffix}`; const vehicleId = `e2e-alfa-${suffix}`; const registration = `E2E-${suffix.slice(0, 8)}`;
  const buyer: Customer = { id: `e2e-buyer-${suffix}`, ssnVerified: true, fullName: 'E2E Ostaja', email: 'e2e@example.test', phone: '+358401234567' };
  const databaseUrl = requiredEnvironment('E2E_DATABASE_URL');
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 3_000, statement_timeout: 5_000 });
  const repository = new PostgresTransactionRepository({ pool, customers: { getById: async (_tenant, id) => id === buyer.id ? buyer : null }, workerId: `e2e-${suffix}` });
  let eventSequence = 0;
  const policy = createVersionedHandoverPolicy({
    tenantId: 'dealer-e2e', version: 'e2e-policy-v1',
    defaultRules: { requireCeramicCoatingCompleted: false, requireHandoverInspectionCompleted: true, requireIdentityVerified: true, requireRegistrationCompleted: true, requireInsuranceInformationReceived: true, requireManualApproval: true },
  });
  const machine = new KopilottiEngine({
    repository, policies: { getCurrent: async () => policy, getByVersion: async () => policy },
    paymentProvider: unusedProvider('CASH'), financingProvider: unusedProvider('FINANCING'),
    authorizer: { requireHandoverPermission: async () => ({ actorId: 'unused' }) },
    clock: { now: () => new Date() }, ids: { next: () => `e2e-event-${suffix}-${++eventSequence}` }, calendar: new BusinessCalendar(),
  });
  const serviceCredential = `Bearer e2e-service-${suffix}`; const buyerToken = `e2e-session-${suffix}`;

  let server: ReturnType<ReturnType<typeof express>['listen']> | null = null;
  try {
    await assertCdcPrerequisites();
    await pool.query(
      `INSERT INTO vehicles (id, tenant_id, registration_number, model, base_price_cents, inventory_revision, is_available)
       VALUES ($1, 'dealer-e2e', $2, 'Alfa Romeo Giulia Quadrifoglio', 10990000, 12, true)`, [vehicleId, registration],
    );
    await machine.createNegotiation({ dealId, tenantId: 'dealer-e2e', vehicle: { vehicleId, registrationIdentifier: registration, inventoryRevision: 12 } });

    const app = express(); app.use(express.json()); app.use(createCorePriceLockRouter({
      authorizer: { authorize: async (request) => {
        if (request.header('authorization') !== serviceCredential) throw new Error('UNAUTHORIZED');
        assert.match(request.header('x-request-id') ?? '', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
        assert.equal(request.header('x-buyer-session-token'), buyerToken);
        return { tenantId: 'dealer-e2e', serviceId: 'e2e-chat-service' };
      } },
      buyers: { resolveStronglyAuthenticatedBuyer: async ({ sessionToken, dealId: protectedDealId }) => sessionToken === buyerToken && protectedDealId === dealId ? buyer : null },
      transactions: repository,
      inventory: { getById: async (id) => {
        const result = await pool.query<{ id: string; registration_number: string; inventory_revision: string }>(
          'SELECT id, registration_number, inventory_revision FROM vehicles WHERE id=$1 AND is_available=true', [id],
        );
        const row = result.rows[0]; return row ? { vehicleId: row.id, registrationIdentifier: row.registration_number, inventoryRevision: Number(row.inventory_revision) } : null;
      } },
      verifier: { verify: async (claim) => {
        assert.deepEqual(claim, { transactionId: dealId, registrationNumber: registration, claimedPriceCents: 9_250_000 });
        return { dealId, approvedPriceCents: 9_250_000, commercialDecisionId: `e2e-decision-${suffix}` };
      } }, engine: machine,
    }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server?.once('listening', resolve); server?.once('error', reject); });
    const port = (server.address() as AddressInfo).port;
    const bridge = new AgentCoreBridge({ coreServiceUrl: `http://127.0.0.1:${port}`, serviceAuthorization: serviceCredential, timeoutMs: 3_000 });

    const toolCall = AgreePriceToolSchema.parse({ transactionId: dealId, registrationNumber: registration, agreedPrice: 92_500 });
    const bridgeResult = await bridge.handleAgentLockPrice({ dealId, vehicleId, buyerSessionToken: buyerToken }, toolCall.agreedPrice, 12);
    assert.equal(bridgeResult.success, true);

    const expectedEventId = `e2e-event-${suffix}-2`;
    const persisted = await pool.query<{ status: string; agreed_price_cents: string; is_available: boolean; event_id: string; payload: unknown; audit_count: string }>(
      `SELECT d.status, d.agreed_price_cents, v.is_available, o.event_id, o.payload,
              (SELECT COUNT(*) FROM audit_logs a WHERE a.transaction_id=d.id AND a.to_status='PRICE_AGREED') AS audit_count
       FROM deals d JOIN vehicles v ON v.id=d.vehicle_id
       JOIN transactional_outbox o ON o.transaction_id=d.id AND o.event_id=$2
       WHERE d.id=$1`, [dealId, expectedEventId],
    );
    assert.equal(persisted.rows[0]?.status, 'PRICE_AGREED'); assert.equal(persisted.rows[0]?.agreed_price_cents, '9250000');
    assert.equal(persisted.rows[0]?.is_available, false); assert.equal(persisted.rows[0]?.event_id, expectedEventId); assert.equal(persisted.rows[0]?.audit_count, '1');

    const kafkaRecord = await readKafkaRecord(dealId, expectedEventId);
    assert.equal(kafkaRecord.headers.includes(expectedEventId), true);
    assert.deepEqual(kafkaRecord.payload, persisted.rows[0]?.payload);
    assert.deepEqual(kafkaRecord.payload, { eventId: expectedEventId, transactionId: dealId, registrationNumber: registration, status: 'PRICE_AGREED', paymentDeadline: null, timestamp: (kafkaRecord.payload as { timestamp: string }).timestamp });
    const serialized = JSON.stringify(kafkaRecord);
    for (const forbidden of ['agreedPrice', '9250000', buyer.id, buyer.fullName, buyer.email, buyer.phone, 'commercialDecisionId', 'e2e-policy-v1', 'ssnVerified']) assert.equal(serialized.includes(forbidden), false, `Kafka record leaked ${forbidden}`);
  } catch (error) {
    const diagnostics = await collectDiagnostics(pool, dealId);
    throw new Error(`CDC E2E failed: ${safeError(error)}\n${diagnostics}`);
  } finally {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool.end();
  }
});

function unusedProvider(method: PaymentMethod): ProviderAdapter {
  return { providerId: `e2e-${method.toLowerCase()}`, method, sourceName: method === 'CASH' ? 'PAYMENT_PROVIDER_ADAPTER' : 'FINANCING_PROVIDER_ADAPTER', verifyCallback: async () => { throw new Error('unused'); } };
}

async function assertCdcPrerequisites(): Promise<void> {
  const response = await fetch('http://127.0.0.1:8083/connectors/kopilotti-outbox-connector/status', { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`CONNECTOR_STATUS_HTTP_${response.status}`);
  const status = JSON.stringify(await response.json());
  if (!status.includes('"state":"RUNNING"') || status.includes('"state":"FAILED"')) throw new Error(`CONNECTOR_NOT_RUNNING ${status}`);
}

async function readKafkaRecord(dealId: string, eventId: string): Promise<{ headers: string; payload: unknown }> {
  try {
    const container = await kafkaContainerId();
    const { stdout } = await execFileAsync('docker', [
      'exec', '-i', container, '/kafka/bin/kafka-console-consumer.sh', '--bootstrap-server', 'kafka:9092',
      '--topic', 'kopilotti.transactions.events', '--from-beginning', '--timeout-ms', '20000', '--property', 'print.headers=true',
    ], { cwd: process.cwd(), timeout: 25_000, maxBuffer: 4 * 1024 * 1024 });
    const line = stdout.split('\n').find((candidate) => candidate.includes(dealId) && candidate.includes(eventId));
    if (!line) throw new Error('EXPECTED_KAFKA_RECORD_NOT_FOUND');
    const jsonStart = line.indexOf('{');
    if (jsonStart < 0) throw new Error('KAFKA_RECORD_PAYLOAD_NOT_JSON');
    return { headers: line.slice(0, jsonStart), payload: JSON.parse(line.slice(jsonStart)) as unknown };
  } catch (error) {
    const output = typeof error === 'object' && error !== null && 'stdout' in error ? String(error.stdout) : '';
    const line = output.split('\n').find((candidate) => candidate.includes(dealId) && candidate.includes(eventId));
    if (line) { const jsonStart = line.indexOf('{'); if (jsonStart >= 0) return { headers: line.slice(0, jsonStart), payload: JSON.parse(line.slice(jsonStart)) as unknown }; }
    throw error;
  }
}

async function kafkaContainerId(): Promise<string> {
  const { stdout } = await execFileAsync('docker', [
    'ps', '--filter', 'label=com.docker.compose.project=kopilotti-sales-cdc',
    '--filter', 'label=com.docker.compose.service=kafka', '--format', '{{.ID}}',
  ], { timeout: 3_000 });
  const identifier = stdout.trim().split('\n')[0];
  if (!identifier || !/^[a-f0-9]{12,64}$/.test(identifier)) throw new Error('KAFKA_CONTAINER_NOT_RUNNING');
  return identifier;
}

async function collectDiagnostics(pool: Pool, dealId: string): Promise<string> {
  const parts: string[] = [];
  try { const result = await pool.query('SELECT slot_name, active, restart_lsn, confirmed_flush_lsn FROM pg_replication_slots'); parts.push(`replication_slots=${JSON.stringify(result.rows)}`); } catch { parts.push('replication_slots=unavailable'); }
  try { const result = await pool.query('SELECT status, version FROM deals WHERE id=$1', [dealId]); parts.push(`deal=${JSON.stringify(result.rows)}`); } catch { parts.push('deal=unavailable'); }
  try { const response = await fetch('http://127.0.0.1:8083/connectors/kopilotti-outbox-connector/status', { signal: AbortSignal.timeout(2_000) }); parts.push(`connector=${await response.text()}`); } catch { parts.push('connector=unavailable'); }
  return parts.join('\n');
}
function requiredEnvironment(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function safeError(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'; }
