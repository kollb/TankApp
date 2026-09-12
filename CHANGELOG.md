# Changelog

Alle nennenswerten Änderungen ab jetzt. Format lose an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) angelehnt;
Version folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.14.0] – 2026-09-12

Heatmap-Ehrlichkeit — der erste P0 aus echtem Tracking-Betrieb. Gemeldet war
„Typisch am günstigsten: Di 06–08 Uhr — 100 % Chance günstig. Wie kann es sein?
06–08 taucht da gar nicht auf“ plus die Frage „Zahlen verlorengegangen? Seit
Dienstag wird getrackt“. Beides gegen den Code geprüft: Die Zahlen waren nicht
weg (das Fenster ist 6 Wochen, der Bestand 4 Tage), aber die Heatmap hat es
nicht gesagt — und die „günstigste Stunde“ war tatsächlich nicht
wiederzufinden. Drei Ursachen, drei Korrekturen: Label-Semantik, Gleichstand,
Stichprobe der Vergleichs-Basis.

### Behoben

- **P0 — „günstigste Stunde“ im Raster nicht wiederfindbar**: Eine
  Heatmap-Spalte ist genau **eine** Stunde (06 = 06:00–06:59 Uhr), das Label
  nannte aber ein Zweistundenfenster (`blockLabel` → „06–08 Uhr“). Gesucht
  wurden die Spalten 06/07/08, gemeint war Spalte 06; im Niveau-Modus
  („17–19 Uhr“) lag die dritte Stunde sogar auf „·“ (zu wenig Daten), das
  genannte Fenster existierte also stellenweise gar nicht. Neu: `hourBucketLabel`
  nennt den Kasten „06–07 Uhr“, die Erklärzeile sagt zusätzlich, dass eine
  Spalte eine Stunde ist.
- **P0 — Gleichstand wurde verschwiegen**: Lagen zwölf Zellen gleichauf
  (Di 06–17 Uhr je 100 %), nannte der Fazit-Satz die Stunde, die die Schleife
  zufällig zuerst als besser sah — „06–08 Uhr“ war damit willkürlich. Neu
  werden alle gleichauf liegenden Stunden gesammelt, zu Bereichen gebündelt
  (`hourRunsOf`/`hourRunsLabel`) und genannt: „Di 06–18 Uhr — 100 % der Preise
  unter dem Median derselben Stunde, 12 Stunden gleichauf“. Lange Aufzählungen
  kürzen für die schmale Tabellenspalte („06–07 und 12–13 Uhr (+2 weitere)“),
  die volle Liste steht im `title`. Gleichstand ist der Normalfall, nicht die
  Ausnahme: Gerundet wird serverseitig auf 0,1 % bzw. 0,001 €/L, die
  Toleranz (`HEATMAP_TIE_EPS`) folgt dem.
- **P0 — „100 % günstig“ aus dünner Vergleichs-Basis**: Vier Tage Bestand
  reichten für 100 % über zwölf Stunden, weil der Stunden-Median selbst nur 16
  Preise trug (Di 8 günstige, Mi–Sa je 2 teurere) — jeder Dienstagspreis lag
  unter einer Referenz, die kaum Daten hatte. Die Zelle war formal belastbar
  (n = 9 ≥ 8), die **Referenz** war es nicht. `build_heatmap` liefert deshalb
  `reference_counts` (Stichprobe der Vergleichs-Basis je Zelle: mit Station der
  Stadtmedian derselben Zelle, bei `basis=hour` der Spalten-Median, bei
  `basis=overall` der Gesamtmedian; `null` für `kind=level`, das keine Basis
  hat). Die GUI kennzeichnet solche Stunden als „dünn“ und nimmt die Empfehlung
  zurück: statt „Typisch am günstigsten“ steht „Noch keine belastbare
  ‚günstigste Stunde‘ … Vergleichs-Basis n=16, Mindestmaß 30 — Mechanik, keine
  Empfehlung“. Der Zellwert bleibt unverändert sichtbar, nur die Deutung wird
  ehrlich. Schwelle `MIN_HEATMAP_REFERENCE = 30` — im Dauerbetrieb (6 Wochen ×
  5-Minuten-Takt × 18 Stationen) mühelos erfüllt, sie beißt nur in der
  Anlaufphase. Fehlt das Feld (alte API, `kind=level`), gilt die Basis als
  unbekannt, nicht als dünn.
