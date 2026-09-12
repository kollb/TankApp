# Changelog

Alle nennenswerten Änderungen ab jetzt. Format lose an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) angelehnt;
Version folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.22.0] – 2026-09-12

**B17** (Batch 3 des Laufzeit-Bündels): der 21-Tage-Backtest wird je lokalem
Endtag gecacht statt je Lauf gerechnet. Untertägige Läufe überspringen damit
21 Folds × (1 Fit + 3 Prognosen) je Station — im Sandkasten 86 % der CPU-Zeit
eines Laufs.

### Hinzugefügt

- **B17 — Tages-Cache des Backtests** (`app/backtest_cache.py`). Schlüssel:
  Stations-Identität, lokaler Endtag (exklusiv), Testtage. Fingerabdruck:
  vollständige Engine-Config (`Config.to_dict()`), Inhalts-Hash der
  **gesamten** Preisreihe bis zum Endtag (alle Spalten + Index über
  `pd.util.hash_pandas_object`), Schema-Versionen von Engine und Cache sowie
  numpy/pandas-Version. Jede Änderung in der Vergangenheit — Archiv-Nachholung,
  Lückenfüllung, Hampel-Ergebnis, Status-Korrektur — kippt den Fingerabdruck
  und rechnet neu; neue Stundendaten am selben Tag treffen. Eine JSON-Datei
  je Station unter `runtime/engine/backtest-cache/`, atomar geschrieben,
  Schreibfehler kippen den Lauf nicht. `TANKAPP_BACKTEST_CACHE=0` schaltet
  den Cache aus (Gegenprobe).
- **Ehrlicher Ausweis:** jede Prognose in `current.json` trägt
  `backtest_cached` (bool) und `backtest_computed_at` (UTC, ISO) — das Alter
  des Berichts wird genannt, nicht verschwiegen. Job-Log und Fortschritt
  melden je Kraftstoff „Backtest: n aus Tages-Cache, m neu gerechnet“.
- **Tests** (`tests/test_backtest_cache.py`, `tests/test_app_jobs.py`):
  „gleicher Tag, +4 h/+10 h Stundendaten → byteidentischer Bericht“,
  „0,1 ct-Änderung zehn Tage zurück → neuer Fingerabdruck“, „Archiv-
  Nachholung → neuer Bericht, danach wieder Treffer“, „Treffer = dieselben
  Zahlen wie die Rechnung“, „zweiter `refresh` am selben Tag ruft
  `run_backtest` nicht“, kaputte Cache-Datei wird ignoriert, Abschaltung.

### Geändert

- **`engine/backtest.py::run_backtest` schneidet hart am Testende ab**
  (`strict_end`, Default an, wenn das Ende aus den Daten bestimmt wird).
  Befund bei der Vorbereitung: die Kernaussage aus der To-Do („eine Stunde
  mehr Live-Daten ändert den Bericht nicht“) galt für Kennzahlen,
  Vergleichszeilen und Fold-Origine — **nicht** für die Mehrtage-Horizonte:
  die +3-d/+7-d-Fenster der letzten Folds wurden gegen den *laufenden*,
  angebrochenen Tag bewertet (`horizons.72h.metrics.points` 912 um 10 Uhr,
  1032 um 20 Uhr), obwohl `test_end_exclusive` Mitternacht nannte. Jetzt
  wird die Reihe vor dem Backtest auf `< end` zugeschnitten, Fenster hinter
  dem Ende zählen als neues Feld `days_beyond_test_end` (Bericht, Markdown)
  statt bewertet zu werden. Die 24-h-Kennzahlen, Entscheidungszeilen und
  Rolling-PICP sind davon nicht betroffen (bitgleich). Mit explizitem
  `--until` (CLI, bekannte Zukunft) bleibt das alte Verhalten
  (`strict_end=False`).
- **Backtest-Task ohne toten Fit** (B20 Punkt 1): `app/model_jobs.py::_run`
  fittete vor jedem Backtest zusätzlich das Cutoff-Modell, das dann verworfen
  wurde. Das Modell kommt aus der Phase-A-Aufgabe.
- `Settings.backtest_cache` (Env `TANKAPP_BACKTEST_CACHE`, Default an);
  `run_tasks(..., cache_dir=None)` — ohne Verzeichnis wird immer gerechnet.

### Gemessen

Sandkasten, eine Station, 7 Testtage, `bootstrap_samples=100`: Backtest-Task
frisch 2,3 s, aus dem Cache < 10 ms (Fingerabdruck über 120 Tage Raster
≈ 5 ms). Auf dem NAS entfällt untertägig der Anteil `backtest21` von
Phase B; die NAS-Laufdauer vorher/nachher aus der `beendet: … Dauer`-Zeile
des Job-Logs steht — wie für 0.20.0 — noch aus. Erwartung laut To-Do:
Phase B untertägig ~1 min (nur `wide72`/`wide168`), der erste Lauf nach
Mitternacht rechnet wie bisher.

## [0.21.0] – 2026-09-12

**B18 + B24** (Batch 2 des Laufzeit-Bündels): Betrieb statt Rechnen — der NAS
wiederholt strukturell aussichtslose Läufe nicht mehr stündlich, und hart
beendete Läufe bleiben nicht mehr als „Läuft …“ hängen.

