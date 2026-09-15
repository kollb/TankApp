// System — die reine Logik (UI-NEUENTWURF §5.5, Phase 4).
//
// Geprüft werden die vier Bausteine, ihre Töne, die Gesamtfarbe,
// die Daten-Abdeckung, die Frische-Fußzeile, die Erklär-Treppe
// und der Diagnose-Export.

import { describe, expect, it } from "vitest";
import type { CollectorStatus, Health, Selection, Stations, Station } from "./data";
import {
  systemDataCoverage,
  webhookLine,
  systemDiagnosticExport,
  systemDiagnosticFilename,
  systemExplanationDaten,
  systemExplanationLaeufe,
  systemExplanationStoerungen,
  systemExplanationZustand,
  systemFreshness,
  systemOverallLabel,
  systemOverallTone,
  systemSetupSteps,
  systemStatusRows,
  type SystemStatusRow,
} from "./system";

const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

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

function stationRow(id: string): Station {
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
  };
}

describe("systemStatusRows", () => {
  it("vier Bausteine in fester Reihenfolge", () => {
    const rows = systemStatusRows({ health: health(), collector: collector() });
    expect(rows.map((r) => r.id)).toEqual(["collector", "database", "models", "app"]);
  });

  it("Collector: kein Herzschlag → unknown", () => {
    const rows = systemStatusRows({ health: health({ collector: undefined }), collector: null });
    expect(rows[0].tone).toBe("unknown");
    expect(rows[0].headline).toContain("Kein Herzschlag");
  });

  it("Collector: nicht verfügbar → error", () => {
    const rows = systemStatusRows({ health: health(), collector: collector({ available: false, error_code: "collector_no_heartbeat" }) });
    expect(rows[0].tone).toBe("error");
  });

  it("Collector: frisch → ok mit tmpfs-Meta", () => {
    const rows = systemStatusRows({ health: health(), collector: collector({ fresh: true, age_minutes: 4 }) });
    expect(rows[0].tone).toBe("ok");
    expect(rows[0].meta).toContain("MiB");
  });

  it("Collector: veraltet → warn", () => {
    const rows = systemStatusRows({ health: health(), collector: collector({ fresh: false, age_minutes: 45 }) });
    expect(rows[0].tone).toBe("warn");
  });

  it("Datenbank: kein Health → unknown", () => {
    const rows = systemStatusRows({ health: null, collector: null });
    expect(rows[1].tone).toBe("unknown");
  });

  it("Datenbank: influx nicht eingebunden → error", () => {
    const rows = systemStatusRows({ health: health({ influx_configured: false }), collector: collector() });
    expect(rows[1].tone).toBe("error");
    expect(rows[1].headline).toContain("InfluxDB");
  });

  it("Datenbank: station_count 0 → warn", () => {
    const rows = systemStatusRows({ health: health({ station_count: 0 }), collector: collector() });
    expect(rows[1].tone).toBe("warn");
  });

  it("Datenbank: ok → ok", () => {
    const rows = systemStatusRows({ health: health({ station_count: 12 }), collector: collector() });
    expect(rows[1].tone).toBe("ok");
  });

  it("Modelle: failed → error", () => {
    const h = health();
    (h.jobs.models as any).state = "failed";
    (h.jobs.models as any).error_detail = "OOM";
    const rows = systemStatusRows({ health: h, collector: collector() });
    expect(rows[2].tone).toBe("error");
  });

  it("Modelle: running → warn", () => {
    const h = health();
    (h.jobs.models as any).state = "running";
    (h.jobs.models as any).progress = { label: "Training", phase_label: "Training" };
    const rows = systemStatusRows({ health: h, collector: collector() });
    expect(rows[2].tone).toBe("warn");
    expect(rows[2].headline).toBe("Lauf aktiv");
  });

  it("Modelle: aborted → warn", () => {
    const h = health();
    (h.jobs.models as any).state = "aborted";
    (h.jobs.models as any).aborted_at = minutesAgo(10);
    const rows = systemStatusRows({ health: h, collector: collector() });
    expect(rows[2].tone).toBe("warn");
  });

  it("Modelle: count 0 → warn", () => {
    const h = health({ models: { published_at: null, count: 0, calibrated: false as const, decision_ready: false as const } });
    const rows = systemStatusRows({ health: h, collector: collector() });
    expect(rows[2].tone).toBe("warn");
  });

  it("Modelle: veröffentlicht → ok", () => {
    const rows = systemStatusRows({ health: health(), collector: collector() });
    expect(rows[2].tone).toBe("ok");
  });

  it("App: polling_error → warn", () => {
    const rows = systemStatusRows({ health: health({ polling_error: "polling_missing" }), collector: collector() });
    expect(rows[3].tone).toBe("warn");
  });

  it("App: jobs aus → warn", () => {
    const rows = systemStatusRows({ health: health({ jobs_enabled: false }), collector: collector() });
    expect(rows[3].tone).toBe("warn");
  });

  it("App: ok → ok", () => {
    const rows = systemStatusRows({ health: health(), collector: collector() });
    expect(rows[3].tone).toBe("ok");
  });
});

