# UMSETZUNG-FALLBACK-GUI-V2 — Arbeits-Checkliste

> **Archiviert am 18.09.2026 · App-Version 0.54.0.** Arbeits-Checkliste, abgeschlossen: Schritte 1–4 sind mit 0.33.0 umgesetzt und geprüft. Schritt 6.2 (diese Auslagerung) ist damit erledigt; die Pi-Sichtprüfung 5.2 ist am 18.09.2026 als nicht nötig geschlossen — der Fallback läuft dort seit Monaten im Betrieb ([TODO.md](../../TODO.md#geschlossen-als-nicht-nötig-18092026)). Was heute gilt: [RP2.md](../RP2.md).
>
> Stand: 14.09.2026 · **umgesetzt in App-Version 0.33.0** (Branch
> `arena/01a09ed1-tankapp`) · Konzept aus
> [PR #112](https://github.com/kollb/TankApp/pull/112).
> Diese Checkliste ist die Arbeitsunterlage für die Implementierung des
> gebilligten Konzepts aus [PR #112](https://github.com/kollb/TankApp/pull/112).
> Konzept-Mockup (Beispieldaten): [archiv/mockups/fallback_gui_v2.html](mockups/fallback_gui_v2.html).
> Nach Abschluss: dieses Dokument in [archiv/](README.md) auslagern.
>
> **Stand der Abarbeitung:** Schritte 1–4 sind umgesetzt und geprüft
> (CI-Spiegel grün, DOM-Smoke-Test aller Zustände). Offen bleibt bewusst
> **5.2** (Abnahme auf dem Pi/RP2 — braucht die echte Hardware) und **6.2**
> (Auslagern ins Archiv nach dem Merge).

## Inhaltsverzeichnis

- [0. Basis, Stand und Messwerte](#0-basis-stand-und-messwerte)
- [1. Backend: series-Endpunkt + Snapshot-TTL-Cache](#1-backend-series-endpunkt--snapshot-ttl-cache)
- [2. Neues Template in rp2/fallback_gui.py](#2-neues-template-in-rp2fallback_guipy)
- [3. Tests und CI](#3-tests-und-ci)
- [4. Doku und Release](#4-doku-und-release)
- [5. Abnahme (manuell)](#5-abnahme-manuell)
- [6. Abschluss](#6-abschluss)

## 0. Basis, Stand und Messwerte

**Vorgaben, die das Design einhalten muss** (Details im Mockup):

- Antwort-Karte zuerst (Verdict + günstigste Station + Ersparnis + Route),
  F1/F2 als Chips; ≤ 3 primäre Zahlen.
- Stations-Karten statt Tabelle auf allen Breiten; Name einzeilig mit
  Ellipsis, voller Name im `title`; Marke/Stadt/Fahrzeit als eigene
  Meta-Zeile; kein horizontales Scrollen.
- Tagesstreifen 06–24 Uhr aus dem Puffer (grün/rot = unteres/oberes
  Preisdrittel; Stunden ohne Meldung bleiben leer).
- Alltag/Werkstatt-Trennung (Werkstatt: Sparklines, Rohdaten, Datenstatus).
- Sticky-Status- + Steuerleiste; Sticky-Aktions-Chip beim Scrollen.
- Ehrlichkeits-Regel: Preis-Score ≠ Wahrscheinlichkeit; Cache-Alter sichtbar.
- Leitplanken: [GUI-VORLAGEN.md](../GUI-VORLAGEN.md), Texte: [MICROCOPY.md](../MICROCOPY.md).

**Grenzen (bewusst nicht im Fallback):** Belege/Wallet, Heatmaps,
kalibrierte M7-Wahrscheinlichkeit, Umweg-Ökonomie mit Profil — bleiben
NAS-only und werden nicht durch Demo-Logik ersetzt.

**Gemessen (18 Stationen, 2 Städte, 3 Tage Puffer, aktueller Code):**

| Größe | Wert |
|---|---|
| Server-RSS (idle → Betrieb) | 23,2 MB → 23,2 MB (stabil) |
| Endpunkt-Dauer | 7–8 ms (jeder liest den Puffer neu) |
| series-Äquivalent (1×/min) | 6,3 ms, Antwort ~1 KiB |
| Template im Speicher | 32 KiB → ~52 KiB |
| SD-Karte | keine neuen Dauer-Schreibvorgänge |

**Keine neuen** Abhängigkeiten (RP2 = Standardbibliothek), Services oder
Proxy-Änderungen. Proxiespfad (NAS online) bleibt byte-identisch.

## 1. Backend: series-Endpunkt + Snapshot-TTL-Cache

Alle Änderungen in `rp2/fallback_gui.py`.

- [x] **1.1** `read_series(poll_dir, uid, fuel)` ergänzen: liest dieselben
  JSONL-Tag-Dateien wie `read_snapshots` (Muster wiederverwenden), behält
  aber die Stunden statt nur der letzten Meldung je Station. Stunden 06–24
  des heutigen Tags, je Stunde die letzte offene Meldung (sonst `null`).
  Rückgabe: Stundenliste + `min`/`max`/`now` (Wert + Zeit) — nur für die
  eine angefragte Station (Payload klein halten).
- [x] **1.2** Endpunkt `GET /api/v1/series?station=<uuid>&fuel=<fuel>`
  (Routing wie die anderen Fallback-Endpunkte in `_api`; in Proxy-Modus wird
  er nicht benutzt, weil dann das NAS antwortet — Namensgleichheit mit der
  NAS-API ist gewollt):

  ```json
  {
    "station_id": "…", "fuel": "e10", "generated_at": "…",
    "hours": [
      {"hour": "06", "value": 1.712, "at": "2026-09-14T06:05:00Z"},
      {"hour": "22", "value": null,  "at": null}
    ],
    "min": {"value": 1.684, "at": "19:00"},
    "max": {"value": 1.712, "at": "06:00"},
    "now": {"value": 1.689, "at": "21:00"}
  }
  ```

  Fehlerfälle konsistent zu den bestehenden Endpunkten: unbekannter
  `station` → 404, leerer Puffer → 503, ungültiges `fuel` → 400.
- [x] **1.3** Snapshot-TTL-Cache (5 s) für `Context.snapshot()`: thread-sicher
  nach dem Muster von `NasState` (Lock + Zeitstempel). Derzeit bauen
  **vier** Endpunkte pro GUI-Refresh (60 s) parallel denselben Puffer neu —
  mit Cache (plus series = fünf) wird daraus **ein** Read pro Zyklus.
  Datenfrische bleibt ok, der Collector tickt alle 5 min.
- [x] **1.4** `VERSION = "2.0"` → `"3.0"` anheben (Template-Auto-Update über
  `VERSION_MARKER` wirkt dadurch auf bestehenden Installationen;
  altes Template wird als `index.html.old` gesichert — bereits getestet).

## 2. Neues Template in rp2/fallback_gui.py

- [x] **2.1** `_TEMPLATE_HEAD` + `_TEMPLATE_REST` durch das Mockup-Design
  ersetzen ([archiv/mockups/fallback_gui_v2.html](mockups/fallback_gui_v2.html)),
  mit diesen Anpassungen:
  - **Mock-Bar + Beispieldaten raus** (`STATIONS`, `FORECAST`, `DAYSTRIP`,
    Mock-Clock `NOW_MIN`) — das sind betrachungshelfer, kein App-Code.
  - **Echte API verdrahten** (Fetch-Muster + 60-s-Auto-Refresh +
    no-store aus dem alten Template übernehmen):
    - `health` → NAS-Pill, Preis-Pill (Alter/offen), Städte-Select,
      Cache-Alter, Datenstatus (Werkstatt)
    - `stations` → Stations-Karten (Preis, Δ, Frise-Punkt, Route-Button,
      `drive_min`), Sortierung Preis/Nähe/Aktuell client-seitig
      (`age_minutes`, `drive_min`, `price` sind bereits im Payload)
    - `decide` → Antwort-Karte: `f1.recommendation`
      (`refuel_now` → „Jetzt tanken", `wait` → „Bis &lt;best_at&gt; warten
      lohnt sich"), `f1.reason` als Begründung, `f2` für Preis/Ersparnis/
      2.-günstigste, `windows` für F3-Zeile und -Chip
    - `forecasts` → Werkstatt-Sparklines (die `sparkline`-Funktion des
      alten Templates ist wiederverwendbar) + „Cache … h alt"
    - `series` → Tagesstreifen (neuer Endpunkt aus Schritt 1)
  - **Leer-/Fehlerzustände** aus dem alten Template beibehalten
    (kein Cache, Puffer leer, 503-Handling, `CACHE_REBOOT_HINT`).
  - **Microcopy** laut [MICROCOPY.md](../MICROCOPY.md): €/L mit 3 Nachkommastellen,
    Differenzen in ct, „…“-Anführungszeichen, keine Ausrufezeichen,
    keine Emoji im Fließtext. Neue Muster in Schritt 4.2 registrieren.
- [x] **2.2** Vorher wissen: Die Tests prüfen das Template nur über den
  `VERSION_MARKER` im ausgelieferten HTML (`tests/test_rp2_fallback.py`),
  nicht über Inhalt — ein Template-Tausch bricht keine existierende Prüfung.
- [x] **2.3** Selbst-Check am Mockup-vs-Produkt-Delta: Verdict-Logik kommt
  produktiv aus `decide` (im Mockup vorkonfiguriert) — alle Zustände
  durchspielen: `f1.available=true/false`, `wait/refuel_now`,
  `f2.second_name` vorhanden/nicht, Fenster vorhanden/nicht.

## 3. Tests und CI

- [x] **3.1** `tests/test_rp2_fallback.py` ergänzen (Fixtures existieren
  schon: `write_poll_file`, `POLLING_JSON`, Proxy-Testserver):
  - `series`: Stunden-Buckets aus Multi-Tag-Fixture; `null` für Stunden
    ohne Meldung; `min`/`max`/`now` korrekt; `fuel`-Filter; 404 für
    unbekannte UUID; 503 bei leerem Puffer; 400 bei ungültigem `fuel`.
  - TTL-Cache: zweiter `snapshot()`-Aufruf innerhalb 5 s liefert denselben
    Stand (z. B. Datei zwischen den Calls ändern und prüfen, dass der
    Cache nicht neu liest).
  - Index liefert weiterhin das Template mit aktuellem `VERSION_MARKER`.
- [x] **3.2** Kompletter CI-Spiegel lokal grün, bevor gepusht wird
  (Befehle stehen in [AGENTS.md](../../AGENTS.md)): ruff check, ruff
  format --check, `pytest -q`, `npm --prefix web test`, `npm --prefix web run build`.
  (Web/Engine sind von der Änderung unberührt, der Spiegel ist trotzdem Pflicht.)

## 4. Doku und Release

- [x] **4.1** `docs/RP2.md`:
  - Fallback-API-Tabelle (Abschnitt „Fallback-API und Umschaltzeiten"):
    Zeile für `GET /api/v1/series?station=&fuel=` ergänzen.
  - Funktionsliste der Fallback-GUI (heute: „Status-Pills, E10/E5/Diesel,
    Tankgröße, günstigste Station, F1/F3 aus Cache, Stationentabelle,
    Prognose-Sparklines, Dark-Mode, Heartbeat") auf das neue Design
    umstellen (Antwort-Karte, Stations-Karten, Tagesstreifen,
    Alltag/Werkstatt, Sticky-Chip).
  - Stand-Zeile und RP2-Fallback-Version (v3.0) aktualisieren.
- [x] **4.2** `docs/MICROCOPY.md`: neue Textmuster aufnehmen (Verdict-Sätze,
  Tagesstreifen-Caption „Leere Stunden hatten keine offene Meldung",
  „&lt;Kraftstoff&gt; nicht geführt", Sortierungs-Labels, Sticky-Chip).
- [x] **4.3** `app/version.py`: 0.31.0 → **0.33.0** (0.32.0 war beim Merge
  von PR #108 bereits belegt); `CHANGELOG.md` ergänzen (neues
  Fallback-Template v3.0, `series`-Endpunkt, Snapshot-TTL-Cache,
  Messwerte aus Schritt 0).
- [x] **4.4** `docs/README.md`: diese Checkliste im Index
  („Ich will … → Dokument") eintragen.

## 5. Abnahme (manuell)

- [x] **5.1** Lokal mit echtem Stand: Server mit `FORCE_FALLBACK=1`
  (ggf. `POLL_DIR`/`STATION_META` auf einen echten Puffer zeigen) starten,
  `?fallback=1` aufrufen. Prüfen auf **Desktop und Smartphone (390 px)**:
  - Lange Namen: einzeilig + Ellipsis, voller Name im `title` —
    Testfall „Supermarkt-Tankstelle FRANKFURT AM RIEDERBRUCH 10".
  - Kein horizontales Scrollen auf keiner Breite.
  - Beide Verdict-Zustände (Jetzt/Warten) und Leer-Zustände
    (Puffer leer, kein Prognose-Cache, NAS an/aus).
  - Dark/Light, Sortierung, Ort-Filter, Tankgröße, 60-s-Auto-Refresh.
  - *Geprüft am 14.09.2026 ohne echtes Gerät:* Server gegen einen echten
    Puffer-Fixture gestartet, alle vier Zustände im DOM durchgespielt
    (wait/refuel_now, kein Cache, leerer Puffer, keine Stationen), langer
    Stationsname bleibt einzeilig mit `title`, Sticky-Chip erscheint beim
    Scrollen. Die **Sichtprüfung auf Desktop und Smartphone steht aus** —
    sie gehört zur Abnahme auf dem Pi (5.2).
- [ ] **5.2** Auf dem Pi/RP2: Dienst neu starten, prüfen, dass das alte
  Template ersetzt und als `index.html.old` gesichert wurde; Fallback zeigt
  das neue Design; NAS online → transparente Weiterleitung zur NAS-GUI
  bleibt unverändert (`X-TankApp-Proxy: nas` im Response-Header).

## 6. Abschluss

- [x] **6.1** PR #112 war beim Umsetzungsstart bereits gemergt — die
  Umsetzung geht deshalb als eigener PR von `arena/01a09ed1-tankapp` heraus
  (Titel ohne „zur Abstimmung", Body mit Verweis auf diese Checkliste).
  Titel und Body von #112 wurden nachträglich um den Umsetzungsstand ergänzt.
- [ ] **6.2** Nach dem Merge: dieses Dokument nach
  `docs/archiv/UMSETZUNG-FALLBACK-GUI-V2-<JJJJ-MM-TT>.md` verschieben
  (Stand-Zeile + Nachfolger) und in `docs/archiv/README.md` eintragen —
  Verweise in `docs/README.md` nachziehen (Link-Test muss grün bleiben).