### Hinzugefügt

- **B18 — dauerhafte von flüchtigen Fehlern getrennt.** Strukturelle
  Fehlercodes (`some_models_unavailable`, `insufficient_history`,
  `archive_not_configured`, `influx_not_configured`, `selection_not_available`)
  setzen den nächsten Versuch jetzt auf das reguläre Intervall des Jobs
  (`models`: 1×/Tag statt stündlich) — `app/worker.py::is_transient_error`
  entscheidet, `Scheduler.next_delay` und der Retry in `finish()` folgen
  derselben Regel. Flüchtige Fehler behalten den schnellen
  Wiederholungsversuch (3600 s). Eigener Fehlercode je Station verhindert,
  dass eine unfitbare Station 24 erfolglose Läufe pro Tag auslöst.
- **B24 — Abbruch statt ewigem `running`.** Ein SIGTERM-Handler im
  Job-Prozess schreibt den Zustand als `state: aborted` samt `aborted_at`,
  `aborted_phase` (letzte protokollierte Phase) und `error_code: aborted`;
  ein liegengebliebener `running`-Vorgänger (Container-Recreate, SIGKILL)
  wird beim nächsten Start als abgebrochen verbucht
  (`_mark_prior_aborted`). `nas-up` warnt, solange ein Modell-Lauf aktiv ist,
  bevor `docker compose config`/Recreate den Job kippen.
- **Sichtbarkeit:** `public_job` exportiert `aborted_at`/`aborted_phase`;
  die Job-Karte zeigt „Abgebrochen“ mit Zeit und Phase; neue Warn-Alarme
  `job_partial` (bei `partial`) und `job_aborted` (bei `aborted`) in
  `/health`; Klartext `messages["aborted"]` im GUI.

### Gemessen

Keine Rechenzeit-Relevanz — B18/B24 ändern nur die Wiederholungs- und
Abbruch-Semantik der Job-Verwaltung, nicht die Modellrechnung. Die
NAS-Laufdauer vorher/nachher für 0.20.0 steht weiterhin aus (siehe dort).

## [0.20.0] – 2026-09-12

**B15 + B16** (Batch 1 des Laufzeit-Bündels aus der To-Do): die beiden
**bitgleichen** Hebel sind umgesetzt. Die 12-Uhr-Projektion dedupliziert
Bootstrap-Pfade je Segment (B15), und `fit()` ist von String-, Aggregator-
und Schleifen-Overhead befreit (B16 a–e). Publizierte Zahlen bleiben exakt
identisch — je ein Bitgleichheits-Test hält das fest. Die
Huber-Normalgleichungen aus B16 (nicht bitgleich, Δ ≤ 3,4e-12) bleiben
weiterhin **aus**.

### Hinzugefügt

- **B15 — Bootstrap-Pfade vor der 12-Uhr-Projektion dedupliziert.**
  `engine/models.py::project_paths` ersetzt die skalare Projektion jedes
  einzelnen Pfads. Innerhalb eines Segments [12:00, nächste 12:00) hängt der
  projizierte Pfad nur von den gezogenen Tagesblöcken ab — bei `n` Blöcken
  gibt es je Segment höchstens `n²` verschiedene Zeilen (bei
  Mitternachts-Origin genau `n`) statt `bootstrap_samples` Vollpfaden.
  Eindeutige Zeilen werden über `np.unique(…, axis=0, return_inverse=True)`
  einmal projiziert und per `inverse` zurückgeschrieben. NaN wird dabei als
  Stellvertreter kodiert, damit Zeilen mit identischem NaN-Muster (gleiche
  Ziehung) tatsächlich zusammenfallen — `NaN != NaN` würde die
  Deduplizierung sonst für Segmente mit Nacht-/Schließzeiten ins Leere
  laufen lassen.
- **B16 — `fit()` von String- und Aggregator-Overhead befreit (a–e, bitgleich).**
  (a)+(c) Residuen-Tagesblöcke als direkte (Tag, Slot)-Index-Zuweisung
  (`_residual_blocks`) statt `pivot_table(aggfunc="median")`, Tagesschlüssel
  über `pd.factorize` statt `strftime`; (b) Feiertagsmaske über sortierte
  int64-Tageswerte + `searchsorted` statt Timestamp-Iteration
  (`engine/holidays.py`); (d) Naiv-Profil über stabilen Sortierindex +
  `searchsorted` statt `groupby(…).agg(lambda g: g.iloc[-1])`
  (`_naive_profile`); (e) Zähler `law_rise_outside_noon` vektorisiert.
- **Bitgleichheits-Tests** in `tests/test_models.py`: `project_paths` gegen
  die skalare Referenz-Projektion, `_residual_blocks` gegen `pivot_table`,
  `_naive_profile` gegen `groupby`, `holiday_flags` gegen Set-Mitgliedschaft.

### Gemessen

Sandkasten-Gegenmessung (eine synthetische Station, Default-Config, ein Kern):
`predict` 24 h **0,13 s** / 72 h **1,03 s** / 168 h **2,81 s**, `fit`
**53 ms**, `run_backtest(21 d)` **6,7 s**. Zum Vergleich die Befund-Werte
*vor* B15/B16 (anderer Messaufbau): `predict` 24 h 0,41 s / 72 h 0,98 s /
168 h 2,18 s, `fit` 219 ms, `run_backtest(21 d)` 24,3 s. Absolute Zeiten
sind zwischen den Maschinen nicht übertragbar, Verhältnisse schon.

