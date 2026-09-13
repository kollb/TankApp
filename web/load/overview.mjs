#!/usr/bin/env node
/* D4: Lastpfad für GET /api/v1/overview — das B7-Alltagsaggregat.
 *
 * Warum ein eigenes Skript statt K6/Autocannon: Der Pfad, der unter Last
 * halten muss, ist nicht „irgendein GET“, sondern genau der Refresh-Rhythmus
 * des GUI. Der besteht aus zwei Anfragearten:
 *
 *   1. normaler Abruf (gzip, voller Body),
 *   2. Revalidierung mit If-None-Match (B7) — der Regelfall im Betrieb.
 *
 * Genau dieses Gemisch fährt das Skript, zählt die Statuscodes getrennt und
 * prüft drei Dinge: keine Fehler, Latenz im Rahmen, und der 304-Pfad trägt
 * überhaupt (sonst würde jeder Refresh die volle Berechnung zahlen).
 * Keine Abhängigkeit — nur Node (fetch, performance.now).
 *
 * Aufruf: node web/load/overview.mjs [Basis-URL] [Sekunden] [Clients]
 */

const base = (process.argv[2] || "http://127.0.0.1:1355").replace(/\/+$/, "");
const seconds = Number(process.argv[3] || 20);
const clients = Number(process.argv[4] || 8);
// Budgets: Das GUI sitzt im LAN; 1 s ist die Grenze, ab der ein Refresh im
// Alltag als „hängt“ wahrgenommen wird. p99 darf doppelt so lang sein —
// einzelne Treffer nach einem Modell-Lauf oder Job-Start sind erklärbar.
const P95_BUDGET_MS = Number(process.env.TANKAPP_LOAD_P95_MS || 1000);
const P99_BUDGET_MS = Number(process.env.TANKAPP_LOAD_P99_MS || 2000);
const NOT_MODIFIED_SHARE_MIN = Number(
  process.env.TANKAPP_LOAD_304_MIN || 0.2,
);
const QUERY =
  process.env.TANKAPP_LOAD_QUERY ||
  "/api/v1/overview?city=Demostadt&fuel=e10&liters=40";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, share) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(share * sorted.length) - 1),
  );
  return sorted[index];
}

async function once(etag) {
  const started = performance.now();
  const headers = { "Accept-Encoding": "gzip" };
  if (etag) headers["If-None-Match"] = etag;
  const response = await fetch(base + QUERY, { headers });
  await response.arrayBuffer(); // Body wirklich lesen (sonst misst nur der Kopf).
  return {
    status: response.status,
    etag: response.headers.get("etag"),
    ms: performance.now() - started,
  };
}

async function client(state, deadline) {
  let etag = null;
  let revalidations = 0;
  while (Date.now() < deadline) {
    // Jeder dritte Abruf ist ein Refresh mit bekanntem Datenstand — so
    // pollt das GUI (B7: ETag/304 statt Neuberechnung).
    const revalidate = etag !== null && state.calls % 3 === 2;
    try {
      const result = await once(revalidate ? etag : null);
      if (revalidate) revalidations += 1;
      if (result.etag) etag = result.etag;
      state.status[result.status] = (state.status[result.status] || 0) + 1;
      if (result.status === 304) state.notModified += 1;
      state.latencies.push(result.ms);
      state.calls += 1;
    } catch (error) {
      state.errors.push(String(error && error.message ? error.message : error));
      state.calls += 1;
    }
    await sleep(150); // ~6–7 Anfragen/s je Client — mehr als jedes GUI.
  }
}

const state = {
  calls: 0,
  status: {},
  notModified: 0,
  latencies: [],
  errors: [],
};

const deadline = Date.now() + seconds * 1000;
await Promise.all(
  Array.from({ length: clients }, () => client(state, deadline)),
);

const latencies = state.latencies;
const p50 = percentile(latencies, 0.5);
const p95 = percentile(latencies, 0.95);
const p99 = percentile(latencies, 0.99);
const max = Math.max(0, ...latencies);
const notModifiedShare = state.calls
  ? state.notModified / Math.max(1, Math.floor(state.calls / 3))
  : 0;
const throughput = state.calls / seconds;

const report = {
  base,
  query: QUERY,
  seconds,
  clients,
  requests: state.calls,
  requests_per_s: Number(throughput.toFixed(2)),
  status: state.status,
  revalidations: Math.floor(state.calls / 3),
  not_modified: state.notModified,
  not_modified_share: Number(notModifiedShare.toFixed(3)),
  latency_ms: {
    p50: Number(p50.toFixed(1)),
    p95: Number(p95.toFixed(1)),
    p99: Number(p99.toFixed(1)),
    max: Number(max.toFixed(1)),
  },
  errors: state.errors.slice(0, 5),
  budgets: {
    p95_ms: P95_BUDGET_MS,
    p99_ms: P99_BUDGET_MS,
    not_modified_share_min: NOT_MODIFIED_SHARE_MIN,
  },
};

const failures = [];
if (state.errors.length) failures.push(`${state.errors.length} Verbindungsfehler`);
for (const [status, count] of Object.entries(state.status)) {
  if (!/^[23]/.test(status)) failures.push(`${count}× HTTP ${status}`);
}
if (p95 > P95_BUDGET_MS) failures.push(`p95 ${p95.toFixed(0)} ms > ${P95_BUDGET_MS} ms`);
if (p99 > P99_BUDGET_MS) failures.push(`p99 ${p99.toFixed(0)} ms > ${P99_BUDGET_MS} ms`);
if (notModifiedShare < NOT_MODIFIED_SHARE_MIN) {
  failures.push(
    `nur ${(notModifiedShare * 100).toFixed(0)} % 304 (B7-Revalidierung trägt nicht)`,
  );
}

report.passed = failures.length === 0;
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error("\nLast-Gate verletzt: " + failures.join("; "));
  process.exit(1);
}
console.log("\nLast-Gate bestanden.");
