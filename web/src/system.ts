// System — die reine Logik des Technik-Bereichs (docs/produkt/UI.md, BereichePhase 4).
//
// Warum eine eigene Datei: Die Ansicht rendert, sie entscheidet nichts (D1).
// Alles hier ist aus Server-Zahlen ableitbar und ohne DOM prüfbar — die vier
// Bausteine des Zustands (Collector, Datenbank, Modelle, App), die Daten-Abdeckung,
// die Läufe, die Störungen, die Frische-Fußzeile und der Diagnose-Export.
//
// Ehrlichkeits-Regeln (§10):
//   * Lädt = Skelett im späteren Raster, Leer = Grund + was als Nächstes passiert,
//     Unsicher = grau, Fehler = Klartext + Rohcode + „Erneut laden“.
//   * Jede Zahl hat Herkunft und Frische — dieselben Schwellen wie dataAgeNote.
//   * Zahlen ausschließlich über die Formatter (data.ts).

import {
  ageLabel,
  ageWord,
  countLabel,
  deNumber,
  deTrimmed,
  freshness,
  JOB_LABELS,
  NO_DATA_LINE,
  percentLabel,
  timeLabel,
  type Alarm,
  type CollectorStatus,
  type DataKind,
  type Health,
  type Job,
  type Selection,
  type Station,
  type Stations,
} from "./data";
import { labHint, type LabHint } from "./lab";