> **NAS-Messung steht noch aus.** Die Batch-Regel verlangt die
> vorher/nachher-Laufdauer aus der `beendet: … Dauer X min`-Zeile des
> Job-Logs auf der Zielhardware — die kann erst nach dem Deploy ergänzt
> werden. Erwartung aus dem Befund: Phase B 9,4 min → ~1,8 min, Gesamtlauf
> 10,3 min → ~2,3 min.

## [0.19.0] – 2026-09-12

B7 und D1: Der **Refresh ist nicht mehr tot** — der Alltagstabs holt seine
Daten jetzt in **einer** Anfrage aus `/api/v1/overview`, die Ansicht bleibt
während des Ladens bedienbar, und ein Refresh mit unverändertem Datenstand
revalidiert per ETag (304) statt die Antwort 5–10 s neu zu berechnen.
Daneben: D1 (zweiter `Dashboard`-Schnitt in Views), C9 (Formatierungs-Rest)
und der Fehlerbanner ohne Fehlalarm.

### Hinzugefügt

- **B7 — `GET /api/v1/overview` (Poll-Bündelung für den Alltag).**
  `DataApi.overview()` (app/data.py) liefert das, was die GUI für den
  Alltagstab sonst in sechs Parallel-Polls holte — `decide`, `fills`,
  `stats/summary`, die due-Episoden und die Tageskurve — in **einer** Antwort.
  Die Bausteine sind dieselben wie die Einzelpfade; die Antworten behalten
  exakt ihre Einzel-Form (keine neue Semantik, nur gebündelt), deshalb müssen
  die Panels keinen zweiten Datenpfad lernen.
  - `DataApi.overview()` ruft `decide`, `fills`, `stats_summary` und
    `episodes("due")` direkt auf und hängt die 24-h-Tageskurve
    (`series`) an, wenn die gewählte `station_id` in `metadata()` bekannt
    ist. Eine **unbekannte** Station (z. B. nach Stations-Tausch) entlädt nur
    die Tageskurve — `decide` wählt selbst, der Rest des Alltags bleibt
    funktionsfähig (keine `404` für den ganzen Tab).
  - `GET /api/v1/overview` (app/server.py): derselbe Status-Vertrag wie die
    Einzelrouten (inkl. `400 invalid_fuel`); `?city=&fuel=&station_id=&…`
    werden wie bei `decide` weitergereicht.
- **B7 — GUI bleibt während des Refresh bedienbar.** `useResource` bricht ein
  laufendes Laden **nie** ab: ein neuer Trigger (Refresh-Knopf, Tab-Wechsel,
  Buchungs-Aktion) **reih ein Reload ein** (`queuedReloadRef`), das nach dem
  laufenden läuft. Auf der NAS, wo ein Refresh 5–10 s dauert, würde das alte
  Abbrechen-jeden-Klick-Verhalten jede Anfrage umwerfen — die Ansicht kam nie
  an. Ein URL-Wechsel setzt Daten und Fehlerzählung der Ressource zurück
  (`failStreak`, `receivedAt`), damit ein Tab-Wechsel nicht den Fehlerzustand
  der alten URL mitnimmt.
- **B7 — Fehlerbanner ohne Fehlalarm** (`resourceErrorVisible`, C6-Teil).
  Ein **einzelner** fehlgeschlagener Poll, während bereits Daten angezeigt
  werden, ist eine kurze Unterbrechung — kein Ausfall: Die Zahlen bleiben
  stehen, erst der **zweite aufeinanderfolgende** Fehlversuch zeigt den
  Fehler. Ohne anzeigbare Daten bleibt der erste Fehlversuch sichtbar (sonst
  gäbe es gar nichts zu sehen). Damit verschwindet der Banner zwischen
  einzelnen lahmen Polls wieder — das war der Ursprung des „Nervig“-Berichts.
- **B7 — Refresh revalidiert statt neu zu laden (ETag/304).** Der
  Token-Bucket lässt maximal 1 Preis-Poll pro 300 s zu — die meisten
  Refreshes rechnen also dieselbe Antwort aus denselben Daten neu. Deshalb:
  - `data_version()` in `app/data.py`: billiges Datenstands-Signal aus
    reinen Datei-Stats (Collector-Heartbeat, Engine-/Selektions-Artefakte,
    Feedback-Store, Polling-Set) — keine InfluxDB-Queries. Dazu ein
    60-s-Uhrzeit-Fenster, weil das „due“-Status der Episoden und
    Fenster-/Stundenlogik in `decide` von der Uhr abhängen (uhrzeitabhängiger
    Inhalt ist damit höchstens 60 s alt — die Fenster-Slacks laufen in
    Minuten).
  - `GET /api/v1/overview` antwortet mit `ETag` und `304 Not Modified`
    (kein Body, kein Compute) auf `If-None-Match` bei unverändertem
    Datenstand; zusätzlich ein Antwort-Cache je (Datenstand, Parameter) für
    Anfragen ohne If-None-Match (zweites Gerät, Page-Reload).
  - `useResource` schickt das letzte ETag mit und behält bei 304 die
    Anzeige (Fehlerzähler zurückgesetzt, Stand als frisch bestätigt).
  - Effekt: Ein Refresh kostet fast immer Millisekunden; die eine teure
    Neuberechnung nach einer echten Datenänderung spürt man dank
    No-Abort/Alt-Daten sichtbar nicht mehr als Freeze.
