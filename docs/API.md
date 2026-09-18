# TankApp API — Endpunkte & Spezifikation

> Stand: 17.09.2026 · App-Version **0.49.5** — neu seit 0.49.1: die
> Stations-Antwort ist die verbindliche Form für die App (siehe
> [Stations](#stations)); der RP2-Fallback liefert sie seit RP2 v4.3 mit
> `cities` und je Zeile `observed_at`, und ein Fehlerpayload trägt bei
> unerwarteten Ursachen bereinigten Klartext in `detail` (O44, siehe
> [Fehlercodes](#fehlercodes)). Neu seit 0.49.0: die
> Prognose-Veröffentlichung ist aufgeteilt (eine Datei je Station, Index mit
> Zeigern, O22 Maßnahme d); der `publication`-Block im Health-Payload nennt
> zusätzlich `index_bytes`/`file_count`/`largest_file_bytes` und den Grund
> `incomplete`, die Endpunkte liefern dieselbe Struktur wie vorher.
> Davor neu seit 0.48.0 (Batch 5 des
> [Optimierungs-Befunds](OPTIMIERUNGS-BEFUND.md#10-batches-priorität-und-check)):
> normierte Fenstersterne mit Rohwert/Basisrate (O12), 0,5-Gleichstände (O7),
> strikte Belegfenster und Netto-Umweg-Provenienz (O8/O9), 7×24-
> Personalisierung (O2/O3), Forecast-Support (O10), LOO-Heatmap (O11),
> benannte Strecken/Zeitwertstufe (O14/O15) sowie Server-Uhrzeit für Belege
> ohne `tanked_at` (O43). Seit 0.47.0: `backup` (Alter der Laufzeit-Backups,
> O33) in `/health`, und der Server antwortet mit **HTTP/1.1** statt HTTP/1.0 —
> mehrere Anfragen teilen sich eine Verbindung (O24). Seit 0.46.0:
> `notify.mode` (Push-Modus, O42),
> `price_implausible`-Zähler (O35) in `/health`,
> `implausible_price` je Station (O35), Fenster-Meldungen über den
> ntfy-Kanal (O29). Davor: B3/B4/B5, Ereignis-Pipeline
> (`POST /api/v1/jobs/trigger`, Issue 50) und die Endpunkte aus 0.10.0:
> Beleg-Storno (`DELETE /api/v1/fills/{id}`, A3), Beleg-Verlauf
> (`GET /api/v1/fills`), CSV-Export (`GET /api/v1/fills.csv`, A6),
> `alarms[]` + `version`/`commit` in `/health` (B4/B9). Seit 0.40.0 nennt das
> Advice-Tagebuch den Grund einer Ablehnung (`decline_reason`) und den Namen der
> Station (`station_name`). Seit **0.44.0** (Batch 1 des
> [Optimierungs-Befunds](OPTIMIERUNGS-BEFUND.md#10-batches-priorität-und-check))
> trägt jeder Beleg die Herkunft seiner Tankuhrzeit (`clock_hour_source`, O1),
> der Feedback-Store hat `schema_version` **4** (Altbestände werden beim Laden
> migriert, siehe [BETRIEB.md](BETRIEB.md)), und `/health` nennt Größe und
> Lesbarkeit der Prognose-Veröffentlichung (`publication`, O22) samt der Alarme
> `publication_large`/`publication_unreadable`.
> Alles serverseitig, keine Demo-Fallbacks (Ehrlichkeits-Regel, Konzept §0.4).

## Inhaltsverzeichnis

- [Auth & Limits](#auth--limits)
- [Übersicht](#übersicht)
- [Decide (B4 Primär)](#decide-b4-primär)
- [Episodes & Intent (B4)](#episodes--intent-b4)
- [Fills (B4 Belege)](#fills-b4-belege)
  - [Beleg-Verlauf (GET)](#beleg-verlauf-get)
  - [Beleg stornieren (DELETE, A3)](#beleg-stornieren-delete-a3)
  - [CSV-Export (A6)](#csv-export-a6)
- [Stats Summary (B4 3 Schichten)](#stats-summary-b4-3-schichten)
- [Health](#health)
- [Stations](#stations)
- [Series](#series)
- [Forecast](#forecast)
- [Last Forecasts (RP2)](#last-forecasts-rp2)
- [Heatmap (B3.9)](#heatmap-b39)
- [Selection / Meine Stationen (B3.10)](#selection--meine-stationen-b310)
- [Collector Status (B3.11)](#collector-status-b311)
- [Collector Heartbeat (POST, B3.11)](#collector-heartbeat-post-b311)
- [Jobs Trigger (POST, Issue 50)](#jobs-trigger-post-issue-50)
- [Job starten (POST, B6 — Startknopf)](#job-starten-post-b6--startknopf)
- [Job-Log (GET, B6)](#job-log-get-b6)
- [Route Evaluate (B3.12)](#route-evaluate-b312)
- [Deprecation alter Alltags-Routen (B5, Konzept §11.3)](#deprecation-alter-alltags-routen-b5-konzept-113)
- [Fehlercodes](#fehlercodes)
- [Beispiele](#beispiele)

## Auth & Limits

Kein App-weites Rate-Limit: Die App läuft im Heimnetz (LAN-only) — keine
`X-RateLimit-*`-Header, kein `429` auf Lesen, keine API-Keys
(`TANKAPP_API_KEYS` und `TANKAPP_RATE_*` sind ersatzlos entfernt,
`app/ratelimit.py` gelöscht). Einzige Auth bleibt der Uploader-Webhook
(`POST /api/v1/jobs/trigger`, nur mit konfiguriertem `TANKAPP_WEBHOOK_TOKEN`
per `Authorization: Bearer`).

**Schreib-Budget (B5):** Die Ledger-Endpunkte `POST /api/v1/fills`,
`POST /api/v1/episodes/{id}/intent` (+ `outcome`-Alias) und
`DELETE /api/v1/fills/{id}` teilen sich ein Budget von **20 Schreibungen
je Client-IP und Minute** (rollendes 60-s-Fenster). Darüber hinaus: `429`
mit `{"error_code": "write_rate_limited"}` und `Retry-After: 60`. Das
Budget schützt das Ledger vor einem defekten Client, nicht vor Angreifern;
Heartbeat, Job-Knopf und Webhook zählen nicht mit, und Lesen bleibt immer
frei (GUI-Polling).

- **Protokoll (O24, seit 0.47.0):** Der Server antwortet mit `HTTP/1.1` —
  aufeinanderfolgende Anfragen teilen sich eine Verbindung (Keep-Alive),
  jede Antwort trägt `Content-Length`. Antworten, die den Request-Body nicht
  lesen (429 Schreib-Budget, 413 zu großer Body, chunked, unlesbare Länge),
  beenden die Verbindung und sagen es mit `Connection: close`: Ein ungelesener
  Body läge sonst vor dem nächsten Request derselben Verbindung. Eine
  Keep-Alive-Verbindung ohne Anfrage endet nach 65 s
  (`Handler.timeout`), damit ein vergessenes Tab keinen Thread hält.
  Nachweis: `curl -sv --http1.1 …/api/v1/health …/api/v1/health` zeigt
  „Re-using existing connection“.
- JSON/UTF-8, Zeiten Europe/Berlin angezeigt, UTC gespeichert; `Cache-Control: no-store`
  überall außer: content-hashierte Assets (`/assets/…`, `immutable`) und die
  semi-statischen Antworten `heatmap`/`last_forecasts`
  (`public, max-age=900` — sie ändern sich nur mit dem Modelllauf, B7).
- JSON-Antworten werden ab 512 Byte als `Content-Encoding: gzip` ausgeliefert,
  wenn der Client `Accept-Encoding: gzip` schickt (B7); `Vary: Accept-Encoding`
  ist immer gesetzt.
- Schreib-Endpunkte:
  - `POST /api/v1/collector/heartbeat` (Collector-Herzschlag, B3.11)
  - `POST /api/v1/jobs/trigger` (Uploader-Webhook, Issue 50; nur mit konfiguriertem `TANKAPP_WEBHOOK_TOKEN`, Auth per `Authorization: Bearer <Token>`)
  - `POST /api/v1/episodes/{episode_id}/intent` (Nutzer-Intent setzen, B4) bzw. `POST /api/v1/recommendations/{id}/outcome` (Alias, schreibt ein Fill gegen den letzten Snapshot)
  - `POST /api/v1/fills` (Persönliche Tankbelege für Wallet-Ledger, B4)
  - `DELETE /api/v1/fills/{id}` (Beleg stornieren: `voided`-Flag statt Löschen, A3)
  - `POST /api/v1/profiles`, `PUT /api/v1/profiles/{id}`, `POST /api/v1/profiles/{id}/activate`, `POST /api/v1/profiles/activate`, `DELETE /api/v1/profiles/{id}` (Fahrzeug-/Haushaltsprofile ohne Login, A1)
- Lesend, aber persönlich: `GET /api/v1/fills` (Verlauf), `GET /api/v1/fills.csv` (Export, A6), `GET /api/v1/fills/summary` (Monats-/Jahresbilanz, A4) und `GET /api/v1/profiles` (Profil-Liste, A1)
- Nicht implementierte Schreib-Endpunkte → `501` mit JSON `{"error_code": "not_implemented"}` (außer RP2 Fallback lokal)

## Übersicht

| Endpunkt | Neu | Aufgabe |
|---|---|---|
| `GET /api/v1/decide?city=...&fuel=...&liters=40` | **B4** | Handlungsempfehlung + 3-Wege-Vergleich + Snapshot-Emission |
| `GET /api/v1/episodes?status=due` | **B4** | Offene / fällige Episoden für Due-Prompts |
| `GET /api/v1/advice/diary?limit=50&outcome=` | **GUI 3** | Prognose-Tagebuch: echte Settlements des Advice-Ledgers (Fenster, Preis, Ergebnis) |
| `POST /api/v1/episodes/{episode_id}/intent` | **B4** | Nutzer-Intent setzen (`wait`, `navigate`, `dismiss`) |
| `POST /api/v1/fills` | **B4** | Echten Tankbeleg erfassen (Wallet-Ledger) |
| `GET /api/v1/fills` | **A3/A6** | Beleg-Verlauf (auch stornierte, mit `voided`-Flag) |
| `DELETE /api/v1/fills/{id}` | **A3** | Beleg stornieren — Flag + Audit-Zeile, kein Löschen |
| `GET /api/v1/fills.csv` | **A6** | Eigene Tankbelege als CSV (`;`, deutsche Dezimalkommas) |
| `GET /api/v1/fills/summary` | **A4** | Monats-/Jahresbilanz des Wallet-Ledgers (Tab „Ich“ → Bilanz) |
| `GET /api/v1/profiles` | **A1** | Fahrzeug-/Haushaltsprofile (ohne Login, serverseitig) |
| `GET /api/v1/stats/summary?city=...&fuel=...` | **B4** | 3 Schichten (Markt-Labor, Live-Advice, Wallet) + Güte-Kacheln |
| `GET /api/v1/health` | erweitert | App online, **`version`/`commit` (B9)**, **`alarms[]` (B4)**, Jobs (inkl. `settlement`), Archiv, Modelle, Selektion, Collector |
| `GET /api/v1/stations?fuel=e10&city=...` |  | Aktuelle Preise, frisch ≤30 Min |
| `GET /api/v1/series?city=...&station_id=...&fuel=...&hours=24` |  | Verlauf 1–168h |
| `GET /api/v1/forecast?city=...&station_id=...&fuel=...` |  | Modell-Ausblick 24h + 3d/7d |
| `GET /api/v1/last_forecasts` |  | Für RP2-Cache, nur 24h Horizonte |
| `GET /api/v1/heatmap?city=...&fuel=...&kind=...&weeks=6&basis=…&station_id=...` | **B3.9** | DoW×Stunde Niveau + Cheap-Prob, Vergleichs-Basis wählbar (B12) |
| `GET /api/v1/selection?fuel=...&city=...` | **B3.10** | Meine Stationen mit δ̂ |
| `GET /api/v1/collector/status` | **B3.11** | Pi/tmpfs Livestatus (Influx → NAS-File → lokal) |
| `POST /api/v1/collector/heartbeat` | **B3.11** | Collector-Herzschlag ans NAS (ohne InfluxDB) |
| `POST /api/v1/jobs/trigger` | **Issue 50** | Uploader-Webhook: Inferenz-Job nach sicherem InfluxDB-Write (Debounce + Idempotenz) |
| `GET /api/v1/jobs/{job}/log?lines=200` | **B6** | Letzte Zeilen von `runtime/jobs/{job}.log` — dieselbe Datei wie `tail -f` auf dem NAS |
| `POST /api/v1/jobs/{job}/run` | **B6** | Startknopf des GUI: Job jetzt ausführen (ohne Passwort; nur bei laufendem Job-Betrieb, abschaltbar per `TANKAPP_GUI_JOB_START=0`) |
| `GET /api/v1/route/evaluate?...` | **B3.12** | Umweg-Ökonomie serverseitig |

## Decide (B4 Primär)

`GET /api/v1/decide?city=Frankfurt&fuel=e10&liters=40&value_of_time=12` (auch als `/v1/decide` erreichbar)

Parameter (Ergänzung zu B4, Konzept §11.1):

| Parameter | Bedeutung |
|---|---|
| `latest_by` | ISO-Zeit (naiv = Europe/Berlin); spätester akzeptabler Tankzeitpunkt. Fenster (`windows_today`/`windows_week`) und die F1-Entscheidung enden spätestens hier (§4.1 H, §4.3 T_max). Unlesbar → `400 invalid_latest_by`. |
| `mode` | `onroute` (Default, nur Mehrweg gegenüber der Vergleichsstation) oder `dedicated` (Extrafahrt ab Zuhause: Hin + Rück, §10) |
| `home_lat`, `home_lon` | Heimatkoordinate für `mode=dedicated`; ohne Angabe nutzt die App die Ankerdistanz aus dem Polling-Set. Ungültig → `400 invalid_home`. |
| `value_of_time`, `consumption`, `speed` | wie B4; der verwendete Zeitwert steht in `context` |
| `tank_percent` | **A2**: Füllstand 0–100 (F3 „Tank bei ¼ — kann ich warten?“). Übersetzt über `tank_capacity_l` und Verbrauch in Restreichweite. Außerhalb 0–100 → `400 invalid_tank`. |
| `tank_capacity_l` | **A2**: Tankgröße 20–120 l (Default 50), nur zusammen mit `tank_percent` wirksam. Außerhalb → `400 invalid_tank`. |
| `range_km` | **A2**: Restreichweite direkt (z. B. Bordcomputer), 0–1500 km; schlägt `tank_percent` vor. Außerhalb → `400 invalid_tank`. |

**Tankstand (A2):** Mit `tank_percent`/`range_km` antwortet `decide` zusätzlich
mit einem `tank`-Block: `range_km` (Restreichweite), `reserve_range_km`
(Reserve = 5 l ÷ Verbrauch × 100), `state` (`empty` ≤ Reserve, `low` ≤ 2 ×
Reserve, `ok`), `blocks_wait` und `message` (Klartext). `state: "empty"`
blockiert eine Warte-Empfehlung: Die angezeigte Aktion kippt von `wait` zu
`refuel_now` mit dem Tank-Begründungstext („Warten riskant, Reserve reicht
~X km“), und der Snapshot im Ledger erhält genau diese angezeigte Aktion plus
`tank_state` — die Tabelle selbst bleibt unangetastet (Güte-Gate, Shadow).
Der Block ist Physik und erscheint unabhängig vom M7-Gate; ohne Tankstand-
Eingabe ist `tank` `null`.

Antwort (Ergänzung): `context` enthält `trip_mode`, `home_used`, `latest_by`,
`horizon_cut`, `liters`, `consumption_l_100km`, `speed_kmh`,
`value_of_time_eur_h`, `z_auto`, `is_peak`, `time_value_rule`. Bei Auto benennt
`time_value_rule` die feste Stufe 16 €/h von 16:30–20:00 Uhr, sonst 10 €/h (O15);
es gibt keinen unsichtbaren Zwischenwert. `thresholds` zeigt die aktiven
Entscheidungsschwellen und den M7-Vorschlag (siehe
[Stats Summary](#stats-summary-b4-3-schichten)). Liegt kein Fenster mehr vor
`latest_by`, lautet die Aktion `no_advice` mit dem Hinweis auf den
spätesten Tankzeitpunkt.

`personalization` (O2/O3) sagt, ob die Fensterreihenfolge schon nach dem
persönlichen **Wochentag×Stunden**-Profil gewichtet ist: `active`, `n_fills`,
`min_fills` (= 8, die Stärke des Standardprofil-Priors, nicht mehr eine
Aktivierungsschwelle) und `missing_fills`. Jeder Beleg mit Zeitstempel wirkt ab
dem ersten vorsichtig über `(n · empirisch + 8 · Standard) / (n + 8)`; ohne
Belege bleibt die reine Preisreihenfolge. Dieselbe Profilquelle gewichtet auch
die Top-3-Verfügbarkeit der Stationsselektion. `measured_fills` umfasst
Beleg-, Server- und rekonstruierte Zeitstempel; `default_fills` bleibt nur für
nicht rekonstruierbare Altzeilen mit markierter 12-Uhr-Projektion. Die GUI hängt
den Satz an die Fensterliste (`personalizationNote` in `web/src/data.ts`).

`quality` weist die Engine-Qualität der ausgewählten Station aus
(Konzept §3.3.3): `rolling_picp_7d_pct` (Mittel der Tagesquoten über die
letzten 7 Backtest-Tage, O4), `rolling_picp_7d_points`,
`rolling_picp_7d_days` (Fallzahl: Tage mit bewerteten Punkten),
`rolling_picp_7d_badge` (`green` ≥ 93 %, `yellow` ≥ 90 %, `red` < 90 %,
nominal 95 %, mit Hysterese: Wechsel erst 1,5 pp jenseits der Schwelle;
`null` bei weniger als 3 Tagen oder ohne veröffentlichten Backtest) und `gate`
(`"picp"`, wenn das Güte-Gate greift). Ist `gate` gesetzt, lautet die
Tabellen-Aktion `no_advice` („Keine klare Empfehlung — Prognose derzeit
unsicher …“), egal wie gut die €-Seite aussieht (§4.4/§4.5 Schritt 1);
`primary.action` selbst bleibt vor M7 durch das Kalibrierungs-Gate auf
`no_advice`.

Ermittelt die primäre Handlungsempfehlung nach der €/P-Entscheidungstabelle (Konzept §4.1/§4.2/§4.4, Auswertungsreihenfolge §4.5: F2 → Grauzone → F1). Die Prozent-Gates sind jetzt die **Verteilungs-P** (§4.1–4.3):
- `refuel_now`: Warten brächte < 1,00 € Ersparnis, oder `p_besser` < 50 %
- `wait`: Fenster-Ersparnis ≥ 2 € bei `p_besser` ≥ 70 % (grün) bzw. ≥ 1 € bei ≥ 60 % (gelb)
- `refuel_elsewhere`: Alternative spart netto ≥ 1,50 € trotz Umweg (`p_lohnt` ≥ 50 %)
- `no_advice`: kein Ankerpreis, keine Prognose, Grauzone `p_besser` ∈ [40, 60] % — oder M7-Gate steht aus

`p_besser` = P(min über dem empfohlenen Fenster ≤ p_jetzt − 1 ct) aus den
Bootstrap-Draws; `p_lohnt` je F2-Zeile = P(€_netto > 0); F3 liefert je
Fenster `p_raw` = P(Fenster ≤ Minimum im ±6-h-Umfeld), die Konkurrenzzahl
`p_competitors`, `p_baseline` und `p` für die Sterne. `p` ist gegen die
zufällige Basisrate `p_baseline = 1 / (p_competitors + 1)` normiert (`min(1, p_raw × (k+1))`), damit
Randfenster mit weniger Nachbarn nicht mechanisch höhere Sterne erhalten (O12).
Ohne veröffentlichte Draws
(Altbestand, kein Modell) entfällt das Prozent-Gate ehrlich — es wird keine
Zahl geraten, die €-Seite entscheidet allein.

**Gleichstands-Konvention (O7):** Ein Ergebnis exakt auf der 1,0-ct/L-Schwelle
ist `tie` und zählt als **0,5 Treffer**. Das gilt einheitlich für `p_besser`,
Settlement, Gesamt- und Aktions-Trefferquote, Brier-Ziel und Reliability-Bins;
bei `wait`/`refuel_elsewhere` gelten beide Grenzen ±1,0 ct/L als Gleichstand.

M7-Gate (§0.4): Vor der Kalibrierung (weniger als 100 Empfehlungen mit Verteilungs-P oder Allzeit-Brier darüber ≥ 0,25) antwortet `primary.action` immer mit `no_advice` und `p_correct: null`. Der Advice-Ledger misst die Tabellen-Aktion trotzdem ab Tag 1 (Shadow-Betrieb): der Snapshot speichert die Verteilungs-P (`p_besser`), Brier misst sie gegen das Settlement — ohne Draws fällt die gespeicherte Schätzung auf die interne Ledger-Quote zurück. Jede Zeile trägt ihre Quelle (`p_source`: `verteilung`|`basisrate`|`keine`); das Gate rechnet ausschließlich über `verteilung` (O5) — die Basisrate wird getrennt ausgewiesen, öffnet das Gate aber nicht. `alternatives_nearby[].p_lohnt` und `windows_today/week[].p` sind Informationswerte aus der Verteilung und hängen nicht am Gate.

Ehrlichkeits-Regeln: Ohne frischen/letzten Preis ist `station.price_now` null (kein erfundener Anker, keine Ersparnis-Rechnung). Ohne Prognose sind `windows_today` leer und `recommended_window` null (kein erfundenes Fenster). Fenstergrenzen sind echte Prognose-Zeitstempel (ISO) aus 2-h-Blöcken; `windows_today` und `windows_week` liefern je Fenster `expected_price`, `expected_saving_eur` (vs. jetzt tanken), `p` sowie die auditierbaren F3-Felder `p_raw`/`p_competitors`/`p_baseline`. Alternativen tragen `detour_km_source`: nur `road` bezeichnet eine Straßenstrecke; `estimated_air_circuity` bzw. `estimated_anchor_*` sind klar benannte Schätzungen (O14). Ihre ungerundete Formel für Brutto-, Sprit-, Zeit- und Netto-€ wird identisch bei Entscheidung, Draw-Wahrscheinlichkeit und Beleg-Abrechnung verwendet (O9).

Emittiert automatisch einen Advice-Snapshot im Persistent Store (mit 30-Minuten-Collapse zur Vermeidung von Dubletten). Das Settlement erfolgt durch den Worker-Job gegen *beobachtete* Preise nach Fensterende + 30 min Lag; ohne beobachtete Preise bleibt der Snapshot `pending`, nicht bewertbare Snapshots werden `void` (zählen weder zu n noch zu Brier).

## Episodes & Intent (B4)

`GET /api/v1/episodes?status=due`

Liefert fällige Episoden nach Fensterende für den Due-Prompt Banner in der GUI.

`POST /api/v1/episodes/{episode_id}/intent`

Setzt die Nutzer-Absicht (`wait` | `navigate` | `refuel_now` | `dismiss`):
```json
{
  "intent": "wait"
}
```

Unbekannte Episoden-IDs liefern strikt `404 episode_not_found` (kein stilles Umschreiben einer anderen Episode).

## Advice-Tagebuch (GET, GUI Phase 3)

`GET /api/v1/advice/diary?limit=50&outcome=win` (Tab „Labor“, Abschnitt 4
„Wie lernt die App aus Fehlern?“)

Prognose-Tagebuch: je **abgerechneter** Empfehlung (Worker-Job
`settlement`, siehe Stats Summary Schicht B) eine Zeile mit dem, was
versprochen war und was eingetroffen ist. Quelle ist das **Settlement
selbst** (`app/feedback.py`, `settlements[]`), verbunden mit dem Snapshot,
der es ausgelöst hat (`snapshots[]` desselben Episoden-Eintrags) — kein
zweiter Zähler, keine Demo-Zeile.

Parameter:

- `limit` (Default 50, 1–500): neueste zuerst (nach `settled_at`).
- `outcome` (optional): `win`, `loss`, `tie` oder `void`.

```json
{
  "generated_at": "2026-09-14T12:04:11+00:00",
  "count": 12,
  "entries": [
    {
      "snapshot_id": "snap_1a2b",
      "episode_id": "ep_1a2b",
      "settled_at": "2026-09-13T17:35:00+00:00",
      "emitted_at": "2026-09-13T14:00:00+00:00",
      "action": "wait",
      "station_id": "uuid",
      "station_name": "Esso Frankfurt Ost",
      "city": "Frankfurt",
      "fuel": "e10",
      "window_start": "2026-09-13T16:00:00+00:00",
      "window_end": "2026-09-13T18:00:00+00:00",
      "price_then": 1.789,
      "price_window": 1.749,
      "outcome": "win",
      "void_reason": null,
      "regret_eur": null,
      "p_correct": null,
      "p_besser": 0.62,
      "p_source": "verteilung",
      "decline_reason": null,
      "liters": 40,
      "intent": "wait"
    }
  ],
  "settled_total": 12,
  "reason": null,
  "error_code": null
}
```

Ehrlichkeits-Regeln:

- `price_then` ist der Preis beim Aussprechen (`p_emit` des Settlements),
  `price_window` der **realisierte** Fensterpreis (`p_realized`); bei
  `outcome: "void"` ist `price_window` null und `void_reason` nennt den Grund
  (`no_advice`, `no_emit_price`, `legacy_no_window`, `beyond_series_range`,
  `no_alt_station`, `no_station`, `no_city`, `no_realized_price`).
- `p_correct` bleibt null, solange das M7-Gate aussteht (§0.4);
  `p_besser` ist die Verteilungs-P des Snapshots und unabhängig davon.
- `p_source` nennt die Herkunft der versprochenen P (`verteilung` = aus den
  Prognose-Draws, `basisrate` = Ledger-Quote als Fallback, `keine` = keine
  Schätzung); der Brier wird je Quelle getrennt ausgewiesen, das M7-Gate
  rechnet nur über `verteilung` (O5).
- Leere Liste **mit Grund** statt einer stillen Leere: `reason`
  `no_settlements` (Snapshots da, noch nichts abgerechnet) oder
  `no_advice_history` (noch keine Empfehlung abgegeben).
- `liters` ist die angenommene Tankmenge des Snapshots, nicht der echte Beleg.
- `station_name` kommt aus dem Snapshot und steht im Tagebuch **statt** der
  rohen `station_id`, wenn die Station nicht mehr im aktuellen Set liegt
  (Altbestände ohne Namen fallen auf die ID zurück).
- `decline_reason` ist der Grund der Entscheidungstabelle, wenn die Empfehlung
  „keine“ war (Güte-Gate, fehlender Anker, kein Fenster, Grauzone) — sonst
  `null`.
- Eine erneut bestätigte Entscheidung ist **keine neue Zeile** und schreibt
  auch nichts in den Store (`_same_advice` in `app/feedback.py`): Ablehnungen
  kollabieren ohne Zeitfenster, Handlungsempfehlungen innerhalb von 30
  Minuten. `emitted_at` bleibt dabei der erste Emit-Zeitpunkt (daran hängen
  Fenster, Ankerpreis und P-Schätzung), `settled_at` die Abrechnung. Ein
  **gewechselter Grund** ist dagegen eine neue Aussage und ergibt eine eigene
  Zeile. Der Schreibverzicht ist die Bedingung der ETag-Revalidierung von
  `/overview` (`data_version()` liest den mtime-Wert des Stores, B7).

Fehler:

- `invalid_query` (400, `limit` außerhalb 1–500)
- `store_too_large`, `diary_read_failed` (500)

Frontend: Tab „Labor“ → Abschnitt 4, Filter „Alle/Warten/Jetzt tanken/
Woanders tanken“ (Filter läuft client-seitig über `action`, der Serverfilter
`outcome` bleibt für gezielte Auswertungen). Gleiche, direkt
aufeinanderfolgende Ablehnungen fasst die GUI zu **einer** Zeile zusammen
(`groupDiaryEntries` in `web/src/lab.ts`, Anzahl „3×“ bzw. „mehrfach“ bei
gekürzter Liste); die Zeitspanne nennt die erste Bestätigung (`emitted_at`
der ältesten Zeile) und die Abrechnung (`diaryStamp` = `settled_at`).

## Fills (B4 Belege)

`POST /api/v1/fills`

Erfasst einen echten Tankbeleg im persönlichen Wallet-Ledger:
```json
{
  "station_id": "uuid",
  "station_name": "Aral Hauptstr.",
  "liters": 40.0,
  "price_paid": 1.689,
  "price_source": "live",
  "fuel": "e10",
  "source": "prompt",
  "episode_id": "ep_123456"
}
```

Der Endpunkt **validiert** (§11.2): `liters` 5–100, `price_paid` 0,40–5,00 €/L,
`fuel` ∈ {e10, e5, diesel}, `station_id` ∈ Polling-Set. Fehlt `price_paid`,
wird der Nowcast-Preis der Station zur Tankzeit gesucht; ohne bestimmbaren
Preis antwortet der Server `400 price_not_available` — es wird **kein**
erfundener Default-Preis verbucht. `tanked_at` (optional, ISO-8601) muss im
plausiblen Fenster liegen — höchstens 90 Tage (Retention) zurück, höchstens
15 Minuten in der Zukunft —, sonst `400 invalid_tanked_at` (B5); ohne Angabe
gilt „jetzt“. Freitext-Felder werden gekappt: `station_name` auf 120, `source`
auf 40 Zeichen (B5). Fehler kommen als 4xx/503
(`invalid_liters`/`invalid_price`/`invalid_fuel`/`invalid_tanked_at`/`price_not_available`/
`invalid_price_source`/`prompt_price_not_live` → 400,
`unknown_station` → 404, `store_too_large`/`store_locked` → 503), nicht
mehr als `200 {"error_code": …}`. `store_locked` heißt: Der
Feedback-Store war während der Wartezeit von 5 s durchgehend belegt
(B11) — derselbe Request darf wiederholt werden.

**Tankuhrzeit (O1, 0.44.0):** `clock_hour` wird serverseitig aus `tanked_at` in
Europe/Berlin abgeleitet — die GUI sendet den Zeitstempel (UTC-ISO), nicht die
Stunde. Der Zeitstempel gewinnt gegen eine widersprechende `clock_hour`-Angabe
(eine Wahrheit je Beleg); ohne Zeitstempel darf ein Client die Stunde weiter
selbst nennen. Ohne beides bleibt der Default 12 Uhr — die Projektionsregel der
Engine (`decision_hour`) — und ist über `clock_hour_source` als erfunden
gekennzeichnet. Vor 0.44.0 war 12 Uhr der Wert **jedes** GUI-Belegs, das
w(h)-Profil lernte also ab dem achten Beleg aus einer Uhrzeit, die nie gemessen
wurde.

**Preis-Herkunft (O17, 0.45.0):** Der Client deklariert je Beleg
`price_source` — `live` (frischer Poll zur Tipp-Zeit, nur der
Ein-Tipp-Beleg „Ja, wie empfohlen“) oder `manuell` (eingetragen, die
Erfassungs-Maske); alles andere ist `400 invalid_price_source`. Ein
expliziter Preis ohne Angabe gilt als `manuell`, ein fehlender Preis mit
Server-Nowcast als `nowcast`. `prognose` vergibt nur die Migration 4 → 5
für Altbestände — neue Belege mit Prognosepreis werden nicht mehr gebucht:
Ein Ein-Tipp-Beleg (`source == "prompt"`) ohne Live-Nachweis wird mit
`400 prompt_price_not_live` abgewiesen statt gebucht, und die GUI fragt
dann in der Maske nach. Vor 0.45.0 trug „Ja, wie empfohlen“ den
**erwarteten** Preis (Median der Prognose) als `price_paid` ein.

Ermittelt automatisch den Compliance-Grad (`followed`, `partial`, `ignored`, `unrelated`) per Zeitstempel-Matching (`tanked_at` vs. Emit-/Fensterzeiten mit 45-min- bzw. −30/+60-min-Slack) und die realisierte Ersparnis im Vergleich zu sofortigem Tanken. Die offene Advice-Folge wird nur durch einen Beleg geschlossen, der die Empfehlung betrifft (`followed`/`partial` bzw. `ignored` an der Emit-Station) — ein fachlich fremder Beleg beendet die Folge nicht.

### Beleg-Verlauf (GET)

`GET /api/v1/fills`

```json
{
  "generated_at": "2026-09-12T08:15:00+02:00",
  "count": 2,
  "fills": [
    {
      "id": "f_2026…",
      "episode_id": "ep_123456",
      "station_id": "6a7fe9a1-…",
      "station_name": "Aral Hauptstr.",
      "tanked_at": "2026-09-12T07:58:00+02:00",
      "clock_hour": 7,
      "clock_hour_source": "beleg",
      "liters": 41.2,
      "price_paid": 1.679,
      "price_source": "live",
      "fuel": "e10",
      "source": "prompt",
      "compliance": "followed",
      "settled": "im_fenster",
      "saved_vs_always_now_eur": 1.84,
      "elsewhere_net_eur": null,
      "elsewhere_net_provenance": null
    }
  ],
  "error_code": null
}
```

Feldbedeutung: `price_source` = `explicit` (Preis selbst eingegeben) oder
`nowcast` (Preis zur Tankzeit aus den Daten ermittelt, weil `price_paid`
fehlte); `saved_vs_always_now_eur` = realisierte Ersparnis gegen „immer
sofort getankt“ (Referenz: `price_now` des ersten Snapshots der Folge, sonst
`price_paid`). `compliance` ∈ `followed`, `partial`, `ignored`, `unrelated`
(Zeitstempel-Matching, siehe [Fills](#fills-b4-belege)). Storno-Felder:
`voided`, `voided_at`. `clock_hour` ist die ganze Stunde der Tankzeit in
Europe/Berlin (Bucket des w(h)-Histogramms), `clock_hour_source` ∈ `beleg`
(aus `tanked_at`) · `server` (kein `tanked_at`: aus dem dokumentierten
Server-Buchungszeitstempel, O43) · `abgeleitet` (nachträglich aus einem
Alt-Zeitstempel rekonstruiert) · `default` (nur nicht rekonstruierbare
Altzeile). Ein `wait`-Beleg trägt zusätzlich `settled: im_fenster` für das
strikte veröffentlichte Fenster oder `kulanz` für die erlaubten −30/+60 Minuten;
Kulanz bleibt sichtbar, zählt aber nur als `partial`, nicht als Qualitäts-Treffer
(O8). Bei einer passenden `refuel_elsewhere`-Folge kann der Client
`actual_detour_km_total` (gefahrene Gesamt-km) mitschicken. Dann enthält der
Beleg `elsewhere_net_eur` und die Annahmen in `elsewhere_net_provenance` mit
`distance_source: actual_receipt`; ohne Angabe wird die gespeicherte
`estimated_snapshot` ausdrücklich so bezeichnet (O9).

Stornierte Belege bleiben mit `voided: true` und `voided_at` in der Liste —
gezählt wird sie in Wallet-Bilanz und w(h)-Profil **nicht** mehr. Fehler:
`store_too_large` (503-Pfad), `fills_read_failed`.

### Beleg stornieren (DELETE, A3)

`DELETE /api/v1/fills/{id}`

Setzt `voided` statt zu löschen und schreibt eine Audit-Zeile
(`{"at", "action": "void_fill", "fill_id"}`) in den Store. Idempotent: ein
zweites Storno desselben Belegs ändert nichts und liefert denselben Beleg.

| Antwort | Bedeutung |
|---|---|
| `200` + Beleg | storniert (oder war schon storniert) |
| `404 {"error_code":"fill_not_found"}` | `id` nicht im Store |
| `400 {"error_code":"invalid_query"}` | leere `id` oder Pfad mit weiterem `/` |
| `503 {"error_code":"store_too_large"}` | Store über der Größen-Grenze |
| `503 {"error_code":"store_locked"}` | Store 5 s belegt — wiederholen (B11) |
| `503 {"error_code":"void_fill_failed"}` | Store nicht schreibbar o. ä. |

GUI: Tankbelege-Verlauf im Alltag mit „Stornieren“-Knopf. Ein Storno ist kein
Löschen — die Audit-Spur bleibt, damit die Bilanz nachvollziehbar bleibt.

### CSV-Export (A6)

`GET /api/v1/fills.csv` → `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="tankapp-fills.csv"`.

Trennzeichen `;`, Dezimalkomma, zwei Nachkommastellen bei `liter`,
`preis_eur_l` und `ersparnis_eur`; `storniert` = `ja` oder leer. Spalten
(in dieser Reihenfolge):

```text
id;getankt_am;station_id;station;liter;preis_eur_l;kraftstoff;quelle;compliance;ersparnis_eur;storniert
```

`getankt_am` = `tanked_at`, `station` = `station_name`, `quelle` = `source`,
`ersparnis_eur` = `saved_vs_always_now_eur`.

Download-Link im System-Tab. Der Export ist dieselbe Datenbasis wie
`GET /api/v1/fills` — keine zusätzliche Aggregation, keine erfundenen Spalten.

### Monats-/Jahresbilanz (GET, A4)

`GET /api/v1/fills/summary`

Gruppiert die **aktiven** (nicht stornierten) Belege je Kalendermonat und
-jahr in Europe/Berlin — die „Jahresbilanz“ in „Ich“ → Bilanz (Konzept §12).
Belege ohne interpretierbares `tanked_at` fließen in `overall`, aber in keine
Zeile; die Differenz steht in `overall.n_without_date`.

```json
{
  "generated_at": "2026-09-12T12:00:00+00:00",
  "n_fills_total": 14,
  "months": [
    {
      "key": "2026-09",
      "fills": 2,
      "liters": 75.0,
      "total_eur": 126.55,
      "avg_eur_per_fill": 63.28,
      "avg_eur_per_liter": 1.687,
      "saved_eur": 2.0,
      "saved_verified_eur": 2.0,
      "n_prognosis_price": 0,
      "baseline_eur": 128.55
    }
  ],
  "years": [ { "key": "2026", "fills": 14, "…": "…" } ],
  "overall": {
    "fills": 14, "liters": 610.5, "total_eur": 1024.9,
    "avg_eur_per_fill": 73.21, "avg_eur_per_liter": 1.679,
    "saved_eur": 18.4, "saved_verified_eur": 18.4,
    "n_prognosis_price": 0, "baseline_eur": 1043.3,
    "n_without_date": 0, "saved_pct": 1.8
  },
  "error_code": null
}
```

`baseline_eur` ist die „immer sofort getankt“-Referenz: pro Beleg
Referenzpreis (`price_now` des ersten Snapshots der Folge, sonst `price_paid`)
× Liter — rechnerisch `total_eur + saved_eur`. `saved_eur` kann negativ sein
(wer teurer als die Referenz tankt, hat gegen die Baseline verloren);
`saved_pct` bleibt `null`, solange die Baseline nicht positiv ist. Zeilen sind
absteigend sortiert (jüngste zuerst), nur Monate/Jahre mit Belegen — keine
erfundenen Leerzeilen. `saved_verified_eur` (O17, 0.45.0) ist die zweite,
ausdrücklich so benannte Spalte: die Ersparnis ohne Belege mit Prognosepreis
(`price_source == "prognose"`, Altbestand, kein gezahlter Preis) — deren
Anzahl nennt `n_prognosis_price` je Zeile.

## Profiles (A1 — Fahrzeug-/Haushaltsprofile, ohne Login)

Verbrauch, Zeitwert, Tankmenge, Kraftstoffart, Tempo und Tankgröße liegen
serverseitig unter `runtime/profiles/profiles.json` — ein Haushalt, kein
Account (LAN-only per Vorgabe). Die GUI liest daraus und schreibt Änderungen
zurück; `city`/`station` bleiben Gerätesache (localStorage).

| Endpunkt | Aufgabe |
|---|---|
| `GET /api/v1/profiles` | `{"profiles": [...], "active": "prof_…" \|\| null}` |
| `POST /api/v1/profiles` | Profil anlegen. Body: `name` (Pflicht, ≤ 40 Zeichen) + optional `fuel`, `liters`, `consumption`, `time_value_eur_h` (0 = Automatik), `speed_kmh`, `detour_mode`, `tank_capacity_l`; Fehlendes bekommt die GUI-Defaults. Das erste Profil wird automatisch aktiv. |
| `PUT /api/v1/profiles/{id}` | Felder partiell aktualisieren (nur gesetzte Schlüssel). |
| `POST /api/v1/profiles/{id}/activate` | Profil aktiv setzen (dieses Gerät folgt ihm). |
| `POST /api/v1/profiles/activate` mit `{"active": null}` | Kein Profil aktiv — Einstellungen gelten nur noch gerätelokal. |
| `DELETE /api/v1/profiles/{id}` | Profil löschen; war es aktiv, ist danach keins aktiv. |

Grenzen wie die GUI-Slider (gleiche Prüfung serverseitig): `liters` 10–100,
`consumption` 4–15, `time_value_eur_h` 0–30, `speed_kmh` 25–80,
`tank_capacity_l` 20–120, `fuel` ∈ {e10, e5, diesel}, `detour_mode` ∈
{onroute, dedicated}. Höchstens **8** Profile.

| Antwort | Bedeutung |
|---|---|
| `200` | Erfolg (angelegtes/aktualisiertes Profil bzw. `{"active": …}` / `{"deleted": …}`) |
| `400` | `invalid_profile_name`, `invalid_fuel`, `invalid_liters`, `invalid_consumption`, `invalid_time_value_eur_h`, `invalid_speed_kmh`, `invalid_tank_capacity_l`, `invalid_mode`, `invalid_query`, `invalid_json` |
| `404 {"error_code": "profile_not_found"}` | Profil-ID unbekannt |
| `409 {"error_code": "profile_limit"}` | mehr als 8 Profile |
| `429` / `503` | Schreib-Budget (B5) bzw. Store nicht lesbar/schreibbar (`profile_write_failed`, `profiles_read_failed`) |

Alle schreibenden Profil-Endpunkte teilen sich das B5-Schreib-Budget der
Ledger-Endpunkte. Der Store trägt eine `schema_version` (Startwert 1) — ein
Sprung braucht eine Migrationsfunktion, kein stiller Reset (B2-Muster).

## Stats Summary (B4 3 Schichten)

`GET /api/v1/stats/summary?city=Frankfurt&fuel=e10` (auch als `/v1/stats/summary` erreichbar)

Liefert die 3 strikt getrennten Schichten gemäß Konzept §5.5:
1. **Schicht A (Markt-Labor Backtest)**: 7 Tage Out-of-Sample Evaluation (`daysEval` aus der Engine-Publikation, `daysTrain` dito) mit echten Anker-Entscheidungszeilen je Stationstag (`evalRows`: μ/s/best/predHour + Erwartungskurve, Anker = letzter Preis ≤ Tages-Anker, Wahrheit = realisierte offene Preise). Der Tages-Anker ist `TANKAPP_DECISION_HOUR` (Default 12, `decisionHour` im Report; Engine-CLI: `--decision-hour`) — 12:00, weil Anhebungen nur mittags stattfinden und der hypothetische Entscheid erst dann weiß, ob es heute teurer wurde. Server-Scores spiegeln exakt die Frontend-Formeln (`rowOutcome`/`scoreRows`, Default ε = 1,0 ct, 40 L). `p` ist null, solange die Engine kein P-Modell hat; `calibration`/`models`/`p8Series`/`scan` sind ehrlich leer.
2. **Schicht B (Live-Advice Ledger)**: Gesettelte Live-Snapshots mit Trefferquoten für Warten/Jetzt/Woanders, Brier-Score (30d, nur über Snapshots mit gespeicherter P-Schätzung) und Kalibrierungs-Bins. `void`-Settlements zählen weder zu n noch zu Brier (`n_void`, `n_brier` werden ausgewiesen); noch laufende Empfehlungen zählen erst nach der Abrechnung (`n_pending`, `snapshots_total`, `n_void_all`). Seit O5 (0.45.0) trägt jede Zeile ihre P-Quelle (`p_source`: `verteilung`|`basisrate`|`keine`): `brier_by_source`/`brier_all_by_source` weisen den Score je Quelle getrennt aus, `p_source_counts`/`p_source_counts_all` zählen die Zeilen. Das M7-Gate ist ein **Zähl-Gate** (§0.4) über die Verteilungs-P allein: `calibrated` gilt ab `min_recommendations` (= 100, `app.feedback.M7_MIN_RECOMMENDATIONS`) abgeschlossenen Empfehlungen mit Verteilungs-P (`gate_n`), wenn die Obergrenze des Block-Bootstrap-Intervalls (`gate_brier_ci`, Tagesblöcke, 95 %) unter beiden naiven Referenzen auf derselben Grundgesamtheit liegt — `gate_ref_base` (konstante Basisrate) und `gate_ref_climate` (Leave-one-out-Klimatologie je Stunde/Wochentag); `brier_threshold` (= 0,25, `M7_BRIER_THRESHOLD`) ist seit O6 (0.45.0) nur noch das dokumentierte Münz-Niveau, kein Kriterium. Unter `min_day_blocks` (= 10) Tagesblöcken bleibt das Intervall `null` („nicht messbar“ statt „kalibriert“); die Antwort nennt Intervall, Fenstergröße (`block_days`, `n_day_blocks`, `bootstrap_samples` = 1000) und beide Referenzen. `gate_status` unterscheidet „steht aus (n < 100)“, „nicht messbar“ (keine Verteilungs-P oder zu wenige Tagesblöcke), „nicht erreicht“ (Obergrenze ≥ Referenz) und „kalibriert“. Die 90-Tage-Übergangsregel (Punkt 6) ist **kein** Bestandteil dieses Gates. Seit O38 (0.45.0) meldet Schicht B zusätzlich die Fensterbilanz: `episodes_used_7d`/`episodes_expired_7d` und `episodes_used_30d`/`episodes_expired_30d` (genutzte vs. verstrichene Fenster, nur Folgen mit echter Empfehlung, datiert nach `closed_at`) plus `episodes_open` (laufende Folgen, in keiner der beiden Seiten). Das Labor zeigt daraus „x von y Fenstern genutzt“ mit abgerechneten Empfehlungen gegen verstrichene Fenster — die Gegenprobe zur Trefferquote.
3. **Schicht C (Wallet Ledger)**: Persönliche Füllungen, Befolgungsgrad und Netto-Ersparnis. `saved_verified_eur` (O17, 0.45.0) ist die zweite, ausdrücklich so benannte Spalte: die Ersparnis ohne Belege mit Prognosepreis (`n_prognosis_price`, Altbestand, kein gezahlter Preis). Das Profil ist seit O2/O3 als `wallet.wh_weekday` (7×24, Montag=0) veröffentlicht; `wallet.wh_hours` bleibt die Summierung für ältere Leser. Ab dem ersten nutzbaren Beleg wird es gegen den festen Acht-Beleg-Standardprior geschrumpft. `wh_clock_sources` zählt `beleg`/`server`/`abgeleitet`/`default`; `wh_measured_n` fasst die drei zeitlich bestimmbaren Quellen zusammen, und nur `wh_default_n` sind nicht rekonstruierbare Altzeilen mit markierter 12-Uhr-Projektion (O43). `settled_in_window` und `settled_grace` trennen den strikten Fenster-Treffer von Kulanz (O8).
4. **M7-Schwellen-Nachzug** (Konzept §5.5 Schicht B Schritt 4, §13 M7): `threshold_tuning` liefert `targets` (Trefferquote WARTEN 70 %, JETZT 85 %, WOANDERS 60 %), die `sample`-Größen je Aktion, `reasons` und den `thresholds`-Vorschlag; `thresholds` sind die **aktiven** Schwellen der Entscheidungstabelle. Nachgezogen wird erst ab `min_n` = 25 ausgespielten Empfehlungen je Aktion; wirksam wird der Vorschlag nur mit `TANKAPP_M7_AUTO_APPLY=1` (Default aus — die Produktion entscheidet weiterhin mit der kalibrierten Tabelle, §8.2 Nr. 1).
5. **Güte-Kacheln**: Nur `picp_95` ist echt (Median aus der Engine-Publikation). `top3_hit_rate`, `mase_sprungfrei` und `cusum_drift` sind null/`unknown` (Konzept §6, offen) — die Gesamt-MASE als „sprungfrei“ zu etikettieren wäre Etikettenschwindel.
6. **`live_phase` (bewertete Live-Tage der Übergangsregel)**: gezählt aus den publizierten Bootstrap-Policies (`runtime/engine/current.json` → `policies`), nicht aus dem Browserdatum: `good_complete_days` (schwächste Station/Kraftstoff), `best_complete_days`, `required_complete_days` (Engine-Schwelle `live_only_days`, Default 90), `days_missing`, `min_daily_coverage`, `stations`, `live_only_stations`, `as_of` (Datenstand des Modell-Laufs), `complete`. Ohne Veröffentlichung oder bei uneinheitlichen Schwellen ist das Feld `null` — die GUI zeigt dann „noch keine Live-Abdeckungsdaten“ statt eines erfundenen Countdowns (§0.4). Achtung: Die Tageszahl ist die Übergangsregel (Archiv → Polling), **nicht** das M7-Gate; dieses bleibt „Allzeit-Brier der Verteilungs-P < 0,25 bei ≥ 100 Empfehlungen mit Verteilungs-P“ (Punkt 2). Beide Freigaben haben deshalb in der GUI eigene Kacheln und eigene Nenner: `live_only_days` (Engine-Schwelle, `engine/cli.py --live-only-days`, Default 90) für die Datenhygiene, `min_recommendations` für M7 — bei ~1 Empfehlung/Tag wären 100 Settlements ~100 Tage, M7 soll aber nach ~4 Wochen Live-Betrieb schaltbar sein (Konzept §13). Das Stationsdetail `data_policy` je Prognose (`GET /api/v1/forecast`) bleibt unverändert.


## Health

`GET /api/v1/health`

Antwort:

```json
{
  "app": "online",
  "generated_at": "2026-09-10T14:00:00+02:00",
  "version": "0.15.0",
  "commit": "35c737234d9d",
  "polling_error": null,
  "station_count": 20,
  "influx_configured": true,
  "archive_configured": true,
  "jobs_enabled": true,
  "alarms": [
    {"code": "collector_stale", "severity": "warn",
     "message": "Collector-Herzschlag ist veraltet (Preise können eingefroren sein)."}
  ],
  "notify": {"configured": true, "mode": "public",
             "open_errors": ["collector_no_heartbeat"],
             "last_ok_at": "2026-09-11T08:05:00+00:00"},
  "archive": {"archive_since": "2025-09-09", "last_complete_until": "2026-09-09", "missing_files": 0, "status": "complete"},
  "jobs": {
    "archive": {"state": "success", "last_success_at": "...", "next_run_at": "..."},
    "models": {"state": "success", "last_success_at": "...", "next_run_at": "...", "data_watermark": "1757584800", "triggers": 12, "last_trigger_skip": "debounced"},
    "selection": {"state": "success", ...}
  },
  "models": {"published_at": "...", "count": 20, "calibrated": false, "decision_ready": false},
  "publication": {"bytes": 13500000, "index_bytes": 4200, "file_count": 20,
                  "largest_file_bytes": 720000,
                  "budget_bytes": 6000000, "max_bytes": 10000000,
                  "over_budget": false, "readable": true,
                  "error_code": null, "reason": null},
  "price_implausible": {"count_24h": 0, "last_at": null},
  "backup": {"configured": true, "count": 14, "monthly_count": 6,
             "newest_at": "2026-09-17T01:30:04+00:00", "age_hours": 10.5,
             "stale_hours": 36.0, "stale": false, "reason": null},
  "selection": {"published_at": "...", "count": 20},
  "collector": {
    "available": true,
    "source": "nas",
    "last_poll_at": "2026-09-10T14:12:03+02:00",
    "age_minutes": 2.5,
    "fresh": true,
    "tmpfs_used_bytes": 1234567,
    "tmpfs_total_bytes": 33554432,
    "oldest_age_days": 6.2,
    "influx": {"available": false, "error_code": "influx_not_queried"}
  }
}
```

**Version und Build-Hash** (B9): `version` kommt aus `app/version.py`
(`VERSION`, je Release angehoben), `commit` ist der Kurzhash des Checkouts bzw.
`TANKAPP_BUILD_COMMIT`. Im Docker-Image ist `commit` `null` — das Image enthält
kein `.git`. Beide Werte stehen im GUI-Footer; sie beantworten bei drei
Oberflächen (NAS, RP2-Proxy/Fallback, Pi) die Frage „was läuft hier?“.

**`publication`** (O22, 0.44.0; aufgeteilt seit 0.49.0): Größe und Lesbarkeit
der Veröffentlichung der Prognosen (`data/runtime/engine/`) — die Stations-
Dateien bleiben bei reinem `stat`, damit das Healthcheck-Budget bleibt. Seit
0.49.0 ist die Veröffentlichung aufgeteilt: `current.json` ist ein kleiner
Index mit Zeigern, jede Stations-Prognose liegt unter `forecasts/` (O22
Maßnahme d); die Klippe gilt der **einzelnen** Datei. `bytes` (Summe aller
Dateien, `null` wenn kein Index), `budget_bytes` (= 6 MB,
`app.data.PUBLICATION_BUDGET_BYTES`), `max_bytes` (= 10 MB,
`READ_JSON_MAX_BYTES` — darüber liest `read_json` eine Datei nicht),
`over_budget` (seit der Aufteilung: die größte Datei über dem Budget),
`readable`, `error_code` (`publication_unreadable` oder `null`) und `reason`
(`missing` · `too_large` · `invalid` · `incomplete` — Letzteres heißt: eine
Stations-Datei fehlt, die übrigen Prognosen bleiben verfügbar). Bei
aufgeteilter Veröffentlichung zusätzlich `index_bytes`, `file_count` und
`largest_file_bytes`. Ein **fehlender** Index ist kein Fehler: Vor dem ersten
Modell-Lauf gibt es keine Veröffentlichung (`reason: "missing"`,
`error_code: null`). Der Modell-Lauf nennt dieselben Zahlen im Job-Log
(`models: Veröffentlichung 13,5 MB gesamt: 20 Stations-Dateien plus Index,
größte Datei 0,7 MB …`).

**`alarms[]`** (B4): Aggregation der vorhandenen Prüfungen, **ohne** neue Netz-
oder InfluxDB-Zugriffe (das 3–5-s-Budget des Docker-Healthchecks bleibt). Jeder
Eintrag: `code`, `severity` (`error` | `warn`), `message` (deutscher Klartext),
bei Job-Alarmen zusätzlich `job`. Die GUI zeigt rot bei `error`, gelb bei `warn`,
grün ohne Alarm.

| `code` | Schwere | Auslöser |
|---|---|---|
| `polling_missing` / `polling_invalid` | error | gemeinsames Polling-Set fehlt bzw. ist ungültig |
| `collector_no_heartbeat` | error | noch kein Herzschlag des Pi auf dem NAS |
| `collector_stale` | warn | Herzschlag älter als 15 min |
| `job_failed` (+ `job`) | error | Job `archive`, `models`, `selection` oder `settlement` fehlgeschlagen |
| `job_partial` (+ `job`) | warn | Lauf unvollständig (mindestens eine Station ohne neues Modell); nächster Versuch im regulären Intervall, nicht stündlich |
| `job_aborted` (+ `job`) | warn | Lauf hart beendet (z. B. Container-Neustart); letzte Ergebnisse bleiben erhalten |
| `store_too_large` | error | Feedback-Store über `FEEDBACK_MAX_BYTES` — Belege werden abgelehnt |
| `store_growing` | warn | Feedback-Store über 80 % der Grenze |
| `publication_unreadable` | error | Eine Datei der Prognose-Veröffentlichung über `READ_JSON_MAX_BYTES` (`reason: "too_large"`), nicht parsebar (`reason: "invalid"`) oder eine Stations-Datei fehlt (`reason: "incomplete"`, die übrigen Prognosen bleiben verfügbar) — seit 0.49.0 gilt die Klippe der einzelnen Datei (O22) |
| `publication_large` | warn | Eine Datei der Veröffentlichung über `PUBLICATION_BUDGET_BYTES` (6 MB), aber noch lesbar — seit der Aufteilung (0.49.0) praktisch unerreichbar, eine Stations-Datei ist ~0,7 MB (O22) |
| `backup_stale` | warn | letztes Laufzeit-Backup älter als `BACKUP_STALE_HOURS` (36 h), Backup-Ziel leer oder nicht erreichbar (O33) |

Reihenfolge und Aktionen: [BETRIEB.md](BETRIEB.md#system-alarme-lesen).

**`notify`** (B4): Sichtbarkeit der ntfy-Zustellung, die `severity: "error"`
an `TANKAPP_NTFY_URL` schickt — `configured` (Variable gesetzt?),
`mode` (Push-Modus `public`|`lan`, O42: bestimmt die Datentiefe der
Fenster-Meldungen, Default `public`), `open_errors` (welche Codes sind als
gemeldet gespeichert), `last_ok_at` (Stempel der letzten „wieder
betriebsbereit“-Meldung, `null` wenn nie).
Der Block liest nur die Zustandsdatei `data/runtime/notify/state.json`, kein
Netz. Einrichten und Verhalten:
[BETRIEB.md](BETRIEB.md#alarm-zustellung-über-ntfy-b4).

**`price_implausible`** (O35, seit 0.46.0): Zähler der Live-Preise außerhalb
0,40–5,00 €/L in den letzten 24 Stunden — `count_24h` und `last_at`
(jüngste Beobachtung, `null` ohne Vorfall). Solche Werte werden nicht als
`price` veröffentlicht, sondern als `implausible_price` gekennzeichnet
(siehe Stationen); ab dem ersten Wert schlägt Alarm `price_implausible`
(warn) an. Der Zähler liest nur `data/runtime/quality/implausible_prices.json`
(je Beobachtung einmal, Dedupe über Station + Zeitstempel).

**`backup`** (O33, seit 0.47.0): Alter der Laufzeit-Backups, die
`ops/nas/backup.sh` schreibt — nur `stat` über das Zielverzeichnis, kein Netz.
`configured` ist `false`, wenn `TANKAPP_BACKUP_DIR` nicht gesetzt **oder** das
Verzeichnis nicht erreichbar ist; `count` zählt die Tagesstände
(`tankapp-runtime-<JJJJ-MM-TT>.tar.gz`), `monthly_count` die Monatsstände
(`tankapp-runtime-monthly-<JJJJ-MM>.tar.gz`), `newest_at`/`age_hours` das Alter
des jüngsten **Tagesstands** — Monatsstände zählen bewusst nicht als
Herzschlag, sonst deckte ein bis zu 31 Tage alter Monatsstand einen toten Cron
einen Monat lang zu. `stale` (und damit Alarm `backup_stale`, warn) gilt ab
`stale_hours` = 36, bei leerem Ziel (`reason: "no_backup"`) und bei nicht
erreichbarem Ziel (`reason: "directory_missing"`). Ohne konfiguriertes Ziel
gibt es **keinen** Alarm (`reason: "not_configured"`) — die App weiß nicht, ob
anderswo gesichert wird; unsichtbar ist der Zustand damit nicht.
Einrichten und Aufbewahrungsregel:
[BETRIEB.md](BETRIEB.md#nas-laufzeitdaten-runtime-backup).

**Job-Fortschritt** (B5): Läuft ein Job (`state: "running"`), liefert
`progress` Phase, Schritt `x/y`, aktuelles Label, Prozent, Laufzeit und
Restschätzung — der System-Tab zeigt daraus Balken und Text. Nach dem Lauf
(oder ohne Lebenszeichen seit 6 h) ist `progress` wieder `null`, damit die
GUI kein „Läuft …“ konserviert.

```json
{"state": "running", "phase": "fit", "phase_label": "Modelle fitten + Backtest",
 "step": 7, "total": 22, "label": "Frankfurt – Aral Hauptstr.", "pct": 31.8,
 "elapsed_s": 421.5, "eta_s": 902.0, "updated_at": "2026-09-10T15:02:11+00:00"}
```

Job-Felder: `data_watermark` = Datenstand (Epochensekunden) des letzten erfolgreichen Webhook-Triggerlaufs, `null` solange kein Webhook eingetroffen ist (Issue 50, Idempotenz-Anker); `triggers` / `last_trigger_skip` = Webhook-Trigger-Statistik des laufenden App-Prozesses (nur `models`/`selection`, siehe [Jobs Trigger](#jobs-trigger-post-issue-50)).

Collector frisch = Herzschlag ≤15 Min. **Wichtig:** `/health` evaluiert den Collector nur aus lokalen Quellen (NAS-Heartbeat-File, lokales tmpfs) und fragt InfluxDB **nicht** ab — der Docker-Healthcheck (3–5 s Budget) darf nicht an InfluxDB-Antwortzeiten scheitern. Volle Details (inkl. Influx-Felder wie `poll_count`) liefert `GET /api/v1/collector/status`, den der GUI-System-Tab nutzt.

## Stations

`GET /api/v1/stations?fuel=e10&city=Frankfurt`

- `fuel`: e10|e5|diesel
- `city`: optional Filter

Antwort sortiert nach Preis (frisch zuerst):

```json
{
  "generated_at": "...",
  "cities": ["Frankfurt", "Gütersloh"],
  "fuel": "e10",
  "city": "Frankfurt",
  "stations": [
    {
      "station_id": "uuid",
      "city": "Frankfurt",
      "name": "Aral ...",
      "brand": "ARAL",
      "lat": 50.1, "lon": 8.6,
      "dist_km": 1.2, "dist_mode": "road|air",
      "maps_url": "https://www.google.com/maps/dir/?api=1&destination=...",
      "status": "open|closed|no prices|unknown",
      "observed_at": "...",
      "age_minutes": 5.2,
      "fresh": true,
      "last_price": 1.729,
      "price": 1.729,
      "implausible_price": null
    }
  ],
  "anchors": {
    "Frankfurt": {"lat": 50.11, "lon": 8.68}
  },
  "fresh_prices": 8,
  "decision_ready": false,
  "calibrated": false
}
```

`price` nur wenn fresh (≤30 Min) und open, sonst null. `last_price` immer letzte Meldung.

**Eine Form, zwei Antwortflächen (O44, seit 0.49.1):** Dieselbe Stations-Form
antwortet auf dem Pi auch der RP2-Fallback (`<RP2-IP>:8000`,
[rp2/fallback_gui.py](../rp2/fallback_gui.py)) — aus seinem Live-Puffer, mit
`cities` (deduplizierte Ortslabel seiner Zeilen), je Zeile `observed_at` als
Alias auf `fetched_at` und ausdrücklich `calibrated`/`decision_ready: false`
(Quantile statt M7-Posterior). Die App liest `cities` für die Ortswahl und gilt
eine Antwort ohne `cities` **oder** `stations` als „kein Payload“ statt als
leere Liste (`web/src/data.ts::usableStations`, Regression
`web/src/state/pi-fallback.test.tsx`); bei `nas_status: "offline"` sagt sie
„Antwort kommt vom Pi-Fallback“. Der Fallback beantwortet nur seine sieben
Pfade — alles andere ist `404` und im Fallback-Modus (gebaute GUI per
`TEMPLATE_DIR`) in der Browser-Konsole zu sehen:
[RP2.md](RP2.md#fallback-api-und-umschaltzeiten), [BETRIEB.md](BETRIEB.md).

**Plausibilität (O35, seit 0.46.0):** Ein gemeldeter Wert außerhalb
0,40–5,00 €/L (oder nicht endlich) ist eine Beobachtung, aber kein Preis —
`price` und `last_price` bleiben null, der rohe Wert steht in
`implausible_price` (sonst null). Die Station bleibt sichtbar und sortiert
sich hinter alle Stationen mit Preis; der Vorfall wird in
`/api/v1/health` → `price_implausible` gezählt und ab dem ersten Wert als
gleichnamiger Alarm (warn) gemeldet. Dieselben Grenzen gelten im
Belegpfad (`MIN_PRICE_PAID`/`MAX_PRICE_PAID`) und im Trainingspfad
(`engine/data.py`).

`anchors` (0.22.0): der Anker (Heimat-Startpunkt) je Stadt aus dem Polling-Set
(`anchor` bzw. `lat`/`lon` auf Set-Ebene). Bei `city`-Filter ist nur die
abgefragte Stadt enthalten, ohne Filter alle. Die Kartenansicht zeichnet ihn
als Startpunkt (Radar-Zentrum, Ursprung der `dist_km`-Angaben); die
Stations-Records selbst tragen die Koordinate weiterhin nicht. Ohne
konfigurierten oder bei ungültigem Anker entfällt der Eintrag.

## Series

`GET /api/v1/series?city=Frankfurt&station_id=uuid&fuel=e10&hours=24`

- `hours`: 1–168

Antwort:

```json
{"points": [{"timestamp": "...", "status": "open", "price": 1.729}, ...], "n_points": 118, "range_from": "2026-09-11T06:00:00+00:00", "range_to": "2026-09-12T06:00:00+00:00", "error_code": null}
```

Geschlossen/fehlend trennt Linie, offener Preis bleibt als Stufe stehen.

- `range_from`/`range_to`/`n_points` (0.18.0, C11): tatsächliche Reichweite der
  gelieferten Preise und ihre Anzahl, oder `null` bei leerem Bestand. Gezählt
  werden nur Punkte **mit** Preis — geschlossene Meldungen sind Beobachtungen,
  kein Preis-Bestand. Das angefragte Fenster (`hours`) ist in der Anlaufphase
  größer als der Bestand; die GUI nennt darum die echte Reichweite, statt die
  Achse als volle Abdeckung erscheinen zu lassen.

## Forecast

`GET /api/v1/forecast?city=Frankfurt&station_id=uuid&fuel=e10`

Liefert letzten publizierten Ausblick:

```json
{
  "station_id": "uuid",
  "city": "Frankfurt",
  "fuel": "e10",
  "origin": "2026-09-10T00:00:00Z",
  "points": [{"timestamp": "...", "q025": 1.6, "q10": 1.65, "q50": 1.7, "q90": 1.75, "q975": 1.8, "support_days": 7, "supported": true}, ...],
  "points_3d": [...],
  "points_7d": [...],
  "metrics": {"points": 1234, "mae_ct": 1.2, "mase": 0.85, "picp95_pct": 94.5},
  "range_from": "2026-07-30T00:00:00+00:00",
  "range_to": "2026-09-09T23:55:00+00:00",
  "n_points": 11712,
  "n_days": 41,
  "stale": false,
  "calibrated": false,
  "decision_ready": false
}
```

- `points`, `points_3d` und `points_7d` enthalten `timestamp`, die fünf auf
  **0,1 ct/L** gerundeten Quantile `q025`/`q10`/`q50`/`q90`/`q975` sowie seit
  O10 `support_days` und `supported`. `support_days` ist die Zahl der nutzbaren
  Tage für den lokalen Wochentag/Stunden-Slot; die GUI markiert gestützte Slots
  mit höchstens sieben Tagen hohl im Band. Bei `supported: false` sind Quantile
  `null`, keine scheinpräzise Bandkante. Alte Publikationen dürfen die beiden
  Support-Felder fehlen lassen.
- `range_from`/`range_to`/`n_points`/`n_days` (0.18.0, C11): Datenreichweite des
  **Fits** — Trainingsfenster, letzte verwendete Beobachtung, Zahl der offenen
  5-Minuten-Preise und nutzbaren Tage. Die Werte stammen unverändert aus dem
  Modell (`training_start`, `last_observation`, `training_points`,
  `training_days`); bisher standen sie nur im Modell-Artefakt. Ältere
  Publikationen ohne die Felder liefern `null` — die GUI zeigt dann keine Zeile.

`stale` wenn Alter >24h. Bänder projiziert auf 12-Uhr-Regel (Erhöhungen nur 12:00).

## Last Forecasts (RP2)

`GET /api/v1/last_forecasts`

Für RP2 Fallback-GUI Cache, nur 24h Horizonte (ohne 3d/7d):

```json
{"generated_at": "...", "count": 20, "forecasts": [{"station_id": "...", "city": "...", "fuel": "e10", "origin": "...", "points": [...]}, ...]}
```

## Heatmap (B3.9)

`GET /api/v1/heatmap?city=Frankfurt&fuel=e10&kind=probability&weeks=6&basis=hour&station_id=uuid`

- `city`: Pflicht
- `fuel`: e10|e5|diesel, Default e10
- `kind`: level|probability, Default level
  - `level`: Median €/L je (Wochentag, Stunde)
  - `probability`: Cheap-Probability in % je Zelle:
    - mit `station_id`: P(Station ≤ **Leave-one-out**-Stadtmedian der Zelle) — die Vergleichsbasis enthält nur andere Stationen desselben (DoW, Stunde); auch mehrere eigene Preise dürfen den Median nicht zu sich ziehen (O11)
    - ohne `station_id`, `basis=overall` (Default): P(Preis ≤ **Gesamtmedian des Zeitfensters**) — Anteil der offenen Preise der Stadt, die unter dem Gesamtmedian liegen
    - ohne `station_id`, `basis=hour` (**B12**): P(Preis ≤ **Median derselben Stunde**) — Spalten-Basis, rechnet den Tagesgang heraus und macht die Wochentage vergleichbar; die GUI nutzt ohne Station diesen Modus
- `weeks`: 1–12, Default 6 (GUI-Wahl: 4/6/12)
- `basis`: overall|hour, Default overall — wirkt nur bei `kind=probability` **ohne** `station_id`, sonst ignoriert (Antwort liefert den wirksamen Wert)
- `station_id`: optional, wenn gesetzt nur diese Station, sonst Stadt

Antwort:

```json
{
  "generated_at": "...",
  "city": "Frankfurt",
  "fuel": "e10",
  "kind": "probability",
  "weeks": 6,
  "station_id": "uuid",
  "basis": "hour",
  "days": ["Mo","Di","Mi","Do","Fr","Sa","So"],
  "hours": [0,1,2,...,23],
  "matrix": [
    [null, null, ..., 45.2, 78.1],
    ...
  ],
  "counts": [
    [0, 0, ..., 71, 68],
    ...
  ],
  "reference_counts": [
    [0, 0, ..., 312, 298],
    ...
  ],
  "range_from": "2026-08-01T04:05:00+00:00",
  "range_to": "2026-09-12T05:55:00+00:00",
  "points": 12345,
  "stations": 10,
  "error_code": null
}
```

- Matrix 7×24, Zeilen Mo–So, Spalten 0–23 Uhr (Europe/Berlin)
- level: Werte €/L (z. B. 1.689) oder null
- probability: Werte 0–100 % (z. B. 73.5) oder null
- `counts`: Stichprobe je Zelle (7×24) — die GUI blendet Zellen unter 8 Preisen aus (sonst kürt ein einzelner Nacht-Preis die „günstigste Stunde“) und lässt Tages-Zeilen unter 3 belastbaren Zellen leer
- `reference_counts` (0.14.0, P0): Stichprobe der **Vergleichs-Basis** je Zelle (7×24), nur bei `kind=probability`, sonst `null`. Mit `station_id` = Zahl der Preise **anderer** Stationen derselben Zelle (LOO-Stadtmedian, O11), bei `basis=hour` = Zahl der Preise derselben Stunde über alle Wochentage (in jeder Zeile gleich), bei `basis=overall` = Gesamtzahl der Preise (überall gleich). Eine Zelle kann 8+ eigene Preise haben und trotzdem ein Artefakt zeigen — die GUI kennzeichnet Stunden, deren Basis unter 30 Preisen liegt, als „dünn“ und kürt daraus keine „typisch günstigste Stunde“
- `range_from`/`range_to` (0.14.0, P0): echte Reichweite der verwendeten Preise (ISO-8601, UTC) oder `null` bei leerem Bestand. Das angefragte Fenster (`weeks`) ist gerade in der Anlaufphase größer als der Bestand; die GUI nennt Reichweite und Bestand und erklärt leere Wochentags-Zeilen als fehlende Tage statt als Datenverlust
- `points`: Anzahl **verwendeter** offener Preise (geschlossene Meldungen und Preise `null` zählen nicht, 0.14.0); mit `station_id` nur die Preise dieser Station
- `stations`: Zahl der Stationen, deren Preise verwendet wurden
- Berechnung: aus InfluxDB letzte N Wochen, nur offene Preise; Berlin-Zeit je Zelle

Fehler:

- `influx_not_configured`, `influx_read_failed`, `too_many_points` (>200k), `polling_missing`, `polling_invalid`, `invalid_basis` (400, bei `basis` außer `overall`/`hour`), `invalid_query` (u. a. bei unbekannter Stadt/Station, ungültigem fuel/kind/weeks)

Frontend: Tab Labor → Abschnitt 3 „Warum ist eine Station „meist günstig“?“,
Heatmaps mit Umschalter Niveau/Probability, Wochen-Wahl 4/6/12 (E5),
Basis-Umschalter für die Cheap-Probability ohne Station (B12).

## Selection / Meine Stationen (B3.10)

`GET /api/v1/selection?fuel=e10&city=Frankfurt`

- `fuel`: e10|e5|diesel
- `city`: optional Filter

Antwort:

```json
{
  "generated_at": "2026-09-10T02:00:00Z",
  "fuel": "e10",
  "city": "Frankfurt",
  "cities": ["Frankfurt", "Gütersloh"],
  "count": 10,
  "total_count": 20,
  "stations": [
    {
      "rank": 1,
      "station_id": "uuid",
      "city": "Frankfurt",
      "fuel": "e10",
      "name": "Aral ...",
      "brand": "ARAL",
      "coverage": 0.97,
      "delta_ct": -3.8,
      "ci_lo": -4.5,
      "ci_hi": -3.1,
      "p_value": 0.001,
      "q_value": 0.005,
      "significant": true,
      "avail": 0.42,
      "best_hour": 19.5,
      "vol_ct": 2.1,
      "rank_std": 1.3,
      "dist_km": 1.2,
      "dist_mode": "road",
      "maps_url": "...",
      "score": 1.23
    }
  ],
  "range_from": "2026-07-01T00:00:00+00:00",
  "range_to": "2026-09-11T23:55:00+00:00",
  "n_points": 284310,
  "n_days": 73,
  "error_code": null,
  "calibrated": false,
  "decision_ready": false
}
```

Felder:

- `range_from`/`range_to`/`n_points`/`n_days` (0.18.0, C11): Datenreichweite des
  Rankings über alle Städte des Kraftstoffs (frühester Anfang, spätestes Ende,
  Summe der Beobachtungen, längste Tagesreihe). „Rang 1“ aus zehn Tagen ist eine
  andere Aussage als „Rang 1“ aus drei Monaten; die GUI weist das aus. Je Stadt
  stehen dieselben Felder im Stadt-Eintrag. Altbestände ohne die Felder: `null`.

- `delta_ct` (δ̂): Median(p_i − LOO-Stadtmedian) ct/L, negativ = günstiger
- `delta_ew_ct`: EW-Median über Tages-δ̂ (Halbwertszeit 7 Tage, F5 — reagiert bei
  Betreiber-/Strategiewechsel schneller als der 42-Tage-Median; Ranking-Grundlage),
  `delta_recent5_ct`: Median der letzten 5 Tage, `delta_days`: Anzahl Tages-δ̂,
  `break_flag`/`break_stat`: retrospektiver CUSUM-Changepoint (Schwelle h=2,0)
- `ci_lo`, `ci_hi`: 95% KI aus exponentiell gewichtetem Tages-Block-Bootstrap B=2000
  (Seed 42, neuere Tage höheres Ziehgewicht, Halbwertszeit 14 Tage)
- `p_value`: einseitig H0: δ≥0 (small = signifikant günstiger), `q_value`: Benjamini-Hochberg FDR, `significant`: q<0.05
- `avail`: AV-Score = Σ w_h·P(Top-3|h); w = Pendlerprofil Mo–Fr 06–09/16–20 (Gewicht 5/7, Wochenende gleichmäßig 2/7)
- `best_hour`: günstigste Stunde aus robuster harmonischer Regression auf δ (2. Ordnung, Huber-IRLS), z. B. 19.5 = 19:30
- `vol_ct`: 1.4826·MAD(Δ) Volatilität
- `rank_std`: Std täglicher Mittelränge
- `coverage`: Anteil nutzbarer Preise
- `dist_km`, `dist_mode`, `maps_url`: aus polling.json + OSRM-Cache (`air` = Luftlinie-Fallback)

`count` = Anzahl aller gerankten Stationen des Kraftstoffs (nicht `top_global`, das ist auf 10 gekappt). `/api/v1/health` und `/api/v1/selection` zeigen dieselbe Zahl.

Artefakt fehlt auf dem NAS bis ersten Modell-Job: `selection_not_available` → Frontend zeigt Hinweis, keine erfundenen Rankings.

Quelle: `runtime/training/*.csv.gz` (aus InfluxDB + Archiv), Job `selection` täglich, auch nach Modell-Job best-effort.

## Collector Status (B3.11)

`GET /api/v1/collector/status`

Liefert Pi/tmpfs Livestatus (Collector-Herzschlag ans NAS).

Quellen in dieser Reihenfolge (`source`): `influx` (Measurement `collector_status`) → `nas` (File `runtime/collector/heartbeat.json`, vom Collector per POST abgelegt) → `local` (`meta/heartbeat.json`, nur wenn NAS selbst Pi ist bzw. `TANKAPP_POLL_DIR`). `influx.fields` enthält die letzten Influx-Felder (u. a. `poll_count`).

Antwort:

```json
{
  "generated_at": "2026-09-10T14:13:00+02:00",
  "available": true,
  "last_poll_at": "2026-09-10T14:12:03+02:00",
  "age_minutes": 1.2,
  "fresh": true,
  "tmpfs_used_bytes": 1234567,
  "tmpfs_total_bytes": 33554432,
  "tmpfs_free_bytes": 32319865,
  "oldest_age_days": 6.2,
  "influx": {
    "available": true,
    "last_heartbeat_at": "2026-09-10T14:12:30Z",
    "age_minutes": 0.5,
    "fresh": true,
    "fields": {
      "last_poll_at": "2026-09-10T14:12:03+02:00",
      "tmpfs_used_bytes": 1234567,
      "tmpfs_total_bytes": 33554432,
      "oldest_age_days": 6.2,
      "poll_count": 1234,
      "city": "Frankfurt",
      "webhook_pending": 0,
      "webhook_attempts": 2,
      "webhook_last_status": "queued",
      "webhook_last_ok_age_s": 240
    }
  },
  "webhook": {
    "pending": false,
    "attempts": 2,
    "pending_age_s": null,
    "last_status": "queued",
    "last_ok_age_s": 240,
    "gave_up": null
  },
  "webhook_source": "influx",
  "local": {
    "last_poll_at": "2026-09-10T14:12:03+02:00",
    "city": "Frankfurt",
    "poll_count": 1234,
    "tmpfs": {"total_bytes": 33554432, "used_bytes": 1234567, "free_bytes": 32319865},
    "oldest_file": {"name": "2026-09-03.jsonl", "age_days": 6.2}
  }
}
```

- `available`: true wenn Influx-Punkt, NAS-Heartbeat-File oder lokales heartbeat.json vorhanden
- `fresh`: Herzschlag ≤15 Min
- `webhook` (B8): Zustand des Triggers Pi → NAS, aus den `webhook_*`-Feldern des Uploader-Herzschlags herausgehoben — `pending` (wartet auf Quittierung), `attempts`, `pending_age_s`, `last_status` (`queued`/`debounced`/`duplicate`/`rejected`/`retry_wait`/`abandoned`/`http_4xx`/`http_5xx`), `last_ok_age_s`, `gave_up`. `null` heißt **keine Angabe** (kein Ziel eingerichtet, älterer Uploader oder Quelle `nas`/`local`) — nicht „in Ordnung“
- tmpfs: belegte Bytes, gesamt, frei, älteste Datei Alter
- `nas`: Herzschlag-File des NAS (siehe POST-Endpunkt unten), `local`: nur wenn NAS selbst Pi ist oder TANKAPP_POLL_DIR gesetzt (Tests)
- Fehler: `influx_not_configured`, `collector_no_heartbeat`, `collector_check_failed`, `influx_read_failed`

Frontend: System-Tab → Pi/tmpfs Livestatus (holt diesen Endpunkt; `/api/v1/health` enthält denselben Status **ohne** Influx-Query, damit der Docker-Healthcheck nicht von InfluxDB-Antwortzeiten abhängt).

Collector schreibt `meta/heartbeat.json` nach jedem Poll, Uploader schreibt `collector_status` Measurement alle 60s.

## Collector Heartbeat (POST, B3.11)

`POST /api/v1/collector/heartbeat` — optionaler, InfluxDB-freier Weg: Der Collector POSTet den Herzschlag direkt ans NAS (`TANKAPP_NAS_URL` oder `TANKAPP_NAS_HEARTBEAT_URL` setzen; Base-URL oder volle Endpunkt-URL).

- Erlaubte Felder (Übriges wird verworfen): `timestamp`, `last_poll`, `city`, `open_count`, `total_count`, `tmpfs_used_mb`, `tmpfs_total_mb`, `oldest_file_age_days`, `poll_interval_s`
- `timestamp` fehlt → `last_poll` wird übernommen; fehlt auch → Server-Zeit (UTC)
- Antwort: `{"status": "ok", "received_at": "…"}` (200); Fehler: `400 invalid_json` / `400 invalid_request` (u. a. defekter Content-Length) / `413 payload_too_large` (>10 kB) / `503 server_error`
- Das File liegt unter `runtime/collector/heartbeat.json` und wird von `GET /api/v1/collector/status` als Fallback-Quelle `nas` ausgewertet (ohne InfluxDB)
- Alle anderen POST/PUT/DELETE/PATCH auf dem Server: `501` (Nur-Lese-Vertrag, ausgenommen die oben gelisteten Schreib-Endpunkte)

## Jobs Trigger (POST, Issue 50)

`POST /api/v1/jobs/trigger` — Uploader-Webhook der Ereignis-Pipeline (Detaillierung: `ARCHITEKTUR.md`, Abschnitt „Ereignis-Pipeline: Webhook statt reinem Polling“). Der Uploader sendet ihn **nach dem sicheren InfluxDB-Write**; der NAS-Scheduler entscheidet allein, ob ein Lauf startet (Separation of Concerns). Die Antwort ist die **Quittierung** (B8): Bleibt sie aus, wiederholt der Uploader den Trigger mit Backoff (30 s … 15 min) und meldet den Zustand über den Herzschlag; nach 2 h gibt er ehrlich auf, dann übernimmt der Intervaljob.

```bash
curl -s -X POST http://nas:1355/api/v1/jobs/trigger \
  -H "Authorization: Bearer <TANKAPP_WEBHOOK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"job": "models", "watermark": 1757584800}'
```

- Body: `{"job": "models"|"selection", "watermark": <Epochensekunden>}` — `watermark` optional (Datenstand des sicheren Writes)
- Auth: `Authorization: Bearer <TANKAPP_WEBHOOK_TOKEN>` — derselbe Secret, den der Uploader auf dem Pi als `TANKAPP_NAS_WEBHOOK_TOKEN` sendet; verglichen per `hmac.compare_digest` (kein Timing-Leak)
- Ohne konfiguriertes `TANKAPP_WEBHOOK_TOKEN` oder ohne laufenden Job-Betrieb (`--jobs`) existiert der Endpoint bewusst nicht: `404 not_found`
- Fehler: `403 unauthorized` (Token fehlt/stimmt nicht), `400 invalid_query` (Job außerhalb `models`/`selection` oder `watermark` keine Zahl)
- Erfolg: `200 {"status": "queued", "job": "models"}` — der Trigger ist nur vorgemerkt; die Job-Schleife wird aufgeweckt und entscheidet:
  - **Debounce:** Mindestabstand 15 min für `models`, 1 h für `selection` → Übersprung `debounced`
  - **Idempotenz:** gleiche `watermark` wie beim letzten erfolgreichen Lauf (verankert in `runtime/jobs/<job>.json → data_watermark`, sichtbar in `GET /api/v1/health`) und letzter Erfolg jünger als das Job-Intervall → Übersprung `duplicate`; letzter Erfolg älter als das Job-Intervall → Lauf trotzdem (Prognosefenster bleiben am aktuellen Tag verankert)
- Mehrere Trigger während eines Laufs werden zusammengeführt (nur die neueste `watermark` bleibt gemerkt); fehlschlägt der Webhook beim Uploader, läuft alles unverändert intervallbasiert weiter (keine neue harte Abhängigkeit)

## Job starten (POST, B6 — Startknopf)

`POST /api/v1/jobs/{job}/run` — der Startknopf der Job-Karten im System-Tab.
**Bewusst ohne Passwort**: Er wirkt nur im selben NAS-Webauftritt und nur,
wenn der Dienst überhaupt Jobs fährt (`tankapp.py nas-up` / `serve --jobs`).
Wer ihn abschalten will: `TANKAPP_GUI_JOB_START=0` in der Compose-Umgebung —
dann antwortet der Endpunkt `404 not_found` (wie der Webhook ohne Secret).

```bash
curl -s -X POST http://nas:1355/api/v1/jobs/models/run -H 'Content-Type: application/json' -d '{}'
```

- `{job}`: `archive`, `models`, `selection`, `settlement`; anderes → `404 not_found`
- Der Body wird ignoriert — der Ablauf entscheidet, nicht der Aufrufer
- Antworten (immer `200`, solange der Endpunkt existiert):
  - `{"status": "queued", "job": "models"}` — vorgemerkt, der Lauf startet sofort
  - `{"status": "running", "job": "models"}` — läuft bereits; kein zweiter Start
  - `{"status": "debounced", "job": "models", "retry_after": 37}` — vor weniger
    als 60 s gestartet; `retry_after` in Sekunden
- Unterschied zum Webhook (`POST /api/v1/jobs/trigger`): der Knopf ist ein
  **Wille**, keine „neue Daten liegen bereit“-Meldung. Er überspringt deshalb
  Debounce (15 min/1 h) und Idempotenz — sonst wäre genau der Fall blockiert,
  für den er gedacht ist: nach einer Korrektur den Fehlschlag sofort nachholen.
  Zwei Grenzen bleiben: nie zwei Läufe desselben Jobs gleichzeitig, und
  mindestens 60 s Abstand (Schutz gegen Dauergeklicke).

## Job-Log (GET, B6)

`GET /api/v1/jobs/{job}/log?lines=200` — liefert die letzten Zeilen des
Job-Logs, das `app/progress.py` je Job fortschreibt
(`tail -f data/runtime/jobs/<job>.log` zeigt dieselben Zeilen).

```bash
curl -s "http://nas:1355/api/v1/jobs/models/log?lines=200" | jq
```

- `{job}`: nur `archive`, `models`, `selection`, `settlement`; alles andere →
  `404 not_found` (keine beliebigen Pfade, kein Directory-Listing)
- `lines`: 1–500, Standard 200; keine Zahl → `400 invalid_query`
- Antwort: `{"job": "models", "available": true, "count": 200, "total": 300,
  "lines": ["2026-09-11T06:10:00Z models: [31 %] …", …], "updated_at": "…",
  "error_code": null}`
- Fehlt die Datei (noch kein Lauf): `200` mit
  `{"available": false, "count": 0, "lines": [], "error_code": "log_missing"}`
  — kein 500, damit die GUI einen ehrlichen Leerzustand zeigen kann
- Jede Zeile wird beim Auslesen bereinigt (`app/errors.redact`): absolute
  Pfade werden auf den Dateinamen gekürzt, `token=…`/`password=…`/`Bearer …`,
  URL-Zugangsdaten und lange Schlüssel-Blobs entfernt
- Die **Ursache** eines Fehlschlags steht zusätzlich als ein Satz im Status:
  `GET /api/v1/health → jobs.<job>.error_detail` (z. B.
  `"ValueError: zu wenig Historie für current.json"`), geschrieben von
  `app/worker.py` bei `state: failed`

## Route Evaluate (B3.12)

`GET /api/v1/route/evaluate?city=Frankfurt&fuel=e10&station_id=uuid&ref_station_id=uuid&liters=40&detour_km=3&consumption=7&speed=45&value_of_time=12&when=2026-09-10T18:00:00+02:00&mode=onroute`

- `city`: optional, für Stadtmedian als Referenz
- `fuel`: e10|e5|diesel, Default e10
- `station_id`: Ziel-Station (Alternative)
- `ref_station_id`: Referenz-Station (z. B. aktuell ausgewählte), optional — falls fehlt, Stadtmedian frischer Preise als Referenz
- `liters`: Tankmenge 5–100, Default 40
- `detour_km`: angegebene einfache Mehrweg-Distanz km (onroute) bzw. einfache Entfernung (dedicated). Ohne Angabe wird zwischen Stationskoordinaten mit Luftlinie × 1,3 geschätzt; eine cached Anker-`road`-Distanz wird nur im dedicated-Modus ohne eigene Home-Koordinate als Straßenstrecke übernommen. `detour_km_source` benennt das zwingend: `declared` | `road` | `estimated_air_circuity` | `estimated_anchor_air_circuity` | `estimated_anchor_difference` | `unavailable`. Nur `road` ist eine Straßenstrecke. Die reine Anker-Differenz bleibt eine markierte Schätzung, keine Fahrroute (O14).
- `consumption`: L/100km 3–20, Default 7
- `speed`: km/h 10–130, Default 45
- `value_of_time`: €/h 0–100, 0/entfällt = Auto
- `when`: ISO-Zeitstempel, `HH:MM[:SS]` (Berlin) oder Stunde 0–23 (Dezimal) — nur für die Zeitwert-Automatik relevant; fehlt → offpeak
- `mode`: onroute|dedicated, Default onroute
  - onroute: nur Mehrweg zählt (einmalig)
  - dedicated: Extrafahrt Hin+Rück (doppelt)
- `price`/`target_price`/`alt_price`: Ziel-Preis explizit (Was-wäre-wenn) — **explizite Preise haben immer Vorrang vor Live-Preisen**, sonst Live-Preis (frisch > zuletzt beobachtet)
- `ref_price`: Referenz-Preis explizit, sonst Live-Preis der Referenzstation, sonst Stadtmedian frischer Preise. Ohne jeden bestimmbaren Referenzpreis: `price_not_available` (kein erfundener +5-ct-Referenzpreis)

Antwort:

```json
{
  "city": "Frankfurt",
  "fuel": "e10",
  "station_id": "uuid-ziel",
  "station_name": "Shell ...",
  "ref_station_id": "uuid-ref",
  "ref_station_name": "Aral ...",
  "ref_price": 1.729,
  "alt_price": 1.689,
  "target_price": 1.689,
  "delta_ct": 4.0,
  "gross_eur": 1.6,
  "detour_km_oneway": 3.0,
  "detour_km_total": 3.0,
  "detour_km_source": "declared",
  "mode": "onroute",
  "fuel_cost_eur": 0.35,
  "time_cost_eur": 0.8,
  "detour_cost_eur": 1.15,
  "net_eur": 0.45,
  "critical_delta_ct": 2.88,
  "worth_it": false,
  "verdict": "borderline",
  "z_used": 12.0,
  "z_auto": true,
  "is_peak": false,
  "time_value_rule": "Automatik: 16 €/h von 16:30 bis 20:00 Uhr, sonst 10 €/h.",
  "consumption_l_100km": 7.0,
  "speed_kmh": 45.0,
  "liters": 40.0,
  "generated_at": "2026-09-10T14:00:00Z"
}
```

`alt_price` = `target_price` (die günstigere Station, zu der gefahren wird); `ref_price` ist die teurere Referenz. `z_auto=true` wenn `value_of_time` 0/fehlte. Preis-Herkunft in `target_price_source`/`ref_price_source` (`query` | `live` | `live_stale` | `city_min` | `city_median`).

Formel: K = d·(c/100)·p + (d/v)·z, brutto = (p_ref − p_alt)·L, netto = brutto − K, kritisch Δp* = K/L

Verdict: worth ab 1.50€ netto, borderline ab 0.50€, sonst not_worth

Zeitwert-Automatik: 0/fehlend = auto, sonst explizit. Auto: Peak 16:30–20:00 = 16€/h, sonst 10€/h (Berlin Zeit). Die GUI sendet `when=<jetzt>` mit, damit Server- und lokale Rechnung dieselbe Zeit verwenden.

UI rechnet lokal (schnell), kann optional Server-Endpunkt zur Validierung nutzen (Button „Server prüfen“).

Fehler: `invalid_fuel`, `invalid_liters`, `invalid_detour`, `invalid_consumption`, `invalid_speed`, `invalid_mode`, `invalid_value_of_time`, `invalid_when`, `unknown_station`, `price_not_available`, `polling_missing`, `polling_invalid`, `route_evaluate_failed`

## Deprecation alter Alltags-Routen (B5, Konzept §11.3)

Sobald `/api/v1/decide` alle Alltags-Fälle abdeckt, markiert die App die
alten Alltags-Routen mit RFC-8594-Headern:

| Route | Header | Nachfolger |
|---|---|---|
| `GET /api/v1/stations` | `Deprecation: true`, `Sunset`, `Link` | `/api/v1/decide` |
| `GET /api/v1/day` | dto. | `/api/v1/decide` (Fenster „Heute später“) |
| `GET /api/v1/route/evaluate` | dto. | `/api/v1/decide` (`alternatives_nearby`) |

Analyse-Routen (`series`, `forecast`, `heatmap`, `selection`,
`collector/status`, `health`) bleiben bewusst unmarkiert — sie sind Analyse,
nicht Alltag.

## Fehlercodes

Zusätzlich zu den bekannten Codes: `invalid_latest_by`, `invalid_mode`,
`invalid_home` (400, `/api/v1/decide`).

Siehe `web/src/data.ts` messages:

- polling_missing, polling_invalid
- influx_not_configured, influx_read_failed
- archive_not_configured, archive_incomplete
- insufficient_history, some_models_unavailable, model_not_available
- dependencies_missing, job_start_failed, job_failed
- selection_not_available, selection_failed
- collector_no_heartbeat, collector_check_failed
- too_many_points, invalid_query, not_found
- unknown_station (404), unknown_city (404), invalid_fuel, invalid_liters, invalid_price, invalid_tanked_at, invalid_consumption, invalid_speed, invalid_when, invalid_value_of_time, invalid_mode, invalid_detour (400)
- write_rate_limited (429, Schreib-Budget der Ledger-Endpunkte mit `Retry-After: 60`, B5)
- price_not_available (400 beim Fill), decide_failed, backtest_not_available
- episode_not_found (404), episodes_read_failed, set_intent_failed, record_fill_failed, settlement_failed, stats_summary_failed
- store_too_large (503), store_locked (503, Feedback-Store 5 s belegt — wiederholbar, B11), not_implemented (501)
- fill_not_found (404, `DELETE /api/v1/fills/{id}`), void_fill_failed (503), fills_read_failed
- invalid_tank (400, `/api/v1/decide` — Tankstand außerhalb 0–100 % bzw. 20–120 l bzw. 0–1500 km)
- profile_not_found (404), profile_limit (409), invalid_profile_name, invalid_time_value_eur_h, invalid_speed_kmh, invalid_tank_capacity_l (400, Profil-Endpunkte), profile_write_failed / profiles_read_failed / fills_summary_failed (503)
- unauthorized (403, nur `POST /api/v1/jobs/trigger` ohne oder mit falschem Bearer-Token)
- payload_too_large (413), invalid_json, invalid_request, server_error

Alle Endpunkte liefern `error_code` statt Exception-Text, nie Tokens. Unbekannte Stationen/Städte liefern 404 mit spezifischem Code (kein pauschales `invalid_query`).

**`detail` — die Ursache zum Code (O44, seit 0.49.1):** Antwortet
`GET /api/v1/decide` mit `{"error_code": "decide_failed"}`, trägt der Payload
zusätzlich `detail`: den bereinigten Klartext der unerwarteten Ursache
(`app/errors.public_detail`, höchstens 240 Zeichen, ohne absolute Pfade,
Tokens oder Stacktrace). Dieselbe Ursache steht im Serverlog
(`decide: fehlgeschlagen — …`). Die GUI zeigt sie als „Ursache:“ unter dem
Fehlercode — die Steuerung hängt weiter an `error_code`, `detail` ist
Diagnose für den Betreiber. Maschinenlesbare Alternative für Jobs:
`GET /api/v1/health → jobs.<job>.error_detail`.

## Beispiele

```bash
curl -s http://nas:1355/api/v1/health | jq
curl -s "http://nas:1355/api/v1/stations?fuel=e10&city=Frankfurt" | jq
curl -s "http://nas:1355/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=probability&weeks=12&basis=hour" | jq
curl -s "http://nas:1355/api/v1/selection?fuel=e10&city=Frankfurt" | jq
curl -s http://nas:1355/api/v1/collector/status | jq
curl -s "http://nas:1355/api/v1/route/evaluate?city=Frankfurt&fuel=e10&detour_km=3&liters=40" | jq
curl -s -X POST http://nas:1355/api/v1/jobs/trigger -H "Authorization: Bearer <TANKAPP_WEBHOOK_TOKEN>" -H "Content-Type: application/json" -d '{"job":"models","watermark":1757584800}' | jq
```
