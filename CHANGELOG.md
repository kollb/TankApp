# Changelog

Alle nennenswerten Änderungen ab jetzt. Format lose an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) angelehnt;
Version folgt [Semantic Versioning](https://semver.org/lang/de/).

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
