
import client from 'prom-client';

export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry });

export const sendDuration = new client.Histogram({
  name: 'send_duration_ms',
  help: 'Duration of SMTP send operations in ms',
  buckets: [100, 500, 1000, 2000, 5000, 10000], // buckets in ms
  registers: [registry]
});

export const fetchDuration = new client.Histogram({
  name: 'imap_fetch_duration_ms',
  help: 'Duration of IMAP fetch operations in ms',
  buckets: [100, 500, 1000, 2000, 5000, 10000, 20000], // buckets in ms
  registers: [registry]
});

export const sendTotal = new client.Counter({
  name: 'send_total',
  help: 'Total number of emails sent successfully',
  registers: [registry]
});

export const fetchTotal = new client.Counter({
  name: 'fetch_total',
  help: 'Total number of successful IMAP fetches',
  registers: [registry]
});

export const errorsTotal = new client.Counter({
  name: 'errors_total',
  help: 'Total number of errors by code',
  labelNames: ['code'],
  registers: [registry]
});
