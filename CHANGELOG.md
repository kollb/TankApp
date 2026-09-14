# Changelog

Alle nennenswerten Änderungen ab jetzt. Format lose an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) angelehnt;
Version folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.35.0] – 2026-09-14

**Phasen 1+2 des GUI-Neuentwurfs stehen: „Stationen“, „Woche“ und „Ich“ —
und die alten Tabs „Alltag“ und „Einstellungen“ sind ersetzt.** Der
Preis-Atlas (Karte, Liste mit Referenz, 7-Tage-Verlauf, A-gegen-B-Vergleich),
der Zeit-Planer (7-Tage-Fenster-Raster mit Sterne und Tank-Abgleich) und der
Ich-Bereich (Fahrzeug, Belege, Bilanz, Einstellungen am Wirkungsort) lesen
dieselben Server-Antworten wie der alte Alltag (`/api/v1/overview`, kein
zweiter Poll). Ehrlich dazu: die manuelle Abnahme am echten Stand (S0/S1/
Stufe A/Fehler/Offline, Pi-Fallback, Vorleser-Stichprobe) steht aus
(Checkliste §7); der CI-Spiegel läuft inklusive Browser-Suite grün.

### Hinzugefügt

- **Bereich „Stationen“** (`web/src/views/Stationen.tsx` + Logik in
  `web/src/stations.ts`/`web/src/strip.ts`): der Preis-Atlas nach
  UI-NEUENTWURF §5.2 in fester Reihenfolge — Karte mit Netto-€-Pins →
  sortierte Liste (Netto-€ | Preis | Entfernung) mit sichtbarer Referenz
  (gewählt → Stamm-Station → nächste frische) → Station-Detail (Preis,
  Tagesrhythmus, Einordnung, 7-Tage-Verlauf der gewählten Station) →
  A-gegen-B-Vergleich (Server-Netto wo vorhanden, sonst Preis × Tankmenge
  mit „ohne Umweg“) → Frische-Fußzeile. Suche/⌘K springt in die Liste.
  Ehrlichkeits-Grenzen: Server-Netto gilt nur gegen die aktuelle Referenz,
  Ranglisten nur unter frischen Preisen, ohne Route keine
  client-seitige Strecke. Bewusster Schnitt: die 24-h-Sparkline je Zeile
  kommt erst mit der v2-Atlas-Antwort (Checkliste 1.10).
- **Bereich „Woche“** (`web/src/views/Woche.tsx` + Logik in `web/src/week.ts`):
  der Zeit-Planer nach §5.3 — Tank-Zeile (eigener Bereich, Schnellauswahl
  „¼ / ½ / ¾ / voll“ + Slider), 7-Tage-Raster aus `decide.windows_week`
  (je Tag das günstigste erwartete Fenster), Sterne nur aus Server-p
  (ohne p: null Sterne), Tage 5–7 „noch unsicher“ (entsättigt), Auswahl-
  Detail mit erwartetem Preis, Abstand zu jetzt, Sicherheit in Worten
  (Prozent nur auf Stufe A) und Tank-Abgleich (`tankReach`: die Server-
  Prüfung `blocks_wait` gilt nur für heute, kommende Tage zeigen ehrlich
  Reichweite statt „reicht bis Do“). Leere Tage bleiben leer — die App rät
  nicht.
- **Bereich „Ich“** (`web/src/views/Ich.tsx`): vier Unterseiten als
  ARIA-Tabs nach §5.4 — **Fahrzeug** (alle Default-Fields an einem Ort:
  Tankmenge, Verbrauch, Tankgröße, Zeitwert, Tempo, Fahrtcharakter,
  Profile), **Belege** (Schnellerfassung + Verlauf mit Storno; Einordnung
  gegen den Median des Sets als Standard, die meistgenutzte Station als
  zweiter Maßstab darunter — erst ab zwei Belegen an derselben Station),
  **Bilanz** (Monat/Jahr aus `fills/summary`, Stadt-Median ehrlich als
  „noch nicht messbar“) und **Einstellungen** (Stadt/Kraftstoff am
  Wirkungsort, read-only-Schwellen aus `stats/summary`, Dark/Light, Über).
- **Tankstand als Fakt in „Jetzt“**: Schnellauswahl „¼ / ½ / ¾ / voll“
  unter der Entscheidung (`onTankQuick`); der Server bleibt die
  Physik-Quelle (`tank`-Block der Decide-Antwort).
- **Was-wäre-wenn in der „Jetzt“-Karte** (§5.1): Liter, spätester Zeitpunkt
  und Zeitwert ändern sich direkt neben der Empfehlung (lokal, kein
  Setting); `assumptionHint()` benennt die ausschlaggebende Annahme
  („Kippt zu ‚Jetzt‘, wenn du vor HH:MM tanken musst …“).
- **Entscheidung 2.4 (Alarme) in [BETRIEB.md](docs/BETRIEB.md)**:
  §11 streicht Preis-Erinnerungen/Push (es wird dafür keine Komponente
  gebaut); der System-Alarmweg (`app/alarms.py`, `app/notify.py`/ntfy B4,
  bestehende Codes) bleibt unverändert aktiv; Störungen erscheinen in der
  neuen GUI nur als Anzeige (Header-Punkt + System-Tab).

### Geändert

- **Tab-Struktur (§16, Tab-für-Tab):** `views/Daily.tsx` (−2 072 Zeilen)
  und der alte Einstellungen-Tab sind entfernt; die Navigation führt
  Jetzt → Stationen → Woche → Ich → Werkstatt → System → Glossar.
  `handleNowNavigate` zielt auf die echten Bereiche. Die Werkstatt
  bleibt (Phase 3 ersetzt sie), das Glossar bleibt.
- **E2e-Suite auf die neue Tab-Struktur umgestellt** (`e2e/*.spec.ts`,
  8 Tests × Desktop/Mobil = 16 Läufe): „honest setup state and all
  views“ (frischer Server: „Jetzt“ S0 → „Stationen“-Set-Karte →
  Werkstatt → System), „city/fuel changes never mix prices, closures
  never win“ (Isolation über die neuen Bereiche), „Ich:
  Fahrzeug-Defaults, Schwellen read-only, Dark/Light“ (Unterseiten als
  ARIA-Tabs adressiert), Decide-Fluss decide → intent → fill → due
  (inkl. „Serverfehler zeigt keinen Erfolg“) und die Horizons-/
  Zeitwert-Automatik-Tests in `horizons.spec.ts`.
- `app/version.py` 0.34.0 → 0.35.0; `docs/UMSETZUNG-GUI-NEUENTWURF.md`
  (Phasen 1+2 abgearbeitet, Messwerte, F4-Liste) und `docs/MICROCOPY.md`
  kennen die neuen Dateien/Bereiche.

### Behoben

- **Woche-Ansicht crashte zur Laufzeit** (`week.ts`): Der Tag-Anker
  parste das de-DE-datierte Berlin-Format („14.09.2026“) mit
  `Date.parse` — das liefert `NaN`, und `weekDays` warf
  `RangeError: Invalid time value`. Der Anker kommt jetzt über das
  ISO-Berlin-Datum (en-CA), dasselbe Muster wie `now.ts`; `week.test.ts`
  deckt es (7 Tage, bestes Fenster je Tag, „noch unsicher“-Tage).
- **Datenfolge ist kein Defekt (Stationen):** Ein decide-`error_code`
  (z. B. `polling_missing` auf einem frischen Server) mit HTTP 200 war
  früher ein roter Fehlerzustand in der Liste. Jetzt ist rot nur eine
  tote Datenquelle (`data === null && error`); der fehlende Polling-Set-
  Zustand zeigt die ehrliche Set-Karte „Erst ein Set, dann der Atlas“
  (Regressionstest in `views/Stationen.test.tsx`).

### Tests

- 458 Web-Tests in 26 Dateien (vorher 352 in 20): Logik `strip.test.ts`
  (7), `stations.test.ts` (30), `week.test.ts` (19); Rendering
  `views/Stationen.test.tsx` (7), `views/Woche.test.tsx` (7),
  `views/Ich.test.tsx` (9) — alle mit fester Uhr (2026-09-14 12:00
  Berlin) und `renderToStaticMarkup`; dazu `mostUsedStation` (zweiter
  Maßstab unter dem Median).
- Microcopy- und Formatierungs-Ratchet kennen die neuen Dateien.
- **Browser-Suite grün** (8 Tests × Desktop/Mobil = 16 Läufe): Setup-
  Zustände auf dem frischen Server, Stadt-/Kraftstoff-Isolation,
  Decide-Fluss, Werkstatt-Horizonte und Zeitwert-Automatik.

## [0.34.0] – 2026-09-14

**Der erste Bereich des GUI-Neuentwurfs steht: „Jetzt“. Eine Entscheidung,
drei Fakten, höchstens drei nächste Schritte, ein Tagesstreifen und die
Frische-Fußzeile — in genau dieser Reihenfolge.** Dazu die Arbeitsliste
(`docs/UMSETZUNG-GUI-NEUENTWURF.md`), die reparierte Entscheidungsvorlage
(`docs/UI-NEUENTWURF.md`) und der Gleichschritt in der Pi-Fallback-GUI.
Ehrlich dazu: **die Abnahme auf dem Pi steht noch aus** (Checkliste §7.3);
die Sichtprüfung auf Desktop (1440 px) und Smartphone (390 px) ist mit
Demo-Daten durchgeführt, die Browser-Suite läuft mit 16/16 grün.

### Hinzugefügt

- **Bereich „Jetzt“** (`web/src/views/Jetzt.tsx` + `web/src/now.ts`): die
  Ampel-Karte 2.0 mit vier Ausgängen (`Jetzt tanken` · `Warten bis 18–20 Uhr` ·
  `Woanders tanken` · `Keine klare Empfehlung`), drei Fakten in fester
  Reihenfolge („Jetzt hier“ · „Bestes Fenster heute“ · „Tank reicht?“),
  höchstens drei nächste Schritte, Tagesstreifen 06–24 Uhr und
  Frische-Fußzeile. „Jetzt“ ist der neue Einstieg; der Alltagstab bleibt
  vorerst daneben stehen (Phase 1 entlastet ihn, sobald „Stationen“ steht).
  Kein zweiter Poll: derselbe `/api/v1/overview` versorgt beide.
- **Erklär-Treppe Ebene 1** (`web/src/components/Level1Sheet.tsx`): „Warum?“
  öffnet ein Sheet mit höchstens drei Sätzen, der Herkunft der Zahlen und
  genau einem Weg in die Tiefe (bis Phase 3: die Werkstatt).
- **Ehrlichkeits-Stufen sichtbar gemacht** (§10): Prozent nur auf Stufe A
  (≥ 100 abgeschlossene Empfehlungen, Brier < 0,25). Stufe B nennt Worte plus
  Fortschritt („Noch 34 abgeschlossene Empfehlungen bis zur Prozent-Anzeige.“),
  Stufe C bleibt grau mit Begründung („Das Modell lernt noch — 12 von 100 …“)
  und zeigt darunter die aktuellen Preise, statt den Nutzer ohne Zahlen zu
  lassen.
