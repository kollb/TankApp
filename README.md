# TankApp

Persönliche Spritpreis-**Entscheidungs**-App: mathematische Tankstellen-Selektion
aus historischen Daten, Preisprognose mit kalibrierten Konfidenzintervallen —
und einem Decision Layer, der daraus an der Zapfsäule genau eine Antwort macht:
**jetzt tanken · warten · woanders** (+ Erfolgskonto). Betrieb auf
Raspberry Pi (RAM-Puffer) + NAS (InfluxDB).

- 📐 **Konzept (v5) — das eine Dokument:** [`docs/KONZEPT.md`](docs/KONZEPT.md)  - §0 Produktprinzip: drei Fragen (jetzt/warten · hier/woanders · heute/später), zwei Modi
  - §3 Zeitreihen-Engine (Quantile) · §4 Decision Layer (Ampel, €-Betrag, P_besser)
  - §5 Brier/Reliability + persönliche Erfolgsbilanz · §6 Produkt-KPIs
  - §8 UI: Alltags-Modus (Cockpit) & Werkstatt-Modus (Statistik-Labor)
  - §5.4 drei Uhren (Advice / Intent / Fill) — Feedback trotz asynchronem Tanken
  - §5.5 drei Statistik-Schichten (Markt-Backtest · Live-Advice · Wallet) · §9.5 Azure ≤ 5 € = Rand, nicht Pi-Ersatz
  - §11 `/v1/decide` + Episode/Fill-API · §13 Roadmap M1–M7 (M7 = Kalibrierungs-Loop)
  - Anhang A: Auswertung der externen Bewertung v3 → v4 (früher REVIEW-Dokument)
  - Anhang B: Zuordnung der zwei Sample-GUIs zu den zwei Modi
- 🔧 **Erstinstallation & Betrieb (was läuft wo, welche Kommandos):**
  [`docs/INSTALL.md`](docs/INSTALL.md) — Pipeline auf dem PC, **M1 Collector
  24/7 auf dem Raspberry Pi** (RAM-Puffer), NAS später; inkl. systemd-Unit,
  Key-Einrichtung und Störungstabelle
- 🖥️ **UI-Prototypen:** [`sample/good gui/`](sample/good%20gui) — Alltags-Modus
  (Entscheidungs-Kompass) · [`sample/good statistic gui/`](sample/good%20statistic%20gui)
  — Werkstatt-Modus (Entscheidungs-Labor: Scoreboard, Kalibrierung, Paarvergleich)
- 📍 **Schritt 0a – wer wird beobachtet:** `data-tools/discover_stations.py` — die 25-km-Kandidaten
  je Ort (Anker in `analysis/config.local.json`), 10er-Polling-Set nach Marke, Eignung je Station
  (`--check-history`). Braucht nur die Tagesliste, ~10 MB → `docs/analysis/stations/report.md`
- 📥 **Schritt 0b – Datenbezug:** [`docs/DATEN-BEZUG.md`](docs/DATEN-BEZUG.md) —
  Historie **ohne** 100-GB-Clone holen (`data-tools/`): ~1,5 GB gz für 2025/2026 statt 125 GB,
  plus Radius-Filter (12 GB → ~150 MB), Ingest ins Analyse-Schema, NAS-Cron für die Tagesdatei;
  Windows-Anleitung (`py -3`, Browser-Download, robocopy) in Kapitel 11.1
- 🧮 **Schritt 1 – Selektion:** [`analysis/`](analysis/README.md) — Pipeline
  (robuste Statistik, Bootstrap, FDR, Composite-Score, bundeslandspezifische
  Feiertage via `--subdiv`) + [Report](docs/analysis/report_top10.md) (auf
  Demo-Daten, bis echte Historie vorliegt)
- 🕗 **Poll-Fenster 08–24 Uhr?** Empirisch beantwortet:
  [report_window.md](docs/analysis/report_window.md) — Antwort: nimm 06–24
- 📊 Abbildungen: [`docs/analysis/figures/`](docs/analysis/figures/)
