# TankApp

Persönliche Spritpreis-**Entscheidungs**-App: mathematische Tankstellen-Selektion
aus historischen Daten, Preisprognose mit kalibrierten Konfidenzintervallen —
und einem Decision Layer, der daraus an der Zapfsäule genau eine Antwort macht:
**jetzt tanken · warten · woanders** (+ Erfolgskonto). Betrieb auf
Raspberry Pi (RAM-Puffer) + NAS (InfluxDB).

- 📐 **Konzept (v5) — das eine Dokument:** [`docs/KONZEPT.md`](docs/KONZEPT.md)
  - §0 Produktprinzip: drei Fragen (jetzt/warten · hier/woanders · heute/später), zwei Modi
  - §3 Zeitreihen-Engine (Quantile) · §4 Decision Layer (Ampel, €-Betrag, P_besser)
  - §5 Brier/Reliability + persönliche Erfolgsbilanz · §6 Produkt-KPIs
  - §8 UI: Alltags-Modus (Cockpit) & Werkstatt-Modus (Statistik-Labor)
  - §11 `/v1/decide` + Outcome-Loop · §13 Roadmap M1–M7 (M7 = Kalibrierungs-Loop)
  - Anhang A: Auswertung der externen Bewertung v3 → v4 (früher REVIEW-Dokument)
  - Anhang B: Zuordnung der zwei Sample-GUIs zu den zwei Modi
- 🖥️ **UI-Prototypen:** [`sample/good gui/`](sample/good%20gui) — Alltags-Modus
  (Entscheidungs-Kompass) · [`sample/good statistic gui/`](sample/good%20statistic%20gui)
  — Werkstatt-Modus (Entscheidungs-Labor: Scoreboard, Kalibrierung, Paarvergleich)
- 🧮 **Schritt 1 – Selektion:** [`analysis/`](analysis/README.md) — Pipeline
  (robuste Statistik, Bootstrap, FDR, Composite-Score, bundeslandspezifische
  Feiertage via `--subdiv`) + [Report](docs/analysis/report_top10.md) (auf
  Demo-Daten, bis echte Historie vorliegt)
- 🕗 **Poll-Fenster 08–24 Uhr?** Empirisch beantwortet:
  [report_window.md](docs/analysis/report_window.md) — Antwort: nimm 06–24
- 📊 Abbildungen: [`docs/analysis/figures/`](docs/analysis/figures/)