- **Fallback-GUI v4.0** (`rp2/fallback_gui.py`) im Gleichschritt: dieselben
  drei Fakten in derselben Reihenfolge (dritter Fakt „Frische Preise“, weil
  der Tankstand NAS-Sache bleibt) und die Frische-Fußzeile
  „Preise … alt · Prognose … alt“. Template-Wechsel per Versionsmarker,
  altes Template wird als `index.html.old` gesichert.
- **Arbeits-Checkliste** `docs/UMSETZUNG-GUI-NEUENTWURF.md`: die vier Phasen
  aus §16 als abhakbare Schritte mit Definition of Done je Bereich, Baseline
  der Messwerte und Fallback-Gleichschritt.

### Behoben

- **Absturz auf der leeren Anlage (leere Seite).** `/api/v1/overview` antwortet
  auch dann mit HTTP 200, wenn die Empfehlung nicht berechnet werden konnte —
  im `decide`-Feld steht dann ein Fehlerobjekt **ohne** `primary`
  (`{"error_code": "polling_missing"}`). `web/src/now.ts` griff ungeprüft auf
  `decide.primary.action` zu; die Ausnahme riss die ganze React-Wurzel mit, die
  Seite blieb weiß. Jetzt durchgehend optional (`nowVerdict`, `nowStage`,
  `nowFacts`, `nowSteps`, `nowExplanation`, `learningNote`) und die Ansicht
  zeigt einen benannten Fehler mit Rohcode statt einer weißen Fläche; ohne
  Stationen bleibt der Einrichtungs-Zustand (der Fehler gewinnt nur, wenn die
  Anlage unerreichbar ist). Drei Regressionstests in `now.test.ts` und
  `views/Jetzt.test.tsx`.
- **Frische-Fußzeile datierte die Prognose falsch.** Dort stand
  `stats_summary.generated_at` — der Zeitpunkt der Antwortberechnung, also bei
  jedem Refresh „gerade eben“. Der Modell-Lauf datiert aus der
  Engine-Publikation (`quality.rolling_picp_7d_as_of`) bzw. dem Fit
  (`debug.fitted_at`); neue reine Funktion `forecastStamp` mit Test. Fehlt
  beides, sagt die Fußzeile ehrlich „Prognose kein Stand“.
- **`docs/UI-NEUENTWURF.md` repariert:** In §12 waren zwei API-Zeilen
  verschmolzen (`ops/runs/{job}/start` + `ops/diagnostics`), §18 endete mit
  ~15 Fragment-Wiederholungen. Die Entscheidungsvorlage ist wieder lesbar.

### Geändert

- `docs/MICROCOPY.md`: neue feste Muster für „Jetzt“ (§4b) und die
  Fallback-Fakten/Fußzeile (§4a, Markerversion 4.0); die Tabs-Zeile nennt
  jetzt „Jetzt“ als Einstieg.
- `docs/RP2.md`: Fallback-Version 4.0, Antwort-Karte beschrieben.
- `docs/README.md`: Index um `UI-NEUENTWURF.md` und
  `UMSETZUNG-GUI-NEUENTWURF.md` ergänzt.

### Tests

- 352 Web-Tests in 20 Dateien (vorher 306 in 18): `web/src/now.test.ts`
  (25 Fälle — vier Ausgänge, drei Fakten, Schritte, Frische, Ebene-1-Sätze,
  Wort/Prozent-Widerspruch)
  und `web/src/views/Jetzt.test.tsx` (9 Fälle — feste Reihenfolge, S0/S1,
  Fehler, Laden, Sheet).
- Microcopy- und Formatierungs-Ratchet kennen die neuen Dateien;
  `tests/test_rp2_fallback.py` prüft die drei Fakten samt Reihenfolge und die
  Frische-Fußzeile der Fallback-GUI.
- **Browser-Suite (`npm --prefix web run test:e2e`, 16 Tests in Desktop und
  Mobil) repariert:** Die Specs gingen vom Alltagstab als Startansicht aus; seit
  „Jetzt“ der Einstieg ist, wechseln sie ausdrücklich dorthin (`gotoAlltag`).
  Der Setup-Test prüft zusätzlich den neuen Einstieg (S0-Karte „Einrichten in
  drei Schritten“). `AGENTS.md` nennt den e2e-Schritt jetzt im Prüf-Spiegel.

## [0.33.1] – 2026-09-14

**Der Kopf der Fallback-GUI passt jetzt zur Inhaltsspalte — und der Desktop
nutzt seine Breite, statt sie zu verschenken.** Auslöser war die Sichtprüfung
der Fallback-GUI v3 auf einem breiten Monitor: Schriftzug links am Fensterrand,
Status-Pills rechts, dazwischen 1892 px Leiste über einer 1060 px breiten
Inhaltsspalte.

### Behoben

- **Kopf- und Steuerleiste laufen in der Inhaltsspalte.** Hintergrund und
  Rahmen bleiben vollflächig, der Inhalt teilt jetzt dieselbe Spalte wie
  `<main class="wrap">` (`--content: 1060px`, `--gutter: 14px`). Bei 1920 px
  stand der Leisteninhalt vorher 416 px neben den Karten.

### Hinzugefügt (ab 1100 px, nur Desktop)

- **Inhaltsspalte 1280 px** wie `max-w-7xl` der NAS-GUI statt 1060 px.
- **Kopf- und Steuerleiste in einer Zeile:** rund 60 px statt ~185 px hoch; die
  drei Kraftstoff-Tabs strecken sich nicht mehr über die volle Breite (Deckel
  420 px). Bei wenig Platz bricht die Leiste um — dann immer noch flacher als
  vorher. Mehr Inhaltshöhe, die Antwort-Karte bleibt länger sichtbar.
- **Alltag zweispaltig (7/5):** links Antwort-Karte und Tagesverlauf, rechts
  Stationen und Prognosen. Die DOM-Reihenfolge bleibt 1→4, die Kicker-Zahlen
  („1 · Empfehlung“) entfallen ab 1100 px — sie sind eine Lesehilfe für die
  einspaltige Handy-Ansicht.
- **Werkstatt:** Prognose-Karten zweispaltig; Rohdaten-Tabelle bleibt über die
  volle Breite.
- **Sticky-Chip** sitzt am Rand der Inhaltsspalte statt am Fensterrand.

Unterhalb von 1100 px ändert sich kein Pixel: Handy und Tablet behalten das
bewährte Layout (Leisten untereinander, Inhalt einspaltig, Kicker mit Zahlen).
Kein neuer Endpunkt, keine neue Abhängigkeit; das Template ersetzt sich über
seinen Inhalts-Hash selbst (Sicherung `index.html.old`), die Fallback-API
bleibt byte-identisch.

## [0.33.0] – 2026-09-14

