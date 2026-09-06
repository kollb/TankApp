# TankApp

Persönliche Spritpreis-App: mathematische Tankstellen-Selektion aus
historischen Daten, Preisprognose (heute / +3 / +7 Tage) mit kalibrierten
Konfidenzintervallen, Betrieb auf Raspberry Pi (RAM-Puffer) + NAS (InfluxDB).

- 📐 **Konzept (v4):** [`docs/KONZEPT.md`](docs/KONZEPT.md) — Zeitreihen-Engine,
  Pi↔NAS-Architektur, Fahrzeug-Ökonomie, TankPuls-API
- 🔍 **Kritische Analyse der Konzept-Bewertung (v3 → v4):**
  [`docs/REVIEW-2026-09-06.md`](docs/REVIEW-2026-09-06.md) — was übernommen
  wurde, wo die Bewertung korrigiert werden musste, was offen bleibt
- 🧮 **Schritt 1 – Selektion:** [`analysis/`](analysis/README.md) — Pipeline
  (robuste Statistik, Bootstrap, FDR, Composite-Score, bundeslandspezifische
  Feiertage via `--subdiv`) + [Report](docs/analysis/report_top10.md) (auf
  Demo-Daten, bis echte Historie vorliegt)
- 🕗 **Poll-Fenster 08–24 Uhr?** Empirisch beantwortet:
  [report_window.md](docs/analysis/report_window.md) — Antwort: nimm 06–24
- 📊 Abbildungen: [`docs/analysis/figures/`](docs/analysis/figures/)
