# TankApp — ToDo aus der Tiefenanalyse (11.09.2026)

> **Rahmenbedingung:** Die App läuft ausschließlich im eigenen LAN (Pi ↔ NAS ↔
> Browser). **Usermanagement, Login und Auth sind explizit nicht nötig** und
> werden in dieser Liste bewusst *nicht* aufgeführt. Rate-Limiting und
> Input-Validierung bleiben trotzdem drin — sie schützen vor Fehlbedienung,
> Doppelgeräten im Haushalt und defekten Clients, nicht vor Angreifern.
>
> **Prioritäten:**
> - **P0** = riskiert falsche Zahlen oder Datenverlust → als Nächstes
> - **P1** = wichtig für den echten 24/7-Dauerbetrieb
> - **P2** = Komfort, Ausbau, Feinschliff
> - **D**  = braucht echte Live-Daten oder eine Produktentscheidung (kein reines Code-Task)
>
> **Quellen:** [docs/LUECKEN.md](docs/LUECKEN.md), [docs/Prüfstand.md](docs/Prüfstand.md),
> [docs/TIEFENANALYSE.md](docs/TIEFENANALYSE.md), [docs/TIEFENANALYSE_V2.md](docs/TIEFENANALYSE_V2.md),
> [docs/TIEFENANALYSE_V3_GUI.md](docs/TIEFENANALYSE_V3_GUI.md), [docs/Gutachten.md](docs/Gutachten.md)
> — diese ToDo ist die priorisierte Arbeitsliste daraus; erledigte Punkte dort
> sind hier nicht mehr enthalten.

---