- **D1 — Views-Schnitt (zweiter `Dashboard`-Schnitt).** Die drei Tabs werden
  aus `Dashboard.tsx` in eigene Dateien ausgelagert:
  `web/src/views/Daily.tsx`, `views/Statistics.tsx`, `views/System.tsx`. Der
  gemeinsame Zustand (`~100` `useState`/`useResource`) **bleibt** in
  `Dashboard` und wandert per **typisierten Props** in die Views (die
  D1-Entscheidung: Props statt Context — greifbarer Datenfluss, keine zweite
  Quelle). `Dashboard.tsx` schrumpft von ~4 700 auf ~1 600 Zeilen.
- **D1 — `JobCard` ausgelagert** (`web/src/components/JobCard.tsx`): die
  Job-Karte des System-Tabs (Startknopf + Status + Job-Log-Zeilen) ist jetzt
  ein eigener Baustein mit eigenen Imports; der System-Tab rendert sie.
- **C9 — Formatierungs-Rest (ct/L vs. €/L inhaltlich).** Die übrigen
  ct/L- und €/L-Anzeigen sind inhaltlich konsistent je Panel (Cent dort, wo
  Cent die richtige Größe ist, € sonst), alle Uhrzeiten sind auf
  Europe/Berlin geprüft und die Anführungszeichen laufen über den F3-Ratchet
  (`microcopy.test.ts`) — `„…“`, UTF-8, keine HTML-Entities.

### Geblieben wie vorher

- Die **Einzelpfade** (`/decide`, `/fills`, `/stats/summary`, `/episodes`,
  `/series`) sind unverändert; `/overview` bündelt nur, es ersetzt nichts.
  Die übrigen Tabs (Werkstatt, System) und die C11-Reichweiten-Felder sind
  von der Bündelung nicht betroffen.
- `route/evaluate` bleibt ein eigener Poll (nur im Alltag, nur bei
  Alternativ-Station) — ob sich auch er bündeln lohnt, ist der als „bewusst
  offen“ markierte Rest von B7.

### Tests

- Backend: acht Fälle in `tests/test_app.py` (vier zum Bundling: `overview`
  bündelt wie die Einzelpfade, unbekannte Station entlädt nur `day`,
  ungültiger Kraftstoff → `invalid_fuel` wie die Einzelrouten, HTTP-Status
  wie die Einzelroute; vier zur Revalidierung: ETag + 304 ohne Body bei
  gleichem Datenstand, Neuberechnung bei geänderter Datenversion
  (Heartbeat), Antwort-Cache spart die zweite Rechnung, ETag hängt an den
  Parametern + If-None-Match-Parser).
- Frontend: `web/src/data-resource.test.tsx` prüft die neue
  `failStreak`/`resourceErrorVisible`-Logik (einzelner Poll-Fehler bleibt
  unsichtbar, zweiter zeigt; ohne Daten zeigt der erste), dass ein
  URL-Wechsel den Fehlerzustand zurücksetzt, und das ETag/304-Protokoll
  end-zu-end (If-None-Match mitgeben, Daten bei 304 behalten, neuen ETag
  annehmen). Die Ratchet-Dateilisten (`format-convention.test.ts`,
  `microcopy.test.ts`) umfassen jetzt `views/*` und `components/JobCard.tsx`.
- Neue Test-Abhängigkeit: `happy-dom` (dev-only, für den Effekt-Test des
  304-Protokolls — Vitest läuft sonst in der Node-Umgebung ohne DOM).

## [0.18.0] – 2026-09-12

C11 und damit C6 komplett: Die drei verbliebenen Panels sagen jetzt ebenfalls,
**worauf** sie beruhen. Die Rechnungen selbst sind unverändert.

### Hinzugefügt

- **C11 — Datenreichweite in Preisverlauf, Modell-Ausblick und Ranking.** Die
  Heatmap nennt seit 0.14.0 Bestand und Zeitraum; die übrigen Panels konnten das
  nicht, weil die Endpunkte keinen Bestandsumfang zurückgaben. Eine
  24-Stunden-Achse aus vier Punkten sah damit genauso solide aus wie eine aus
  288, und „Rang 1“ aus zehn Tagen genauso belastbar wie „Rang 1“ aus drei
  Monaten.
  - `/api/v1/series`: `range_from`/`range_to`/`n_points`. Gezählt werden nur
    Punkte **mit** Preis — eine geschlossene Meldung ist eine Beobachtung, aber
    kein Preis-Bestand, und sie verlängert die Reichweite nicht.
  - `/api/v1/forecast`: `range_from`/`range_to`/`n_points`/`n_days` als
    Reichweite des **Fits**. Die Werte kannte das Modell längst
    (`training_start`, `last_observation`, `training_points`, `training_days`),
    sie standen bisher nur im Modell-Artefakt; `app/refresh.py` publiziert sie
    jetzt mit der Prognose.
  - `/api/v1/selection`: dieselben vier Felder je Kraftstoff, neu berechnet in
    `engine/selection.py` (je Stadt aus der Preis-Matrix, darüber aggregiert:
    frühester Anfang, spätestes Ende, Summe der Beobachtungen).
  - Frontend: `dataReachLabel()` in `web/src/data.ts` und
    `web/src/components/DataReach.tsx` — gleiche Beschriftung, gleiche
    Reihenfolge und gleiche Berliner Zeitangabe wie in der Heatmap.

