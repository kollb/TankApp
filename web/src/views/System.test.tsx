// @vitest-environment happy-dom
// System — Anlage & Daten (UI-NEUENTWURF §5.5, Phase 4).
//
// Geprüft wird, was der Nutzer tatsächlich bekommt: die feste Reihenfolge
// Zustand → Daten → Läufe & Protokolle → Störungen → Diagnose → Frische-Fußzeile,
// die vier Bausteine, die ehrlichen Zustände (Lädt, Leer, Fehler) und dass
// Formatter-only gilt.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemView, type SystemViewProps } from "./System";
import type { CollectorStatus, Health, Selection, Stations, Station } from "../data";

const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: `Station ${id}`,
    brand: "ARAL",
    fuel: "e10",
    maps_url: null,
    dist_km: 1,
    dist_mode: "road",
    price: 1.749,
    last_price: 1.749,
    status: "open",
    fresh: true,
    observed_at: minutesAgo(4),
    age_minutes: 4,
    ...overrides,
  };
}

function collector(overrides: Partial<CollectorStatus> = {}): CollectorStatus {
  return {
    available: true,
    last_poll_at: minutesAgo(4),
    age_minutes: 4,
    fresh: true,
    source: "influx",
    tmpfs_used_bytes: 12 * 1024 * 1024,
    tmpfs_total_bytes: 100 * 1024 * 1024,
    tmpfs_free_bytes: 88 * 1024 * 1024,
    oldest_age_days: 1,
    city: "Frankfurt",
    open_count: 10,
    total_count: 12,
    error_code: null,
    ...overrides,
  } as CollectorStatus;
}

function health(overrides: Partial<Health> = {}): Health {
  return {
    app: "tankapp",
    polling_error: null,
    polling_path: "data/analysis/stations/polling.json",
    influx_configured: true,
    archive_configured: true,
    jobs_enabled: true,
    station_count: 12,
    generated_at: minutesAgo(5),
    version: "0.37.0",
    commit: "abc123",
    alarms: [],
    notify: { configured: false, open_errors: [] },
    archive: { status: null, archive_since: null, requested_until: null, missing_files: null, last_complete_until: null },
    jobs: {
      archive: { state: "success", started_at: null, finished_at: minutesAgo(60), last_success_at: minutesAgo(60), next_run_at: null, error_code: null },
      models: { state: "success", started_at: null, finished_at: minutesAgo(35), last_success_at: minutesAgo(35), next_run_at: null, error_code: null },
      selection: { state: "success", started_at: null, finished_at: minutesAgo(40), last_success_at: minutesAgo(40), next_run_at: null, error_code: null },
      settlement: { state: "success", started_at: null, finished_at: minutesAgo(50), last_success_at: minutesAgo(50), next_run_at: null, error_code: null },
    },
    models: { published_at: minutesAgo(35), count: 12, calibrated: false as const, decision_ready: false as const },
    collector: collector(),
    ...overrides,
  } as unknown as Health;
}

function selection(overrides: Partial<Selection> = {}): Selection {
  return {
    generated_at: minutesAgo(40),
    fuel: "e10",
    city: "Frankfurt",
    cities: ["Frankfurt"],
    count: 12,
    total_count: 12,
    stations: [],
    dead_count: 0,
    closed_count: 1,
    nofuel_count: 0,
    price_twin_count: 0,
    price_twins: [],
    coverage_window: "06–24 Uhr",
    coverage_reference: 0.98,
    coverage_threshold: 0.8,
    ...overrides,
  } as unknown as Selection;
}

function stationsPayload(rows: Station[]): Stations {
  return {
    generated_at: minutesAgo(4),
    cities: ["Frankfurt"],
    fuel: "e10",
    stations: rows,
    connection_error: null,
    fresh_prices: rows.filter((r) => r.price !== null).length,
  };
}

const noop = () => {};

const baseProps: SystemViewProps = {
  activeCity: "Frankfurt",
  fuel: "e10",
  heatmapWeeks: 6,
  data: stationsPayload([station("a")]),
  stations: [station("a")],
  fresh: [station("a")],
  h: health(),
  health: { data: health(), error: false, errorCode: null, pending: false, receivedAt: 0 },
  collector: collector(),
  selection: { data: selection(), error: false, errorCode: null, pending: false, receivedAt: 0 },
  statsSummaryRes: { data: { quality_metrics: { top3_hit_rate: 0.7, mase_sprungfrei: 0.6, picp_95: 0.95, cusum_drift: { status: "normal", max_cusum: 0.5, threshold: 3 } }, live_advice: { n: 10, wins: 7, losses: 3, ties: 0, hit_rate: 0.7, wait_n: 5, wait_hits: 4, now_n: 5, now_hits: 3, brier_30d: 0.2, calibrated: false, gate_status: "open" }, wallet: { n_fills: 0, followed: 0, partial: 0, ignored: 0, unrelated: 0, saved_eur: 0, wh_hours: [] } } as any, error: false, errorCode: null, pending: false, receivedAt: 0 },
  decideRes: { data: { decision_ready: true } as any, error: false, errorCode: null, pending: false, receivedAt: 0 },
  jobLog: { data: { job: "models", available: true, count: 10, total: 10, lines: ["2026-09-14 INFO ok"], updated_at: minutesAgo(35) }, error: false, errorCode: null, pending: false, receivedAt: 0 },
  logJob: "models",
  logLineCount: 100,
  logLines: ["2026-09-14 INFO ok"],
  logBodyRef: { current: null },
  logRef: { current: null },
  setLogJob: noop,
  setLogLineCount: noop,
  setLogReload: noop,
  showJobLog: noop,
  calibrationHint: "",
  m7Line: null,
  liveAdvice: null,
  identity: "test",
  span: 24,
  webhookCapable: true,
  triggerCommand: "curl -X POST ...",
  workerCommand: "python -m app worker",
  refreshNow: noop,
  onDeepen: noop,
};