/** T5: derselbe Hinweis an beiden Stellen (Daten-Karte und Einrichtungsliste). */
const INFLUX_MISSING = "influx.env fehlt — docs/betrieb/INSTALL.md, Abschnitt InfluxDB.";

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

  const collectorRow = ((): SystemStatusRow => {
    if (!c) {
      return {
        id: "collector",
        label: "Collector (Pi)",
        tone: "unknown",
        headline: "Kein Herzschlag",
        detail: "Noch kein Collector-Herzschlag auf dem NAS — Pi-Uploader prüfen.",
        meta: null,
      };
    }
    const age = c.age_minutes;
    if (!c.available) {
      return {
        id: "collector",
        label: "Collector (Pi)",
        tone: "error",
        headline: "Kein Herzschlag",
        detail: c.error_code
          ? `Fehler: ${c.error_code}`
          : "Der Pi meldet seit längerem keine Preise.",
        meta: c.last_poll_at ? `Letzter Poll ${timeLabel(c.last_poll_at)}` : null,
      };
    }
    const tmpfsMeta =
      c.tmpfs_used_bytes != null
        ? `${deTrimmed(Number(c.tmpfs_used_bytes) / 1024 / 1024, 1)} MiB tmpfs`
        : null;
    if (c.fresh) {
      const mins = age != null ? `${ageWord(age)} gemeldet` : "frisch";
      return {
        id: "collector",
        label: "Collector (Pi)",
        tone: "ok",
        headline: `Preise ${mins}`,
        detail: `Letzter Poll ${timeLabel(c.last_poll_at)} · ${countLabel(c.open_count)} offen von ${countLabel(c.total_count)}`,
        meta: tmpfsMeta,
      };
    }
    return {
      id: "collector",
      label: "Collector (Pi)",
      tone: "warn",
      headline: age != null ? `Preise ${ageWord(age)}` : "Veraltet",
      detail: `Letzter Poll ${timeLabel(c.last_poll_at)} — älter als 30 Minuten, Collector prüfen.`,
      meta: tmpfsMeta,
    };
  })();

  const databaseRow = ((): SystemStatusRow => {
    if (!h) {
      return {
        id: "database",
        label: "Datenbank (NAS)",
        tone: "unknown",
        headline: "Kein Status",
        detail: "Gesundheitsabfrage liefert keinen Status — App-Server prüfen.",
        meta: null,
      };
    }
    if (!h.influx_configured) {
      return {
        id: "database",
        label: "Datenbank (NAS)",
        tone: "error",
        headline: "InfluxDB nicht eingebunden",
        detail: INFLUX_MISSING,
        meta: h.polling_path ? `Polling-Pfad: ${h.polling_path}` : null,
      };
    }
    if ((h.station_count ?? 0) === 0) {
      return {
        id: "database",
        label: "Datenbank (NAS)",
        tone: "warn",
        headline: `${countLabel(h.station_count)} Stationen eingebunden`,
        detail: "Polling-Set fehlt oder leer — docs/betrieb/INSTALL.md, Abschnitt Polling-Set.",
        meta: h.polling_path ? `Pfad: ${h.polling_path}` : null,
      };
    }
    return {
      id: "database",
      label: "Datenbank (NAS)",
      tone: "ok",
      headline: `${countLabel(h.station_count)} Stationen · InfluxDB ok`,
      detail: h.archive_configured
        ? "Archiv-Zugang eingebunden — Lückenfüllung aktiv."
        : "Archiv-Zugang fehlt — Live-Preise funktionieren unabhängig davon.",
      meta: h.polling_path ? `Polling: ${h.polling_path}` : null,
    };
  })();

  const modelsRow = ((): SystemStatusRow => {
    if (!h) {
      return {
        id: "models",
        label: "Modelle",
        tone: "unknown",
        headline: "Kein Status",
        detail: "Kein Modell-Status — App-Server prüfen.",
        meta: null,
      };
    }
    const job = h.jobs?.models;
    const count = h.models?.count ?? 0;
    const published = h.models?.published_at;
    const publishedMeta = published
      ? `Letzte Veröffentlichung ${timeLabel(published)}`
      : null;
    if (job?.state === "failed") {
      return {
        id: "models",
        label: "Modelle",
        tone: "error",
        headline: "Lauf fehlgeschlagen",
        detail:
          job.error_detail ||
          job.error_code ||
          "Modell-Lauf fehlgeschlagen — letzte gute Ergebnisse bleiben erhalten.",
        meta: publishedMeta,
      };
    }
    if (job?.state === "running") {
      return {
        id: "models",
        label: "Modelle",
        tone: "warn",
        headline: "Lauf aktiv",
        detail:
          job.progress?.label ||
          job.progress?.phase_label ||
          "Modell-Lauf rechnet — Fortschritt in der Läufe-Kachel.",
        meta: publishedMeta,
      };
    }
    if (job?.state === "aborted") {
      return {
        id: "models",
        label: "Modelle",
        tone: "warn",
        headline: "Lauf abgebrochen",
        detail: `Abgebrochen ${timeLabel(job.aborted_at)}${job.aborted_phase ? ` · Phase ${job.aborted_phase}` : ""} — letzte Ergebnisse bleiben erhalten.`,
        meta: publishedMeta,
      };
    }
    if (count === 0) {
      return {
        id: "models",
        label: "Modelle",
        tone: "warn",
        headline: "Noch kein Modell-Lauf",
        detail: "Noch kein Modell veröffentlicht — Job Modell-Update starten.",
        meta: null,
      };
    }
    return {
      id: "models",
      label: "Modelle",
      tone: "ok",
      headline: `Lauf ${published ? timeLabel(published) : "—"} · ${countLabel(count)} Prognosen`,
      detail:
        "Modelle veröffentlicht — Empfehlungen in Jetzt und Fenster in Woche nutzen sie.",
      meta: null,
    };
  })();

  const appRow = ((): SystemStatusRow => {
    if (!h) {
      return {
        id: "app",
        label: "App",
        tone: "unknown",
        headline: "Kein Status",
        detail: "App-Status nicht geladen.",
        meta: null,
      };
    }
    const version = h.version ? `Version ${h.version}` : "Version unbekannt";
    const commit = h.commit ? ` (${h.commit})` : "";
    if (h.polling_error) {
      return {
        id: "app",
        label: "App",
        tone: "warn",
        headline: `${version}${commit}`,
        detail: `Polling-Problem: ${h.polling_error} — Einrichtung prüfen.`,
        meta: h.jobs_enabled ? "Hintergrundjobs aktiv" : "Hintergrundjobs aus",
      };
    }
    if (!h.jobs_enabled) {
      return {
        id: "app",
        label: "App",
        tone: "warn",
        headline: `${version}${commit}`,
        detail: "Hintergrundjobs aus — Läufe nur manuell über die Knöpfe.",
        meta: null,
      };
    }
    return {
      id: "app",
      label: "App",
      tone: "ok",
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
  // B5: Jeder Stempel wird mit der Schwellenart gewertet, die zu seiner
  // Natur passt — Health/Collector hängen am Preis-Polling (30 min),
  // Modelle und Selektion laufen täglich. Vorher wogen alle vier mit
  // der Preis-Schwelle, und ein gesundes tägliches Modell machte die
  // Fußzeile stur rot.
  const stamps: Array<[string, DataKind]> = [
    [input.healthAt, "prices"],
    [input.collectorAt, "prices"],
    [input.modelsAt, "model"],
    [input.selectionAt, "selection"],
  ].filter(
    (s): s is [string, DataKind] => s[0] != null,
  );
  if (!stamps.length) {
    return { text: NO_DATA_LINE, tone: "warn" };
  }
  const ages = stamps.map(([s, kind]) => ({ s, age: freshness(s, kind, now) }));
  const worst = ages.reduce((acc, cur) => {
    const order = { fresh: 0, stale: 1, old: 2, unknown: 3 } as const;
    return order[cur.age] > order[acc.age] ? cur : acc;
  });
  const tone =
    worst.age === "old" ? "bad" : worst.age === "stale" ? "warn" : "ok";
  const parts: string[] = [];
  if (input.collectorAt) parts.push(`Collector ${ageLabel(input.collectorAt, now)}`);
  if (input.modelsAt) parts.push(`Modelle ${ageLabel(input.modelsAt, now)}`);
  if (input.selectionAt) parts.push(`Ranking ${ageLabel(input.selectionAt, now)}`);
  if (input.healthAt) parts.push(`Status ${ageLabel(input.healthAt, now)}`);
  const text = parts.length
    ? parts.join(" · ")
    : `Stand ${ageLabel(stamps[0][0], now)}`;
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
    source:
      "Grundlage: /api/v1/health und /api/v1/collector/status.",
    labHint: labHint("lernen"),
  };
}

export function systemExplanationDaten(
  coverage: SystemDataCoverage,
): SystemExplanation {
  const cities = coverage.cities.length
    ? coverage.cities.join(", ")
    : "keine Stadt";
  const reference =
    coverage.coverageReference != null
      ? percentLabel(coverage.coverageReference * 100)
      : "—";
  const threshold =
    coverage.coverageThreshold != null
      ? percentLabel(coverage.coverageThreshold * 100)
      : "—";
  return {
    sentences: [
      `Abdeckung: ${countLabel(coverage.stationCount)} Stationen im Set (${cities}), ${countLabel(coverage.freshCount)} mit frischem Preis — gezählt aus dem letzten Collector-Poll.`,
      coverage.coverageWindow
        ? `Coverage-Gate: Fenster ${coverage.coverageWindow} · Stadt-Bestwert ${reference} · Schwelle ${threshold} relativ zum Bestwert — schützt vor Stationen, die deutlich seltener liefern.`
        : "Coverage-Gate misst im Polling-Fenster (06–24 Uhr) relativ zum Stadt-Bestwert — nicht absolut gegen das theoretische 24-h-Raster.",
      coverage.deadCount > 0 || coverage.twinCount > 0
        ? `${countLabel(coverage.deadCount)} tot · ${countLabel(coverage.closedCount)} geschlossen · ${countLabel(coverage.nofuelCount)} ohne Sorte · ${countLabel(coverage.twinCount)} Preis-Zwillinge — Warnungen brauchen Bestätigung, das Polling-Set ändert sich nie automatisch.`
        : "Keine toten Stationen und keine Preis-Zwillinge erkannt — Polling-Set bleibt unverändert.",
    ],
    source:
      "Grundlage: /api/v1/stations (frische Preise) und /api/v1/selection (Lebenszyklus, Zwillinge, Coverage).",
    labHint: labHint("stationen"),
  };
}

export function systemExplanationLaeufe(
  jobs: Record<string, Job | undefined> | null,
): SystemExplanation {
  const names = jobs
    ? Object.keys(jobs)
        .map((key) => JOB_LABELS[key] ?? key)
        .join(", ")
    : "Archiv-Sync, Modell-Update, Selektion Ranking, Beleg-Verarbeitung";
  return {
    sentences: [
      `Läufe: ${names} — jeder Job meldet Zustand (Erfolg, Läuft, Wartet, Unvollständig, Abgebrochen, Fehlgeschlagen) und Fortschritt je Phase.`,
      "Der Startknopf wirkt nur im NAS-Webauftritt und nie zweimal gleichzeitig — auf der Kommandozeile gilt der Worker-Befehl aus der Anleitung.",
      "Das Job-Log zeigt die letzten Zeilen direkt vom NAS — Pfade und Zugangsdaten werden beim Auslesen entfernt.",
    ],
    source:
      "Grundlage: /api/v1/health → jobs und /api/v1/jobs/<job>/log.",
    labHint: labHint("lernen"),
  };
}

export function systemExplanationStoerungen(
  alarmCount: number,
): SystemExplanation {
  return {
    sentences: [
      alarmCount > 0
        ? `${countLabel(alarmCount)} Störung${alarmCount === 1 ? "" : "en"} aktiv — jede mit Code, Klartext und Checkliste, was zu tun ist.`
        : "Keine aktiven Störungen — die Anlage meldet keine Alarme.",
      "Gelb und Rot erscheinen nur als Anzeige im System-Tab und als Punkt in der Kopfzeile — kein Push, kein Ton (Betriebs-Entscheidung seit 0.35.0, docs/betrieb/BETRIEB.md).",
      "Alarm-Zustellung über ntfy ist optional: Ist TANKAPP_NTFY_URL gesetzt, kommen Fehler-Alarme aufs Handy — sonst stehen sie nur hier.",
    ],
    source:
      "Grundlage: /api/v1/health → alarms und notify — dieselben Codes wie im Header-Punkt.",
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
      hint: h?.station_count
        ? `${countLabel(h.station_count)} Stationen eingebunden.`
        : "Gemeinsames Polling-Set fehlt — docs/betrieb/INSTALL.md, Abschnitt Polling-Set.",
    },
    {
      label: "Collector-Herzschlag",
      done: !!c?.available,
      hint: c?.available
        ? c.fresh
          ? "Der Pi meldet regelmäßig Preise."
          : "Herzschlag vorhanden, aber veraltet."
        : "Noch kein Herzschlag — Pi-Uploader prüfen.",
    },
    {
      label: "InfluxDB-Lesezugang",
      done: !!h?.influx_configured,
      hint: h?.influx_configured
        ? "Lesezugang eingebunden."
        : INFLUX_MISSING,
    },
    {
      label: "Erster Modell-Lauf",
      done: (h?.models?.count ?? 0) > 0,
      hint: h?.models?.count
        ? `${countLabel(h.models.count)} Prognosen veröffentlicht.`
        : "Noch kein Modell-Lauf — Job Modell-Update starten.",
    },
    {
      label: "Erste Empfehlung",
      done: input.decideReady,
      hint: input.decideReady
        ? "Der Kompass gibt eine belastbare Empfehlung."
        : "Noch nicht freigegeben — bis dahin zählen nur aktuelle Preise.",
    },
  ];
}

