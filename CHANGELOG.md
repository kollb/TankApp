# Changelog

Alle nennenswerten Änderungen ab jetzt. Format lose an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) angelehnt;
Version folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.12.0] – 2026-09-12

Nutzer-Feedback-Runde (11 Punkte): Alltag und Werkstatt neu geordnet, Anker
12:00 konfigurierbar, Archiv-Lückenfüllung, belastbare Heatmaps, Rate-Limit
entfernt.

### Hinzugefügt

- **„Tanken erfassen“** im Alltag (Sektion 2): Beleg jederzeit buchen (Station,
  Liter, Preis) — daneben die Tank-Bilanz; zusätzlich zur Due-Prompt- und
  Verlaufs-Erfassung.
- **Archiv-Lückenfüllung** (`app/gapfill.py`, Job-Phase „gapfill“): geschlossene
  Polling-Lücken vergangener Tage (z. B. gestern 12–13 Uhr) werden automatisch
  mit echten Tankerkönig-Archiv-Ereignissen geschlossen — nur Lückenfenster,
  nur Vergangenheit, Live behält per Engine-Dedup immer Vorrang; Ergebnis als
  `gapfill_quality` in der Publikation. Details:
  [docs/BETRIEB.md](docs/BETRIEB.md#polling-lücken-werden-automatisch-aus-dem-archiv-geschlossen).
- **`TANKAPP_DECISION_HOUR`** (Default 12, Engine-CLI `--decision-hour`):
  Der Schicht-A-Anker ist konfigurierbar und fließt in Backtest-Report
  (`decisionHour`), Werkstatt-Texte und Labor-Diagramm ein.
- **Advice-Ledger zählt ehrlich**: `snapshots_total`, `n_pending`
  (noch laufende Empfehlungen), `n_void_all`; M7-Kachel mit Warten/Jetzt/
  Woanders-Erklärung „pro Empfehlung, nicht pro Tag“.
- **Heatmap-Stichprobe**: Antwort liefert `counts` (7×24) je Zelle.

### Geändert

- **Alltag neu geordnet** (7 nummerierte Sektionen): 1 Empfehlung (+ schmale
  Vertrauens-Zeile statt Doppel-Karten), 2 Tanken, 3 Kosten, 4 Heute,
  5 Stationen, 6 Umweg, 7 Belege.
- **Werkstatt in 3 Fragegruppen**: A „Taugt das Modell?“ (Scoreboard,
  Kalibrierung), B „Warum empfiehlt es das?“ (Regel-Slider, Historie, Labor),
  C „Was zeigen die Daten?“ (Heatmaps, Ranking) — alle Funktionen bleiben.
- **Schicht-A-Anker 08:00 → 12:00**: Anhebungen gibt es nur mittags
  (12-Uhr-Regel) — erst um 12 Uhr weiß der hypothetische Entscheid, ob es
  heute teurer wurde.
- **Vergleichsstation** ist Default die nächste frische Station (statt der
  billigsten); ist die Auswahl selbst die billigste, zeigt die Differenz die
  Spanne zur teuersten („Teuerste statt billigste“ statt 0,00 €).
- **Heatmaps belastbar**: Zellen unter 8 Preisen (·) und Tages-Zeilen unter
  3 belastbaren Zellen bleiben leer — kein 100-%-Artefakt aus Nacht-Preisen.
- **Kalibrierungs- und Übergangs-Texte neu gefasst** („Stimmen die
  Prozentzahlen?“, „Freigabe 1/2 von 2“), Diagrammachsen ohne Jargon.
- **`nas-up` räumt auf**: `docker image prune -f` nach `compose up`.

### Entfernt

- **App-weites Rate-Limit ersatzlos gestrichen** (LAN-only): `app/ratelimit.py`
  gelöscht, `TANKAPP_API_KEYS`/`TANKAPP_RATE_*`, `X-RateLimit-*`-Header und
  `429` + `rate_limited` entfernt. Unberührt: Tankerkönig-429-Backoff des
  Collectors und `TANKAPP_WEBHOOK_TOKEN`.

## [0.11.0] – 2026-09-12

> Quick-Wins 0.11 komplett umgesetzt (7 von 7): ehrliche Beleg-Eingabe,
> wählbarer Heatmap-Zeitraum, präzise Slider, faire Cheap-Prob-Basis,
> begrenztes RP2-Journal. Baut auf **0.10.1** auf (Collector-Herzschlag lesbar,
> `export_influx.query_raw`).

### Hinzugefügt

- **B12** Heatmap-Vergleichs-Basis für die Cheap-Probability **ohne** Station:
  `GET /api/v1/heatmap?...&basis=hour` rechnet jede Zelle gegen den Median
  **derselben Stunde** (Spalten-Basis) statt gegen den Gesamtmedian — damit ist
  der Tagesgang herausgerechnet und die Wochentags-Zeilen sind vergleichbar.
  API-Default bleibt `overall` (bestehende Aufrufe ändern sich nicht), die GUI
  schaltet ohne Station auf `hour` und erklärt die Wahl; mit gewählter Station
  ist der Umschalter deaktiviert (dort vergleicht die Heatmap ohnehin je Zelle).
  Begründung und Grenzen: [docs/ANALYSE.md](docs/ANALYSE.md#cheap-probability).
- **G2** Journal-Cap für die RP2-Dienste: Drop-in-Beispiel
  `rp2/journald.conf.d/50-tankapp-journal.conf` (`SystemMaxUse=50M`,
  `SystemMaxFileSize=10M`) + `journalctl --vacuum-size=50M` als
  Wartungsschritt; Anleitung in [docs/RP2.md](docs/RP2.md#journal-gr%C3%B6%C3%9Fe-begrenzen-sd-karte-schonen).
- **E5** Heatmap-Zeitraum wählbar: Wochen-Select **4/6/12** (Default 6) neben
  „Heatmap Art“; die `heatmapWeeks`-Preference hatte bisher keinen Eingabeweg.
- **E6** Slider mit Begleit-Zahlenfeld: Verbrauch `step=0,5`, Tankmenge
  `step=1`, Zeitwert `step=0,5` — das Feld daneben nimmt exakte Werte
  (6,3 L/100 km) mit Komma oder Punkt und klemmt in den Bereich des Sliders;
  `aria-valuetext` bleibt (in €/h, L/100 km, km/h).
- **B13** Build-Commit im Docker-Image (bereits vor diesem Stand umgesetzt, hier
  erstmals dokumentiert): `tankapp.py nas-up` setzt `TANKAPP_BUILD_COMMIT` als
  Build-Arg + Env, `compose.yml`/`Dockerfile` übernehmen ihn, `/health` liefert
  damit `commit` statt `null`.

### Geändert

- **E3** Beleg-Eingabe ehrlich: Liter und Preis prüfen **vor** dem Roundtrip
  gegen dieselben Grenzen wie der Server (5–100 L / 0,40–5,00 €/L); die Grenzen
  stehen gemeinsam in `web/src/data.ts::FILL_LIMITS`, der erlaubte Bereich steht
  als Hinweis am Feld. Bewusst **keine** `min`/`max`/`step`-Attribute: die
  Eingaben sind seit E2 Textfelder mit `inputMode="decimal"` (Komma!), bei denen
  diese Attribute wirkungslos wären — ein Effekt-Attribut ohne Wirkung wäre
  unehrlicher als die geprüfte Konstante.
- **E4** Beleg ohne Station: Button „Beleg buchen“ ist deaktiviert, solange
  keine Station gewählt ist (Hinweis „Station wählen“ + Name der gewählten
  Station im Dialog). Die GUI schickt nicht länger `station_id: "custom"`, das
  der Server nur mit `unknown_station` ablehnen konnte.
- **E7** API-Explorer: „day (Beispiel)“ gibt es nur noch mit gewählter Station —
  sonst grauer, deaktivierter Knopf mit Hinweis „erst Station wählen“ statt eines
  Aufrufs mit leerem `station_id`. Die Heatmap-Beispiele nutzen Bauanleitung und
  Wochenwahl der Tabs (`heatmapPath`).
- **D1-Vorbereitung, Testbarkeit:** Heatmap-URL-Bau (`heatmapPath`),
  Beleg-Vorprüfung (`checkFillDraft`) und Slider-Commit (`sliderCommit`) liegen
  als reine Funktionen in `web/src/data.ts` und sind dort von vitest abgedeckt.

## [0.10.1] – 2026-09-12

### Behoben

- **B3.11** Collector-Herzschlag lesbar: `GET /api/v1/collector/status` las das
  Measurement `collector_status` mit dem Preis-Schema (`station`/`status` als
  Pflichtspalten) und verwarf die `_field`/`_value`-Antwort deshalb als
  „Unerwartetes InfluxDB-CSV-Format" — `influx_read_failed`/`ExportError`, obwohl
  der Pi-Uploader den Herzschlag korrekt liefert. Ein generischer Leseweg
  (`export_influx.query_raw`, nur `_time` als Pflichtspalte) liest solche
  Messungen jetzt als rohe Zeilen; die credential-freie `ExportError`-Meldung
  steht zusätzlich in `message` des Status-Endpunkts.

## [0.10.0] – 2026-09-12

> Alle 14 Quick Wins gehören zu 0.10 – B6/H1 (server-only Umweg) wurde in 0.10.0 konsolidiert.

### Hinzugefügt

- **A3** Beleg-Storno: `DELETE /api/v1/fills/{id}` setzt `voided`-Flag statt zu
  löschen, mit Audit-Spur; stornierte Belege zählen nicht mehr in Wallet-Bilanz
  und w(h)-Profil. GUI: Tankbelege-Verlauf im Alltag mit „Stornieren“-Knopf.
- **A6** CSV-Export der eigenen Tankbelege: `GET /api/v1/fills.csv` + Download
  im System-Tab.
- **B1** Backup der Laufzeitdaten: `ops/nas/backup.sh` + Restore-Absatz in
  docs/BETRIEB.md.
- **B4** Aggregierter Alarm-Block `alarms[]` in `GET /api/v1/health` + roter/
  gelber/grüner Punkt im Header.
- **B6/H1** Umweg server-only: Server liefert `detour_km_est`, `dist_mode`,
  `verdict`/`worth_it` + Schwellen `thresholds.active.elsewhere_net_eur`/
  `elsewhere_borderline_eur` (M7-tunebar, Bounds 0,25–1,0 €); GUI zeigt
  ausschließlich Server-Werte, entfernt `haversineKm*CIRCUITY`-Eigenrechnung und
  1,50/0,50-Konstanten in `data.ts`/`Dashboard.tsx`; `route/evaluate` liefert
  `thresholds.active` + `verdict`.
- **B9** App-Version + Commit-Hash in `/health` (app/version.py) + Anzeige im
  Footer.
- **C1** Geführte Einrichtungs-Checkliste im System-Tab (Status aus vorhandenen
  Endpunkten).
- **A7** M7-Fortschritts-Kachel im System-Tab (n/100 Empfehlungen, Brier gegen
  Ziel < 0,25).
- **C10** Heatmap: Tages-Zusammenfassung (Median + günstigste Stunde je Tag),
  Hervorhebung der heutigen Zeile, Fazit-Satz + Erklärzeile.
- **Doku-Umbau:** alle Dokumente in `docs/`, Index `docs/README.md`; Modul-READMEs
  eingezogen; Archiv `docs/archiv/` mit Legende; `docs/BETRIEB.md`/`RP2.md`
  gerettet; Link-Test ausgeweitet auf alle Markdowns inkl. Anker.

### Geändert

- **F1** Tab „Statistik“ → „Werkstatt“ (inkl. Sekundär-Texte und Doku-Verweise).
- **E2** Beleg-Dialog: Dezimaleingabe mit Komma (`inputMode="decimal"`, String-
  State, `,`→`.`-Normalisierung), Sofort-Validierung am Feld.
- **C5** Ampel-Chip mit Symbol (▲/▼/●/→) zusätzlich zur Farbe; Slider mit
  `aria-valuetext` (€, L/100 km, km/h, €/h).
- **G1** `rp2/cache_forecasts.py`: `cache.log` wächst nicht mehr unbegrenzt
  (1-MB-Ring, ältere Hälfte wird verworfen).
- **Dokumentation an einem Ort:** Verweise in Python-Docstrings, CLI-Hilfen,
  `AGENTS.md`, `.github/dependabot.yml` und übrigen Dokumenten nachgezogen.
- **Inhalte auf Stand 0.10.x gebracht:** `docs/API.md`, `docs/INSTALL.md`,
  `docs/ANALYSE.md`, `docs/ARCHITEKTUR.md`, `docs/LUECKEN.md`, `README.md`,
  `TODO.md`.
