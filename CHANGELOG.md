# Changelog

Alle nennenswerten Änderungen ab jetzt. Format lose an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) angelehnt;
Version folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.10.1] – 2026-09-12

### Geändert

- **Dokumentation an einem Ort:** alle Dokumente liegen in `docs/`, Index ist
  `docs/README.md` („Ich will … → Dokument“). Die Modul-READMEs sind eingezogen:
  `engine/README.md` → `docs/ENGINE.md`, `data-tools/README.md` →
  `docs/DATENWERKZEUGE.md`, `sample/README.md` → `docs/GUI-VORLAGEN.md`; `rp2/`
  enthält nur noch Code und systemd-Units. Verweise in Python-Docstrings,
  CLI-Hilfen, `AGENTS.md`, `.github/dependabot.yml` und den übrigen Dokumenten
  sind nachgezogen.
- **Archiv mit Legende:** Stichtags-Prüfungen (Prüfstand 10.09., Gutachten,
  Tiefenanalyse V1–V3), die abgeschlossene UUID-Migration, die alten
  RP2-Anleitungen inkl. HTML-Mockups und der Punktstand `polling-merged` liegen
  in `docs/archiv/` — Datum im Dateinamen, Archiv-Banner im Dokument, Index
  `docs/archiv/README.md` mit Grund und Nachfolger je Datei. Zitate aus dem Code
  („Prüfstand §3.1“) bleiben auflösbar.
- **Gültige Betriebs-Aussagen aus dem Archiv gerettet:** `docs/BETRIEB.md`
  (Legacy-Punkte ohne `station_id`/Namens-Zwillinge, Alarm-Codes mit Aktionen,
  Versions-Check, `no prices`-Alarm in Kalendertagen statt nach 7 Polls) und
  `docs/RP2.md` (Dateistruktur, Fallback-API, Umschaltzeiten, Template-Updates,
  Log-/Journal-Wartung, `systemctl show -p Environment` in der Fehlersuche).
- **Inhalte auf Stand 0.10.x gebracht:** `docs/API.md` (Beleg-Verlauf, Storno,
  CSV-Export, `alarms[]`, `version`/`commit`, neue Fehlercodes),
  `docs/INSTALL.md` (drei Tabs, „Werkstatt“ statt „Statistik“, Checkliste,
  Alarm-Punkt, Export), `docs/ANALYSE.md` (P-Seite, Rolling-PICP, Güte-Gate,
  21-Tage-Backtest, Heatmap-Tages-Zusammenfassung inkl. bekannter
  Cheap-Prob-Grenze), `docs/ARCHITEKTUR.md` (RP2-Zugang, Alarm-Aggregation,
  explizites Datenverlust-Fenster), `docs/LUECKEN.md` (Update-Blockquotes in
  einen echten Abschnitt überführt, 0.10.0-Punkte ergänzt), `README.md`
  (Repo-Struktur, Dokumentations-Einstieg), `TODO.md` (erledigte Punkte
  gestrichen + „Erledigt“-Nachweis, neue Punkte B13/B14).
- **Link-Test ausgeweitet:** `tests/test_operations.py` prüft jedes
  Markdown-Dokument inkl. `docs/archiv/` sowie `CHANGELOG.md`, `TODO.md`,
  `AGENTS.md` auf funktionierende lokale Links **und** Anker.

## [0.10.0] – 2026-09-11

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
- **B9** App-Version + Commit-Hash in `/health` (app/version.py) + Anzeige im
  Footer.
- **C1** Geführte Einrichtungs-Checkliste im System-Tab (Status aus vorhandenen
  Endpunkten).
- **A7** M7-Fortschritts-Kachel im System-Tab (n/100 Empfehlungen, Brier gegen
  Ziel < 0,25).
- **C10** Heatmap: Tages-Zusammenfassung (Median + günstigste Stunde je Tag),
  Hervorhebung der heutigen Zeile, Fazit-Satz + Erklärzeile.

### Geändert

- **F1** Tab „Statistik“ → „Werkstatt“ (inkl. Sekundär-Texte und Doku-Verweise).
- **E2** Beleg-Dialog: Dezimaleingabe mit Komma (`inputMode="decimal"`, String-
  State, `,`→`.`-Normalisierung), Sofort-Validierung am Feld.
- **C5** Ampel-Chip mit Symbol (▲/▼/●/→) zusätzlich zur Farbe; Slider mit
  `aria-valuetext` (€, L/100 km, km/h, €/h).
- **G1** `rp2/cache_forecasts.py`: `cache.log` wächst nicht mehr unbegrenzt
  (1-MB-Ring, ältere Hälfte wird verworfen).