## A. Fachlich (Produkt & Domäne)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| A1 | P1 | **Fahrzeug-/Haushaltsprofile ohne Login** | Verbrauch, Zeitwert, Tankmenge, Kraftstoffart liegen heute im `localStorage` pro Browser → Handy ≠ PC, zweites Fahrzeug (Diesel vs. Benziner) unmöglich. Ziel: Profil-Umschalter im Header, serverseitig gespeichert (pro Haushalt, kein Account), GUI-Felder lesen daraus. |
| A2 | P1 | **Tankstand / Restreichweite als Eingabe für F3** | Konzept-F3 („Tank bei ¼, kann ich warten?") hat keinen Tankstand-Input. Ziel: Fuellstand-Angabe (≈ Füllstand oder Rest-km), App sagt ehrlich „Warten riskant, Reserve reicht ~40 km" statt nur „bestes Fenster morgen". |
| A3 | P0 | **Beleg-Korrektur/Storno fehlt komplett** | `DELETE /api/v1/fills` ist 501, kein Edit im Store. Ein falsch gebuchter Beleg verzerrt Wallet, w(h)-Profil und Statistik für immer. Ziel: Beleg korrigieren/stornieren (mit Storno-Flag statt Löschen, Audit-Spur), Button im Wallet-Verlauf. |
| A4 | P1 | **Jahres-/Monatsbilanz in der Werkstatt** | Konzept §12 P2: „Wallet-Ledger im Alltag, **Jahresbilanz in der Werkstatt**". Heute nur Summen-Kacheln im Alltag. Ziel: Verlaufsliste der Fills, Monats-/Jahressumme, Ø €/Tankung, Vergleich gegen „immer sofort getankt"-Baseline (Regret-Ratio ist vorhanden, nur nicht persönlich aufbereitet). |
| A5 | P1 | **Benachrichtigung ohne Account** | Konzept §12 P2 lieferbar LAN-tauglich: ntfy/Telegram-URL oder Browser-Notification bei „Preis X ct unter Tagesmedian" / „billigstes Fenster beginnt in 15 min". Trigger aus dem Decision Layer sind vorbereitet, aber ungetestet und nicht konfigurierbar. Ziel: Schwelle je Station/Fuel einstellbar, Versand via ntfy (kein Drittanbieter-Account nötig, eigener ntfy-Prozess auf dem NAS möglich). |
| A6 | P1 | **Export & Share eigener Daten** | Kein CSV/JSON-Export von Fills/Wallet/Preisverläufen, keine Share-URL (`?city=…&fuel=…&station_id=…&liters=…`) zum Bookmarken oder im Haushalt weitergeben. Ziel: Download-Button im System-/Statistik-Tab + URL-Parameter, die die GUI beim Öffnen übernimmt. |
| A7 | D | **Kalibrierung M7 „Inbetriebnahme"** | `p_correct` bleibt bis ≥100 abgeschlossene Settlements und Brier < 0,25 gesperrt — richtig so, aber es fehlt die **Checkliste/Anzeige**, wie weit der Weg ist („37/100 Settlements, Brier 0,31"). Ziel: Fortschritts-Kachel im System-Tab + Doku, was beim Freischalten zu prüfen ist. |
| A8 | D | **Markenrabatte/Karten** (`--brand-rebate`) | 2–4 ct können das F2-Ranking umdrehen. Erst sinnvoll, sobald echte Rabattdaten vorliegen; bis dahin soll die GUI im Ranking anzeigen „rechnet ohne Rabattprogramme" (Transparenz-Hinweis). |
| A9 | D | **w(h)-Rückkopplung anschließen** | Persönliches Zeitprofil (`wallet.wh_hours`) wird berechnet, fließt aber nicht in „billigste Stunde"/F3 ein (Konzept §5.5). Ab ≥8 Füllungen aktivieren, vorher Default — mit UI-Hinweis ab wann personalisiert. |
| A10 | D | **Engine-Ausbau nach Konzept §3** | Hampel-Filter (§3.1), gepoolter Feiertags-Dummy je Bundesland, Zeit-seit-letztem-Sprung-Feature, M3-Zweitmodell/Ensemble, Mehrtage-Backtests (+3/+7 d), 21-Tage-Backtest im Auto-Lauf, Rolling-PICP als Live-Badge je Station. Alles dokumentiert offen; erst nach echter Datenabnahme kalibrierbar. |
| A11 | D | **Gemeinsame Bootstrap-Ziehung für `p_lohnt`** | Konzept §4.2: Marktgleichlauf darf nicht wegkorreliert werden. Braucht stationsübergreifenden Resampling-Schritt (gleicher Tagesblock je Ziehung) — eigener Arbeitsschritt, in LUECKEN begründet offen. |
| A12 | P2 | **Station-Lebenszyklus & Zustandsehrlichkeit** | „führt E10 nicht" vs. „temporär geschlossen" vs. „keine Daten seit n Tagen" wird in der GUI nicht unterschieden. Tote Stationen (`no prices` > 7 Kalendertage) sollen automatisch aus Ranking/Polling-Set fallen (konfigurierbar), nicht dauerhaft Kontingent kosten. |
| A13 | P2 | **Preis-Zwillinge: automatische Warnung** | Identische Preisverläufe zweier Stationen (Doppel-Source/Franchise) werden nur manuell per `compare-stations` gefunden. Ziel: Warnung im Selektions-Artefakt + System-Tab. |

---

