// System — die reine Logik des Technik-Bereichs (docs/UI-NEUENTWURF.md §5.5, Phase 4).
//
// Warum eine eigene Datei: Die Ansicht rendert, sie entscheidet nichts (D1).
// Alles hier ist aus Server-Zahlen ableitbar und ohne DOM prüfbar — die vier
// Bausteine des Zustands (Collector, Datenbank, Modelle, App), die Daten-Abdeckung,
// die Läufe, die Störungen und die Frische-Fußzeile.
//
// Ehrlichkeits-Regeln (§10):
//   * Lädt = Skelett im späteren Raster, Leer = Grund + was als Nächstes passiert,
//     Unsicher = grau, Fehler = Klartext + Rohcode + "Erneut laden".
//   * Jede Zahl hat Herkunft und Frische — dieselben Schwellen wie dataAgeNote.
//   * Zahlen ausschließlich über die Formatter (data.ts).

import {
  ageLabel,
  countLabel,
  deTrimmed,
  euro,
  freshness,
  timeLabel,
  type CollectorStatus,
  type Health,
  type Job,
  type Selection,
  type Station,
  type Stations,
} from "./data";
import { labHint, type LabHint } from "./lab";

export type SystemTone = "ok" | "warn" | "error" | "unknown";

export type SystemStatusRow = {
  id: "collector" | "database" | "models" | "app";
  label: string;
  tone: SystemTone;
  headline: string;
  detail: string;
  meta?: string | null;
};

/**
 * Vier Bausteine, vier Farben, vier Sätze (§5.5): Der gesamte Systemzustand
 * passt auf einen Blick — Details eine Ebene tiefer.
 */
