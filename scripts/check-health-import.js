#!/usr/bin/env node

delete process.env.DATABASE_URL;

const { default: health } = await import('../api/health.js');

const response = {
  headers: new Map(),
  headersSent: false,
  statusCode: null,
  payload: null,
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
  getHeader(name) { return this.headers.get(name.toLowerCase()); },
  status(code) { this.statusCode = code; return this; },
  send(payload) { this.payload = payload; this.headersSent = true; return this; },
  end() { this.headersSent = true; return this; },
};

await health({ method: 'GET', headers: {}, socket: {} }, response);

const payload = JSON.parse(response.payload || '{}');
if (response.statusCode !== 200 || payload.service !== 'nestra-api' ||
    payload.ok !== false || payload.reason !== 'sem_banco') {
  throw new Error('A rota de saúde não diagnosticou DATABASE_URL ausente.');
}

console.log('Rota de saúde funciona sem DATABASE_URL.');
