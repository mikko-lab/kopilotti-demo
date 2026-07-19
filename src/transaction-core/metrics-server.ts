import { createServer, type Server } from 'node:http';
import type { Registry } from 'prom-client';
import { registry as defaultRegistry } from './metrics.ts';

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export function createMetricsServer(registry: Registry = defaultRegistry): Server {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found\n');
      return;
    }
    try {
      const body = await registry.metrics();
      response.writeHead(200, { 'content-type': PROMETHEUS_CONTENT_TYPE, 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(500, { 'content-type': PROMETHEUS_CONTENT_TYPE, 'cache-control': 'no-store' });
      response.end('# ERROR metrics unavailable\n');
    }
  });
}

export function startMetricsServer(input: { readonly port?: number; readonly host?: string; readonly registry?: Registry } = {}): Server {
  const port = input.port ?? 3001;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new TypeError('Metrics port is invalid');
  const server = createMetricsServer(input.registry);
  server.listen(port, input.host ?? '0.0.0.0');
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const configuredPort = process.env.METRICS_PORT === undefined ? 3001 : Number(process.env.METRICS_PORT);
  startMetricsServer({ port: configuredPort });
}