export function systemStatusRows(input: {
  health: Health | null;
  collector: CollectorStatus | null | undefined;
}): SystemStatusRow[] {
  const h = input.health;
  const c = input.collector ?? h?.collector ?? null;

  // 1 · Collector (Pi)
  const collectorRow = (() => {
    if (!c) {
      return {
        id: "collector" as const,
        label: "Collector (Pi)",
        tone: "unknown" as const,
        headline: "Kein Herzschlag",
        detail: "Noch kein Collector-Herzschlag auf dem NAS — Pi-Uploader prüfen.",
        meta: null,
      };
    }
    const age = c.age_minutes;
    const fresh = c.fresh;
    if (!c.available) {
      return {
        id: "collector" as const,
        label: "Collector (Pi)",
        tone: "error" as const,
        headline: "Kein Herzschlag",
        detail: c.error_code ? `Fehler: ${c.error_code}` : "Der Pi meldet seit längerem keine Preise.",
        meta: c.last_poll_at ? `Letzter Poll ${timeLabel(c.last_poll_at)}` : null,
      };
    }
    if (fresh) {
      const mins = age != null ? `${deTrimmed(age, 0)} Min. alt` : "frisch";
      return {
        id: "collector" as const,
        label: "Collector (Pi)",
        tone: "ok" as const,
        headline: `Preise ${mins}`,
        detail: `Letzter Poll ${timeLabel(c.last_poll_at)} · ${countLabel(c.open_count)} offen von ${countLabel(c.total_count)}`,
        meta: c.tmpfs_used_bytes != null ? `${euro(Number(c.tmpfs_used_bytes) / 1024 / 1024, 1)} MiB tmpfs` : null,
      };
    }
    return {
      id: "collector" as const,
      label: "Collector (Pi)",
      tone: "warn" as const,
      headline: age != null ? `Preise ${deTrimmed(age, 0)} Min. alt` : "Veraltet",
      detail: `Letzter Poll ${timeLabel(c.last_poll_at)} — älter als 30 Min., Collector prüfen.`,
      meta: c.tmpfs_used_bytes != null ? `${euro(Number(c.tmpfs_used_bytes) / 1024 / 1024, 1)} MiB tmpfs` : null,
    };
  })();

  // 2 · Datenbank (NAS)
  const databaseRow = (() => {
    if (!h) {
      return {
        id: "database" as const,
        label: "Datenbank (NAS)",
        tone: "unknown" as const,
        headline: "Kein Status",
        detail: "Gesundheitsabfrage liefert keinen Status — App-Server prüfen.",
        meta: null,
      };
    }
    if (!h.influx_configured) {
      return {
        id: "database" as const,
        label: "Datenbank (NAS)",
        tone: "error" as const,
        headline: "InfluxDB nicht eingebunden",
        detail: "influx.env fehlt — docs/INSTALL.md, Abschnitt InfluxDB.",
        meta: h.polling_path ? `Polling-Pfad: ${h.polling_path}` : null,
      };
    }
    if ((h.station_count ?? 0) === 0) {
      return {
        id: "database" as const,
        label: "Datenbank (NAS)",
        tone: "warn" as const,
        headline: `${countLabel(h.station_count)} Stationen eingebunden`,
        detail: "Polling-Set fehlt oder leer — docs/INSTALL.md, Abschnitt Polling-Set.",
        meta: h.polling_path ? `Pfad: ${h.polling_path}` : null,
      };
    }
    return {
      id: "database" as const,
      label: "Datenbank (NAS)",
      tone: "ok" as const,
      headline: `${countLabel(h.station_count)} Stationen · InfluxDB ok`,
      detail: h.archive_configured ? "Archiv-Zugang eingebunden — Lückenfüllung aktiv." : "Archiv-Zugang fehlt — Live-Preise funktionieren unabhängig davon.",
      meta: h.polling_path ? `Polling: ${h.polling_path}` : null,
    };
  })();

  // 3 · Modelle
  const modelsRow = (() => {
    if (!h) {
      return {
        id: "models" as const,
        label: "Modelle",
        tone: "unknown" as const,
        headline: "Kein Status",
        detail: "Kein Modell-Status — App-Server prüfen.",
        meta: null,
      };
    }
    const job = h.jobs?.models;
    const count = h.models?.count ?? 0;
    const published = h.models?.published_at;
    if (job?.state === "failed") {
      return {
        id: "models" as const,
        label: "Modelle",
        tone: "error" as const,
        headline: "Lauf fehlgeschlagen",
        detail: job.error_detail || job.error_code || "Modell-Lauf fehlgeschlagen — letzte gute Ergebnisse bleiben erhalten.",
        meta: published ? `Letzte Veröffentlichung ${timeLabel(published)}` : null,
      };
    }
    if (job?.state === "running") {
      return {
        id: "models" as const,
        label: "Modelle",
        tone: "warn" as const,
        headline: "Lauf aktiv",
        detail: job.progress?.label || job.progress?.phase_label || "Modell-Lauf rechnet — Fortschritt in der Läufe-Kachel.",
        meta: published ? `Letzte Veröffentlichung ${timeLabel(published)}` : null,
      };
    }
    if (job?.state === "aborted") {
      return {
        id: "models" as const,
        label: "Modelle",
        tone: "warn" as const,
        headline: "Lauf abgebrochen",
        detail: `Abgebrochen ${timeLabel(job.aborted_at)}${job.aborted_phase ? ` · Phase ${job.aborted_phase}` : ""} — letzte Ergebnisse bleiben erhalten.`,
        meta: published ? `Letzte Veröffentlichung ${timeLabel(published)}` : null,
      };
    }
    if (count === 0) {
      return {
        id: "models" as const,
        label: "Modelle",
        tone: "warn" as const,
        headline: "Noch kein Modell-Lauf",
        detail: "Noch kein Modell veröffentlicht — Job Modell-Update starten.",
        meta: null,
      };
    }
    return {
      id: "models" as const,
      label: "Modelle",
      tone: "ok" as const,
      headline: `Lauf ${published ? timeLabel(published) : "—"} · ${countLabel(count)} Prognosen`,
      detail: "Modelle veröffentlicht — Empfehlungen in Jetzt und Fenster in Woche nutzen sie.",
      meta: null,
    };
  })();

  // 4 · App
  const appRow = (() => {
    if (!h) {
      return {
        id: "app" as const,
        label: "App",
        tone: "unknown" as const,
        headline: "Kein Status",
        detail: "App-Status nicht geladen.",
        meta: null,
      };
    }
    const version = h.version ? `Version ${h.version}` : "Version unbekannt";
    const commit = h.commit ? ` (${h.commit})` : "";
    const pollingErr = h.polling_error;
    if (pollingErr) {
      return {
        id: "app" as const,
        label: "App",
        tone: "warn" as const,
        headline: `${version}${commit}`,
        detail: `Polling-Problem: ${pollingErr} — Einrichtung prüfen.`,
        meta: h.jobs_enabled ? "Hintergrundjobs aktiv" : "Hintergrundjobs aus",
      };
    }
    if (!h.jobs_enabled) {
      return {
        id: "app" as const,
        label: "App",
        tone: "warn" as const,
        headline: `${version}${commit}`,
        detail: "Hintergrundjobs aus — Läufe nur manuell über die Knöpfe.",
        meta: null,
      };
    }
    return {
      id: "app" as const,
      label: "App",
      tone: "ok" as const,
      headline: `${version}${commit}`,
      detail: "App läuft — Hintergrundjobs aktiv.",
      meta: null,
    };
  })();

  return [collectorRow, databaseRow, modelsRow, appRow];
}

export function systemOverallTone(rows: SystemStatusRow[]): SystemTone {
  if (rows.some((r) => r.tone === "error")) return "error";
  if (rows.some((r) => r.tone === "warn")) return "warn";
  if (rows.some((r) => r.tone === "unknown")) return "unknown";
  return "ok";
}