/**
 * Diagnose-Export (§5.5): Version, Zustand, letzte Log-Zeilen, Coverage —
 * als Datei, ohne Tokens, ohne Pfade mit Zugangsdaten. Reine Funktion,
 * damit der Inhalt testbar bleibt; die View löst nur den Download aus.
 */
export function systemDiagnosticExport(input: {
  version?: string | null;
  commit?: string | null;
  generatedAt?: string | null;
  overall: { tone: SystemTone; label: string };
  rows: SystemStatusRow[];
  coverage: SystemDataCoverage;
  alarms: Alarm[];
  logJob: string;
  logLines: string[];
}): string {
  return JSON.stringify(
    {
      app: "tankapp",
      version: input.version ?? null,
      commit: input.commit ?? null,
      generated_at: input.generatedAt ?? null,
      overall: input.overall,
      zustand: input.rows.map((row) => ({
        id: row.id,
        label: row.label,
        tone: row.tone,
        headline: row.headline,
        detail: row.detail,
      })),
      coverage: {
        cities: input.coverage.cities,
        fuel: input.coverage.fuel,
        stations: input.coverage.stationCount,
        fresh: input.coverage.freshCount,
        dead: input.coverage.deadCount,
        closed: input.coverage.closedCount,
        nofuel: input.coverage.nofuelCount,
        twins: input.coverage.twinCount,
        window: input.coverage.coverageWindow,
      },
      alarms: input.alarms.map((alarm) => ({
        code: alarm.code,
        severity: alarm.severity,
        message: alarm.message,
        job: alarm.job ?? null,
      })),
      log: {
        job: input.logJob,
        lines: input.logLines.slice(-80),
      },
    },
    null,
    2,
  );
}