describe("systemOverallTone", () => {
  it("error dominiert", () => {
    const rows: SystemStatusRow[] = [
      { id: "collector", label: "C", tone: "ok", headline: "ok", detail: "" },
      { id: "database", label: "D", tone: "error", headline: "err", detail: "" },
      { id: "models", label: "M", tone: "ok", headline: "ok", detail: "" },
      { id: "app", label: "A", tone: "warn", headline: "warn", detail: "" },
    ];
    expect(systemOverallTone(rows)).toBe("error");
  });

  it("warn vor unknown und ok", () => {
    const rows: SystemStatusRow[] = [
      { id: "collector", label: "C", tone: "ok", headline: "", detail: "" },
      { id: "database", label: "D", tone: "unknown", headline: "", detail: "" },
      { id: "models", label: "M", tone: "warn", headline: "", detail: "" },
      { id: "app", label: "A", tone: "ok", headline: "", detail: "" },
    ];
    expect(systemOverallTone(rows)).toBe("warn");
  });

  it("alles ok → ok", () => {
    const rows: SystemStatusRow[] = [
      { id: "collector", label: "C", tone: "ok", headline: "", detail: "" },
      { id: "database", label: "D", tone: "ok", headline: "", detail: "" },
      { id: "models", label: "M", tone: "ok", headline: "", detail: "" },
      { id: "app", label: "A", tone: "ok", headline: "", detail: "" },
    ];
    expect(systemOverallTone(rows)).toBe("ok");
    expect(systemOverallLabel("ok")).toBe("Alles ok");
  });
});

describe("systemDataCoverage", () => {
  it("zählt Stationen und frische Preise", () => {
    const data = { cities: ["Frankfurt"], fuel: "e10", stations: [stationRow("a")], generated_at: minutesAgo(4), connection_error: null, fresh_prices: 1 } as unknown as Stations;
    const cov = systemDataCoverage({ data, stations: [stationRow("a"), stationRow("b")], freshCount: 1, selection: selection() });
    expect(cov.stationCount).toBe(2);
    expect(cov.freshCount).toBe(1);
    expect(cov.cities).toEqual(["Frankfurt"]);
  });

  it("ohne Selection: Zähler 0, kein Crash", () => {
    const cov = systemDataCoverage({ data: null, stations: [], freshCount: 0, selection: null });
    expect(cov.deadCount).toBe(0);
    expect(cov.twinCount).toBe(0);
  });
});

