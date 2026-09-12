# TankApp Dokumentation

**Ein Ordner, ein Einstieg.** Alle Dokumente liegen direkt in `docs/`, benannt
nach ihrer Aufgabe. Veraltete Dokumente und Stichtags-Prüfberichte liegen in
[`docs/archiv/`](archiv/README.md) — nichts wird stillschweigend gelöscht.

> Stand: 12.09.2026 · App-Version **0.11.0**
> Was sich zuletzt geändert hat: [CHANGELOG](../CHANGELOG.md) ·
> was als Nächstes ansteht: [TODO](../TODO.md)

## Ich will … → Dokument

| Ich will … | Dokument |
|---|---|
| TankApp auf Pi + NAS einrichten (erster Start) | [INSTALL.md](INSTALL.md) |
| wissen, was im Dauerbetrieb zu tun ist (systemd, Backup, Alarme, Fehlersuche) | [BETRIEB.md](BETRIEB.md) |
| einen 24/7-Zugang über den RP2 (Fallback-GUI + NAS-Proxy) | [RP2.md](RP2.md) |
| eine tote oder sortenlose Station im Polling-Set tauschen | [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md) |
| verstehen, wie Pi ↔ NAS ↔ Browser zusammenspielen | [ARCHITEKTUR.md](ARCHITEKTUR.md) |
| einen API-Endpunkt nachschlagen | [API.md](API.md) |
| wissen, wie Selektion, Modelle und Heatmaps rechnen | [ANALYSE.md](ANALYSE.md) |
| das fachliche Zielbild lesen (drei Fragen, Decision Layer, Ehrlichkeits-Regel) | [KONZEPT.md](KONZEPT.md) |
| sehen, was vom Konzept umgesetzt ist und was bewusst offen bleibt | [LUECKEN.md](LUECKEN.md) |
| Modelle selbst fitten und prüfen (Werkstatt-Lauf am PC) | [ENGINE.md](ENGINE.md) |
| die Einzelprogramme in `data-tools/` verstehen | [DATENWERKZEUGE.md](DATENWERKZEUGE.md) |
| die GUI-Vorlagen in `sample/` als Design-Basis nutzen | [GUI-VORLAGEN.md](GUI-VORLAGEN.md) |
| eine frühere Prüfung oder ein altes Konzept nachlesen | [archiv/README.md](archiv/README.md) |

## Lesereihenfolge

1. **[INSTALL.md](INSTALL.md)** — der einzige verbindliche Ablauf: Gütersloh
   mitpollen → NAS-App starten → Archiv parallel → automatische Berechnung.
2. **[ARCHITEKTUR.md](ARCHITEKTUR.md)** — Rollen, Datenfluss, Heartbeat,
   Ressourcen, SD-Härtung. Erklärt, warum die Schritte so herum stehen.
3. **[BETRIEB.md](BETRIEB.md)** — alles, was nach dem ersten Start wiederkehrt:
   systemd, Backup/Restore, Alarme, Störungsfälle, InfluxDB, Unraid.
4. **[API.md](API.md)** und **[ANALYSE.md](ANALYSE.md)** — Nachschlagewerke für
   Endpunkte und Methodik, keine Checklisten.
5. **[KONZEPT.md](KONZEPT.md)** + **[LUECKEN.md](LUECKEN.md)** — Zielbild und
   der ehrliche Abgleich Zielbild ↔ Code.

## Die Dokumente im Einzelnen

### Einrichten und betreiben

| Dokument | Inhalt |
|---|---|
| [INSTALL.md](INSTALL.md) | Verbindlicher Ersteinrichtungs-Ablauf (Pi → NAS → Browser), private Dateien, `nas-up`, Unraid, was danach automatisch läuft, Echt-Daten-Abnahme |
| [BETRIEB.md](BETRIEB.md) | Collector/Uploader als systemd-Dienst, tmpfs, InfluxDB, Modell-Läufe beobachten und beschleunigen, Backup + Restore (Pi, InfluxDB, `runtime/`), System-Alarme, Fehlersuche, M1-Abnahme |
| [RP2.md](RP2.md) | RP2 als 24/7-Zugang: NAS-Proxy auf Port 8000, Fallback-GUI, Prognose-Cache, Services, Template-Updates, Fehlersuche |
| [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md) | Befund absichern, Ersatz suchen, 1:1-Vorschlag bauen, auf dem Pi aktivieren, NAS-Kopie nachziehen, Rollback |

### Verstehen