export function systemDiagnosticFilename(stamp?: string | null): string {
  const day = stamp
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Berlin",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(stamp))
    : "ohne-stand";
  return `tankapp-diagnose-${day}.json`;
}

// ---------------------------------------------------------------------------
// B8: Webhook Pi → NAS. Der Uploader meldet mit dem Herzschlag, ob ein
// Trigger auf Quittierung wartet und wie der letzte Versuch ausging
// (`collector_status` → `/api/v1/collector/status`). Hier wird daraus ein
// Satz — mit Grund statt Schuld und ohne Zahl, die niemand gemessen hat.
// ---------------------------------------------------------------------------

export type WebhookState = {
  pending?: boolean | null;
  attempts?: number | null;
  pending_age_s?: number | null;
  last_status?: string | null;
  last_ok_age_s?: number | null;
  gave_up?: number | null;
};

export type WebhookLine = { tone: SystemTone; text: string; note: string };

/** Kurze, ehrliche Beschreibung des letzten Quittierungs-Ergebnisses. */
function webhookStatusText(status: string): { tone: SystemTone; text: string } {
  switch (status) {
    case "queued":
      return { tone: "ok", text: "Quittiert — der NAS-Job ist vorgemerkt." };
    case "debounced":
      return { tone: "ok", text: "Quittiert — gedrosselt, ein Lauf steht kurz bevor." };
    case "duplicate":
      return { tone: "ok", text: "Quittiert — nicht nötig, derselbe Datenstand war schon gelaufen." };
    case "rejected":
      return { tone: "error", text: "Abgelehnt — der NAS kennt diesen Job nicht." };
    case "unauthorized":
      return { tone: "error", text: "Abgelehnt — Token passt nicht zu NAS und Pi." };
    case "abandoned":
      return { tone: "warn", text: "Aufgegeben — nach 2 h nicht quittiert, der Intervalljob übernimmt." };
    case "retry_wait":
      return { tone: "warn", text: "Wartet auf den nächsten Versuch." };
    default:
      if (status.startsWith("http_4")) {
        return { tone: "error", text: `Abgelehnt (${status}) — Wiederholen hilft nicht.` };
      }
      if (status.startsWith("http_")) {
        return { tone: "warn", text: `Keine Quittierung (${status}) — wird erneut versucht.` };
      }
      return { tone: "ok", text: `Quittiert (${status}).` };
  }
}

