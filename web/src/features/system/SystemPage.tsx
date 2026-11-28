import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { listOutbox, removeOutboxEntry, syncOutbox, type OutboxEntry } from "../../api/outbox";
import type { HealthResponse } from "../../api/types";
import { Card } from "../../components/ui/Card";
import "../feature-pages.css";

const endpoints = [
  "health",
  "overview",
  "decide",
  "stations",
  "stats/summary",
  "collector/status",
  "profiles",
  "fills",
  "fills/summary",
  "advice/diary",
  "heatmap",
];

export function SystemPage({ health }: { health: HealthResponse | null }) {
  const [tab, setTab] = useState<"status" | "export" | "api">("status");
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [endpoint, setEndpoint] = useState("health");
  const [result, setResult] = useState("");
  const [message, setMessage] = useState("");

  const reload = () => void listOutbox().then(setOutbox).catch((error) => setMessage(String(error)));
  useEffect(reload, []);

  const run = async () => {
    try {
      const data = await api.get<unknown>(endpoint);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    }
  };

  const downloadFills = async () => {
    try {
      const csv = await api.get<string>("fills.csv");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "fills.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage("Belegliste als CSV heruntergeladen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV-Export fehlgeschlagen");
    }
  };

  return (
    <div className="feature-stack">
      <div className="segmented" role="tablist" aria-label="System">
        {([["status", "Status & Jobs"], ["export", "Rohdaten & Exporte"], ["api", "API-Explorer"]] as const).map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>
      {message && <p role="status">{message}</p>}

      {tab === "status" && (
        <div className="feature-grid">
          <Card>
            <h2>Backend & Collector</h2>
            <dl className="kv-list">
              {Object.entries({
                Version: health?.version,
                Commit: health?.commit,
                Datenstand: health?.prices?.fetched_at,
                Collector: health?.collector?.available ? "Erreichbar" : "—",
                "Letzter Poll": health?.collector?.last_poll_at,
                Stationen: health?.station_count,
                Backup: health?.backup_status,
              }).map(([key, value]) => (
                <div key={key}><dt>{key}</dt><dd className="numeric">{value == null ? "—" : String(value)}</dd></div>
              ))}
            </dl>
            <h3>Jobs</h3>
            {Object.entries(health?.jobs ?? {}).map(([name, job]) => (
              <div className="kv-list" key={name}><div><dt>{name}</dt><dd>{job.state ?? "—"}</dd></div></div>
            ))}
            {!Object.keys(health?.jobs ?? {}).length && <p className="muted-line">Keine Job-Daten.</p>}
          </Card>
          <Card>
            <h2>Outbox · {outbox.length}</h2>
            <button type="button" onClick={() => void syncOutbox().then((summary) => {
              setMessage(`${summary.sent} synchronisiert, ${summary.remaining} offen`);
              reload();
            }).catch((error) => setMessage(String(error)))}>
              Synchronisieren
            </button>
            {outbox.map((entry) => (
              <div className="outbox-row" key={entry.id}>
                <span>{entry.createdAt} · {entry.kind} · {entry.lastError ?? "wartend"}</span>
                <button type="button" onClick={() => void removeOutboxEntry(entry.id).then(reload).catch((error) => setMessage(String(error)))}>Löschen</button>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === "export" && (
        <Card>
          <h2>Rohdaten & Exporte</h2>
          <p className="muted-line">Downloads verwenden die aktuellen Serverdaten.</p>
          <button className="export-link" type="button" onClick={() => void downloadFills()}>Belegliste als CSV herunterladen ↓</button>
          <button type="button" onClick={() => { setEndpoint("stations"); setTab("api"); }}>Stationsdaten ansehen</button>
        </Card>
      )}

      {tab === "api" && (
        <Card>
          <h2>API-Explorer</h2>
          <label>GET /api/v1/
            <select value={endpoint} onChange={(event) => setEndpoint(event.target.value)}>
              {endpoints.map((path) => <option key={path}>{path}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void run()}>Anfrage senden</button>
          <pre className="json-view">{result || "Noch keine Anfrage."}</pre>
        </Card>
      )}
    </div>
  );
}