export function systemOverallLabel(tone: SystemTone): string {
  if (tone === "ok") return "Alles ok";
  if (tone === "warn") return "Hinweise";
  if (tone === "error") return "Störungen";
  return "Unbekannt";
}

export type SystemDataCoverage = {
  cities: string[];
  fuel: string;
  stationCount: number;
  freshCount: number;
  deadCount: number;
  closedCount: number;
  nofuelCount: number;
  twinCount: number;
  coverageWindow: string | null;
  coverageReference: number | null;
  coverageThreshold: number | null;
  generatedAt: string | null;
};

export function systemDataCoverage(input: {
  data: Stations | null;
  stations: Station[];
  freshCount: number;
  selection: Selection | null;
}): SystemDataCoverage {
  const sel = input.selection;
  return {
    cities: input.data?.cities ?? [],
    fuel: input.data?.fuel ?? "e10",
    stationCount: input.stations.length,
    freshCount: input.freshCount,
    deadCount: sel?.dead_count ?? 0,
    closedCount: sel?.closed_count ?? 0,
    nofuelCount: sel?.nofuel_count ?? 0,
    twinCount: sel?.price_twin_count ?? 0,
    coverageWindow: sel?.coverage_window ?? null,
    coverageReference: sel?.coverage_reference ?? null,
    coverageThreshold: sel?.coverage_threshold ?? null,
    generatedAt: sel?.generated_at ?? input.data?.generated_at ?? null,
  };
}

export type SystemFreshness = { text: string; tone: "ok" | "warn" | "bad" };

export function systemFreshness(input: {
  healthAt?: string | null;
  collectorAt?: string | null;
  modelsAt?: string | null;
  selectionAt?: string | null;
  now?: number;
}): SystemFreshness {
  const now = input.now ?? Date.now();
  const stamps = [input.healthAt, input.collectorAt, input.modelsAt, input.selectionAt].filter(Boolean) as string[];
  if (!stamps.length) {
    return { text: "Kein Datenstand — noch nichts gemeldet", tone: "warn" };
  }
  const ages = stamps.map((s) => ({ s, age: freshness(s, "prices", now) }));
  const worst = ages.reduce((acc, cur) => {
    const order = { fresh: 0, stale: 1, old: 2, unknown: 3 } as const;
    return order[cur.age] > order[acc.age] ? cur : acc;
  });
  const tone = worst.age === "old" ? "bad" : worst.age === "stale" ? "warn" : "ok";
  const parts: string[] = [];
  if (input.collectorAt) parts.push(`Collector ${ageLabel(input.collectorAt, now)}`);
  if (input.modelsAt) parts.push(`Modelle ${ageLabel(input.modelsAt, now)}`);
  if (input.selectionAt) parts.push(`Ranking ${ageLabel(input.selectionAt, now)}`);
  if (input.healthAt) parts.push(`Status ${ageLabel(input.healthAt, now)}`);
  const text = parts.length ? parts.join(" · ") : `Stand ${ageLabel(stamps[0], now)}`;
  return { text, tone };
}

export type SystemExplanation = {
  sentences: string[];
  source: string;
  labHint: LabHint | null;
};

export function systemExplanationZustand(): SystemExplanation {
  return {
    sentences: [
      "Der Zustand zeigt vier Bausteine: Collector (Pi sammelt), Datenbank (NAS speichert), Modelle (NAS rechnet) und App (Version und Jobs).",
      "Grün heißt frisch und freigegeben, gelb heißt veraltet oder wartend, rot heißt Fehler — die Details stehen in der jeweiligen Zeile.",
      "Was fehlt, nennt die App mit Grund und nächstem Schritt, statt eine Zahl zu erfinden.",
    ],
    source: "Grundlage: /api/v1/health und /api/v1/collector/status — dieselben Endpunkte wie die alte System-Ansicht.",
    labHint: labHint("lernen"),
  };
}