describe("systemFreshness", () => {
  it("ohne jeden Zeitstempel: warn mit ehrlichem Text", () => {
    const f = systemFreshness({});
    expect(f.tone).toBe("warn");
    expect(f.text).toContain("Kein Datenstand");
  });

  it("frisch: ok", () => {
    const f = systemFreshness({ healthAt: minutesAgo(4), collectorAt: minutesAgo(4), now: NOW });
    expect(f.tone).toBe("ok");
    expect(f.text).toContain("Collector");
  });

  it("stale → warn, old → bad (schlechtester gewinnt)", () => {
    const stale = systemFreshness({ collectorAt: minutesAgo(45), now: NOW });
    expect(stale.tone).toBe("warn");
    const old = systemFreshness({ collectorAt: minutesAgo(120), now: NOW });
    expect(old.tone).toBe("bad");
  });

  it("B5: ein gesundes Tages-System (Modell 20 h, Selektion 25 h alt) ist ok", () => {
    // Vorher: beide mit der 30-min-Preisschwelle gewogen → „old“ → rot.
    const f = systemFreshness({
      healthAt: minutesAgo(1),
      collectorAt: minutesAgo(4),
      modelsAt: minutesAgo(20 * 60),
      selectionAt: minutesAgo(25 * 60),
      now: NOW,
    });
    expect(f.tone).toBe("ok");
  });

  it("B5: veraltetes Modell (30 h) warnt, altes Modell (50 h) wird rot", () => {
    const warn = systemFreshness({
      healthAt: minutesAgo(1),
      modelsAt: minutesAgo(30 * 60),
      now: NOW,
    });
    expect(warn.tone).toBe("warn");
    const bad = systemFreshness({
      healthAt: minutesAgo(1),
      modelsAt: minutesAgo(50 * 60),
      now: NOW,
    });
    expect(bad.tone).toBe("bad");
  });

  it("B5: veraltete Selektion (40 h) warnt, mit 80 h wird sie rot", () => {
    const warn = systemFreshness({
      healthAt: minutesAgo(1),
      selectionAt: minutesAgo(40 * 60),
      now: NOW,
    });
    expect(warn.tone).toBe("warn");
    const bad = systemFreshness({
      healthAt: minutesAgo(1),
      selectionAt: minutesAgo(80 * 60),
      now: NOW,
    });
    expect(bad.tone).toBe("bad");
  });
});

describe("systemExplanation*", () => {
  it("Zustand: drei Sätze, Quelle, Lab-Hinweis", () => {
    const e = systemExplanationZustand();
    expect(e.sentences).toHaveLength(3);
    expect(e.source).toContain("/api/v1/health");
    expect(e.labHint).not.toBeNull();
  });

  it("Daten: drei Sätze, nennt Städte und Zwillinge", () => {
    const cov = systemDataCoverage({ data: null, stations: [stationRow("a")], freshCount: 1, selection: selection({ dead_count: 1, price_twin_count: 2 }) });
    const e = systemExplanationDaten(cov);
    expect(e.sentences).toHaveLength(3);
    expect(e.sentences.join(" ")).toContain("Preis-Zwillinge");
    expect(e.sentences.join(" ")).toContain("98 %");
    expect(e.sentences.join(" ")).not.toContain(" Uhr Uhr");
  });

  it("Läufe: drei Sätze, Quelle enthält jobs", () => {
    const e = systemExplanationLaeufe({ models: { state: "success" } as any });
    expect(e.sentences).toHaveLength(3);
    expect(e.source).toContain("jobs");
    expect(e.sentences.join(" ")).toContain("Modell-Update");
  });

  it("Störungen: 0 → kein Alarm, >0 → nennt Anzahl", () => {
    expect(systemExplanationStoerungen(0).sentences[0]).toContain("Keine aktiven");
    expect(systemExplanationStoerungen(2).sentences[0]).toContain("2 Störungen");
  });
});

describe("systemSetupSteps", () => {
  it("fünf Schritte in fester Reihenfolge", () => {
    const steps = systemSetupSteps({ health: health(), collector: collector(), decideReady: true });
    expect(steps.map((s) => s.label)).toEqual(["Polling-Set", "Collector-Herzschlag", "InfluxDB-Lesezugang", "Erster Modell-Lauf", "Erste Empfehlung"]);
    expect(steps.every((s) => typeof s.done === "boolean")).toBe(true);
  });

  it("ohne Daten: alle false, mit Daten: true", () => {
    const emptyHealth = health({
      station_count: 0,
      influx_configured: false,
      collector: undefined,
      models: { published_at: null, count: 0, calibrated: false as const, decision_ready: false as const },
    });
    (emptyHealth as any).collector = undefined;
    const empty = systemSetupSteps({
      health: emptyHealth,
      collector: null,
      decideReady: false,
    });
    expect(empty.every((s) => !s.done)).toBe(true);
    const full = systemSetupSteps({ health: health(), collector: collector(), decideReady: true });
    expect(full.every((s) => s.done)).toBe(true);
  });
});