/**
 * Eine Zeile für den Collector-Baustein: „Was macht der Trigger Pi → NAS?“
 *
 * ``null`` heißt „keine Angabe“ und nicht „in Ordnung“: Ohne eingerichtetes
 * Ziel meldet der Uploader nichts, und der Intervalljob läuft unabhängig
 * davon. Steht ein Versuch offen, sagt der Satz die Zahl der Versuche und
 * das Alter des ältesten.
 */
/**
 * T7: Der Serverzustand kommt als englisches Enum — angezeigt wird das
 * deutsche Wort, der Rohcode steht höchstens im title.
 */
export function driftStatusLine(drift: {
  status: string;
  max_cusum?: number | null;
} | null | undefined): string {
  if (!drift) return "—";
  const value =
    drift.max_cusum != null && Number.isFinite(drift.max_cusum)
      ? ` (${deNumber(drift.max_cusum)}σ)`
      : "";
  if (drift.status === "normal") return `unauffällig${value}`;
  if (drift.status === "drift") return `Drift erkannt${value}`;
  if (drift.status === "unknown") return "noch nicht messbar";
  return drift.status;
}

export function webhookLine(webhook: WebhookState | null | undefined): WebhookLine {
  if (!webhook) {
    return {
      tone: "unknown",
      text: "Keine Angabe — kein Ziel eingerichtet oder älterer Uploader.",
      note: "Der Intervalljob läuft unabhängig davon.",
    };
  }
  if (webhook.pending) {
    const attempts = webhook.attempts ?? 0;
    const age = webhook.pending_age_s;
    const since =
      age != null && Number.isFinite(age)
        ? ` seit ${ageWord(age / 60).replace(/^vor /, "")}`
        : "";
    const tries = attempts === 0 ? "erster Versuch" : `${countLabel(attempts)} Versuche`;
    return {
      tone: "warn",
      text: `Wartet auf Quittierung — ${tries}${since}.`,
      note: "Ein kurzer NAS-Ausfall holt sich selbst auf; der Intervalljob läuft weiter.",
    };
  }
  if (webhook.last_status) {
    const { tone, text } = webhookStatusText(webhook.last_status);
    const age = webhook.last_ok_age_s;
    const when =
      age != null && Number.isFinite(age)
        ? ` Zuletzt quittiert ${ageWord(age / 60)}`
        : "";
    const gaveUp = (webhook.gave_up ?? 0) > 0 ? ` Aufgegeben: ${countLabel(webhook.gave_up)}.` : "";
    return {
      tone,
      text: text + when,
      note: `Der Intervalljob läuft unabhängig davon.${gaveUp}`,
    };
  }
  return {
    tone: "unknown",
    text: "Noch kein Trigger gemeldet.",
    note: "Der erste Trigger geht nach dem nächsten sicheren Preis-Write raus.",
  };
}