- **`points`/`stations` zählten zu viel**: Beide nannten alle gelieferten
  Punkte, auch geschlossene Meldungen und Preise `null`/`NaN`, die in keine
  Zelle flossen. Gezählt werden jetzt nur die Preise, die wirklich verwendet
  wurden — dieselbe Zahl, die auch `range_from`/`range_to` begrenzen.

### Hinzugefügt

- **Datenreichweite im Heatmap-Panel** (P0, Teil von C6 „Reichweite der Daten
  je Panel“): `range_from`/`range_to` im Payload (ISO-8601 UTC, echte Grenzen
  der verwendeten Preise) und darunter die Zeile „Datenreichweite: 12.345
  Preise von 18 Stationen · Di 08.09. 05:10 – Sa 12.09. 07:55 Uhr“. Ist das
  Fenster größer als der Bestand, folgt amber der Grund für leere Zeilen:
  „Fenster 42 Tage (6 Wochen), Bestand aber nur 5 Tage — Di 08.09. 05:10 –
  Sa 12.09. 07:55 Uhr. Wochentage, die in dieser Zeit nicht vorkamen, bleiben
  leer: Das sind fehlende Tage, kein Datenverlust.“ Ohne `range_*` (alte API)
  bleibt die Zeile weg, statt ein Datum zu raten.
- **C9-Teil — Formatter-Satz in `web/src/data.ts`** mit vitest-Schutz:
  `euroPerLiter` (€/L, 3 Stellen), `centPerLiter` (ct/L, 1 Stelle),
  `euroToCentPerLiter`, `percentLabel`, `countLabel` (Tausenderpunkt),
  `hourRangeLabel` („18–20 Uhr“) und die Heatmap-Helfer `hourBucketLabel`,
  `hourRunsOf`, `hourRunsLabel`. Die Heatmap ist als erstes Panel umgestellt:
  „2,219 €/L“ statt „2.219“ (der Punkt las sich als Tausender-Trennzeichen) und
  „100 %“ statt „100%“. Die übrigen Panels folgen panelweise (C9-Rest).
- **Heatmap-Logik als reine Funktionen** (D1-Muster): `heatmapDaySummaries`,
  `heatmapBestDay`, `heatmapCellOk`, `heatmapCellCount`, `heatmapReferenceCount`,
  `heatmapCoverage`, `heatmapCoverageNote`, `heatmapRangeLabel`,
  `heatmapSampleLabel` liegen in `data.ts`, `HeatmapGrid.tsx` rendert nur noch.
- **Render-Tests der Heatmap** (`web/src/components/HeatmapGrid.test.tsx`,
  `react-dom/server`): Der gemeldete Befund ist als Fixture nachgebaut (Di
  06–17 Uhr 100 %, dünne Basis, Bestand seit Dienstag) und prüft das echte
  Markup — „06–08 Uhr“ darf nicht mehr vorkommen, „06–18 Uhr“,
  „12 Stunden gleichauf“, „n=16“, „dünn“ und „kein Datenverlust“ müssen. Dazu
  `tests/test_b3.py::test_heatmap_reports_reach_and_reference_sample` für
  Reichweite, Referenz-Zähler und die drei Basen (inkl. HTTP-Pfad).

### Geändert

- **Fazit-Satz trennt Stundenwert und Tagesmedian**: Vorher stand beim Niveau
  „Di 17–19 Uhr — Median 2.219 €/L“ direkt unter einer Zeile, deren
  Median-Spalte 2.239 zeigte — zwei „Mediane“ ohne Unterschied. Neu: „Di
  17–18 Uhr — 2,219 €/L in dieser Stunde (Tagesmedian 2,239 €/L)“.
- **Tabellen-`title` erklären statt raten lassen**: Stundenkopf („06–07 Uhr“),
  Median-Spalte (was hier der Median von was ist), Tagesname (n belastbare von
  24 Stunden) und die günstigste Stunde (Gleichstand, kleinste
  Zellen-Stichprobe, Vergleichs-Basis) haben Tooltips; die Zellen-Tooltips
  nutzen dieselben Formatter wie der sichtbare Text.

## [0.13.0] – 2026-09-12