### Ehrlich geblieben

- Gibt ein Payload keine Reichweite her — Altbestand ohne die Felder, leeres
  Ergebnis —, liefern Backend und Komponente `null` bzw. gar nichts. Keine
  geschätzte Spanne, keine aus dem angefragten Fenster abgeleitete Zahl.
- Die neuen Felder ändern keine Prognose, kein Ranking und keine Empfehlung.

### Tests

- Backend: drei Fälle in `tests/test_app.py` (Reichweite ≠ Fenster, nur
  geschlossene Meldungen, Fit-Reichweite inkl. Altbestand-`None`), einer in
  `tests/test_b3.py` (Ranking-Reichweite + Altformat).
- Frontend: vier Fälle in `web/src/components/states.test.tsx`; beide
  Ratchet-Dateilisten um `components/DataReach.tsx` erweitert.

## [0.17.0] – 2026-09-12

C6 zu Ende gebracht: Die Panels haben jetzt **eine** Sprache für alle vier
Zustände — lädt, leer, veraltet, kaputt. Reine GUI-Arbeit, keine Änderung an
Endpunkten oder Rechnungen.

### Hinzugefügt

- **C6 (Rest) — Skeletons statt Spinner/Text-Mix** (`web/src/components/Skeleton.tsx`):
  `SkeletonPanel`, `SkeletonChart`, `SkeletonRows` und `SkeletonLine` halten
  beim **ersten** Laden den Platz, den der Inhalt gleich braucht — vorher wuchs
  die Seite unter dem Finger weg. Verdrahtet in Empfehlung, Tagesverlauf,
  Umweg-Ökonomie, Preisverlauf, Modell-Ausblick, Heatmap, Ranking und im
  Entscheidungs-Scoreboard. Bewusst **nur** beim ersten Laden: Ein
  Aktualisierungs-Poll über vorhandenen Daten nimmt die Zahlen nicht weg, sonst
  flackert die Ansicht im Takt. Jedes Skelett meldet sich als
  `role="status"` + `aria-busy` mit einem Satz für Screenreader; die
  `animate-pulse`-Animation entschärft `prefers-reduced-motion` bereits global.
- **C6 (Rest) — „Datenstand älter als X“-Banner** (`web/src/components/DataAge.tsx`,
  Logik in `data.ts`): `STALE_AFTER_MINUTES` legt die Schwellen je Datenart
  fest (Preise 30 min, Modell 180 min, Selektion 36 h), `freshness` stuft
  frisch/veraltet/alt (alt = doppelte Schwelle), `ageLabel` schreibt das Alter
  aus („vor 45 Minuten“, „vor 2 Tagen“), `dataAgeNote` liefert den fertigen
  Satz mit Folge statt Schuldzuweisung. Der Banner steht über dem Tab-Inhalt
  (Preise) sowie an Modell-Ausblick, Heatmap und Ranking — und erscheint
  **nur**, wenn der Stand wirklich kippt: kein „alles in Ordnung“-Lärm, und
  bei unbekanntem Stand wird nichts behauptet (Ehrlichkeits-Regel §0.4).
- **C6 (Rest) — Fehler-Zustände in Tabellen** (`web/src/components/CellError.tsx`):
  `LoadError` ist eine Karte und in einer Tabellenzelle falsch; genau dort
  standen die letzten selbstgebauten Texte. `CellError` bringt dieselbe Sprache
  als Tabellenzeile über die volle Breite — Klartext aus `problem(error_code)`,
  Rohcode darunter, derselbe „Erneut laden“-Knopf — und trennt sauber
  „noch nichts da“ (kein Alarm-Ton, kein Knopf) von „Abruf fehlgeschlagen“.
  Verdrahtet im Entscheidungs-Scoreboard und bei den Tages-Entscheidungen.

### Tests

- `web/src/data-age.test.ts`: Schwellen je Datenart, Rundung der Wortform,
  Uhren-Versatz (Stand „aus der Zukunft“ ergibt kein negatives Alter),
  kaputte/fehlende Zeitstempel führen zu **keinem** Banner.
- `web/src/components/states.test.tsx`: Render-Tests gegen echtes Markup —
  `aria-busy`, Zeilen-/Spaltenzahl der Skelette, Schweigen des Banners bei
  frischen Daten, Ton-Wechsel bei doppelter Schwelle, Leerstand vs. Fehler
  in `CellError`.
- Die neuen Dateien sind in die beiden Ratchets aufgenommen
  (`format-convention.test.ts`: toFixed-frei; `microcopy.test.ts`: paarige
  Anführungszeichen).