describe("systemDiagnosticExport", () => {
  it("bündelt Version, Zustand, Coverage und Log — ohne Tokens", () => {
    const rows = systemStatusRows({ health: health(), collector: collector() });
    const coverage = systemDataCoverage({
      data: null,
      stations: [stationRow("a")],
      freshCount: 1,
      selection: selection(),
    });
    const body = systemDiagnosticExport({
      version: "0.37.0",
      commit: "abc123",
      generatedAt: "2026-09-14T10:00:00+02:00",
      overall: { tone: "ok", label: "Alles ok" },
      rows,
      coverage,
      alarms: [{ code: "collector_no_heartbeat", severity: "error", message: "Kein Herzschlag", job: null }],
      logJob: "models",
      logLines: ["INFO ok", "secret=TOKEN-xyz"],
    });
    const json = JSON.parse(body);
    expect(json.app).toBe("tankapp");
    expect(json.version).toBe("0.37.0");
    expect(json.zustand).toHaveLength(4);
    expect(json.coverage.stations).toBe(1);
    expect(json.alarms[0].code).toBe("collector_no_heartbeat");
    expect(json.log.job).toBe("models");
    expect(json.log.lines).toHaveLength(2);
    expect(body).not.toContain("Bearer");
    expect(body).not.toContain("TANKAPP_WEBHOOK_TOKEN");
  });

  it("Dateiname trägt den Berliner Kalendertag", () => {
    expect(systemDiagnosticFilename("2026-09-14T23:30:00+02:00")).toBe(
      "tankapp-diagnose-2026-09-14.json",
    );
    expect(systemDiagnosticFilename(null)).toBe("tankapp-diagnose-ohne-stand.json");
  });
});

describe("B8: Trigger Pi → NAS", () => {
  it("sagt „keine Angabe“ statt „in Ordnung“, wenn nichts gemeldet wird", () => {
    const line = webhookLine(null);
    expect(line.tone).toBe("unknown");
    expect(line.text).toContain("Keine Angabe");
    expect(line.note).toContain("Intervalljob");
  });

  it("benennt einen offenen Trigger mit Versuchen und Alter", () => {
    const line = webhookLine({
      pending: true,
      attempts: 3,
      pending_age_s: 600,
      last_status: "retry_wait",
    });
    expect(line.tone).toBe("warn");
    expect(line.text).toContain("3 Versuche");
    expect(line.text).toContain("10 Minuten");
  });

  it("übersetzt die Quittierung des NAS in Klartext", () => {
    expect(webhookLine({ pending: false, last_status: "queued" }).tone).toBe("ok");
    expect(webhookLine({ pending: false, last_status: "queued" }).text).toContain(
      "vorgemerkt",
    );
    expect(webhookLine({ pending: false, last_status: "duplicate" }).text).toContain(
      "Datenstand",
    );
    const throttled = webhookLine({ pending: false, last_status: "debounced" });
    expect(throttled.tone).toBe("ok");
    expect(throttled.text).toContain("gedrosselt");
  });

  it("meldet dauerhafte Fehler als Fehler, nicht als Warten", () => {
    const rejected = webhookLine({ pending: false, last_status: "rejected" });
    expect(rejected.tone).toBe("error");
    expect(rejected.text).toContain("kennt diesen Job nicht");
    const auth = webhookLine({ pending: false, last_status: "http_403" });
    expect(auth.tone).toBe("error");
    expect(webhookLine({ pending: false, last_status: "http_500" }).tone).toBe("warn");
  });

  it("nennt das Aufgeben als solches (Intervaljob übernimmt)", () => {
    const line = webhookLine({
      pending: false,
      last_status: "abandoned",
      gave_up: 2,
    });
    expect(line.tone).toBe("warn");
    expect(line.text).toContain("Aufgegeben");
    expect(line.note).toContain("2");
  });

  it("behält die Ehrlichkeits-Regel: keine Zahl ohne Messung", () => {
    const line = webhookLine({ pending: false, last_status: "http_200" });
    expect(line.text).not.toContain("0 Min.");
    expect(line.text).not.toContain("undefined");
  });
});