Kalibrierte Quick-Wins-Runde: der letzte P0 (Feedback-Store-Versionierung),
die Schreib-Härtung, der messbare Teil der HTTP-Effizienz, der echte
A11y-Rest und der erste Dashboard-Schnitt. Alle Befunde vorher gegen den
Code geprüft — der 0.11-Kandidat „Fokus-Ring: zwei CSS-Zeilen" stellte sich
als erledigt heraus; die echte Lücke war die `outline-none`-Überschreibung.

### Hinzugefügt

- **B2 — Schema-Version & Migration des Feedback-Stores** (P0):
  `runtime/feedback/store.json` trägt `schema_version`; Altbestände ohne
  Feld gelten als Version 1 und werden beim Laden migriert (je Sprung eine
  Funktion in `app/feedback.py::_STORE_MIGRATIONS`), gespeichert wird die
  migrierte Fassung beim nächsten Schreibvorgang. Damit brechen künftige
  Feldsprunge (Storno, `tanked_at`, `price_source` …) Altbestände nicht mehr
  still. Ein Store aus einer *neueren* Version wird mit
  `StoreSchemaTooNew` (503-Familie) abgelehnt, statt ihn still zu
  überschreiben. Tests inkl. „alter 0.10-Store → neuer Code“;
  Doku-Absatz in [docs/BETRIEB.md](docs/BETRIEB.md#schema-version-des-feedback-stores-b2).
- **A6 — Share-URL**: `?city=…&fuel=…&station_id=…&liters=…&weeks=…&basis=…`
  wird beim Start in die Ansicht übernommen (einmalig, vor den
  localStorage-Preferences) — nötig spätestens seit `heatmapWeeks`/
  `heatmapBasis` echte Preferences sind, sonst restoren geteilte Ansichten
  falsch. Neu: Teilen-Knopf im Header — schreibt die aktuelle Sicht per
  `replaceState` in die Adresszeile und kopiert den Link (mit Fallback-Hinweis,
  wenn der Browser keine Zwischenablage erlaubt). Parameter-Reader und
  Builder sind reine Funktionen (`readShareParams`/`shareQuery`), ungetestete
  oder feindliche Parameter fallen still auf die Defaults zurück.
- **B5 — Schreib-Härtung**: `tanked_at` (optional, ISO-8601) wird jetzt auf
  ein Plausibilitätsfenster geprüft (≤ 90 Tage zurück = Retention, ≤ 15 min
  Zukunft = Uhrversatz), sonst `400 invalid_tanked_at` — vorher wurde jede
  Angabe ungeprüft gespeichert (1970/2100 inklusive). Freitext-Caps:
  `station_name` 120, `source` 40 Zeichen. Dazu ein **getrenntes
  Schreib-Budget** (20/min je Client-IP, rollende Minute) ausschließlich für
  die Ledger-Endpunkte (`POST /fills`, `POST …/intent` + `outcome`-Alias,
  `DELETE /fills/{id}`) mit `429 write_rate_limited` + `Retry-After: 60`;
  Lesen bleibt uneingeschränkt (0.12.0-Beschluss), Heartbeat/Knopf/Webhook
  zählen nicht mit.
- **B7 (Teil) — HTTP-Effizienz**: JSON-Antworten ab 512 Byte werden mit
  `Content-Encoding: gzip` ausgeliefert (immer `Vary: Accept-Encoding`); die
  semi-statischen Endpunkte `heatmap` und `last_forecasts` antworten mit
  `Cache-Control: public, max-age=900` — Fehler und alles Live-Pollbare
  bleiben `no-store`. Overview-Endpunkt und Poll-Bündelung bleiben offen
  (B7-Rest).

### Geändert

- **C5 (Rest)** — die A11y-Lüge aus 0.11 geschlossen: Die
  `outline-none`-Klassen (die den globalen `:focus-visible`-Ring an genau
  den Feldern überschrieben, die 0.11 angefasst hat) sind entfernt — der
  Ring gilt jetzt durchgängig. Alle Diagramme (`LineChart`, `LabLineChart`,
  `HistogramBars`, `DeltaBars`, `CalibChart`) sind `role="img"` **mit**
  `aria-describedby`-Textfassung (`<desc>` + optionales
  `ariaDescription`-Prop mit echten Inhaltsbeschreibungen je Einsatzort).
- **D1 (erster Schnitt)** — `PrecisionSlider`, `HeatmapGrid` und
  `ApiExplorer` sind aus `Dashboard.tsx` nach `web/src/components/`
  ausgelagert (−~420 Zeilen); der View-Schnitt bleibt offen (TODO D1).

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