**Die Fallback-GUI auf dem Pi ist neu gebaut: Antwort zuerst, Karten statt
Tabelle, Alltag und Werkstatt getrennt — und sie liest den Preis-Puffer nur
noch einmal pro Zyklus.** Umgesetzt ist das gebilligte Konzept aus
[PR #112](https://github.com/kollb/TankApp/pull/112) nach der Arbeits-Checkliste
[docs/UMSETZUNG-FALLBACK-GUI-V2.md](docs/UMSETZUNG-FALLBACK-GUI-V2.md).

### Hinzugefügt

- **Fallback-GUI v3 (`rp2/fallback_gui.py`, VERSION 3.0):** Antwort-Karte
  zuerst (Verdict „Jetzt tanken“ / „Bis <Zeit> Uhr warten lohnt sich“,
  günstigste Station, Ersparnis, Route-Button), F1 als Fenster-Chip und F2 als
  Zweitplatzierter-Chip, **Stations-Karten statt Tabelle** auf allen Breiten
  (Name einzeilig mit Ellipsis, voller Name im `title`, Marke/Stadt/Fahrzeit in
  der Meta-Zeile, Δ-Chip, 44-px-Route-Button, kein horizontales Scrollen),
  **Tagesstreifen 06–24 Uhr** aus dem Puffer (grün/rot = unteres/oberes
  Preisdrittel, Stunden ohne Meldung bleiben leer), **Alltag/Werkstatt-Trennung**
  (Werkstatt: Prognose-Sparklines, Rohdaten aller Treibstoffe, Datenstatus mit
  Cache-Alter), Sticky-Status- und Steuerleiste sowie Sticky-Aktions-Chip beim
  Scrollen. Leer- und Fehlerzustände (kein Cache, leerer Puffer, 503,
  `CACHE_REBOOT_HINT`) bleiben erhalten.
- **`GET /api/v1/series?station=<uuid>&fuel=<fuel>`:** Tagesverlauf aus dem
  JSONL-Puffer, je Stunde die letzte **offene** Meldung für den gewählten
  Kraftstoff (Ortszeit, Zelle „24“ = Mitternachtsstunde), Stunden ohne Meldung
  als `null`, dazu `min`/`max`/`now`. Fehler wie bei den übrigen Endpunkten:
  unbekannte Station 404, leerer Puffer 503, ungültiges `fuel` 400 (kein
  stilles E10). Namensgleichheit mit dem NAS-Endpunkt ist gewollt — antwortet
  das NAS, kommt von dort die vollständige Serie.
- **Snapshot-TTL-Cache (5 s, `SNAPSHOT_TTL_S`):** `Context.snapshot()` hält den
  Puffer-Stand kurz und baut ihn unter einem Lock auf. Vorher lasen die vier
  Endpunkte eines GUI-Refreshs denselben Puffer viermal neu.
- **Microcopy §4a** ([docs/MICROCOPY.md](docs/MICROCOPY.md)): die festen
  Muster der neuen Oberfläche (Verdict-Sätze, Tagesstreifen-Caption,
  „<Kraftstoff> nicht geführt“, Sortierungs-Labels, Sticky-Chip, Ehrlichkeits-Zeile).

### Messwerte (lokaler Lauf, 18 Stationen, 216 Polls/Tag, 406 KiB Puffer)

| Größe | Wert |
|---|---|
| Snapshot-Read je GUI-Zyklus | **1** statt 4 (mit `series` zusammen 2 statt 4) |
| Puffer-Read | 7,5 ms |
| `/api/v1/series` | 4,7 ms, ~2,1 KiB Antwort |
| `/api/v1/health`, `/api/v1/decide` | 0,8 ms (warmer Cache; vorher 7–8 ms je Anfrage) |
| Template im Speicher | 59 KiB (vorher 32 KiB) |
| Neue Abhängigkeiten | keine (RP2 bleibt Standardbibliothek) |

### Geändert

- Version 0.33.0, `docs/RP2.md` (Stand-Zeile, Fallback-API-Tabelle,
  Funktionsliste der GUI, Abschnitt zum Tagesstreifen, Changelog) und
  `docs/MICROCOPY.md` nachgezogen.
- Dienst-Neustart installiert das neue Template automatisch; die alte Datei
  wird weiterhin als `templates/index.html.old` gesichert
  (Marker `<!-- tankapp-fallback-gui v3.0 sha:… -->`). Der Proxy-Pfad bleibt
  unverändert: bei erreichbarem NAS wird weiterhin transparent weitergeleitet.

### Tests

- `tests/test_rp2_fallback.py` (9 neu): Stunden-Buckets inkl. „letzte Meldung
  der Stunde“, `null` für geschlossene Meldungen und fremde Kraftstoffe,
  `min`/`max`/`now`, Mitternachtszelle aus der Folgetags-Datei, `fuel`-Filter,
  404/503/400 des Endpunkts, TTL-Cache (zweiter `snapshot()`-Aufruf liest
  nicht neu, `force=True` schon) und „ein Puffer-Read für fünf Endpunkte“
  sowie ein Marker-Test, dass Mock-Leiste und Beispieldaten aus dem Template
  verschwunden sind.

## [0.32.0] – 2026-09-13

**Abnahme-Release: A12, A13 und C7 waren implementiert, aber unbelegt —
jetzt sind sie getestet, dokumentiert und geschlossen.** Dazu zwei echte
Funde aus der Abnahme: Stationen ohne einzige Rasterzelle waren unsichtbar
statt tot, und „verbraucht kein Kontingent“ war falsch (weiter gepollt wird).
Der Footer spricht jetzt Doku-Vokabular (F3-Rest), H3 steht auch im TODO als
erledigt.

### Hinzugefügt

- **A12 — Abnahme Station-Lebenszyklus:** vier Zustände (`active`/`dead`/
  `closed`/`no_fuel` je Station und Kraftstoff, Fenster = letzte
  `dead_after_days` Kalendertage Europe/Berlin), Ausschluss toter Stationen
  vor dem Coverage-Gate, Schwelle `TANKAPP_DEAD_AFTER_DAYS` (Default 7,
  0 = aus), Alarme `stations_dead`/`stations_lifecycle`, Artefakt-Felder
  (`dead_stations`, `lifecycle_counts`, `lifecycles` je Zeile) und
  Unterscheidung in Werkstatt- und System-Tab. Doku-Abschnitt
  [ANALYSE.md](docs/ANALYSE.md#lebenszyklus-der-stationen).
- **A13 — Abnahme Preis-Zwillinge:** `_detect_price_twins` mit denselben
  Schwellen wie der manuelle Vergleich (≥ 28 Tage mit je ≥ 12 gemeinsamen
  Punkten, ≥ 90 % Überlappung, ≥ 99 % innerhalb 0,1 ct/L), Warnung im
  Artefakt (`price_twins`/`price_twin_count`, `auto_apply: false`), Alarm
  `price_twins` und Paar-Tabelle im System-Tab.
  [ANALYSE.md](docs/ANALYSE.md#preis-zwillinge).
- **C7 — Abnahme Hilfe/Glossar:** „Was heißt das?“-Tab mit 10 Begriffen
  (δ̂, MASE, PICP, Brier, ε, Regret, q-Wert, AV-Score, Lebenszyklus,
  Preis-Zwillinge), i-Tooltips (`InfoTooltip`) in Werkstatt und System,
  jeder Eintrag mit gültigem `docs/ANALYSE.md`-Anker — die Abschnitte
  MASE/PICP/Brier/ε/Regret/Lebenszyklus/Zwillinge sind neu in der Doku,
  q-Wert/AV-Score verweisen auf die bestehenden.
- **F3 (Rest) — Footer ans Regelwerk:** „Abfrage gedrosselt“ → „Abfrage
  höchstens alle 5 Minuten“ (konkret statt Jargon),
  „Beobachtungsfenster“ → „Polling-Fenster“ (Doku-Vokabular, Konzept §7).
  Die deutsche Kurzzeile („Keine Demo-Preise. …“) bleibt — eine pro
  Auftritt, kein Englisch, keine Behauptung ([MICROCOPY.md](docs/MICROCOPY.md) §6).

### Behoben

- **A12 — unsichtbar statt tot:** Stationen ohne einzige Rasterzelle
  (nie ein Preis im Fenster) fielen aus `pivot_table` und damit aus der
  Lebenszyklus-Schleife — kein Ranking-Ausschluss im Artefakt, kein Alarm,
  kein Tausch. Die Schleife läuft jetzt über Matrix-Spalten plus
  df-Rest (`engine/selection.py`), das `mat.drop` war bereits
  abgesichert. Reine Sichtbarkeits-Korrektur: Wer nie lieferte, stand
  auch vorher in keinem Ranking.
- **A12 — falsche Kontingent-Behauptung:** „verbraucht kein Kontingent
  mehr“ stand im Alarm, im Glossar und an zwei GUI-Stellen — der Collector
  pollt aber jede UUID im `batch`, tote Stationen kosten weiter (höchstens
  ein Zehntel Request je Poll, `prices.php`-Batch zu 10). Alle Stellen
  sagen jetzt die Wahrheit: Vergleichsplatz weg, Polling-Set stabil bis
  zum bestätigten Tausch. Die Entscheidung (keine Selbst-Tot-Schleife,
  Pfad = Alarm → [Tausch-Anleitung](docs/STATIONEN-TAUSCH.md)) steht in
  [LUECKEN.md](docs/LUECKEN.md) begründet.

### Dokumentation

- [ANALYSE.md](docs/ANALYSE.md): neue Abschnitte „Lebenszyklus der
  Stationen“, „Preis-Zwillinge“, „MASE (Fehler gegen die Naive)“,
  „PICP (Band-Trefferquote)“ und „Empfehlungs-Bilanz (Brier, Epsilon,
  Regret)“ mit Brier/ε/Regret-Unterabschnitten; Glossar-Wortlaut
  wortgleich in der Doku.
- [LUECKEN.md](docs/LUECKEN.md): 0.32.0-Abschnitt; Polling-Set-Entscheidung
  als begründet-offen eingetragen.
- [TODO.md](TODO.md): A12/A13/C7/F3 erledigt (0.32.0), H3 als 0.31.0
  nachgetragen (Code, Tests und CHANGELOG waren da, das TODO lag).

### Tests

- `tests/test_lifecycle_twins.py` (16 Fälle): vier Zustände, Fenster-Regel,
  Abschaltung (0/`None`), Env-Schalter, Ausschluss aus dem Ranking
  (frischtot + nie geliefert), geschlossen/sortenlos unterscheidbar,
  Totals, Zwillinge positiv/negativ/kurz/einzeln/im Artefakt, drei
  Alarm-Codes plus Schweigen ohne Befund und Fuel-Datei-Fallback.
- `tests/test_glossary.py` (3 Fälle): Pflichtbegriffe, Anker-Existenz je
  Eintrag (derselbe Slugger wie der Doku-Link-Test), de-Wortlaut in der Doku.
- `web/src/glossary.test.ts` (8 Fälle): Tabellen-Invarianten,
  `glossaryById`, Lebenszyklus-Helfer, kein Kontingent-Versprechen.

## [0.31.0] – 2026-09-13

**Die Prognose hat jetzt zwei Modellkerne, und die Unsicherheit rechnet
zusammen statt getrennt.** Dazu: die Karte lädt wieder (CSP), die
Qualitäts-Gates sind automatisiert, die Schwellen pendeln nicht mehr und die
Fenster-Reihenfolge lernt aus deinen Tankzeiten.

### Hinzugefügt

- **A10 — Zweitmodell und inverse-MASE-Ensemble (Konzept §3.2 M3):**
  `engine/models.py` fittet neben der harmonischen Tagesform ein
  **Zweitmodell `profile_ar2`** — das Tagesprofil je 5-Minuten-Slot als
  Median über das Trainingsfenster, also ein anderer Modellkern und kein
  zweiter Sinus-Fit. Beide Punktprognosen werden mit Gewichten ∝ 1/MASE
  gemischt; MAE, MASE, Bewertungsfenster und Stichprobengröße stehen im
  Artefakt (`ensemble`) und werden je Prognose veröffentlicht. Schalter:
  `TANKAPP_MODEL_KIND=harmonic_ar2|profile_ar2|ensemble` (Default
  `ensemble`). Messung (Demo-Daten, 6 Stationen, 72-h-Holdout): MAE
  **2,53 → 1,93 ct/L** (−24 %), in 6/6 Stationen besser als der Hauptpfad.
- **A11 — gemeinsame Bootstrap-Ziehung (Konzept §4.2):** alle Stationen
  eines Laufs ziehen ihre Tagesblöcke aus denselben Zufallszahlen je
  (Horizont, Tagesposition), jede bildet sie über ihre eigene
  Blockverteilung ab — der Marktgleichlauf bleibt in `p_lohnt` statt
  herauszufallen. Ausgewiesen als `draws_24h.shared` / `draws_7d.shared`;
  `TANKAPP_SHARED_DRAWS=0` stellt das alte Verhalten für Gegenmessungen her.
- **A9 — persönliche Fensterreihenfolge (Konzept §5.5):** ab **8 Belegen**
  gewichtet die App die F3-Fenster mit deinem Tankzeit-Profil w(h);
  günstige Fenster zu Stunden, die du nie tankst, stehen weiter hinten.
  Darunter bleibt die preisliche Reihenfolge — und die Tagesansicht sagt,
  woran es liegt: „Noch nach Preis sortiert (5 Belege von 8) — es fehlen 3“.
- **H3 — Hysterese für die M7-Schwellen:** der Regler schlägt eine
  Anpassung nur vor, wenn sie über dem Rauschband liegt
  (`app/thresholds.py`: 2,0-σ-Band, Mindest-Abstand 0,02 bei
  Wahrscheinlichkeiten bzw. 0,05 €); die Werkstatt zeigt Band und
  Begründung — auch die, warum **nicht** nachgezogen wird.
- **D4 — Qualitäts-Gates automatisiert:** `ops/quality/gates.py` prüft
  Bundle-Größe (200 kB gzip), Lighthouse-Kategorien ≥ 0,7 und eine
  Lastprobe (25 RPS, p95 < 2 s, Fehlerquote < 5 %); Bericht als
  `ops/quality/gates_report.json`. Ergebnis: alle Gates grün, das
  B7-Restthema (Bundle-Aufteilung) ist damit **nicht** nötig.

### Geändert

- **Karte lädt wieder:** `Content-Security-Policy` lässt die OSM-Kacheln
  zu (`img-src … https://*.tile.openstreetmap.org`, `connect-src` für
  Tile- und Nominatim-Anfragen) und der Tile-Abruf sendet `Referer` sowie
  einen identifizierbaren `User-Agent` — ohne diese Kennung blockt die OSM
  Tile Usage Policy mit HTTP 403 („Access blocked“).
- Version 0.31.0, ToDo-Stand aktualisiert (A9/A10/A11 erledigt).
- **D4-Folge (CI):** das Lighthouse-Gate startet den Demo-Stack jetzt selbst
  (eigener Schritt mit Bereitschaftsschleife auf `/api/v1/health`) und
  Chrome läuft mit `--no-sandbox`. Vorher startete Lighthouse-CI den Server
  und wartete auf „bereit auf“ — auf dem CI-Läufer dauerte der Demo-Aufbau
  länger als diese Wartezeit, der Lauf brach **ohne Bericht** ab: ein rotes
  Gate ohne Befund. Begründung in [QUALITAET.md](docs/QUALITAET.md).

### Dokumentation

- [ANALYSE.md](docs/ANALYSE.md): P-Seite mit gemeinsamer Ziehung und
  Messwerten, neuer Abschnitt „Ensemble aus zwei Modellkernen (A10)“.
- [LUECKEN.md](docs/LUECKEN.md): Punkt „gemeinsame Bootstrap-Ziehung“
  geschlossen; neu und begründet offen: Ensemble-Gewichte aus dem
  Rolling-Origin-Backtest statt aus dem Validierungsfenster.

## [0.30.0] – 2026-09-13

**Die Karte lädt wieder und beginnt am Anker.** Die OSM-Kacheln wurden von
der Content-Security-Policy blockiert (leere Karte, nur Pins), und die
0-€-Markierung war als Spritpreis missverständlich.

### Hinzugefügt

- **Anker-Pin auf der Karte:** `/api/v1/stations` liefert das neue, stadtweise
  gefilterte Feld `anchors` (`app/data.py::anchors_by_city`, Koordinate aus
  `anchor` bzw. `lat`/`lon` des Polling-Sets). Die Kartenansicht zeichnet den
  Anker als eigenen Pin (Haus-Symbol, „Anker“), das Luftlinien-Radar
  zentriert auf ihn und seine Ringe zeigen km ab Anker; Tipp/Klick öffnet eine
  Erklärung, was am Anker beginnt (Stationsentfernungen, Extrafahrt Hin &
  Rück). Die Stations-Records tragen die Koordinate weiterhin nicht.
- **Erklärtext unter der Karte:** die €-Pins nennen die Netto-Ersparnis
  gegenüber der Vergleichsstation; deren Pin heißt jetzt „Vergleich“ (0 €
  Unterschied, nicht 0 € Spritpreis), und der Text erklärt Anker sowie die
  Fahrtcharaktere „Auf dem Weg“ und „Extrafahrt“. Das Radar beschriftet sein
  Zentrum und was die Ringe messen.

### Geändert

- **CSP gibt die OSM-Kacheln frei:** `img-src` in `app/server.py` erlaubt
  zusätzlich `https://*.tile.openstreetmap.org`; vorher blockierte der Browser
  jede Kachel (`a/b/c.tile.openstreetmap.org`) und die Karte blieb leer.
- **Detailkarte der Vergleichsstation:** aus „0,00 € (Vergleich)“ wird
  „0,00 € Unterschied“ — die Rolle steht daneben.

### Tests

- `tests/test_app.py`: `anchors`-Feld stadtweise gefiltert, Anker auch im
  discover-Format (`lat`/`lon`), ungültiger Anker erscheint nicht; CSP-Header
  enthält den OSM-Kachel-Host; Stations-Records bleiben ankerfrei.
- `web/src/components/StationMap.test.tsx`: Anker-Legende/-Erklärung,
  Vergleichs-Pin ohne 0-€-Preis, keine Koordinaten im Nutzertext;
  `StationMap.tsx` in die Microcopy-/Format-Ratchets aufgenommen.

## [0.29.0] – 2026-09-13

**Batch 6 (Bedienung) und Batch 7 (Kanten) in einem PR.** Keine neuen
Fachzahlen, keine neue Fläche: die Oberfläche wird am Handy bedienbar (C5/C8),
und zwei Randfälle bekommen eine dokumentierte Entscheidung statt einer
offenen Frage (G4 Cache, H5 Zeitumstellung).

### Hinzugefügt

- **C8 — Install-/„Zum Homescreen“-Hinweis:** `components/InstallHint.tsx` +
  `install.ts`. Wo der Browser es anbietet, erscheint ein echter
  Installationsknopf (`beforeinstallprompt`, `appinstalled`); auf iOS-Safari,
  das kein solches Ereignis kennt, der Handgriff „Teilen → Zum Home-Bildschirm“.
  „Nicht jetzt“ schweigt 30 Tage (localStorage), in der installierten App und
  ohne Installationsweg erscheint nichts. Das Manifest erlaubt jetzt beide
  Ausrichtungen (`orientation: "any"`).
- **C8 — Querformat am Handy:** eigener Media-Block
  (`orientation: landscape and (max-height: 620px)`): Einleitung und Tagline
  entfallen, Kopfzeile und Abschnittsabstände werden flacher, die Tageskurve
  steht quer als zwei Neuner-Reihen über die volle Breite. Die Haken
  (`app-header`, `app-tagline`, `app-main`, `daily-flow`, `daily-intro`,
  `daystrip-cells`, `daily-action-chip`) sitzen im Markup.
- **C5 — Kontrast AA:** `slate-500`/`slate-600` sind angehoben
  (dunkel `#8598b0`/`#8295ad`, hell `#55677c`) — dieselben Klassen, dieselbe
  Rollenskala, nur lesbar auf den tatsächlichen Flächen. `web/src/a11y.test.ts`
  rechnet die Kontraste gegen Seite, Karte und Rand nach.
- **C5 — Touch-Ziele ≥ 44 px:** eigene Regel nur bei grober Zeigerart
  (`pointer: coarse`), damit die Maus-Ansicht kompakt bleibt; Karten-Zoomknöpfe
  und Pins ziehen unsichtbar auf 44 px nach.
- **C5 — Beleg ohne Maus:** die Schnellerfassung ist ein `<form>` (Enter bucht,
  der Knopf bleibt sichtbar), das „Anpassen“-Panel setzt den Fokus ins
  Literfeld, Escape schließt es und gibt den Fokus an den Auslöser zurück; die
  Radar-Pins sind per Tab/Enter/Space erreichbar (`role="button"`, `tabIndex`,
  Trefferfläche) wie die Leaflet-Marker (`keyboard: true`, `title`/`alt`).
- **H5 — Zeitumstellung im Backtest ausgewiesen:** `engine/data.py` kennt die
  Wanduhr-Länge eines lokalen Tages (`local_day_hours`, 23/24/25 h) und die
  betroffenen Tage (`dst_transition_days`). Jeder Fold trägt `dst_day` und
  `local_day_hours`, `report.json` den Block `dst` (Tage, Stunden, betroffene
  und bewertete Folds, fehlende Vortages-Anker `anchors_missing_nat`,
  `anchors_outside_series`, `mase_none_reasons`), `report.md` den Abschnitt
  „Zeitumstellung (DST)“. Ausgeschlossen oder auf 24 h gerechnet wird nichts —
  die Tage bleiben vergleichbar und sind nur gekennzeichnet.
- **H5 — sichtbar in der Werkstatt:** `dstLabel()` in `web/src/data.ts` und die
  Zeile über der Metrik-Kachel in der Werkstatt nennen die 23/25-h-Tage, die
  Zahl der Anker ohne Wanduhr-Zeitpunkt und die Politik („bleiben im Backtest
  und sind je Tag gekennzeichnet“).

### Geändert

- **H5 — kein stilles `None`:** `seasonal_scale_detail()` liefert Skala,
  Stichprobengröße, fehlende Anker (`NaT`, außerhalb der Reihe) und einen
  Grund (`no_reference_points`, `constant_series`); die Metriken ergänzen
  `mase_none_reason` (`no_scored_points`, `naive_scale_undefined`). Bleibt
  MASE undefinierbar, steht der Grund im selben Feld.
- **G4 — der Prognose-Cache bleibt bewusst flüchtig:** keine Spiegelung auf die
  SD-Karte (jeder Abruf alle 5 Minuten würde schreiben, der Puffer füllt sich
  nach einem Neustart von selbst). Stattdessen sagt der Start
  (`boot_state_note()`) den Zustand in `cache.log`/`systemctl status`, und die
  Fallback-GUI erklärt ihn an drei Stellen (`CACHE_REBOOT_HINT`: F1-Erklärung,
  Prognose-Raster, API-Fehlermeldung).
- **C8 — Pull-to-Refresh weicht nur der Geste:** `ptr.ts`/`usePtrOff.ts`
  sperren das Overscrollen an der Wurzel nur zwischen `pointerdown` und
  `pointerup`; Slider und Karte sind zusätzlich als `.no-ptr` markiert, die
  Leaflet-Fläche scrollt nie die Seite mit.
- **Dokumentation:** [docs/ENGINE.md](docs/ENGINE.md) beschreibt die
  DST-Ausweisung und die Gründe für `mase: null`;
  [docs/RP2.md](docs/RP2.md) und [docs/SPEICHER.md](docs/SPEICHER.md) halten
  die G4-Entscheidung fest (CACHE_DIR-Zeile, Reboot-Zeile, eigener Absatz).

### Tests

- `web/src/a11y.test.ts` (17 Fälle): Kontrast AA der gedämpften Töne auf allen
  Flächen, 44-px-Regel, Tastatur-Haken der Karte, `ptr-off`-Sperre,
  Querformat-Block samt Markup-Haken, Manifest-Ausrichtung und die
  Installations-Entscheidung (inkl. iOS-Erkennung und Snooze).
- `tests/test_data.py` (`local_day_hours`, `dst_transition_days`),
  `tests/test_models.py` (`seasonal_scale_detail`),
  `tests/test_backtest.py` (DST-Block, `dst_day`, Anker-Zählung),
  `tests/test_rp2_cache.py`/`test_rp2_fallback.py` (G4-Sätze),
  `web/src/data.test.ts` (`dstLabel`).

## [0.28.0] – 2026-09-13

### Hinzugefügt

- **C3 — Karten-/Umgebungsansicht für F2 („Hier oder woanders?“):** Interaktive
  OpenStreetMap-Kartenansicht (`StationMap`) mit Server-Netto-€-Pins (`verdict`,
  `detour_km_est`) in F2 („Hier oder woanders?“). Pins zeigen die vom Server
  berechnete Netto-Ersparnis/Nachteil sowie die Vergleichsstation.
- **Ehrlicher Offline/Luftlinien-Radar-Fallback:** Bei fehlendem Netz, Tile-Ladefehlern
  oder per Umschalter schaltet die Ansicht nahtlos auf ein leichtgewichtiges
  Luftlinien-Radar um, ohne Anfragen zu blockieren oder Client-seitig Haversine-€
  zu errechnen.

## [0.27.0] – 2026-09-13

### Hinzugefügt

- **F4 — klare Intent-Leiste:** Die empfohlene Handlung ist der einzige
  Primärbutton. Neutrale Aktionen bleiben sekundär; „Ich warte“ bzw. „Jetzt
  tanken“ werden bei einem Widerspruch bewusst zurückgenommen und erklären
  den Widerspruch im Tooltip. Die Intent-API und Entscheidungslogik bleiben
  unverändert.
- **C8 (Teil) — Sticky-Aktions-Chip:** „Jetzt tanken“, „Warten bis …“ oder die
  empfohlene Navigation bleibt im Alltag beim Scrollen erreichbar. Ohne
  belastbare Empfehlung erscheint kein Chip. Install-Prompt, Landscape und
  Pull-to-Refresh bleiben ausdrücklich außerhalb dieses Batches.

## [0.26.1] – 2026-09-13

**B11 abgeschlossen** — strenger Kaltlauf-Beleg auf der Zielhardware
(Stand **0.25.1**, vor Batch 4). TODO aufgeräumt (offen oben, erledigt
in der Mitte, Rest unten); A8 (Markenrabatte ohne Daten) gestrichen.

### Gemessen

Kaltlauf 13.09.2026 17:36:21–17:39:16 local (`ops/nas/b11-cold-run.sh`,
25 Stichproben à 5 s). Cache vorher gelöscht und verifiziert. Job-Log:
„Backtest: 0 aus Tages-Cache, 19 neu gerechnet“. 20 Stationen, e10,
Endzustand `partial (some_models_unavailable)`, Dauer **2,6 min**.

| Größe | Wert | Folge |
|---|---|---|
| Python-Prozesse | max **2** gezählt (`cmdline` `python*`) | Gegenprobe CPUS **381 %** ≈ 4 Worker; Forkserver-Kinder (`/usr/local/bin/python…`) fielen durch. Sammler zählt seitdem cmdline **und** `/proc/pid/comm`. Seit 0.26.0 ist die Startmethode `fork`, Forkserver entfällt. |
| Container-Speicher | max **1031 MiB (1,0 GiB)**, MEM % 6,6 | Peak am Ende von Phase B; Leerlauf ~110 MiB. 4 × ~150 MB passen |
| Host verfügbar | min **4212 MiB (4,1 GiB)**, Swap 0 | Weit über der Marke ~500 MiB |
| CPUS | max **381 %** (Phase B 248–381 %) | Pool mit ~4 Workern |
| `/dev/shm` | max **1 MiB** / 256 MiB | `shm_size: 256m` bleibt |

Damit ist der Ressourcen-Abgleich erledigt und die Kaltstart-Zahl für
B15/B16 da: 10,3 min (12.09.) → **2,6 min** kalt / 1,4–1,7 min warm.
Die **Nachher-Dauer von 0.26.0** (ein Pool, `fork`, Cache-Schema 2) bleibt
eine eigene Messung nach dem Deploy — sie hält B11 nicht offen.

### Betrieb

- Sammler `ops/nas/measure-phase-b.sh`: Python-Prozesse über `cmdline` **und**
  `/proc/pid/comm`.
- [docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11):
  B11 mit den fünf Zahlen; Kaltlauf nach B15/B16 **~2,6 min**.

## [0.26.0] – 2026-09-13

**Batch 4 des Laufzeit-Bündels — Feinschliff ohne Änderung der fachlichen
Modellzahlen.** B19 räumt den Prozess-Pool auf, B20 entfernt tote Arbeit und
macht den Fortschritt wahrheitsgetreu, B23 begrenzt die automatische
Worker-Zahl auf die CPUs, die der Container wirklich nutzen darf. Die bereits
gemessenen B11-Ressourcenwerte sind in der Betriebsanleitung eingeordnet.

### Geändert

- **B19 — ein Pool je Kraftstoff statt zwei** (`app/model_jobs.py::ModelTaskPool`,
  `app/refresh.py`): Fit/24 h (Phase A) und 72 h/168 h/Backtest (Phase B)
  laufen in denselben Worker-Prozessen. Der eigenständige Job-Prozess ist
  single-threaded; auf POSIX wird deshalb explizit `fork` gewählt statt des
  Python-3.14-Defaults `forkserver` (Fallback `spawn`, wenn `fork` nicht
  verfügbar ist). Fällt die Pool-Infrastruktur aus, werden nur noch offene
  Aufgaben seriell nachgerechnet; bereits gemeldete Ergebnisse und ihre
  Fortschrittszeilen bleiben erhalten.
- **B19 — schlanke Worker-Eingabe:** Von neun Rasterspalten gehen nur die sechs
  tatsächlich von Fit und Backtest gelesenen Spalten in die `initargs`
  (`price`, Beobachtungs-/Antwortmasken, Status-Herkunft, Quelle,
  Beobachtungszeit). Der B17-Fingerabdruck ist auf genau dieselben fachlichen
  Eingaben normalisiert. Cache-Schema **2** verwirft Schema-1-Dateien beim
  ersten Lauf einmalig; danach bleibt die Tages-Cache-Semantik unverändert.
- **B20/2 — keine Prognose ohne Testwahrheit:** Leere +3-d/+7-d-Fenster werden
  vor `predict()` als `no_common_observations` gezählt. Im gemessenen
  Produktionsmuster entfallen damit 8 von 63 Mehrtage-Aufrufen je Station
  (13 %), ohne eine Kennzahl zu ändern.
- **B20/4 — nur Publikationsfelder über die Prozessgrenze:** `_records` baut
  direkt `timestamp` + fünf Quantile, ohne Vollkopie, `index.map(lambda …)`
  und interne Diagnosefelder. Wide-Aufgaben schicken außerdem ihr nur lokal
  benötigtes Modellartefakt nicht mehr zum Parent zurück.
- **B20/5+7 — Fertigstellung heißt Fertigstellung:** Parallel ruft
  `as_completed` den Callback in echter Abschlussreihenfolge auf; die
  Ergebnisliste bleibt für eine deterministische Publikation in
  Einreichreihenfolge. Seriell folgt `on_done` unmittelbar auf jede Aufgabe
  statt erst nach der gesamten Phase — kein 22-Minuten-Fenster ohne
  Lebenszeichen mehr.
- **B20/6 — monotoner Fortschritt:** `gapfill` hat eine benannte Phase und ein
  Gewicht; der lange Fit-Block belegt jetzt 35–95 % statt 85–95 %. Eine
  monotone Untergrenze verhindert Rücksprünge bei optionalen Phasen und
  mehreren Kraftstoffen, `completed` übernimmt dabei den globalen
  Aufgabenzähler. Abschlusszustände enden bei 100 %.
- **B23 — Worker nach Prozesssicht und Container-Quota:** Automatik nutzt
  `os.process_cpu_count()` ab Python 3.13, auf 3.11/3.12 die CPU-Affinität,
  und zusätzlich cgroup v2 `cpu.max` bzw. v1
  `cpu.cfs_{quota,period}_us`. Docker `--cpus`/`NanoCpus` ist darin bereits
  abgebildet. Beispieltest: acht Host-Kerne, aber Affinität oder Quota für zwei
  CPUs ergeben zwei Worker. Ein positiver, expliziter
  `TANKAPP_MODEL_WORKERS`-Wert bleibt eine bewusste Betreiber-Vorgabe.
- **Doku-Integrität:** Der Merge vor diesem Batch hatte `TODO.md` mitten in der
  0.25.1-Zeile abgeschnitten (einschließlich Reihenfolge-Abschnitt); der
  verlorene, unveränderte Historienteil ist wiederhergestellt. Damit zeigt der
  bestehende Link aus `docs/LUECKEN.md` wieder auf einen vorhandenen Anker.

### Gemessen

- **Sandkasten, 20 synthetische Stationen × 35 Tage:** Worker-Frame
  31,24 → **17,69 MiB** (−43 %), Pickle der `initargs` 10,50 → **7,32 MiB**
  (−30 %, 89 → 35 ms). Eine 168-h-Punktliste trägt 6 statt 11 Felder:
  Pickle 283,6 → **175,3 KiB** (−38 %), Serialisierung 7,9 → 6,7 ms. Das ist
  eine Struktur-/Transfermessung, keine übertragbare NAS-Laufzeit.
- **NAS vorher (13.09.2026, Stand bis 0.25.1):** warme Läufe mit komplettem
  Tages-Cache **1,4–1,7 min**, Phase B rund 50 s. Der erste B11-Messlauf mit
  9 Cache-Treffern/10 Neuberechnungen dauerte **2,1 min**; Peak 1,0 GiB
  Container, Host mindestens 4,1 GiB verfügbar, `/dev/shm` 1 MiB von
  256 MiB, CPU max. 370 %. Damit bleiben vier Worker und `shm_size: 256m`.
- **NAS nach 0.26.0 steht noch aus.** Die Batch-Regel verlangt die Dauer aus
  der Job-Log-Zeile `beendet: … Dauer …`; sie kann erst nach dem Deploy
  ergänzt werden. Durch Cache-Schema 2 ist der erste Lauf automatisch ein
  strenger Kaltlauf (0 Treffer erwartet). `ops/nas/b11-cold-run.sh` sammelt
  Laufzeit, Prozesszahl und Ressourcen in einem Report; bis dieser Beleg
  vorliegt, wird weder „~28 s“ noch ein neuer Speicher-Peak als Messwert
  behauptet.

### Tests

- Prozess-/Seriell-Fingerprints bleiben gleich; ein Fake-Pool beweist eine
  Instanz für zwei Aufgabenwellen, schlanke `initargs`, explizite Startmethode,
  echte Callback-Reihenfolge bei stabiler Ergebnisreihenfolge und genau einen
  Shutdown.
- Regressionen für sofortigen seriellen Callback, Affinität + cgroup-v1/v2-
  Quota, reine Publikationsspalten/kein Wide-Modell, leere Mehrtage-Fenster,
  Cache-Fingerabdruck und die monotone 15→25→30→35…95→99→100-Abbildung.
## [0.25.1] – 2026-09-13

**Begleitpunkte des Laufzeit-Bündels — ausdrücklich ohne Batch 4**
(B19/B20-Rest/B23 bleiben liegen). Auslöser war ein Job-Log vom 13.09.2026 mit
„1 Fehler“ und der Endzeile `77/80`: beides war nicht zuordnenbar, weil die
Ursache nur auf Container-stdout stand und der Zähler Aufgaben mitzählte, die
gar nicht mehr eingereicht werden.

### Behoben

- **Fehlerursache im Job-Log** (`app/refresh.py`, `app/progress.py::note`):
  Fällt der Fit einer Station aus (`insufficient_or_invalid_training_data`),
  fehlt ihre Historie (`missing_history`) oder scheitert ein Horizont/Backtest
  (`horizon_or_backtest_failed`), steht der Grund jetzt mit Stationsname und
  Engine-Text in `runtime/jobs/models.log` — z. B. „nur 12 nutzbare Tage mit
  344 offenen 5-Minuten-Preisen in 42 Tagen; mindestens 28 Tage mit 672
  Punkten erforderlich“. Bisher stand die Zeile nur in `docker logs`, zwischen
  hunderten anderen. Neu dafür: `note(…, sticky=False)` — eine Log-Zeile, die
  **nicht** als Status an jedem folgenden Schritt kleben bleibt. Erst mit der
  Zahl im Log ist entscheidbar, ob die Station je fitbar wird oder dauerhaft
  tot ist (A12).
- **Ehrlicher Fortschrittszähler** (`app/progress.py::retotal`): Die
  Gesamtzahl ist vorab als `Stationen × Kraftstoffe × 4 Aufgaben` geschätzt
  (heute 80). Fällt eine Station in Phase A aus, entfallen ihre drei
  Folgeaufgaben (+3 d, +7 d, Backtest) — die Zahl wird nachgezogen
  (Log-Zeilen „1 Station ohne Modell — 3 Folgetasks entfallen“ und
  „Gesamtzahl auf 77 Schritte korrigiert“), statt mit „77/80“ zu enden. Der
  Balken springt dabei nicht zurück (nie weniger als schon erreicht), und bei
  mehreren Kraftstoffen zählt er über alle hinweg — vorher begann jeder
  Kraftstoff wieder bei 0.

### Betrieb

- **B11-Messprotokoll auf den Kaltlauf umgestellt**
  ([docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11)):
  Der Tages-Cache des Backtests (B17) gilt für den ganzen lokalen Tag — sein
  Fingerabdruck enthält `end_local`, den letzten vollständigen Tag. Weil
  `models` nach B18 nur 1×/Tag läuft, ist **jeder Planlauf ein Kaltlauf**
  (~9 min Phase B, zugleich der Speicher-Worst-Case); warm (~40 s) sind nur
  zusätzliche Läufe am selben Tag, etwa nach einem Container-Recreate. Gemessen
  wird deshalb im Kaltlauf; kalt erzwingen geht per `TANKAPP_BACKTEST_CACHE=0`
  oder durch Löschen von `runtime/engine/backtest-cache/`.
- **Sammler statt Hand-Tippen**: `ops/nas/measure-phase-b.sh` schreibt alle 5 s
  eine Zeile (Speicher, `MEM %`, CPU, Python-Prozesse, Host verfügbar,
  `/dev/shm` — je mit der Phase aus dem Job-Log) und rechnet am Ende die
  Maxima/Minima zusammen. Die vier von Hand getippten Befehle treffen das
  40-s-Fenster eines Warm-Laufs nicht mehr.
- **Die Messung selbst steht weiterhin aus** — B11 bleibt offen, bis die fünf
  Zahlen in [TODO.md](TODO.md) eingetragen sind.

### Tests

- `tests/test_app_jobs.py`: nicht-klebende Notiz bleibt aus dem Status, aber
  steht im Log; `retotal` korrigiert die Gesamtzahl ohne Rücksprung; ein
  Refresh mit unfitbarer Station nennt den Grund im Job-Log und endet bei
  `5/5` statt `5/8`; ein harter Fit-Fehler (`engine.models.fit` wirft) landet
  mit seiner Meldung im Log.

## [0.25.0] – 2026-09-13

**Batch 0 des Laufzeit-Bündels** (TODO.md §B, „0 — ohne Code“): Ursachen
klären statt rechnen. Der Hauptbefund ist kein Laufzeit-Thema, aber ein
echter Fehler: „e10: **0 Stationen**“ im Modell-Lauf war weder ein
Eingabedaten-Problem noch ein stiller Fehler, sondern ein Coverage-Gate, das
gegen einen Nenner misst, den dieser Betrieb nie erreichen kann. „Meine
Stationen“ war damit dauerhaft leer.

### Behoben

- **B21 — die Selektion lieferte immer null Stationen**
  (`engine/selection.py::analyse_city_light`): Das Datenqualitäts-Gate
  (Konzept §2 Zeile 6, „Coverage ≥ 85 % je Station“) maß die Abdeckung gegen
  das **volle** 5-Minuten-Raster über die gesamte Datenreichweite. Zwei
  strukturelle Gründe machen 85 % dort unerreichbar — unabhängig davon, wie
  vollständig die Daten sind (Nachbau mit Produktions-Kadenz, 8 Stationen,
  40 Tage lückenlos, gemessen in dieser Version):
  1. **Nachtzellen.** Der Collector pollt 06–24 Uhr
     (`Config.poll_start`/`poll_end`); die übrigen 25 % des Rasters sind nie
     besetzt, und das 30-Minuten-ffill reicht nicht über die Lücke.
     Maximalwert bei lückenlosem 5-Minuten-Polling: **77,5 %**.
  2. **Archiv-/Bootstrap-Betrieb.** Das Tankerkönig-Archiv liefert
     Preis-*Ereignisse*, keine Rasterpunkte. Zusammen mit der dichten
     Live-Phase fällt der Median-Gap auf 5 min und damit das ffill auf
     30 min — ein Archiv-Ereignis deckt 30 von 216 Tageszellen ab. Gemessen
     **4,8 %** (30 Tage Archiv + 2 Tage Live) bzw. **1,3 %** (120 + 2 Tage).

  Beides zusammen heißt: `coverage >= 0.85` war für **jede** Station falsch,
  `mat.shape[1] < 4` griff, `top_global` blieb leer, `current.json` hatte kein
  Ranking, und das Job-Log sagte nur „e10: 0 Stationen“. Jetzt misst
  `scheduled_mask` die Abdeckung nur über die Zellen des Polling-Fensters
  (Fenster und Zeitzone kommen aus derselben `Config` wie der Rest des Laufs —
  `app/refresh.py` und `app/selection.py` reichen sie durch), und
  `coverage_gate` legt die Schwelle **relativ zum Bestwert der Stadt**
  (`min_coverage` × Referenz). Ausgeschlossen wird damit, wer deutlich
  seltener liefert als die Vergleichsstationen — genau die Datenqualität, die
  das Gate schützen soll — und nicht, wer eine andere Datenquelle hat.
  Gegenprobe im Test: Eine Station, die nach Tag 5 aufhört zu liefern, fällt
  weiter raus (`excluded: ["tot"]`), die anderen fünf bleiben im Ranking.
- **B21 — eine Stadt ohne Ranking verschwand kommentarlos**: Fand
  `analyse_city_light` keine einzige Zeile, kam `None` zurück und
  `compute_all` ließ die Stadt ganz fallen — derselbe blinde Fleck wie „0
  Stationen“, nur eine Ebene tiefer. Jetzt gibt es einen Diagnose-Eintrag mit
  Grund („n Station(en) ohne verwertbares δ̂ — zu wenig gleichzeitige Werte“),
  Reichweite und Punktzahl; `compute_all` führt ihn unter `diagnostics`.
- **B21 — NaN-Zeilen im Ranking**: Eine Station ohne einzigen verwertbaren
  Zeitpunkt (LOO braucht ≥ 4 Stationen mit Wert zur selben Zeit) hat kein
  δ̂ und wurde trotzdem als Zeile mit `delta_ct: NaN` publiziert. Solche
  Stationen fallen jetzt raus und stehen als `no_delta`/`no_delta_count` im
  Artefakt.
- **B11 — belegter Feedback-Store meldete „Ungültige Anfrageparameter“**
  (`app/feedback.py`, `app/data.py`, `app/server.py`): `locked_store` reichte
  nach 50 × 0,05 s den Rohtext der Sperre („Feedback-Store: in diesem
  Verzeichnis läuft bereits ein Prozess.“) als `ValueError` weiter,
  `record_fill` machte daraus den Fehlercode und die API daraus **400
  `invalid_query`** — klingt nach falscher Eingabe, war aber belegter
  Speicher auf der NAS-Platte. Jetzt: Wartezeit als benanntes Budget
  (`LOCK_ATTEMPTS` × `LOCK_RETRY_SECONDS` = 100 × 0,05 s = **5 s**, vorher
  2,5 s — B11: „bei NAS-HDD werden die File-Locks knapp“) und beim Aufgeben
  `ValueError("store_locked")` → **503** (wiederholbar) mit eigenem Text in
  der GUI: „Speicher ist gerade belegt — in ein paar Sekunden erneut
  versuchen.“ Gilt für alle drei Schreibpfade (`fills`, `fills/{id}`-Storno,
  Intent).

### Geändert

- **Ausweis des Coverage-Gates im Selektions-Artefakt**
  (`runtime/selection/{fuel}.json` je Stadt): `coverage_window`
  (z. B. `06-24`), `coverage_reference` (Bestwert der Stadt),
  `coverage_threshold` (wirksame Schwelle), `coverage_min`/`coverage_max` in
  Diagnose-Einträgen sowie `no_delta`/`no_delta_count`. Ohne diese Zahlen ist
  „warum ist Station X nicht dabei?“ nicht beantwortbar — der Grund für die
  B21-Suche.
- **Diagnose-Texte nennen Zahlen**: „nach Coverage-Gate (≥85 % vom
  Stadt-Bestwert 98 % im Fenster 06–24 Uhr) nur 2 Station(en) übrig — LOO
  braucht ≥4“ statt „nach Coverage ≥85% nur 2 Station(en) übrig“.
- `docs/ANALYSE.md`: Coverage-Gate (Zeile 6 der Selektions-Tabelle) mit der
  neuen Definition und dem Unterschied zur Offline-Pipeline
  `analysis/station_selection.py` (dort bleibt das absolute Gate mit
  `--min-coverage`, weil dort ein Operator auf die Fehlermeldung reagieren
  kann).
- `docs/BETRIEB.md`: Messprotokoll „Ressourcen während Phase B messen (B11)“
  — die ausstehende NAS-Messung als Copy-Paste-Block statt als Erinnerungsnotiz.

### Gemessen

Nachbau der Produktions-Kadenz im Sandkasten (8 Stationen, 5-Minuten-Raster
06–24 Uhr, `SelectionConfig`-Defaults, B = 200):

| Datenstand | Coverage gegen Vollraster | Ranking vorher | Ranking nachher |
|---|---|---|---|
| 40 Tage lückenlos live | 77,5 % | 0 Stationen | 8 Stationen |
| 30 Tage Archiv + 2 Tage live | 4,8 % | 0 Stationen | 8 Stationen |
| 120 Tage Archiv + 2 Tage live | 1,3 % | 0 Stationen | 8 Stationen |
| 20 Tage live, eine Station ab Tag 5 tot | 77,5 % / 19 % | 0 Stationen | 5 Stationen, `excluded: ["tot"]` |

**Bitgleichheit, wo das Gate nicht bindet** (42 Tage dichte Stundenwerte,
24 h — Coverage alt wie neu 100 %): dieselben Stationen, dieselbe
Reihenfolge, alle Stationsfelder (`delta_ct`, `delta_ew_ct`, `ci_lo`, `ci_hi`,
`score`, `coverage`) unverändert; geprüft gegen die Implementierung vor dieser
Änderung und als Invarianz-Test hinterlegt (Fenster 06–24 gegen 00–24).
Wo das Gate bisher alles ausgeschlossen hat, gibt es keine „alten“ Zahlen, die
sich verschieben könnten — das Ranking erscheint dort zum ersten Mal.

**Beleg von der Zielhardware (Job-Log 13.09.2026, Stand 0.24.1 — dieser Fix
war dort noch nicht deployed):** drei Läufe, in jedem dauert die Phase
„Selektion (δ̂)“ **0,13–0,15 s** (07:52:38.343→.491, 10:15:44.663→.793,
10:50:14.125→.257). Ein δ̂-Ranking für 20 Stationen mit B = 2000 rechnet nicht
in einer Zehntelsekunde — das ist der Bail-out des Gates, und der Nachbau am
denselben Datenstand (20 Stationen, 2 Städte, 25 051 Archiv-Ereignisse,
10 748 Live-Zeilen) liefert mit dem Stand vor diesem Fix **0 Stationen in
0,05 s** samt Grund „nach Coverage ≥85% nur 0 Station(en) übrig“.

**Was der Fix kostet:** dieselbe Selektion mit echtem Ranking (20 Stationen,
2 Städte, B = 2000) dauert **1,5 s** statt 0,05 s — gemessen am NAS-Datenstand.
Gegen die 1,4–1,7 min Laufzeit des Modell-Laufs ist das vernachlässigbar, aber
es ist nicht null, und es steht hier, weil dies ein Laufzeit-Bündel ist.

> **Batch 0 hat planmäßig keine Laufzeitwirkung** („keine, aber
> Entscheidungsgrundlage“) — die einzige messbare Folge ist die eine
> tatsächlich gerechnete Selektion (+1,5 s). Aus demselben Job-Log lässt sich
> aber die bisher ausstehende Gegenmessung für **B15/B16 (0.20.0)** und
> **B17 (0.22.0)** ablesen: **1,4–1,7 min** je Lauf (07:52: 1,7 min,
> 10:15: 1,5 min, 10:50: 1,4 min) statt 10,3 min am 12.09.2026 — Backtest
> komplett aus dem Tages-Cache („19 aus Tages-Cache, 0 neu gerechnet“),
> Phase B nur noch ~50 s. Ein Kaltstart des Caches (erster Lauf des Tages)
> ist in diesem Log nicht enthalten. Nachgetragen in TODO.md, Batch 1 und 3.
>
> **Weiter offen: B11 auf der Zielhardware** — `docker top tankapp-web-app-1`
> und `docker stats --no-stream` **während Phase B** (nicht im Leerlauf),
> Protokoll in
> [docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11).
> Erwartet wird keine Beschleunigung, sondern der Beleg, ob 4 Worker ×
> pandas in `shm_size: 256m` und 4,2 Gi verfügbarem Host-Speicher passen.

### Tests

- `tests/test_selection.py` (6 neu): lückenloses 06–24-Polling ergibt ein
  Ranking und nennt `coverage_reference`/`coverage_window`/`coverage_threshold`;
  Archiv-Präfix + Live bleibt rankbar (mit Beleg, dass ein absolutes Gate
  ausgeschlossen hätte); tote Station wird weiterhin ausgeschlossen; Stadt
  ohne Überlappung liefert Diagnose statt `None` (`compute_all` →
  `diagnostics`, `top_global` leer); Fenster ändert keine Zahl, wenn nachts
  Daten liegen; beide NAS-Aufrufe reichen das Polling-Fenster durch
  (Quellenprüfung wie beim B = 2000-Test).
- `tests/test_b4.py` (2 neu): belegter Store liefert `store_locked` auf allen
  drei Schreibpfaden und 503 aus `_fill_status`, danach schreibt derselbe Pfad
  wieder; das Wartezeit-Budget ist benannt (100 × 0,05 s = 5 s).
- `web/src/data.test.ts` (1 neu): `messages.store_locked` existiert, nennt die
  Handlung („erneut versuchen“) und ist nicht der `invalid_query`-Text.
- Geprüft auf dem Stand **nach** PR 94 (0.24.1, Stations-Labor-Fix):
  `python -m pytest -q` **670 grün** (davon 8 neu), `npm --prefix web test`
  **244 grün** (davon 1 neu), `npm --prefix web run build` grün,
  `ruff check` + `ruff format --check` grün.

## [0.24.1] – 2026-09-13

**Regressionsfix Stations-Labor** — der Preisverlauf im Werkstatt-Tab
zeigte trotz vorhandener Polling-Beobachtungen immer „keine Daten“.

### Behoben

- **Stations-Labor 24 h / 3 Tage / 7 Tage: „keine Daten“ trotz N Preisen.**
  Der Verlaufs-Chart schnitt die Punkte gegen ein Fenster aus
  `performance.now()` (Seitenlaufzeit, Sekunden, ~10³) — die
  Punktkoordinaten sind aber Epoch-Millisekunden aus den
  Server-Zeitstempeln (`Date.parse`, ~10¹²). Jeder echte Punkt lag damit
  vor dem Fenster; der Chart renderte „keine Daten“, während die
  Datenreichweite-Notiz (serverseitig gezählt) die Preise korrekt
  auswies (im Regressionsfall: 108 Preise, Sa 12.09. 12:25 – So 13.09.
  12:15 Uhr). Das Fenster kommt jetzt aus `historyWindowMs()`
  (`web/src/data.ts`) — Wandzeit (`Date.now()`) bei der Länge des
  gewählten Zeitraums. Der Seitenlaufzeit-`now`-State bleibt erhalten und
  dient weiterhin nur dem Datenalter (elapsed).
- Regressionstest `web/src/stations-lab-window.test.ts`: Fensterende in
  Wandzeit (Epoch-Millisekunden), Beobachtungspunkte des letzten Tags im
  24-h-Fenster, zwei Tage alte Punkte erst im 72-h-Fenster.

## [0.24.0] – 2026-09-13

**C4** — Einstellungen-Tab zentral: alle Defaults an einer Stelle statt
verteilt über die Panels, dazu die aktiven Entscheidungsschwellen als
read-only-Tabelle und die Dark/Light-Umschaltung, die die Fallback-GUI
am RP2 schon hatte und die NAS-GUI (dunkles Slate) nicht.

### Hinzugefügt

- **C4 — Einstellungen-Tab** (`web/src/views/Settings.tsx`, neu; vierte
  Ansicht nach Alltag/Werkstatt/System). Verbrauch, Zeitwert
  (manuell/auto), Liter-Default, Kraftstoff und Stadt lagen verteilt in
  Panels (Alltag „3 · Was kostet die Füllung“ und „6 · Rechnet sich der
  Umweg?“, Kopfzeile) — jetzt ist der Tab der einzige Eingabeort für die
  Defaults: Kontext (Stadt, Kraftstoff), Fahrzeug & Füllung (Tankmenge,
  Verbrauch, Tankgröße), Zeit & Fahrtcharakter (Zeitwert mit Automatik,
  Tempo, Fahrtcharakter). Der Alltag zeigt die aktiven Werte read-only
  (Tankmenge-Kachel, Wertezeile in der Umweg-Sektion, Tankgrößen-Hinweis
  im Tankstand) mit Verlinkung „in ‚Einstellungen‘ ändern“ — dieselben
  Werte, ein Speicher (localStorage/Profil), keine Duplikate. Die
  Kopfzeile behält Stadt/Kraftstoff/Profil als Schnellwahl derselben
  Werte. Tankgröße war vorher nur editierbar, wenn ein Füllstand gesetzt
  war; jetzt immer.
- **C4 — Schwellen-Tabelle (read-only)**: der Tab zeigt die aktiven
  Entscheidungsschwellen aus `GET /api/v1/stats/summary` → `thresholds`
  (die neun Werte, mit denen die Engine entscheidet: Warten grün/gelb,
  Woanders tanken inkl. Grauzone, Jetzt tanken) plus den M7-Nachzug-
  Status (`threshold_tuning`: aktiv/aus, Stichprobe je Aktion,
  Begründung der Engine, wenn sich Werte ändern). Reine Anzeige — die
  GUI rechnet mit den Schwellen, ändert sie aber nicht; ohne
  Statistik-Lauf steht ein ehrlicher Leerstand. `StatsSummary`-Typ in
  `data.ts` um `thresholds`/`threshold_tuning` ergänzt (Server lieferte
  beides schon, die GUI wusste nicht darum).
- **C4 — Dark/Light-Umschaltung** (Darstellung-Panel im Tab): „Dunkles
  Slate (Standard)“ bleibt der Default (Design-Basis, docs/GUI-VORLAGEN);
  „Hell (Slate)“ ist eine helle Variante derselben Tailwind-Skala —
  Tailwind v4 kompiliert Farbklassen als CSS-Variablen-Verweis, deshalb
  kippt `html.light` in `styles.css` nur die Token-Werte
  (Slate-Skala umgedreht, Akzent-Texttöne dunkler, dunkle Box-Tönungen
  hell), jede Klasse im Code bleibt unverändert; die Werte folgen der
  Light-Palette der Fallback-GUI (rp2/fallback_gui.py), damit beide
  Oberflächen beieinander liegen. Die Wahl gilt gerätelokal
  (`tankapp.theme`), ein Bootstrap-Script in `index.html` wendet sie vor
  dem ersten Paint an (kein Theme-Flash) und hält `theme-color`
  synchron. Fallback-GUI: unverändert, hatte Dark/Light schon (v2.0).

### Geändert

- Alltagstabs: die Default-Regler (Tankmenge, Verbrauch, Tempo,
  Zeitwert, Fahrtcharakter, Tankgröße) sind raus — ersetzt durch
  read-only-Werte mit Link in den Einstellungen-Tab (C4).
- `docs/TODO.md`: C4 aus der offenen Liste gestrichen;
  Reihenfolge-Empfehlung angepasst.
- **Straßen-Distanzen ohne Request-Blockade** (`app/data.py`): Der
  Request-Pfad (alle Endpunkte, inkl. `/health`) liest für
  `dist_km`/`dist_mode` jetzt **nur den lokalen Routen-Cache**
  (`runtime/road_route_cache.json`); unbekannte Anker→Station-Paare
  bekommen sofort die Luftlinie (`dist_mode: "air"`, nie erfunden).
  Fehlende Routen holt ein Hintergrund-Thread (Debounce je Anker, hartes
  Wanduhr-Budget 20 s, 5-min-Cooldown bei Fehlschlag); der nächste
  Request nutzt die neuen Einträge über die Datei-mtime (invalidiert das
  Metadata-Memo). Vorher lief je Request je Anker eine Live-OSRM-Anfrage
  — bei wackeligem Internet/DNS am NAS blockierte das die komplette API
  (gemessen: `/health` 54 s, `/stations` 67 s).
- **Metadata-Memo** (`app/data.py`): `metadata()` ist auf die
  Datei-Stats von `polling.json` + Routen-Cache geschlüsselt (30-s
  Backstop): Wiederholte Requests zahlen eine Dict-Kopie statt
  Re-Parse/Re-Ableitung aller Distanzen.
- **OSRM-Server konfigurierbar**: `TANKAPP_OSRM_URL` (eigener
  OSRM, z. B. NAS-Docker — LAN-only statt Drittanbieter-Demo-Server),
  `TANKAPP_OSRM` (`0` = kein Netz, nur Luftlinie). Beide laufen über
  `tankapp.py nas-up` in die Compose-Umgebung (`ops/nas/app/compose.yml`).
- **Stations-Preise: Stale-While-Revalidate** (`app/data.py`): Sobald
  ein Cache-Eintrag existiert, antwortet `/api/v1/stations` (und damit
  alles, was darauf aufbaut: `decide`, `route/evaluate`, …) sofort mit
  dem letzten bekannten Stand; der InfluxDB-Read (2-Tage-Fenster,
  mehrere Sekunden auf der NAS) läuft im Hintergrund (Single-Flight je
  Kraftstoff, Daemon). 30-s-Intervall und Fehler-Semantik unverändert
  (fehlerhafter Read behält den bekannten Stand und meldet
  `influx_read_failed`, sobald der Hintergrund-Read gescheitert ist).
  Die Erst-Ladung je Stations-Menge bleibt synchron — der Server warmt
  alle drei Kraftstoffe beim Start im Hintergrund vor
  (`LiveData.prewarm()` in `app/server.py`), sodass der erste
  GUI-Request danach in der Praxis nie wartet.
- `docs/BETRIEB.md`: Abschnitt „GUI-Responsivität“ mit
  OSRM-Empfehlung (eigener Server) und Verhalten bei Internet-Ausfall.

### Behoben

- **API-Antwortzeiten bei OSRM-Ausfall** (Produktiv-Meldung: `/health`
  54 s, `/stations` 67 s): Die Straßen-Distanz-Ableitung stand auf jedem
  Request (auch `/health`, dessen Docker-Healthcheck-Budget 3–5 s ist)
  und machte Live-OSRM-Calls mit 4-s-Socket-Timeout — dem Timeout
  unterliegt die DNS-Auflösung nicht (hängt bei wackeligem DNS beliebig
  lange), und Fallback-Ergebnisse wurden nicht gecacht,
  also versuchte jeder Request das Netz erneut. Jetzt: Request-Pfad
  cache-only (Millisekunden), Fetch nur im Hintergrund, Healthcheck
  wieder im Budget; Details unter „Geändert“.
- **Rest-Latenz von `/stations` (InfluxDB-Read)**: Nach dem OSRM-Fix
  blieb der 2-Tage-InfluxDB-Read im Request-Pfad (mehrere Sekunden je
  30-s-Cache-Zyklus auf der NAS). Jetzt Stale-While-Revalidate +
  Start-Prewarm: im Steady-State antwortet `/stations` aus dem Cache,
  der Read läuft im Hintergrund — Antwortzeit komplett entkoppelt von
  InfluxDB-Latenz (Einzelheiten unter „Geändert“).

### Tests

- `web/src/settings.test.tsx` (neu): die GUI kennt genau die neun
  Server-Schwellen, Formattierung über die Formatter (€/L in €, P in %),
  Status-/Stichprobe-Zeilen, Read-only-Tabelle ohne Eingabefelder,
  ehrlicher Leerstand ohne Statistik, Begründungs-Anzeige bei Nachzug;
  alle Default-Eingabeorte an einem Ort; Dark/Light (zwei Themen,
  `<html>`-Klasse + theme-color-Meta, aria-pressed je Stand).
- e2e: `app.spec.ts` — neuer Test „C4: Einstellungen-Tab“ (alle
  Eingabeorte, Schwellen-Zeilen mit Server-Werten, keine Inputs in der
  Tabelle, Theme-Wechsel übersteht den Reload) + die
  Tankmenge-Eingabe läuft jetzt über den Einstellungen-Tab;
  `horizons.spec.ts` — Zeitwert-Automatik wird im Tab gesetzt, der
  Alltag zeigt „Auto (… €/h Peak/offpeak)“ read-only.
- `tests/test_app.py` (Server-Latenz, 0.24.0): Metadata-Memo
  (bis zur Datei-Änderung stabil, Mutation-sicher), Request-Pfad wartet
  nie auf OSRM (Hintergrund-Fetch füllt die Cache-Datei, genau ein
  Netz-Call), Refresh-Debounce bei Internet-Ausfall, `TANKAPP_OSRM_URL`
  wird respektiert, `/health` ohne Router-Warten; dazu Stations-Preise:
  Stale-While-Revalidate wartet nie auf InfluxDB, Single-Flight bei
  parallelen Requests, Fehlschlag behält den bekannten Stand, Prewarm
  erwärmt e10/e5/diesel.

## [0.23.0] – 2026-09-12

**A1, A2, A4, C2** — die vier offenen P1-Punkte der Fach- und GUI-Listen:
Fahrzeug-/Haushaltsprofile ohne Login (serverseitig), Tankstand als
F3-Eingabe, Monats-/Jahresbilanz in der Werkstatt und Stamm-Stationen mit
Suche/Filter/Sortierung im Alltag.

### Hinzugefügt

- **A1 — Fahrzeug-/Haushaltsprofile** (`app/profiles.py`, neu). Verbrauch,
  Zeitwert, Tankmenge, Kraftstoffart, Stadt-/Pendel-Tempo und Tankgröße
  liegen statt nur im Geräte-localStorage jetzt serverseitig für den
  Haushalt — ohne Login, bewusst LAN-only. Endpunkte: `GET /api/v1/profiles`,
  `POST /api/v1/profiles`, `PUT /api/v1/profiles/{id}` (partiell),
  `POST /api/v1/profiles/{id}/activate`,
  `POST /api/v1/profiles/activate` mit `{"active": null}` (Deaktivieren) und
  `DELETE /api/v1/profiles/{id}`; höchstens 8 Profile, dieselben Grenzen wie
  die GUI-Slider, Schreib-Budget (B5) gilt mit. Profil-Store unter
  `runtime/profiles/profiles.json` mit `schema_version` (B2-Muster:
  Migrationstabelle statt stiller Feldsprünge), Digest-Vergleich schreibt nur
  bei echter Änderung, Prozess-Lock wie Feedback-Store. GUI: Profil-Umschalter
  im Header, Verwaltungs-Dialog (`components/ProfileManager.tsx`) für
  Anlegen/Umbenennen/Löschen/Aktivieren; Sync in beide Richtungen — Server →
  GUI bei Profilwechsel oder Fernänderung (120-s-Poll), GUI → Server
  entprellt (800 ms) für jedes geänderte Profil-Feld. Fällt der Server aus,
  gilt weiter der letzte localStorage-Stand (offen gesagt im Dialog). Stadt
  und Vergleichsstation bleiben bewusst Gerätesache. Tests
  `tests/test_profiles.py` (Statuscodes, Persistenz, Limit, 404-Fälle).
- **A2 — Tankstand / Restreichweite als F3-Eingabe** (`app/decide.py`).
  `decide` nimmt `tank_percent` (mit `tank_capacity_l`, Default 50 l) oder
  `range_km` (Bordcomputer) und antwortet mit einem `tank`-Block:
  Restreichweite, Reserve-Reichweite (5 l ÷ Verbrauch × 100 — Reichweite aus
  Menge und Verbrauch, nicht als feste km-Zahl), Zustand `empty`/`low`/`ok`
  und Klartext. `empty` (Rest ≤ Reserve) blockiert eine Warte-Empfehlung: Die
  angezeigte Aktion kippt von `wait` zu `refuel_now` mit „Warten riskant …
  Tank jetzt, nicht auf das Fenster warten“ — Physik statt Modell, der Block
  erscheint deshalb unabhängig vom M7-Gate. Der Ledger bekommt die wirklich
  angezeigte Aktion plus `tank_state` (sonst würde ein befolgtes „jetzt tanken
  (Reserve)“ später als „ignoriert“ zählen); die Tabellen-Aktion selbst bleibt
  unangetastet (Güte-Gate, Shadow-Messung). GUI: Tankstand-Karte in „1 ·
  Empfehlung“ (Füllstands-Slider mit Live-Restreichweite, Tankgrößen-Slider,
  Server-Bewertung als roter/amber Block bzw. ruhige Zeile). Ungültige Werte
  → `400 invalid_tank`. Tests `tests/test_decide_tank.py` (Grenzen, Override,
  Ledger, `invalid_tank`).
- **A4 — Monats-/Jahresbilanz in der Werkstatt** (`app/feedback.py::
  compute_wallet_balance`, Endpunkt `GET /api/v1/fills/summary`). Gruppiert
  aktive Belege je Kalendermonat/-jahr in Europe/Berlin (der Kalender des
  Nutzers, nicht UTC — ein Beleg am 1.1. 00:30 Berlin zählt zum Januar),
  je Zeile Füllungen, Liter, € gesamt, Ø €/Tankung, Ø €/l, Ersparnis und die
  „immer sofort getankt“-Baseline (`total + saved`, darf negativ sein);
  `overall` mit `saved_pct` und ehrlichem `n_without_date` für Belege ohne
  lesbares Datum. Stornierte Belege zählen nicht. GUI: Panel „Monats- &
  Jahresbilanz“ am Ende der Werkstatt — vier Kacheln (Tankungen, Ø pro
  Tankung, Gesamtsumme, Ersparnis gegen Baseline) plus umschaltbare Monats-/
  Jahrestabelle. Tests `tests/test_wallet_balance.py`.
- **C2 — Stamm-Stationen pinnen + Suche/Filter/Sortierung** (Alltag „5 ·
  Stationen“). Stern je Zeile pinnt die 2–3 Stammstationen nach oben
  (Pin-Reihenfolge, höchstens 8, localStorage — kein Account nötig), Suche
  über Name/Marke, Markenfilter aus dem aktuellen Set, Sortierung nach Preis
  (€/L), Distanz und „Netto-€ (Füllung)“ = Preis × Tankmenge mit
  Füllungs-Preis-Anzeige je Zeile. Die Beleg-Erfassung listet gepinnte
  Stationen zuerst. Bewusst **keine** client-seitige Netto-€-Rechnung mit
  Umweg: Die Ökonomie bleibt server-only (B6/H1) — die Sortierung „Netto-€“
  ist Preis × Tankmenge, Umweg-Fälle bleiben dem Decide/Route-Pfad
  vorbehalten. Reine Funktionen (`orderedStationList`,
  `togglePinnedStation`, …) mit Tests in `web/src/features.test.ts`.

### Geändert

- `POST /api/v1/profiles/activate` (Body `{"active": null}`) ist vor dem
  `POST /api/v1/profiles/{id}/activate`-Muster ausgewertet — sonst würde
  „activate“ als Profil-ID gelesen (404 statt Deaktivierung).
- Ratchet-Listen erweitert: `components/ProfileManager.tsx` steht jetzt in
  `microcopy.test.ts` (Anführungszeichen) und `format-convention.test.ts`
  (keine `toFixed`-Anzeigen).

### Tests

Backend: 19 neue Tests (`test_profiles.py`, `test_decide_tank.py`,
`test_wallet_balance.py`), Suite 652 grün. Frontend: `features.test.ts` mit
11 Fällen zu Tankstand-Rechnung, Pin-Liste, Stationsordnung, Bilanz-Labels
und Profil-Sync (228 Tests gesamt); bestehende Ratchets mitgezogen.

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