## B. Technisch (Backend, Datenhaltung, Betrieb, Qualität)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B1 | P0 | **Backup der App-Laufzeitdaten** | [docs/BETRIEB.md](docs/BETRIEB.md) sichert Pi-Keys und das InfluxDB-Volume — **nicht** `runtime/` (Feedback-Store = persönliche Tank-Bilanz, Selektion, Job-Stände). NAS-Disk-Crash = Bilanz weg. Ziel: täglicher Tar/Snapshot in bestehendes Backup + dokumentierter, durchgespielter Restore. |
| B2 | P0 | **Schema-Version & Migration des Feedback-Stores** | `store.json` hat kein `schema_version`; die nächste Feldänderung bricht alte Stores still. Ziel: Versionsfeld + Migrations-Funktionen je Versionssprung, Test „alter Store → neue Version". |
| B3 | P1 | **Persistenz-Entscheidung: JSON → SQLite** | Gutachten-Empfehlung (ACID). Im Ein-Haushalt-Betrieb funktioniert JSON, aber sobald A3 (Storno) und A4 (Verlauf) kommen, wird ein JSON-Rewrite pro Schreibzugriff zum Risiko. Ziel: Entscheidung fällen und festnageln (SQLite nahe dem jetzigen Schema reicht; kein PostgreSQL nötig). |
| B4 | P1 | **Aggregierter System-Alarm (ein Block in `/health` + GUI-Badge)** | Heartbeat fehlt, `no prices` > Schwelle, Job 2× fehlgeschlagen, Store-Größe, freier Festplattenplatz, CUSUM-`break_flag` — heute über sieben Endpunkte verteilt und niemand schaut aktiv. Ziel: `alarms[]` in `/api/v1/health`, roter/grüner Punkt im Header aller Tabs, optional ntfy-Versand (siehe A5). |
| B5 | P1 | **POST-/Schreib-Endpunkte gegen Flut härten** | Rate-Limit deckt GET gut ab, aber `POST /fills`/`/intent` können von einem defekten Client das Ledger fluten. Zusätzlich Plausibilitätsgrenzen serverseitig: `tanked_at` nur plausibles Fenster (nicht 1970/2100), Liter/Preis Obergrenzen, Stringlängen. Kein Auth — einfache IP-/Minuten-Drossel reicht. |
| B6 | P1 | **Luftlinien-/Umweg-Faktor vereinheitlichen** | Server rechnet in `/decide` Luftlinie × 1,3 (`CIRCUITY`), die GUI rechnet lokal × 1,0 und schickt das an `/route/evaluate` → „Server prüfen" kann eine als lohnend angezeigte Alternative für unlohnend erklären. Ziel: Server liefert `detour_km_est` + `dist_mode` pro Alternative; die GUI zeigt exakt diese Zahl, keine eigene Schätzung. |
| B7 | P1 | **HTTP-Effizienz: gzip, getrenntes Caching, Poll-Bündelung** | `no-store` auf allem, keine Kompression, GUI pollt 8+ Ressourcen (~14.700 Req/Tag > 10.000er Anonym-Budget, Zählerstand aus V2-Analyse vor den B5-Fixes — jetzt mit LRU gemildert, aber strukturell ungelöst). Ziel: `Content-Encoding: gzip`; Hash-Assets `immutable`; semi-statische Endpunkte (heatmap, last_forecasts) 15–120 min cachebar; ein Aggregat-Endpunkt `/api/v1/overview` für den Alltag statt Einzelpolls. |
| B8 | P2 | **Webhook-Retry Pi → NAS** | `POST /jobs/trigger` ist Fire-and-Forget: NAS kurz offline → Watermark verloren, läuft nur noch intervallbasiert, ohne Hinweis. Ziel: Retry mit Backoff + Quittierung, Status im Collector-Status sichtbar. |
| B9 | P2 | **Versionierung & Nachverfolgbarkeit** | Keine App-Version/kein Commit-Hash in `/health`, kein `CHANGELOG.md`. Bei Pi/NAS/Fallback-GUI (3 Oberflächen!) weiß man im Fehlerfall nicht, was wo läuft. Ziel: Version + Build-Hash in `/health`, Anzeige im Footer, kurzes CHANGELOG ab jetzt. |
| B10 | P2 | **Service-Worker: Versionierung & Update-Anzeige** | Cache-Namen sind fix `…-v1`; ein GUI-Update signalisiert dem Nutzer nichts, und die Offline-Queue aus dem Konzept (§5.4, IndexedDB) fehlt. Ziel: SW-Version im Build bumsen, „Neue Version — neu laden?"-Banner, Offline-Queue für Fill/Intent mit sichtbarem „wird gesendet, sobald online"-Zustand. |
| B11 | P2 | **Ressourcen-Abgleich Modell-Worker** | `TANKAPP_MODEL_WORKERS` bis 8 Prozesse × pandas vs. `shm_size: 256m` in [ops/nas/app/compose.yml](ops/nas/app/compose.yml) — nicht getestet; bei NAS-HDD werden außerdem File-Locks (`locked_store`, 50×0,05 s) knapp. Ziel: Lauf mit Max-Workern auf Zielhardware + Doku-Werte, Lock-Timeout erhöhen bzw. klare 503-Meldung. |
| B12 | D | **OpenAPI-Spezifikation** | M5-Fertig-Kriterium des Konzepts; bis dahin ist docs/API.md verbindlich. Lohnt erst mit zweitem API-Konsumenten (z. B. Home Assistant, eigene ntfy-Brücke) — dann aus `app/server.py` generieren, in CI pinnen. |

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C1 | P1 | **Onboarding-/Einrichtungs-Checkliste** | Ohne private Daten zeigt die GUI den Einrichtungszustand — aber als Flachtext. Ziel: geführte Karte „1) Polling-Set ✓/✗ 2) Collector-Heartbeat 3) InfluxDB 4) erster Modell-Lauf 5) erste Empfehlung", jede Zeile mit direktem Fix-Hinweis (Link zu docs/INSTALL.md-Anker). |
| C2 | P1 | **Stamm-Stationen pinnen + Suche/Filter/Sortierung** | „Meine Stationen" lebt nur in der Werkstatt; im Alltag will der Nutzer seine 2–3 Stammstationen oben sehen. Liste bei 20+ Stationen (Frankfurt-Radius) ohne Suche/Markenfilter/Sortierung (Preis, Distanz, Netto-€). Lokal speicherbar, kein Account nötig. |
| C3 | P2 | **Karten-/Umgebungsansicht für F2** | „Hier oder woanders?" als Karte mit Netto-€-Pins. OSM-Tiles brauchen Internet (im LAN okay, wenn NAS/Handy online); Alternativen: statische Tile-Region oder reduzierte Luftlinien-Übersicht. |
| C4 | P2 | **Einstellungen-Tab zentral** | Verbrauch, Zeitwert (manuell/auto), Liter-Default, Kraftstoff, Stadt liegen verteilt in Panels. Ziel: ein Tab „Einstellungen": alle Defaults inkl. aktiver Schwellen-Tabelle (read-only aus `/api/v1/stats/summary → thresholds`), Dark/Light-Umschaltung (Fallback-GUI kann dunkel, NAS-GUI nur dunkles Slate). |
| C5 | P2 | **Barrierefreiheit-Runde** | Konkret: emerald/rose-Farbcodierung ist **Rot-Grün** — zusätzlich Symbol/Text; Charts `role="img"` mit `aria-describedby`; Slider `aria-valuetext` in €; sichtbarer Fokus-Ring; komplette Bedienung per Tastatur (Fill buchen ohne Maus); `prefers-reduced-motion`; Touch-Targets ≥ 44 px; Kontraste AA prüfen. |
| C6 | P2 | **Einheitliche Leer-/Lade-/Fehler-Zustände** | Panels unterscheiden sich (Spinner vs. Text vs. nichts). Ziel: Skeletons, `Retry`-Button mit `error_code`-Text (Problem-Mapping existiert in `data.ts`), „Datenstand älter als X"-Banner konsistent, Anzeige „Reichweite der Daten" (z. B. Heatmap: 6 Wochen) je Panel. |
| C7 | P2 | **Hilfe/Glossar-Layer** | δ̂, MASE, PICP, Brier, ε, Regret — Werkstatt-Begriffe ohne Erklärung in der App. Ziel: i-Tooltips + eine kurze „Was heißt das?"-Seite (kann auf docs/ANALYSE.md-Anker verweisen), Begriffe konsistent zur Doku. |
| C8 | P2 | **Mobile-Feinschliff & PWA** | Sticky-Aktions-Chip im Alltag („Jetzt tanken / Warten bis …" beim Scrollen sichtbar), Install-/„Zum Homescreen"-Hinweis (manifest ist da, Prompt fehlt), Landscape-Layout der Tageskurve prüfen, Pull-to-Refresh dort unterdrücken, wo er mit Karten-/Slider-Gesten kollidiert. |
| C9 | P2 | **Formatierungs-Konventionen** | Durchgängig de-DE: ct/L vs €/L nicht mischen (beides vorkommend), einheitliche Rundung (3 Nachkommastellen €/L, 1 Nachkommastelle ct), Uhrzeiten „18–20 Uhr" überall in Europe/Berlin. Kleiner ESLint-/Test-geschützter Formatter-Satz in `data.ts`. |

---

## D. Code-Wartbarkeit (Voraussetzung für C-Features)

| # | Prio | Fehlt | Details |
|---|---|---|---|
| D1 | P1 | **`Dashboard.tsx` zerlegen (3 415 Zeilen in einer Datei)** | Tab-weise Module (`views/Daily.tsx`, `views/Statistics.tsx`, `views/System.tsx`) + geteilte UI-Bausteine (Panel, Metric, Badge, EmptyState). Sonst kollidiert jede C-Arbeit mit Merge- und Review-Kosten. |
| D2 | P1 | **e2e-Abdeckung der Entscheidungs-Flows** | Jetzige Playwright-Specs mocken nur `stations`/`series`/`forecast`. Fehlt: `decide`-Mock → Intent „Ich warte" → Due-Prompt → Fill buchen → Fehlerfall 429/Offline (Erfolgsmeldung darf nur bei Erfolg — V3-Fix ist drin, aber ungesichert). |
| D3 | P2 | **Property-Tests Umweg-Ökonomie** | `K = d·(c/100)·p + (d/v)·z`: Monotonie in Litern, Grenzfälle `z=0`, `d=0`, `liters→∞` mit fast-check abstecken (Schwellen-`worth_it`-Logik inklusive). |
| D4 | P2 | **Qualitäts-Gates in CI: Lighthouse + Last** | M4-Kriterium „Lighthouse > 90" nie gemessen; kein Last-Test, ob das GUI-Polling (B7) unter dem Rate-Limit bleibt. Ziel: Lighthouse-CI-Job mit Budget, kleiner K6-/Autocannon-Pfadtest gegen den Docker-Stack. |

---

## Quick Wins (jeweils ≤ ½ Tag, ohne Architektur-Abhängigkeit)

1. **A3** Storno-Flag für Fills (`DELETE /fills/{id}` → `voided`, Audit-Zeile) + Button im Wallet.
2. **A6** CSV-Export `GET /api/v1/fills.csv` + Download-Link im System-Tab.
3. **B1** Eine Zeile Backup-Skript für `runtime/` + Restore-Absatz in BETRIEB.md.
4. **B4** `alarms[]`-Array in `/health` (nur Aggregation vorhandener Prüfungen) + roter Punkt im Header.
5. **B6** Server-Feld `detour_km_est` ausgeben, GUI-Eigenschätzung entfernen.
6. **B9** Version/Commit in `/health` + Footer-Anzeige.
7. **C1** Einrichtungs-Checkliste als Daten-getriebene Karte (Status kommt aus vorhandenen Endpunkten).
8. **C5** Zwei schnelle A11y-Fixes: Ampel-Chip mit Symbol (▲/▼/●) statt nur Farbe, Slider-`aria-valuetext` in €.
9. **D2** Eine Playwright-Spec „decide → intent → fill → due" mit Mocks — schützt alle V3-Fixes.
10. **A7** Fortschritts-Kachel „M7: n/100 Settlements, Brier x (Ziel < 0,25)" — Daten liegen in `/stats/summary` schon vor.

---

## Bewusst NICHT in dieser Liste

- **Login, Benutzerkonten, Rollen, Mandanten, OAuth/SSO** — LAN-only per Vorgabe.
- **DSGVO-Löschkonzept, Daten-Portabilität für Fremdnutzer, Consent-Management** — keine Fremddaten.
- **i18n über Deutsch hinaus** — Zielgruppe ist ein deutschsprachiger Haushalt.
- **Öffentliche Skalierung** (CDN, Multi-Instanz, Loadbalancer) — ein NAS, ein Haushalt.

## Reihenfolge-Empfehlung

1. **P0 zuerst:** A3 (Storno), B1 (Backup), B2 (Schema-Version) — schützt die persönliche Bilanz, bevor echte Daten anwachsen.
2. **Dann B6 + B7** (Entscheidungs-Zahlen intern widerspruchsfrei und API-Last gesenkt) und **C1** (Inbetriebnahme führbar machen).
3. **D1 direkt vor dem ersten größeren C-Feature** — sonst verdoppelt sich der Aufwand.
4. **D-Items erst nach Live-Daten** (M7-Termin, Rabatte, Engine-Ausbau) — sie stehen begründet in docs/LUECKEN.md.
