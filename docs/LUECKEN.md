# TankApp Lücken-Check — Konzept gegen Stand

> Stand: 12.09.2026 · App-Version 0.11.0. Abgleich von
> [KONZEPT.md](KONZEPT.md) (Zielbild) mit dem Code — § für §, mit Grund für
> jeden offenen Punkt. **Kein Punkt behauptet Modellgüte:** Kalibrierung bleibt
> M7 vorbehalten (§0.4).
> Die unabhängige Prüfung vom 10.09.2026 liegt im
> [Archiv](archiv/PRUEFSTAND-2026-09-10.md); ihre Befunde sind hier eingearbeitet
> (Abschnitt „Umgesetzt seit der Prüfung“) oder als Aufgabe in
> [TODO.md](../TODO.md). Prioritäten und Definition-of-Done stehen in TODO,
> Konzept-Bezüge hier.

## Inhaltsverzeichnis

- [Kurzfassung](#kurzfassung)
- [B5: in diesem Durchgang geschlossen](#b5-in-diesem-durchgang-geschlossen)
- [Umgesetzt seit der Prüfung am 10.09.2026](#umgesetzt-seit-der-prüfung-am-10092026)
  - [11.09.2026 — P-Seite aus der Prognoseverteilung (§4.1–4.3)](#11092026--p-seite-aus-der-prognoseverteilung-4143)
  - [11.09.2026 — P1/P2/P3-Fixes (Prüfstand §3/§7)](#11092026--p1p2p3-fixes-prüfstand-37)
  - [11.09.2026 — Engine-Ausbau, Güte-Gate, Umweg-Konvention (Prüfstand §1.3/§1.5, §3.1–3.4)](#11092026--engine-ausbau-güte-gate-umweg-konvention-prüfstand-1315-3134)
  - [12.09.2026 — Version 0.10.0/0.10.1: Betrieb, GUI, Sprache](#12092026--version-01000101-betrieb-gui-sprache)
  - [12.09.2026 — Version 0.11.0: ehrliche Eingaben, Heatmap-Basis, RP2-Journal](#12092026--version-0110-ehrliche-eingaben-heatmap-basis-rp2-journal)
  - [12.09.2026 — Version 0.14.0: Heatmap-Ehrlichkeit](#12092026--version-0140-heatmap-ehrlichkeit)
  - [12.09.2026 — Version 0.15.0: Alarme aufs Handy, Werkstatt-Sprache](#12092026--version-0150-alarme-aufs-handy-werkstatt-sprache)
- [Konzept-Abdeckung im Einzelnen](#konzept-abdeckung-im-einzelnen)
- [Bewusst offen (Backlog mit Grund)](#bewusst-offen-backlog-mit-grund)
- [Nicht umgesetzt und warum nicht](#nicht-umgesetzt-und-warum-nicht)
- [Messwerte](#messwerte)

## Kurzfassung

| Bereich | Vor B5 (10.09.) | Heute (0.11.0) |
|---|---|---|
| „Läuft …“ beim Modell-Job | nur Zustand, kein Fortschritt | Phasen, Schritt x/y, Balken, Restschätzung in GUI, Statusdatei und Log |
| Rechenzeit Modell-Lauf | ~3 min je Station, ein Kern | ~14 s je Station, mehrere Kerne |
| API-Schutz | nur im Reverse Proxy gedacht | Rate-Limit + `X-Api-Key` in der App (§11, später ersatzlos entfernt — LAN-only) |
| Alte Alltags-Routen | ohne Hinweis | `Deprecation`/`Sunset`/`Link` (§11.3, M5) |
| `latest_by` („bis wann muss ich tanken?“) | Parameter dokumentiert, nicht implementiert | schneidet Fenster und F1-Entscheidung |
| Fahrtmodus `dedicated` | nur in der Selektion | auch in `/v1/decide` (§10) |
| M7-Schwellen-Nachzug | Ankündigung | Vorschlag aus dem Advice-Ledger, abschaltbar (§13); Fortschritt als Kachel im System-Tab |
| Systemzustand | über sieben Endpunkte verteilt | `alarms[]` in `/health` + Punkt im GUI-Header (B4), `severity: error` zusätzlich als ntfy-Push aufs Handy (0.15.0) |
| Persönliche Bilanz | Beleg buchen, keine Korrektur | Storno mit Audit-Spur (A3), CSV-Export (A6), `runtime/`-Backup (B1) |
| „Was läuft hier?“ | unsichtbar | `version` + `commit` in `/health` und Footer, `CHANGELOG.md` (B9) |
| Dokumentation | verteilt über Root, `docs/`, `engine/`, `data-tools/`, `rp2/`, `sample/` | ein Ordner `docs/` mit Index, Historisches in `docs/archiv/` (0.10.1) |
| Beleg-Eingabe | GUI prüft nur „> 0“, Station durfte fehlen | Felder mit den Server-Grenzen (5–100 L, 0,40–5,00 €/L), Buchung ohne Station deaktiviert (E3/E4) |
| Cheap-Probability ohne Station | Gesamtmedian überstrahlt den Wochentag | umschaltbare Basis: Median derselben Stunde (Spalte) oder Gesamtmedian (B12) |

## B5: in diesem Durchgang geschlossen

1. **Fortschritts-Protokoll der NAS-Jobs** (`app/progress.py`) — Statusdatei
   `runtime/jobs/<job>.progress.json`, Log `runtime/jobs/<job>.log`
   (500 Zeilen), Ausgabe im Journal/Docker-Log und im System-Tab.
   `/api/v1/health` liefert `progress` je laufendem Job; die GUI pollt
   während eines Laufs alle 15 s. Siehe [Betrieb](BETRIEB.md#modell-lauf-beobachten).
2. **Beschleunigung des Modell-Laufs** — vektorisierte Segmentgrenzen der
   12-Uhr-Regel (kein `pd.Timestamp`-Boxing mehr) und schnellere
   Pool-adjacent-violators-Projektion; Ergebnisse **bitgleich** zur vorherigen
   Implementierung (direkter Vergleich über 24 h/72 h/168 h und 200
   Zufallsverläufe). Neu `app/model_jobs.py`: Fit, Horizonte und Backtests
   laufen prozessparallel (`TANKAPP_MODEL_WORKERS`, Default automatisch),
   mit seriellem Rückfall, wenn kein Prozess-Pool verfügbar ist.
3. **Rate-Limit + API-Key** (`app/ratelimit.py`, Konzept §11) — 60/min
   anonym, 300/min mit Schlüssel, Tageskontingente, `X-RateLimit-*`-Header,
   `429` + `Retry-After` + `error_code: rate_limited`.
   (Stand 0.11.0; später ersatzlos entfernt — LAN-only.)
4. **Deprecation-Header** (§11.3, M5) auf `stations`, `day` und
   `route/evaluate` mit `Link` auf `/api/v1/decide`. Werkstatt-Routen bleiben
   unmarkiert.
5. **`latest_by`** in `/api/v1/decide` (§4.1 H, §4.3 T_max, §11.1): Fenster
   und Warten-Empfehlung enden spätestens am angegebenen Zeitpunkt; ohne
   verbleibendes Fenster folgt ehrlich `no_advice` statt eines erfundenen.
6. **Fahrtmodus in `/api/v1/decide`** (§10): `mode=onroute|dedicated` plus
   `home_lat`/`home_lon`; Alternativen weisen `trip_mode`, Umweg-km,
   Sprit-/Zeitkosten und Netto getrennt aus.
7. **M7-Schwellen-Nachzug** (`app/thresholds.py`, §5.5 Schritt 4, §13 M7):
   Vorschlag aus den gemessenen Trefferquoten (Ziele 70 %/85 %/60 %, erst ab
   n = 25 je Aktion), begrenzte Schritte, harte Grenzen; sichtbar in
   `/api/v1/stats/summary` (`threshold_tuning`). Wirksam nur mit
   `TANKAPP_M7_AUTO_APPLY=1` — die Produktion entscheidet sonst weiter mit
   der kalibrierten Tabelle (§8.2 Nr. 1).
8. **Trefferquote `refuel_elsewhere`** im Advice-Ledger (bisher nur
   WARTEN/JETZT) — Voraussetzung für Punkt 7.

## Umgesetzt seit der Prüfung am 10.09.2026

Die Prüfung ([Archiv](archiv/PRUEFSTAND-2026-09-10.md)) und die beiden
Tiefenanalysen ([V1](archiv/TIEFENANALYSE-2026-09-11.md),
[V2](archiv/TIEFENANALYSE-V2-2026-09-11.md),
[V3](archiv/TIEFENANALYSE-V3-GUI-2026-09-11.md)) haben Punkte gefunden, die
nicht in der Konzept-Abdeckung unten standen. Sie sind umgesetzt — die
zugehörigen Aufgaben stehen nicht mehr in [TODO.md](../TODO.md).

### 11.09.2026 — P-Seite aus der Prognoseverteilung (§4.1–4.3)
Die Bootstrap-Pfade werden jetzt im Worker zu **2-h-Fenster-Minima je Draw
und Nowcast-Draws** reduziert und im Artefakt veröffentlicht
(`forecasts[].draws_24h`/`draws_7d`, `engine/probabilities.py`). Der
Decision Layer rechnet daraus ohne Numerik-Abhängigkeit (`app/pside.py`):
- `p_besser` = P(min über dem Fenster ≤ p_jetzt − 1 ct) — ersetzt die
  Ledger-Trefferquote als F1-Gate **und** als Brier-Input,
- `p_lohnt` = P(€_netto > 0) je F2-Zeile,
- F3-Fenster-P = P(Fenster ≤ Minimum im ±6-h-Umfeld) je Fenster.
**Dokumentierte Abweichung:** die gemeinsame Bootstrap-Ziehung über
Stationen (§4.2) ist nicht umgesetzt — `p_lohnt` rechnet mit unabhängigen
Nowcast-Draws (siehe „Bewusst offen“). Das M7-Gate (§0.4) bleibt hart:
`primary.p_correct` erscheint erst nach der Kalibrierung.

### 11.09.2026 — P1/P2/P3-Fixes (Prüfstand §3/§7)
Fill-Validierung + Nowcast statt 1,70-€-Default, 4xx-Status, Compliance-
Bedingung fürs Episode-Resolve, `worth_it` aus der Schwellen-Config,
Store-Größenfehler statt Silent-Reset + 90-Tage-Retention/-Archiv,
echtes 30-Tage-Fenster der Kennzahlen (M7-Gate bleibt Allzeit-Zähl-Gate
über dieselbe P-Grundgesamtheit), `trip_mode`/`latest_by` persistiert,
`no prices`-Alarm in Kalendertagen, Rate-Limit-LRU + korrektes
`Retry-After`, 501 als JSON, Asset-Caching, Preflight-Stationszahl und
`python -m engine.cli`.

### 11.09.2026 — Engine-Ausbau, Güte-Gate, Umweg-Konvention (Prüfstand §1.3/§1.5, §3.1–3.4)
- **Hampel-Filter** (§3.1 Schritt 3) in `engine/data.py`: ± 1 h, Median ±
  5·MAD mit 1-ct-Boden und Isolations-Prüfung — entfernt nur isolierte
  Einzel-Poll-Artefakte, behält persistente Sprünge und die Tageskurve;
  Zähler in `describe()` (`hampel_removed_points`).
- **Strukturmodell X** (§3.2): gepoolter **Feiertags-Dummy je Bundesland**
  (`engine/holidays.py`, Paket `holidays` optional — ohne Subdiv/Paket
  trägt er ehrlich null; Koeffizient aus bis zu 365 d, nicht aus dem
  42-d-Fenster, wo 0–1 Feiertage unidentifizierbar wären) und
  **Zeit-seit-letztem-Preissprung** als Feature (Sprung ≥ 1 ct, auf 168 h
  gedeckelt). Modell-Schema 2, alte Artefakte werden beim nächsten Lauf
  neu gefittet.
- **Rolling-PICP 7 d je Station** (§3.3.3) im Backtest: Badge grün ≥ 93 %,
  gelb ≥ 90 %, rot < 90 % (nominal 95 %, < 72 Punkte = keine Aussage),
  publiziert in `current.json` (`rolling_picp_7d`), als `quality`-Feld in
  `/v1/decide` und als Intervall-Kachel-Zeile in der Startkarte.
- **Güte-Gate** (§4.4/§4.5 Schritt 1): Rot im Rolling-PICP der
  ausgewählten Station → `no_advice` „Keine klare Empfehlung — Prognose
  derzeit unsicher …“ *vor* F2/F1.
- **Mehrtage-Backtests** (§3.4): +3 d und +7 d (24-h-Fenster am
  Horizontbeginn) werden im Backtest gegen beobachtete Preise bewertet
  (`horizons` im Report + Markdown); ehrlich ausgewiesen, kein
  M3-Abnahmekriterium.
- **NAS-Job Backtest 7 d → 21 d** (`app/refresh.py`): das
  21-Tage-Gate `at_least_21_complete_test_days_per_station` ist damit aus
  dem automatischen Lauf erfüllbar (Prüfstand §1.3).
- **Umweg-Konvention vereinheitlicht** (Prüfstand §1.5): Die GUI rechnet
  und schickt Luftlinie × 1,3 (dieselbe Größe wie `route.py`/`decide.py`
  ableiten) statt × 1,0; GUI-Texte angepasst.
- **GUI aufgeräumt**: toter Paarvergleich-Prototypcode mit erfundenen
  Preisen (1,70/1,66 €/L) entfernt — die Umweg-Ökonomie läuft im
  Alltags-Panel und in `/api/v1/route/evaluate` (§8.2 Nr. 5, „bewusst
  offen“).

### 12.09.2026 — Version 0.10.0/0.10.1: Betrieb, GUI, Sprache

| Punkt | Umsetzung | Konzept/Prüfung |
|---|---|---|
| Beleg-Storno | `DELETE /api/v1/fills/{id}` setzt `voided` + Audit-Zeile statt zu löschen; GUI-Knopf im Verlauf | A3, §5.4 |
| Daten-Export | `GET /api/v1/fills.csv` + Download im System-Tab | A6, §12 P2 |
| Backup der Bilanz | `ops/nas/backup.sh` für `runtime/` + durchgespielter Restore | B1, Prüfstand §3.5 |
| Ein Alarm-Block | `alarms[]` in `/api/v1/health`, roter/gelber Punkt im GUI-Header | B4, Prüfstand §4 |
| Version sichtbar | `version` + `commit` in `/health` und im Footer, `CHANGELOG.md` | B9 |
| Einrichtung führbar | Checkliste im System-Tab mit Fix-Hinweisen je Zeile | C1 |
| M7-Fortschritt | Kachel „n/100 Settlements, Brier x (Ziel < 0,25)“ | A7, §0.4/§13 M7 |
| Heatmap beantwortet F3 | Tages-Zeilen (Median + günstigste Stunde), heutige Zeile, Fazit-Satz, Erklärzeile | C10, §8.2 |
| Ein Vokabular | Tab „Statistik“ → „Werkstatt“ (UI + Doku) | F1, §0.3 |
| Komma-Eingabe | `inputMode="decimal"`, `,`→`.`, Sofort-Validierung am Feld | E2 |
| A11y-Anfang | Ampel-Chip mit Symbol (▲/▼/●/→), Slider mit `aria-valuetext` | C5 |
| RP2-Log-Cap | `cache.log` als 1-MB-Ring (`CACHE_LOG_MAX_BYTES`) | G1 |
| e2e-Absicherung | Playwright-Spec `decide → intent → fill → due` | D2, Prüfstand §6 |
| Doku an einem Ort | Alle Dokumente in `docs/` (Index `docs/README.md`), Historisches in `docs/archiv/` | 0.10.1 |

Offen aus derselben Prüfung: **B7** (gzip, getrenntes Caching,
Poll-Bündelung), **B2** (Schema-Version des Feedback-Stores), **D1**
(`Dashboard.tsx` zerlegen). **B6/H1** ist seit 0.10.0 geschlossen (Server als
einzige Quelle von Strecke und Schwellen), siehe
[CHANGELOG](../CHANGELOG.md#0100--2026-09-12).

### 12.09.2026 — Version 0.11.0: ehrliche Eingaben, Heatmap-Basis, RP2-Journal

| Punkt | Umsetzung | Prüfung |
|---|---|---|
| Beleg-Eingabe | Felder prüfen vor dem Roundtrip dieselben Grenzen wie der Server (5–100 L, 0,40–5,00 €/L, `web/src/data.ts::FILL_LIMITS`), Hinweis direkt am Feld | E3, Prüfstand §3.1 |
| Beleg ohne Station | Button „Beleg buchen“ deaktiviert + Hinweis „Station wählen“; kein `station_id: "custom"`, das erst der Server ablehnt | E4 |
| Heatmap-Zeitraum | Wochen-Select 4/6/12 (Default 6), `setHeatmapWeeks` verdrahtet | E5 |
| Slider-Präzision | Verbrauch 0,5-L/100-km-Schritte, Tankmenge 1-L-Schritte, Zeitwert 0,5 €/h — je ein Begleit-Zahlenfeld für exakte Werte (6,3 L/100 km) | E6 |
| Cheap-Prob-Basis | `basis=hour`: Vergleich gegen den Median **derselben Stunde** (Spalten-Basis), GUI-Default ohne Station; API-Default bleibt `overall` | B12, [ANALYSE.md](ANALYSE.md#cheap-probability) |
| API-Explorer | „day (Beispiel)“ nur mit gewählter Station, sonst grau + Hinweis | E7 |
| RP2-Journal | Drop-in `rp2/journald.conf.d/50-tankapp-journal.conf` (`SystemMaxUse=50M`), `journalctl --vacuum-size=50M` als Wartungsschritt | G2, [RP2.md](RP2.md#journal-größe-begrenzen-sd-karte-schonen) |

### 12.09.2026 — Version 0.14.0: Heatmap-Ehrlichkeit

Erster P0 aus echtem Betrieb (Tracking seit Dienstag): „Typisch am günstigsten:
Di 06–08 Uhr — 100 % Chance günstig“ war im Raster nicht wiederzufinden, und
die leere Mo-Zeile las sich wie Datenverlust. Beides war eine Anzeige-Lücke,
kein Rechenfehler — die Werte stimmten, ihre Deutung nicht.

| Punkt | Umsetzung | Prüfung |
|---|---|---|
| Günstigste Stunde wiederfindbar | Eine Spalte = **eine** Stunde: Label „06–07 Uhr“ (`hourBucketLabel`) statt Zweistundenfenster „06–08 Uhr“, plus Erklärzeile im Panel | P0 12.09., C10 |
| Gleichstand ausgeschrieben | Alle gleichauf liegenden Stunden zu Bereichen gebündelt („06–18 Uhr — 12 Stunden gleichauf“) statt erstbeste Nennung der Schleife | P0 12.09. |
| Dünne Vergleichs-Basis | `reference_counts` je Zelle im Payload, `MIN_HEATMAP_REFERENCE = 30`, Kennzeichen „dünn“ + Rücknahme der Empfehlung („Mechanik, keine Empfehlung“); Zellwert bleibt sichtbar | P0 12.09., B12 |
| „Zahlen verloren?“ | `range_from`/`range_to` + Zeile „Datenreichweite: 12.345 Preise von 18 Stationen · Di 08.09. 05:10 – Sa 12.09. 07:55 Uhr“ + amber Hinweis „fehlende Tage, kein Datenverlust“ | P0 12.09., C6-Teil |
| Zähler ehrlich | `points`/`stations` zählen nur **verwendete** Preise (geschlossene Meldungen und `null`-Preise fielen vorher mit ins Gewicht) | P0 12.09. |
| Format-Konvention | €/L mit Komma und drei Stellen („2,219 €/L“ statt „2.219“), Prozent mit Leerzeichen, Formatter-Satz in `web/src/data.ts` + vitest | C9-Teil |
| Logik testbar | Heatmap-Rechnung als reine Funktionen in `data.ts`, Render-Tests gegen echtes Markup (`HeatmapGrid.test.tsx`), Payload-Test in `tests/test_b3.py` | D1-Muster |

### 12.09.2026 — Version 0.15.0: Alarme aufs Handy, Werkstatt-Sprache

Backlog-Runde ohne Live-Daten und ohne Produktentscheidung: Zustellung,
Testschutz, Sprache und ein gemeinsamer Fehler-Zustand. Keine bestehende
Rechnung geändert.

| Punkt | Umsetzung | Prüfung |
|---|---|---|
| Alarme aufs Handy | `app/notify.py`: `severity: error` → **ein** ntfy-Webhook (`TANKAPP_NTFY_URL`), 5-min-Tick, Zustandswechsel + eine Erinnerung nach 6 h, „wieder betriebsbereit“ beim Abräumen; Text nur Codes + Klartext + Version (keine Preise/Stationen/Pfade/Secrets), Fehler bereinigt auf stderr, Zustand atomar in `runtime/notify/state.json`, `/health` → `notify`; ohne Variable passiert nichts | B4, [BETRIEB.md](BETRIEB.md#alarm-zustellung-über-ntfy-b4) |
| Umweg-Rechnung abgesichert | Property-Tests mit fast-check (`web/src/data.property.test.ts`, 300 Läufe je Eigenschaft, fester Seed): Identität, Monotonie, exakter Break-even `criticalCtPerL`, Grenzfälle (`z=0`, `d=0`, `liter→∞`, `v≤0`), `worth_it`-Schwellen inkl. Kanten — reiner Testzuwachs | D3 |
| Werkstatt-Sprache | Deutsche Primär-Labels statt Jargon („Wahrscheinlichkeit für günstig“, „Ampel-Stärke“, „Preis-Abstand“, „Prüfzeitraum“, „Ø Mehrkosten“, „Billigste Stunde“), Formel und Fachwort im Tooltip; Tageszahlen ausgeschrieben („Brier (30 Tage)“ statt „Brier 30d“) | F2, F3-Teil |
| Bausteine geteilt | `web/src/components/ui.tsx`: `panel`, `Empty`, `Badge`, `Metric` (Tooltip auch per Tastatur) aus `Dashboard.tsx` ausgelagert, Render-Test daneben — gemeinsame Basis für den Views-Schnitt; `Dashboard.tsx` 4 098 Zeilen | D1-Teil |
| Zahlen de-DE | Alle Anzeigen nutzen den Formatter-Satz: 21 `toFixed`-Stellen in `Dashboard.tsx` (PICP, δ̂, KI, q, Ampel-Stärke, MASE, CUSUM, tmpfs, ε) plus Achsen/Tooltips in `LineChart`/`LabCharts`; `format-convention.test.ts` zählt die erlaubten Reste (SVG-Koordinaten, Preis-Eingabefelder) und meldet neue | C9-Rest |
| Fehler-Zustände einheitlich | `web/src/components/LoadError.tsx`: Klartext aus `problem(error_code)`, Rohcode darunter, **ein** `Erneut laden`-Knopf über den gemeinsamen Refresh-Zähler, `role="alert"`, kompakte Variante für Inline-Boxen; in sechs Panels verdrahtet, Render-Test daneben | C6-Teil |

## Konzept-Abdeckung im Einzelnen

| § | Anforderung | Stand |
|---|---|---|
| 0.1–0.3 | Drei Fragen, zwei Modi, eine Zahl |fertig (Alltag/Werkstatt-Tabs, Ampelkarte) |
| 0.4 | Kalibrierungs-Gate (Brier < 0,25, n ≥ 100) |fertig als hartes Gate; offen bis echte Daten (M7) |
| 1 | Tankerkönig-Collector, tmpfs, Upload |fertig (M1) |
| 2 | Selektion δ̂, Bootstrap-KI, AV, Tagesform |fertig (B3.10); **dokumentierte Abweichung** (Stand 10.09.2026, Konzept §8.2 Nr. 7): die Werkstatt-Ansicht ist ein Analyse-Werkzeug und sortiert nach δ̂; Sortierung nach aktueller Empfehlungsstärke bleibt das Zielbild für die Alltags-Ansicht ([Prüfstand §1.2](archiv/PRUEFSTAND-2026-09-10.md)) |
| 3.1–3.2 | Aufbereitung, Strukturmodell + AR(2), 12-Uhr-Regel |Strukturmodell + AR(2) + 12-Uhr-Regel fertig; **fertig**: Hampel-Filter (§3.1 Schritt 3), gepoolter Feiertags-Dummy je Bundesland + Zeit-seit-letztem-Sprung als Feature (§3.2, Update 11.09.2026 abends); **offen**: M3-Zweitmodell/Ensemble (Echt-Daten-Abnahme) |
| 3.3 | Bootstrap-Intervalle |fertig (unkalibriert, gekennzeichnet); **fertig**: 7-Tage-Rolling-PICP je Station als Konfidenz-Badge (§3.3.3, Update 11.09.2026 abends); **ACI offen** (§3.3 selbst: erst nach 4 Wochen Live-Betrieb) |
| 3.4 | Backtest 24 h, Horizonte +3/+7 d |fertig; **fertig**: Mehrtage-Backtests +3 d/+7 d im Rolling-Origin-Backtest (Update 11.09.2026 abends) |
| 4.1–4.3 | F1/F2/F3 inkl. Fenster-Top-3 |Regel- und €-Seite fertig (B4) + `latest_by` (B5); **P-Seite jetzt aus der Prognoseverteilung**: `p_besser` = P(min ≤ p−1 ct) aus den Draws (F1-Gate + Brier), `p_lohnt` je F2-Zeile, F3-Fenster-P je Fenster. **Abweichung**: gemeinsame Ziehung über Stationen (§4.2) offen — `p_lohnt` nutzt unabhängige Nowcast-Draws (siehe „Bewusst offen“) |
| 4.4 | „Keine klare Empfehlung“ |fertig (Grauzone P_besser ∈ [40, 60] % aus den Draws); **fertig**: Güte-Gate als Auswertungsschritt 1 (§4.5) — Rolling-PICP rot → „Keine klare Empfehlung“ ohne Ampel/Prozent (Update 11.09.2026 abends) |
| 4.5 | Schwellen in einer Config |fertig (B5: `app/thresholds.py`) |
| 5.1–5.2 | Brier, Reliability, zwei Ledger |fertig |
| 5.4 | Drei Uhren, Episode, Slack-Matching, Due-Prompt |fertig; **Offline-Queue für Fill/Intent offen** (P2) |
| 5.5 | Drei Schichten A/B/C |fertig; w(h)-Rückkopplung in Selektion/F3 offen (Datenbedarf ≥ 8 Füllungen) |
| 6 | Produkt-KPIs | Brier, Trefferquoten, Regret-Ratio fertig; **Top-3-Fenster-Trefferquote offen** (Engine liefert je Tag nur eine Prognosestunde) |
| 7 | Polling-Fenster 06–24 |fertig |
| 8.1 | Alltag: Ampel, Alternativen, Tagesstreifen, What-If |fertig |
| 8.2 Nr. 1–4, 6–9 | Werkstatt: Regel/ε, Scoreboard, Kalibrierung, Stations-Labor, Fan-Chart/Heatmaps, Meine Stationen, System-Status, API-Explorer |fertig (System-Status jetzt mit Fortschritt) |
| 8.2 Nr. 5 | Paarvergleich als Werkstatt-Werkzeug |bewusst kein zweites Panel: die Umweg-Rechnung liegt im Alltag („Rechnet sich der Umweg?“) und serverseitig in `/api/v1/route/evaluate`; ein zweites Panel wäre Duplikat. Der tote Prototypcode mit erfundenen Preisen (1,70/1,66 €/L) ist entfernt (Update 11.09.2026 abends) |
| 9 | Pi ↔ NAS, Archiv, Jobs |fertig + Job-Fortschritt (B5) |
| 10 | Umweg-Ökonomie, Zeitwert, Rushhour |fertig; E5↔E10-Äquivalenz nur als Hinweis, nicht im Ranking; **Konvention vereinheitlicht**: GUI rechnet und schickt Luftlinie × 1,3 wie Server und Selektion (Prüfstand §1.5, Update 11.09.2026 abends) |
| 11.1 | `/v1/decide` inkl. `lat`/`lon`, `latest_by`, `home_*` |fertig außer Standortwahl per `lat`/`lon` (App arbeitet mit dem Polling-Set) |
| 11.2 | Intent, Fills, Settlement |fertig |
| 11.3 | Detail-Endpunkte + Deprecation |fertig (B5) |
| 12 P0 | Datenquellen, Erreichbarkeit, E10 |fertig |
| 12 P1 | Markenrabatte, w(h), Lebenszyklus |Rabatte offen, w(h) berechnet aber nicht zurückgekoppelt, CUSUM-/Coverage-Alarm teilweise |
| 12 P2 | Push, Belege |offen (siehe unten) |
| 13 M1–M4 | Collector, Selektion, Engine, PWA |M1/M2/M4 fertig; M3 ohne Echt-Daten-Abnahme |
| 13 M5 | TankPuls-API |fertig (B4 + B5: Deprecation; Rate-Limit entfernt — LAN-only); **offen**: OpenAPI-Spezifikation aus M5-Fertig-Kriterium (siehe „Bewusst offen") |
| 13 M6 | Quantile-Boosting |optional, verworfen bis ≥ 3 Monate Daten |
| 13 M7 | Kalibrierungs-Loop |Vorschlag und Regler fertig (B5); Anziehen der Schwellen erst mit echten Live-Daten sinnvoll |

## Bewusst offen (Backlog mit Grund)

| Thema | Grund, es jetzt *nicht* zu tun |
|---|---|
| **ACI (§3.3)** | Konzept verlangt 4 Wochen Live-Betrieb vor der Aktivierung; ohne echte Scores wäre α eine erfundene Zahl. Bootstrap-Intervalle bleiben als unkalibriert gekennzeichnet. |
| **M3-Zweitmodell/Ensemble (§3.2)** | Setzt die Abnahme-Kriterien (MASE, Pinball) voraus — die sind ohne echten Datenbestand nicht prüfbar. |
| **Preis-Push (§12 P2)** | Der **Alarm**-Push ist seit 0.15.0 drin (ntfy, `severity: error` → [BETRIEB.md](BETRIEB.md#alarm-zustellung-über-ntfy-b4)). Offen bleibt die Meldung „Jetzt 4 ct unter Tagesmedian“: Trigger aus dem Decision Layer sind vorbereitet, aber ungetestet, und der Versand braucht eine Entscheidung, wer wann was aufs Handy bekommt (kein Dauerfeuer). |
| **Top-3-Fenster-Trefferquote (§6)** | Die Engine veröffentlicht je Tag eine Prognosestunde; drei Kandidatenfenster wären geraten. Erst mit Fensterstruktur im Backtest. |
| **w(h)-Rückkopplung in Selektion/F3 (§5.5)** | Profil ist berechnet (`wallet.wh_hours`), aber erst ab ≥ 8 Füllungen belastbar — vorher wäre der Default die ehrlichere Wahl. |
| **Markenrabatte (§12 P1)** | `--brand-rebate` ist ein Eingriff in δ̂ und Score; ohne echte Rabattdaten nicht kalibrierbar. |
| **Standortwahl per `lat`/`lon` (§11.1)** | Die App arbeitet mit dem kuratierten Polling-Set ( Kontingent 1 R/5 min). Freie Umkreissuche bräuchte eigene Requests und ein Kontingent-Modell. |
| **Offline-Queue für Fill/Intent (§5.4)** | Der Service-Worker hält die letzte Antwort vor; eine IndexedDB-Warteschlange ist sinnvoll, aber erst nötig, wenn Füllungen im echten Betrieb häufig offline erfasst werden. |
| **E5↔E10-Äquivalenz im Ranking (§10)** | 1,015-Faktor ist eine Näherung; ohne gemessenen Mehrverbrauch des Fahrzeugs wäre das Ranking damit weniger ehrlich, nicht mehr. |
| **OpenAPI-Spezifikation (M5)** | Konzept §13 nennt „OpenAPI + Tests grün" als Fertig-Kriterium; bis dahin ist [API.md](API.md) die verbindliche Endpunkt-Beschreibung. Eine aus `app/server.py` generierte OpenAPI-Datei wäre Werkzeugarbeit ohne neuen Inhalt — erst mit einer zweiten API-Verbraucherin lohnend. |
| **Feedback-Ledger-Persistenz (JSON vs. relationale DB)** | Gutachten-Empfehlung (ACID via SQLite/PostgreSQL). Der JSON-Store funktioniert im Ein-Nutzer-NAS-Betrieb; entschieden wird zusammen mit Retention/Rotation ([Prüfstand §3.5](archiv/PRUEFSTAND-2026-09-10.md)). |
| **Kampagnen-Quote 6/2/2 auf dem NAS (§2)** | Der NAS-Job rankt global Top-10 je Kraftstoff; die 6/2/2-Quotierung existiert nur in der Offline-Pipeline (`analysis/station_selection.py`). Erst relevant, sobald mehr als eine Kampagnenstadt live geht ([Prüfstand §1.2](archiv/PRUEFSTAND-2026-09-10.md)). |
| **P-Schätzer im Advice-Ledger (Laplace vs. Beta-Binomial)** | Implementiert ist Laplace-Glättung `(hits + 10·0,5)/(n + 10)`; das Gutachten schlägt Beta(5,5)-Binomial vor. Beide sind priorsauber — ein Wechsel vor M7 ist nicht messbar, deshalb kein Handlungsbedarf. Seit der P-Seite (§4.1–4.3) dient diese Ledger-Quote nur noch als **Fallback**, wenn keine Draws veröffentlicht sind (Altbestand, kein Modell); das F1/F2-Gate und der Brier-Input sind die Verteilungs-P. |
| **Gemeinsame Bootstrap-Ziehung über Stationen (§4.2)** | `P_lohnt` soll die Marktbewegung *nicht* wegkorrelieren („steigt der ganze Markt, steigen alle mit“). Die Engine fittet Stationen unabhängig mit eigenem seed-basiertem Generator; die veröffentlichten Nowcast-Draws je Station sind daher **unabhängig**. Eine echte gemeinsame Ziehung braucht einen stationenübergreifenden Resampling-Schritt (gleicher Tagesblock für alle Stationen einer Ziehung) — das ist ein eigener Arbeitsschritt, keine Nebenwirkung der P-Seite. Bis dahin ist `p_lohnt` die relative Häufigkeit über die *unabhängigen* Nowcast-Draws (konservativer Richtung: Marktgleichlauf würde die Unsicherheit *reduzieren*). |
| **`live_only_days` senken (90 → z. B. 28), „damit es zum M7-Zeitplan passt“** | Die Übergangsregel liegt **nicht** im M7-Pfad: `/v1/decide` schreibt ab Tag 1 Shadow-Snapshots (`app/decide.py`, „der Ledger misst die Tabelle trotzdem“), und das Gate zählt abgeschlossene Settlements (`min_recommendations`). 28 statt 90 Tage brächten M7 keinen Tag früher — die Kacheln sind seit der Trennung ohnehin getrennt ausgewiesen ([API.md](API.md) Punkte 2 und 6). Was die 90 Tage kaufen, ist Modell-Input: ab Handover fällt das Archiv weg (`engine/bootstrap.py`, `selected_archive = archive.iloc[:0]`), der Fit braucht sein 42-Tage-Fenster (`engine/config.py`: `train_days=42`, Untergrenze `min_train_days=28`, geprüft in `engine/models.py::fit`). Bei 28 live-only Tagen läge der Fit exakt auf der Untergrenze — ein einziger Tag ohne Daten (Umbau, Collector-Ausfall) ließe ihn mit `ValueError` scheitern; bei 90 Tagen bleiben 62 Tage Puffer. **Untergrenze einer Senkung ist deshalb `train_days` = 42, nicht 28**, und sie gehört gemessen (Backtest: MASE/PICP bei 42 vs. 90 Tagen Live-Input), nicht geschätzt. Nebenbefund: `app/refresh.py` ruft `bootstrap()` zweimal ohne `live_only_days` auf (Abdeckungsprüfung und Training) — der Produktivpfad ist damit auf 90 fest, `--live-only-days` wirkt nur im Standalone-CLI. Ein Knopf `TANKAPP_LIVE_ONLY_DAYS` in `app/config.py` lohnt erst, wenn die Messung einen anderen Wert verlangt; das Mess-Rezept (zwei Backtests auf live-only Daten + Entscheidungsregel) steht in [ENGINE.md §4](ENGINE.md#4-datenqualität-und-backtest-auf-dem-pc). |

## Nicht umgesetzt und warum nicht

- **Ergebnisse verändern sich nicht durch Parallelität.** Die Aufgaben
  (Station × Horizont) sind unabhängig, Config und Cutoff sind identisch, der
  Bootstrap nutzt einen seed-basierten Generator. Test
  `tests/test_model_jobs.py::test_parallel_matches_sequential` vergleicht
  serielle und parallele Ausgabe.
- **Keine neuen Demo-Zahlen.** Alle neuen Felder (`progress`, `thresholds`,
  `context`) sind `null` bzw. Startwerte, solange keine echten Daten
  vorliegen — Ehrlichkeits-Regel (§14).
- **Keine Credentials im Log.** Das Fortschrittsprotokoll schreibt Phasen,
  Stationsnamen und Zähler. Zugangsdaten, Tokens und Pfade zu privaten
  Dateien erscheinen nicht.

## Messwerte

Gemessen auf 8 Test-Stationen, 70 Tage Verlauf, 2 CPU-Kerne
(siehe [Betrieb](BETRIEB.md#modell-lauf-beschleunigen)):

| Schritt | vorher | nachher |
|---|---|---|
| Prognose 24 h | 12,4 s | 0,8 s |
| Prognose +3 d | 35,7 s | 2,2 s |
| Prognose +7 d | 82,1 s | 4,9 s |
| Backtest 7 Tage | 44,3 s | 6,4 s |
| Gesamtlauf 8 Stationen (seriell) | ~23 min | 121 s |
| Gesamtlauf 8 Stationen (2 Prozesse) | – | 70 s |

Die Zahlen sind Messwerte einer Testreihe, keine Zusage für den echten
Bestand; entscheidend ist der Faktor, nicht der Absolutwert.

Seit 11.09.2026 (abends) fährt der NAS-Job den **21-Tage-Backtest** (statt
7 Tagen) plus die Mehrtage-Horizonte — der Backtest-Schritt dauert damit
etwa 3–4× so lange (auf der Messmaschine: ~20 s statt 6,4 s je Station
seriell, B = 2000). Der Gesamtlauf bleibt im einstelligen Minutenbereich
und der Modell-Job läuft nachts ([Betrieb](BETRIEB.md)).