export function systemExplanationDaten(coverage: SystemDataCoverage): SystemExplanation {
  const cities = coverage.cities.length ? coverage.cities.join(", ") : "keine Stadt";
  return {
    sentences: [
      `Abdeckung: ${countLabel(coverage.stationCount)} Stationen im Set (${cities}), ${countLabel(coverage.freshCount)} mit frischem Preis — gezählt aus dem letzten Collector-Poll.`,
      coverage.coverageWindow
        ? `Coverage-Gate: Fenster ${coverage.coverageWindow} · Stadt-Bestwert ${coverage.coverageReference != null ? `${Math.round(coverage.coverageReference * 100)} %` : "—"} · Schwelle ${coverage.coverageThreshold != null ? `${Math.round(coverage.coverageThreshold * 100)} %` : "—"} relativ zum Bestwert — schützt vor Stationen, die deutlich seltener liefern.`
        : "Coverage-Gate misst im Polling-Fenster (06–24 Uhr) relativ zum Stadt-Bestwert — nicht absolut gegen das theoretische 24-h-Raster.",
      coverage.deadCount > 0 || coverage.twinCount > 0
        ? `${countLabel(coverage.deadCount)} tot · ${countLabel(coverage.closedCount)} geschlossen · ${countLabel(coverage.nofuelCount)} ohne Sorte · ${countLabel(coverage.twinCount)} Preis-Zwillinge — Warnungen brauchen Bestätigung, das Polling-Set ändert sich nie automatisch.`
        : "Keine toten Stationen und keine Preis-Zwillinge erkannt — Polling-Set bleibt unverändert.",
    ],
    source: "Grundlage: /api/v1/stations (frische Preise) und /api/v1/selection (Lebenszyklus, Zwillinge, Coverage).",
    labHint: labHint("stationen"),
  };
}

export function systemExplanationLaeufe(jobs: Record<string, Job | undefined> | null): SystemExplanation {
  const names = jobs ? Object.keys(jobs).join(", ") : "Archiv, Modelle, Selektion, Belege";
  return {
    sentences: [
      `Läufe: ${names} — jeder Job meldet Zustand (Erfolg, Läuft, Wartet, Unvollständig, Abgebrochen, Fehlgeschlagen) und Fortschritt je Phase.`,
      "Der Startknopf wirkt nur im NAS-Webauftritt und nie zweimal gleichzeitig — auf der Kommandozeile gilt der Worker-Befehl aus der Anleitung.",
      "Das Job-Log zeigt die letzten Zeilen direkt vom NAS (data/runtime/jobs/<job>.log) — Pfade und Zugangsdaten werden beim Auslesen entfernt.",
    ],
    source: "Grundlage: /api/v1/health → jobs und /api/v1/jobs/<job>/log — dieselben Zahlen wie im alten System-Tab.",
    labHint: labHint("lernen"),
  };
}

export function systemExplanationStoerungen(alarmCount: number): SystemExplanation {
  return {
    sentences: [
      alarmCount > 0
        ? `${countLabel(alarmCount)} Störung${alarmCount === 1 ? "" : "en"} aktiv — jede mit Code, Klartext und Checkliste, was du tun kannst.`
        : "Keine aktiven Störungen — die Anlage meldet keine Alarme.",
      "Gelb und Rot erscheinen nur als Anzeige im System-Tab und als Punkt in der Kopfzeile — kein Push, kein Ton (Betriebs-Entscheidung seit 0.35.0, docs/BETRIEB.md).",
      "Alarm-Zustellung über ntfy ist optional: Ist TANKAPP_NTFY_URL gesetzt, kommen Fehler-Alarme aufs Handy — sonst stehen sie nur hier.",
    ],
    source: "Grundlage: /api/v1/health → alarms und notify — dieselben Codes wie im Header-Punkt.",
    labHint: labHint("sicherheit"),
  };
}

export type SystemSetupStep = {
  label: string;
  done: boolean;
  hint: string;
};

export function systemSetupSteps(input: {
  health: Health | null;
  collector: CollectorStatus | null | undefined;
  decideReady: boolean;
}): SystemSetupStep[] {
  const h = input.health;
  const c = input.collector ?? h?.collector ?? null;
  return [
    {
      label: "Polling-Set",
      done: (h?.station_count ?? 0) > 0,
      hint: h?.station_count ? `${countLabel(h.station_count)} Stationen eingebunden.` : "Gemeinsames Polling-Set fehlt — docs/INSTALL.md, Abschnitt Polling-Set.",
    },
    {
      label: "Collector-Herzschlag",
      done: !!c?.available,
      hint: c?.available ? (c.fresh ? "Der Pi meldet regelmäßig Preise." : "Herzschlag vorhanden, aber veraltet.") : "Noch kein Herzschlag — Pi-Uploader prüfen.",
    },
    {
      label: "InfluxDB-Lesezugang",
      done: !!h?.influx_configured,
      hint: h?.influx_configured ? "Lesezugang eingebunden." : "influx.env fehlt — docs/INSTALL.md, Abschnitt InfluxDB.",
    },
    {
      label: "Erster Modell-Lauf",
      done: (h?.models?.count ?? 0) > 0,
      hint: h?.models?.count ? `${countLabel(h.models.count)} Prognosen veröffentlicht.` : "Noch kein Modell-Lauf — Job Modell-Update starten.",
    },
    {
      label: "Erste Empfehlung",
      done: input.decideReady,
      hint: input.decideReady ? "Der Kompass gibt eine belastbare Empfehlung." : "Noch nicht freigegeben — bis dahin zählen nur aktuelle Preise.",
    },
  ];
}