## [0.16.0] – 2026-09-12

Aufräum-Runde aus der ToDo-Liste: die drei Punkte, die **ohne Live-Daten, ohne
Zielhardware und ohne Produktentscheidung** wirklich abschließbar waren —
Zustellung im System-Tab sichtbar (B4-Rest), Selektions-Daten raus aus dem
Doku-Ordner (B14), Microcopy-Regelwerk als eine Seite mit Ratchet-Test
(F3-Rest). Keine Logikänderung an bestehenden Rechnungen, kein neuer Endpunkt.

### Hinzugefügt

- **B4 (Rest) — Alarm-Zustellung im System-Tab sichtbar.** Die Daten lagen seit
  0.15.0 in `/api/v1/health` → `notify`, waren aber nur per API-Abruf lesbar.
  Neu: eine Kachel „Alarm-Zustellung · Push aufs Handy“ zwischen
  Collector-Status und API-Explorer mit Badge („Nicht eingerichtet“ /
  „Eingerichtet“ / „Fehler gemeldet“), Klartextsatz, den offenen Error-Codes
  als Chips (Tooltip = `problem(code)`) sowie „Zuletzt gemeldet“ und „Zuletzt
  Entwarnung“ in Berliner Zeit. Ohne konfigurierten Webhook steht dort die
  Tatsache, nicht ein Fehler: „Keine Push-Zustellung eingerichtet — Alarme
  stehen nur hier in der GUI“ plus Einrichtungshinweis auf
  `TANKAPP_NTFY_URL`/[docs/BETRIEB.md](docs/BETRIEB.md). Die Texte sind reine
  Funktionen in `web/src/data.ts` (`notifyTone`, `notifyStatusLine`,
  `notifyLastLine`) und in `web/src/notify.test.ts` getestet, damit kein Panel
  eine eigene Formulierung erfindet. Serverseitig kam dafür genau ein Feld
  dazu: `notify.last_sent_at` (jüngster Zeitstempel einer zugestellten
  Fehlermeldung) — die Webhook-URL bleibt wie bisher außen vor.
- **F3 (Rest) — Microcopy-Regelwerk** [docs/MICROCOPY.md](docs/MICROCOPY.md),
  eine Seite, verlinkt aus [docs/README.md](docs/README.md), der Repo-`README`
  und [AGENTS.md](AGENTS.md): Tonfall („ehrlich, knapp, handlungsleitend“, mit
  Ja/Nein-Tabelle), Anführungszeichen und Sonderzeichen (`„…“`, `—` vs. `–`,
  `·`, `…`), Zahlen/Einheiten (**Regel: Niveaus in €/L, Differenzen in ct/L**,
  Uhrzeiten immer Europe/Berlin, Formatter statt `toFixed`), Benennungen
  (Station, Beleg, Modell-Update, Alltag/Werkstatt/System), Muster für Leer-,
  Lade- und Fehlerzustände sowie die Liste dessen, was nie im Text steht
  (erfundene Zahlen, Pfade, Tokens, Koordinaten). Dazu ein Ratchet-Test
  `web/src/microcopy.test.ts`: paarige `„…“` je Datei, kein verirrtes `”`,
  keine HTML-Entities für Anführungszeichen — und die Doku-Verlinkung selbst.

### Geändert

- **B14 — `docs/analysis/` → `data/analysis/`.** Das gitignored
  Ausgabeverzeichnis der Selektion (aktives `polling.json`, Berichte,
  Abbildungen) lag als Datenverzeichnis mitten in der Dokumentation. Neuer
  Default ist `data/analysis/` — für `app/config.py`, `tankapp.py`, alle
  CLI-Defaults in `data-tools/` (`collect_prices`, `upload_influx`,
  `export_influx`, `swap_stations`, `discover_stations`, `run_pipeline`),
  `analysis/*`, `ops/nas/preflight.sh`, die Meta-Suchpfade der RP2-Fallback-GUI
  und die gesamte Doku. **Kein stiller Umzug privater Daten:** Die neuen
  Helfer `analysis_dir`/`analysis_path`/`active_polling` in
  `data-tools/polling_plan.py` benutzen weiter den alten Pfad, solange nur
  dieser existiert, und melden das einmal je Prozess auf stderr („neuer Ort ist
  …, von Hand verschieben“); `preflight.sh` gibt dieselbe Warnung aus. Ein
  bestehender Pi läuft nach dem Update unverändert weiter. `.gitignore`
  ignoriert beide Pfade. Test: `tests/test_analysis_path.py`.

## [0.15.0] – 2026-09-12

Backlog-Runde direkt nach dem Heatmap-P0 — alles, was **ohne Live-Daten und
ohne Produktentscheidung** fertig werden konnte: Alarme kommen aufs Handy (B4),
die Umweg-Ökonomie ist property-getestet (D3), die Werkstatt spricht im
Primärtext Deutsch (F2), und alle Panels teilen sich einen Fehler-Zustand mit
einem Knopf (C6-Teil). Kein P0, keine neue Datenquelle, keine Logikänderung an
bestehenden Rechnungen.

### Hinzugefügt