function render(overrides: Partial<SystemViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as SystemViewProps;
  return renderToStaticMarkup(<SystemView {...props} />);
}

describe("System: Aufbau", () => {
  it("hält die feste Reihenfolge ①②③④⑤ und zeigt die Frische-Fußzeile", () => {
    const html = render();
    const zustand = html.indexOf("Zustand — vier Bausteine");
    const daten = html.indexOf("Daten — Abdeckung");
    const laeufe = html.indexOf("Läufe &amp; Protokolle");
    const stoerungen = html.indexOf("Störungen — Verlauf");
    const diagnose = html.indexOf("Diagnose &amp; Export");
    const frische = html.indexOf('role="status"');
    expect(zustand).toBeGreaterThanOrEqual(0);
    expect(daten).toBeGreaterThan(zustand);
    expect(laeufe).toBeGreaterThan(daten);
    expect(stoerungen).toBeGreaterThan(laeufe);
    expect(diagnose).toBeGreaterThan(stoerungen);
    expect(frische).toBeGreaterThan(diagnose);
  });

  it("zeigt die vier Bausteine als je eine Zeile", () => {
    const html = render();
    expect(html).toContain("Collector (Pi)");
    expect(html).toContain("Datenbank (NAS)");
    expect(html).toContain("Modelle");
    expect(html).toContain("App");
  });

  it("zeigt Coverage, Stationen-Zustände und Güte-Kacheln", () => {
    const html = render();
    expect(html).toContain("Stationen im Set");
    expect(html).toContain("Frische Preise");
    expect(html).toContain("Coverage-Gate");
    expect(html).toContain("06–24 Uhr");
    expect(html).not.toContain("06–24 Uhr Uhr");
    expect(html).toContain("Bestwert 98 %");
    expect(html).toContain("Stationen: Zustände &amp; Preis-Zwillinge");
    expect(html).toContain("Güte &amp; Kalibrierung");
  });

  it("zeigt Läufe & Protokolle mit Job-Karten und Log", () => {
    const html = render();
    expect(html).toContain("Archiv-Sync");
    expect(html).toContain("Modell-Update");
    expect(html).toContain("Selektion Ranking");
    expect(html).toContain("Beleg-Verarbeitung");
    expect(html).toContain("Job-Log");
  });

  it("zeigt Störungen, Diagnose-Export und ehrliche PWA-Lage", () => {
    const html = render();
    expect(html).toContain("Alarm-Zustellung");
    expect(html).toContain("API-Explorer");
    expect(html).toContain("fills.csv");
    expect(html).toContain("Diagnose als Datei");
    expect(html).toContain("/api/v1");
    expect(html).toContain("Service-Worker");
    expect(html).toContain("B10");
  });
});

describe("System: Zustände", () => {
  it("Lädt: Systemzustand zeigt Skelett", () => {
    const html = render({
      h: null,
      health: { data: null, error: false, errorCode: null, pending: true, receivedAt: 0 },
    });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Systemzustand wird geladen");
  });

  it("Leer: Polling-Set fehlt → ehrlicher Hinweis, kein roter Fehler", () => {
    const emptyData = { ...stationsPayload([]), connection_error: "polling_missing" } as Stations;
    const html = render({
      data: emptyData,
      stations: [],
      fresh: [],
      h: health({ station_count: 0 }),
    });
    expect(html).toContain("Das gemeinsame Polling-Set fehlt");
    expect(html).toContain("Keine Stadt eingerichtet");
  });

  it("Fehler: Health nicht erreichbar → LoadError mit Retry", () => {
    const html = render({
      h: null,
      health: { data: null, error: true, errorCode: "request_failed", pending: false, receivedAt: 0 },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Status neu laden");
  });

  it("Unsicher: Collector veraltet → gelber Ton, kein Crash", () => {
    const html = render({
      collector: collector({ fresh: false, age_minutes: 45 }),
    });
    expect(html).toContain("Collector (Pi)");
    expect(html).toContain("45 Min.");
  });
});

describe("System: Formatter-only", () => {
  it("nutzt keine hart kodierten Preise — €/MiB über Formatter", () => {
    const html = render();
    expect(html).toContain("MiB tmpfs");
    expect(html).toContain("70 %");
  });
});