| Dokument | Inhalt |
|---|---|
| [ARCHITEKTUR.md](ARCHITEKTUR.md) | Zielbild, Rollen & Datenfluss, Pi (tmpfs, Heartbeat, systemd), Uploader, Ereignis-Pipeline, NAS (InfluxDB, Archiv, Modelle, Selektion), Ressourcen, Hardware-Bewertung |
| [ANALYSE.md](ANALYSE.md) | δ̂-Ranking, Bootstrap-KI & FDR, AV-Score, billigste Stunde, Heatmaps (Niveau/Cheap-Probability), Zeitreihen-Engine, Backtest, Umweg-Ökonomie |
| [KONZEPT.md](KONZEPT.md) | Fachliches Zielbild: drei Fragen (F1/F2/F3), zwei Modi, Ehrlichkeits-Regel, Datenquelle, Selektion, Engine, Decision Layer, Feedback-Ledger, KPIs, UI, Architektur, Roadmap M1–M7 |
| [LUECKEN.md](LUECKEN.md) | Konzept-Abdeckung § für §, geschlossene Punkte, bewusst offener Backlog **mit Grund**, Messwerte |

### Nachschlagen

| Dokument | Inhalt |
|---|---|
| [API.md](API.md) | Alle `/api/v1/*`-Endpunkte mit Parametern, Antworten, Fehlercodes, Rate-Limit, Deprecation, Beispielen |
| [ENGINE.md](ENGINE.md) | Modellwerkstatt: 12-Uhr-Regel, Datenqualität, Backtest-Rezepte, InfluxDB-Diagnose, Preis-Zwillinge, offene M3-Punkte |
| [DATENWERKZEUGE.md](DATENWERKZEUGE.md) | Gebündelte Befehle (`tankapp.py …`), interne Einzelprogramme, Archiv- und Analyse-CSV-Schema, optionale vertiefte Stationsanalyse |
| [GUI-VORLAGEN.md](GUI-VORLAGEN.md) | Die beiden Prototypen in `sample/` als gestalterische Basis: Übernahmeregeln, visuelle Leitplanken, Trennung Daten/Design |

### Projektstand (Repo-Wurzel, nicht in `docs/`)

| Datei | Inhalt |
|---|---|
| [../README.md](../README.md) | Kurzvorstellung, Geräte-Rollen, Stand der Umsetzung, Entwicklung & Tests |
| [../CHANGELOG.md](../CHANGELOG.md) | Alle nennenswerten Änderungen je Version |
| [../TODO.md](../TODO.md) | Priorisierte Arbeitsliste (P0/P1/P2/D) aus den Prüfungen |
| [../AGENTS.md](../AGENTS.md) | Arbeitsregeln für Änderungen in diesem Repo (CI-Spiegel, Push, GUI-Basis) |

### Archiv

[`archiv/README.md`](archiv/README.md) listet jedes abgelegte Dokument mit Datum,
Grund und Nachfolger. Dort liegen die Prüfberichte (Prüfstand, Gutachten,
Tiefenanalyse V1–V3), die abgeschlossene UUID-Migration, die alten RP2-Anleitungen
inkl. Mockups und ein Punktberichts-Polling-Set. Code-Kommentare, die
„Prüfstand §3.x“ oder „Gutachten“ zitieren, meinen genau diese Dateien.

## Was die App tut

TankApp beantwortet an der Säule in ≤ 5 Sekunden drei Fragen:

- **F1 — Jetzt oder warten?** Ampel + Zeitfenster + € + `p_besser`
- **F2 — Hier oder woanders?** Netto-€ nach Umweg (Sprit + Zeit)
- **F3 — Heute oder später?** Top-3-Fenster

Zwei Modi in der GUI:

- **Alltag** — Entscheidungs-Kompass, ≤ 3 primäre Zahlen
- **Werkstatt** — Scoreboard, Fan-Chart, Heatmaps, Meine Stationen, System-Status

Dritter Tab: **System** — Konfiguration, Archiv, Jobs, Collector, Alarme,
Einrichtungs-Checkliste, Tankbelege-Export.

```text
Tankerkönig live ──→ Pi: Collector + RAM-Puffer (/dev/shm/tankapp) ──→ NAS: InfluxDB
Tankerkönig-Archiv ───────────────────────────────────────────────→ NAS: Roharchiv + Cache
                                                                  ↓
                                                         Modelle + Selektion
                                                                  ↓
                                                         NAS: API + Web-GUI (1355)
                                                                  ↓
                                                          Handy/PC: Browser
Pi → NAS: collector_status (Herzschlag) via InfluxDB
RP2: Port 8000 proxyt das NAS, zeigt sonst die Fallback-GUI
```

## Schnellstart

```bash
# Pi: zweite Stadt aufnehmen und Polling-Set aktivieren
python3 tankapp.py add-city
sudo python3 tankapp.py activate-polling

# NAS: ein App-Dienst für GUI, Archiv, Modelle, Selektion
bash ops/nas/preflight.sh
python3 tankapp.py nas-up
# Browser: http://<NAS>:1355

# RP2 (optional, 24/7-Zugang): http://<Pi>:8000
```

Details und Reihenfolge: [INSTALL.md](INSTALL.md).

## API auf einen Blick