- **B4 — Alarm-Zustellung über ntfy** (`app/notify.py`, neu): Wer die GUI nicht
  offen hat, bekommt Alarme mit `severity: "error"` aufs Handy — ein Webhook,
  konfiguriert über `TANKAPP_NTFY_URL` (URL inklusive Topic), ohne
  `TANKAPP_NTFY_URL` bleibt alles wie bisher. Der Notifier läuft als
  Daemon-Thread in `serve()` und prüft alle 5 min (`NOTIFY_INTERVAL_S`) die
  bereits vorhandene Aggregation aus `app/alarms.py` — keine neue Prüfung, kein
  zusätzlicher InfluxDB- oder Netz-Zugriff. Gesendet werden **Zustandswechsel**,
  keine Dauerschleife: neuer Error-Code → eine Meldung mit allen offenen Codes
  (`priority: 4`, Ton/Vibration), derselbe Code nach `NOTIFY_REPEAT_S` = 6 h
  immer noch offen → **eine** Erinnerung, alle Errors weg → einmal „wieder
  betriebsbereit“ (`priority: 2`). Verschwinden einzelne Codes, während andere
  bleiben, wird der Zustand still nachgezogen; `severity: "warn"` wird bewusst
  nie gepusht (Warnungen bleiben im Header-Punkt). Datenschutz: Im Text stehen
  nur die stabilen Codes, ihre deutschen Klartexte aus `app/alarms.py` und die
  App-Version — keine Preise, keine Stationen, keine Koordinaten, keine Pfade,
  keine Zugangsdaten; Fehlermeldungen werden über `app/errors.redact`/
  `public_detail` bereinigt, bevor sie auf stderr landen. Zustellung
  fehlgeschlagen → bereinigte Zeile, Zustand unverändert, der nächste Tick
  versucht es erneut; eine Ausnahme im Tick erreicht die Server-Schleife nicht.
  Der gemeldete Zustand liegt atomar geschrieben in
  `runtime/notify/state.json` (kaputte Datei = leer = Neustart), und
  `/api/v1/health` zeigt `notify` (`configured`, `open_errors`, `last_ok_at`).
  `ops/nas/app/compose.yml` reicht die Variable durch, Einrichtung und
  Verhalten stehen in
  [docs/BETRIEB.md](docs/BETRIEB.md#alarm-zustellung-über-ntfy-b4). Offen
  bleibt die Anzeige im System-Tab der GUI (TODO B4).
- **D3 — Property-Tests der Umweg-Ökonomie**
  (`web/src/data.property.test.ts`, neu; `fast-check` als devDependency): Die
  Umweg-Rechnung ist seit 0.10.0 server-only (`app/route.py::evaluate_route`),
  die GUI rechnet über `detourEconomics`/`detourVerdict` in `data.ts` nach —
  beide Seiten hatten bisher nur Beispielwerte. Jetzt gelten Eigenschaften über
  300 Zufallsfälle je Eigenschaft (fester Seed, über `TANKAPP_FC_SEED`
  umstellbar; gegen mehrere Seeds geprüft): Identität
  `netto = brutto − sprit − zeit`, gezielter Umweg = 2× Wegkosten, Monotonie in
  Litern/km/Verbrauch/Geschwindigkeit/Zeitwert, `criticalCtPerL` als **exakter**
  Break-even (dort ist `netto = 0`), Grenzfälle `zeitwert = 0`, `km = 0`,
  `liter → ∞` (kritischer Preisabstand → 0), `liter = 0` und `v ≤ 0` (Boden bei
  1 km/h, keine Division durch null) sowie die `worth_it`-Schwellenlogik in
  Server-Form: monoton, exakte `≥`-Kanten, bei gleichen Schwellen nur
  `worth_it`/`not_worth_it`. Die Eingabebereiche sind auf die Produktgrenzen
  genagelt (0,40–5,00 €/L, 5–100 L, 0–100 km, 4–15 L/100 km, 0–50 €/h), damit
  die Tests reale Fälle und keine Zahlenfriedhöfe abdecken. Reiner Testzuwachs,
  kein Produktcode geändert.
- **C6-Teil — ein gemeinsamer Fehler-Zustand** (`web/src/components/LoadError.tsx`,
  neu): Bisher unterschieden sich die Panels im Fehlerfall — Spinner, nackter
  Text, nichts — und keiner bot einen Weg zurück. Jetzt gilt für alle dieselbe
  Karte: Klartext aus dem bestehenden Problem-Mapping (`problem(error_code)` in
  `data.ts`), darunter der Rohcode (`Code: influx_read_failed`) für eine
  eindeutige Meldung an den Betrieb, daneben **ein** `Erneut laden`-Knopf
  (er nutzt den vorhandenen gemeinsamen Refresh-Zähler `refreshNow()`, den alle
  `useResource`-Aufrufe als Abhängigkeit haben), `role="alert"` und eine schmale
  Variante für Inline-Boxen. Verdrahtet in sechs Panels: Empfehlung im Alltag,
  Tagesverlauf, Tankbelege, Preisverlauf, Modell-Ausblick, Collector-Status.
  Ohne Handler erscheint kein toter Knopf. Render-Test daneben
  (`LoadError.test.tsx`, 7 Fälle: bekannter/unbekannter Code, Transport-Fehler
  ohne Code, genau ein Knopf, eigenes Knopf-Label, kompakte Variante,
  Zusatz-Hinweis).

### Geändert

- **F2 — deutsche Primär-Labels in der Werkstatt**: Die Jargon-Stellen heißen
  jetzt deutsch, Formel und Fachwort stehen im `title`/Tooltip (der Glossar-Layer
  C7 bleibt offen): „Wahrscheinlichkeit für günstig“ statt „Cheap-Probability
  P(p ≤ Median)“ (Heatmap-Umschalter), „Ranking nach Preis-Abstand“ statt
  „δ̂ Ranking“, „Preis-Abstand ct/L“ statt „δ̂ ct/L“, „Ampel-Stärke“ statt
  „AV-Score“, „Prüfzeitraum“ statt „Out-of-Sample“ (Entscheidungs-Scoreboard),
  „Ø Mehrkosten“ statt „Ø Regret“, „Billigste Stunde“ statt „Billigste Std“,
  „q-Wert“ statt „q“, „95-%-KI“ statt „95%-KI“, „Sprungfreie Tage · MASE“ statt
  „MASE sprungfrei“, „95-%-Band-Trefferquote · PICP“ statt „95-%-Band PICP“,
  „Drift-Status · CUSUM“ statt „CUSUM Drift-Status“; der `aria-label`
  „Due-Prompt“ heißt für Screenreader „Rückmeldung nach Fensterende“ (derselbe
  Text wie die sichtbare Augenbraue der Box). Neu erklärt zusätzlich:
  „P behauptet“, „S>0 real“, „Warten“/„Jetzt“, „Regel-€“/„Orakel-€“ —
  Spalten, die bisher nur mit Vorwissen lesbar waren. Reine Textarbeit, keine
  Logik geändert; die e2e-Specs hängen an keinem der alten Labels.
- **C9-Rest — Anzeige formatiert jetzt überall de-DE**: Die 21 `toFixed`-Stellen
  in `Dashboard.tsx` sind auf den Formatter-Satz umgestellt (`euro`,
  `percentLabel`, `centPerLiter`): „Intervallqualität (7 Tage): 87,5 %“ statt
  „87.5 %“, `δ̂`/Bootstrap-KI/`q`-Wert/Ampel-Stärke im Ranking mit Komma
  („+1,23 ct“, „[-2,10, 0,40]“, „0,0547“), Kalibrierfehler in Prozentpunkten,
  MASE/PICP/CUSUM-Kacheln, tmpfs in MiB, `aria-valuetext` der ε-Schwelle (das
  `.replace(".", ",")` von Hand ist damit überflüssig) sowie die
  Standard-Achsen- und Tooltip-Formatierer in `LineChart`/`LabCharts`.
  SVG-Pfad-Koordinaten bleiben `toFixed` (keine Anzeige), ebenso die
  Vorbelegung der beiden Preis-Eingabefelder — die normalisieren jede Eingabe
  mit `commaToDot`, Vorbelegung und Getipptes müssen gleich aussehen (Kommentar
  im Code). Neu schützt `web/src/format-convention.test.ts` die Konvention als
  Ratchet: `toFixed`-Stellen werden je Datei gezählt, eine neue Anzeige-Stelle
  fällt mit einem Hinweis auf den Formatter-Satz auf — die ESLint-Regel aus dem
  TODO ist damit ersetzt.
- **F3-Teil — Tageszahlen ausgeschrieben**: „Brier (30 Tage)“ statt „Brier 30d“,
  „Intervallqualität (7 Tage)“ statt „(7 d)“, „Top-3-Trefferquote (30 Tage)“
  statt „(30 d)“. Das Microcopy-Regelwerk und die ct/L-€/L-Einheitlichkeit
  bleiben offen (F3/C9-Rest).

### Umgebaut

- **D1-Teil — geteilte UI-Bausteine** (`web/src/components/ui.tsx`, neu):
  `panel` (die Karten-Grundklasse), `Empty` (Leer-/Hinweis-Zustand), `Badge`
  (Ampel-Kapsel) und `Metric` (Kennzahlen-Karte mit Pflicht-Erklärzeile,
  Tooltip am i-Symbol — per `tabindex`/`role` auch mit der Tastatur erreichbar —
  und Zusatz-Hinweis) waren lokale Funktionen in `Dashboard.tsx` und sind jetzt
  ein eigenes Modul mit Render-Test (`ui.test.tsx`, 6 Fälle). Damit haben die
  künftigen Views (`views/Daily.tsx`, `views/Statistics.tsx`, `views/System.tsx`)
  eine gemeinsame Basis, statt dass jede View eigene Karten baut; `Dashboard.tsx` sinkt
  auf 4 098 Zeilen. Verhalten unverändert — reine Umlagerung plus Test. Der
  Views-Schnitt selbst bleibt offen: Die drei Tabs teilen sich ~100
  `useState`/`useResource`-Aufrufe in einer Komponente, vorher ist zu
  entscheiden, ob gemeinsamer Zustand per Props oder Context wandert.

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
Code geprüft — der 0.11-Kandidat „Fokus-Ring: zwei CSS-Zeilen“ stellte sich
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
  „Unerwartetes InfluxDB-CSV-Format“ — `influx_read_failed`/`ExportError`, obwohl
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