| Endpunkt | Aufgabe |
|---|---|
| `GET /api/v1/health` | App online, Version/Commit, Alarme, Jobs, Archiv, Modelle, Selektion, Collector |
| `GET /api/v1/decide` | **Primär:** Ampel, Alternativen, Fenster, `latest_by`, Fahrtmodus |
| `GET /api/v1/stations` | Aktuelle Preise (deprecated → `decide`) |
| `GET /api/v1/series` | Preisverlauf einer Station |
| `GET /api/v1/forecast` | Modell-Ausblick 24 h + 3 d/7 d je Station |
| `GET /api/v1/last_forecasts` | Prognose-Bündel für den RP2-Cache |
| `GET /api/v1/heatmap` | DoW × Stunde: Niveau oder Cheap-Probability, Vergleichs-Basis wählbar (B12) |
| `GET /api/v1/selection` | Meine Stationen: δ̂, Bootstrap-KI, AV-Score, billigste Stunde |
| `GET /api/v1/collector/status` | Pi/tmpfs-Livestatus |
| `GET /api/v1/route/evaluate` | Umweg-Ökonomie serverseitig (deprecated → `decide`) |
| `GET /api/v1/stats/summary` | Drei Schichten: Markt-Labor, Advice-Ledger, Wallet |
| `GET/POST /api/v1/episodes`, `POST …/intent` | Empfehlungs-Folgen und Nutzer-Intent |
| `GET/POST /api/v1/fills`, `DELETE …/{id}`, `GET …/fills.csv` | Tankbelege: Verlauf, Storno (Flag statt Löschen), CSV-Export |
| `POST /api/v1/jobs/{job}/run`, `GET …/log`, `POST /api/v1/jobs/trigger` | Job-Start, Job-Log, Webhook vom Uploader |
| `POST /api/v1/collector/heartbeat` | Herzschlag des Pi (HMAC) |

Vollständig mit Parametern, Antworten und Fehlercodes: [API.md](API.md).

## Hinweise, die Verwirrung sparen

- **`docs/analysis/` ist kein Doku-Ordner.** Das ist das gitignored
  Ausgabeverzeichnis der Selektion (`stations/polling.json`, Berichte,
  Abbildungen). Es existiert nur lokal auf Pi/NAS/PC und gehört nie ins Repo —
  `app/config.py` und `data-tools/*` lesen/schreiben dorthin.
- **`sample/` bleibt.** Beide GUI-Prototypen sind die gestalterische Basis der
  Homepage ([GUI-VORLAGEN.md](GUI-VORLAGEN.md), Regel in [../AGENTS.md](../AGENTS.md)).
- **Private Daten gehören nicht ins Repo:** `config.local.json`, `polling.json`,
  `data/influx.env`, `data/_netrc`, `data/apikey.txt` (siehe `.gitignore`).
- **Begriffe:** Alltag / Werkstatt / System. „Statistik“ und „Prüfstand“ sind
  veraltete Bezeichnungen und stehen nur noch in Archiv-Dokumenten.

## Regeln für diese Dokumentation

1. **Ein Ort.** Dokumentation lebt in `docs/`. Keine READMEs neben Code-Ordnern,
   keine Anleitungen in Repo-Wurzel oder Unterordnern.
2. **Aufgabe im Dateinamen.** Ein Dokument = eine Aufgabe. ASCII, Großbuchstaben,
   keine Datumsangaben bei lebenden Dokumenten.
3. **Stichtag ins Archiv.** Prüfberichte, Migrationen und Punktstände sind nach
   ihrer Abarbeitung historisch: `docs/archiv/<THEMA>-<JJJJ-MM-TT>.md` plus Eintrag
   in [archiv/README.md](archiv/README.md) (Grund + Nachfolger). Noch gültige
   Betriebs-Aussagen daraus werden vorher in das zuständige lebende Dokument
   übernommen (meist [BETRIEB.md](BETRIEB.md)).
4. **Stand-Zeile und Inhaltsverzeichnis** oben in jedem Dokument.
5. **Links bleiben heil.** `tests/test_operations.py::test_local_documentation_links_exist`
   prüft jeden lokalen Link und jeden Anker in allen Dokumenten inklusive Archiv —
   ein umbenanntes Dokument bedeutet immer auch: Verweise nachziehen
   (Markdown, Python-Docstrings, CLI-Hilfen, `web/`, `.github/`).
6. **Ehrlichkeits-Regel gilt auch für Doku** (Konzept §0.4): kein „fertig“,
   was nicht abgenommen ist; offene Punkte mit Grund statt Lücke.

## Footer

Daten: MTS-K via tankerkoenig.de (CC BY 4.0) · Token-Bucket 1 Request/300 s ·
Polling-Fenster 06–24 Uhr · App-Version und Commit-Hash stehen in
`GET /api/v1/health` und im GUI-Footer.
