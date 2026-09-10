# TankApp Dokumentation

**Ein Einstieg, eine Reihenfolge:** [INSTALL.md](INSTALL.md) ist der verbindliche Betriebsplan.

> Stand: 10.09.2026 — B3 (Heatmaps, Meine Stationen, Collector-Livestatus, Route-Evaluate), B4 (Decision Layer), die Ereignis-Pipeline (Uploader-Webhook, Issue 50) und **B5** (Konzept-Lücken: Job-Fortschritt, schnellerer Modell-Lauf, Rate-Limit, Deprecation-Header, `latest_by`, Fahrtmodus, M7-Schwellen) implementiert.
> Alle Dokumente haben ein klickbares Inhaltsverzeichnis.

## Inhaltsverzeichnis (klickbar)

- [Überblick](#überblick)
- [Schnellstart](#schnellstart)
- [Dokumente nach Aufgabe](#dokumente-nach-aufgabe)
- [Lücken-Check: Konzept gegen Stand](LUECKEN.md) — was fehlt noch, was ist bewusst offen
- [Architektur Kurzfassung](#architektur-kurzfassung)
- [API Übersicht](#api-übersicht)
- [Alte Anleitungen aufräumen](#alte-anleitungen-aufräumen)

### Dokumente nach Aufgabe

1. **[Installation — vom Polling zur GUI](INSTALL.md)**  
   Der einzige verbindliche Einstieg. Reihenfolge: Gütersloh mitpollen → NAS-App starten → Archiv parallel → automatische Berechnung.

2. **[Architektur — Pi ↔ NAS ↔ Browser](ARCHITEKTUR.md)**  
   Rollen, Datenfluss, Ressourcen, SD-Härtung, Hardware-Bewertung. Extrahiert aus Konzept §9 und Installations-Details.

3. **[API — Nur-Lese Endpunkte](API.md)**  
   Alle `/api/v1/*` Endpunkte inkl. B3 und Ereignis-Pipeline: heatmap, selection, collector/status, route/evaluate, jobs/trigger. Mit Beispielen.

4. **[Betrieb — systemd, Backup, Fehlersuche](BETRIEB.md)**  
   Collector/Uploader systemd-Units, tmpfs, Sicherung/Wiederherstellung, Störungsfälle, InfluxDB-Setup, Unraid-Spezial.

5. **[Analyse — Selektion, Modelle, Heatmaps](ANALYSE.md)**  
   δ̂ Ranking, Bootstrap-KI, AV-Score, billigste Stunde, Heatmaps DoW×Stunde, Backtest, Kalibrierung.

6. **[Lücken-Check — Konzept gegen Stand](LUECKEN.md)**  
   Abgleich Zielbild ↔ Code: was B5 geschlossen hat, was bewusst offen bleibt und warum.

7. **[Produkt- und Architekturkonzept](KONZEPT.md)**  
   Fachliches Zielbild, Decision Layer, drei Fragen (Jetzt/warten, Hier/woanders, Heute/später), Ehrlichkeits-Regel.

8. **[RP2 Fallback-GUI + NAS-Proxy](RP2.md)**  
   Konsolidiert aus `rp2/README.md` + `rp2/ANLEITUNG.md`. 24/7 Zugang über Pi Port 8000.

9. **[Stations-UUID — Gleiche Namen trennen](STATIONS-UUID.md)**  
   Migration von Namens-Serien auf UUID-Tags, Replay mit Zeitzone.

10. **[Prüfstand — Konzept ↔ API ↔ Engine ↔ GUI ↔ Live-Daten](Prüfstand.md)**  
    Unabhängige Prüfung vom 10.09.2026: Abweichungen, die nicht in LUECKEN stehen.

11. **[Gutachten — gutachterliche Stellungnahme](Gutachten.md)**  
    Externe Zweitmeinung zur statistischen Methodik; Bewertung der Empfehlungen in der [To-Do-Liste](TODO.md) (Abschnitt B).

12. **[To-Do — Aufgaben aus Gutachten, Prüfstand und Doku-Abgleich](TODO.md)**  
    Bearbeitbare Aufgaben mit Priorität, plus offene Konzept-Entscheidungen.

13. **Weitere Referenzen (keine Installationspflicht)**
   - [Engine-Referenz](../engine/README.md) — Modellwerkstatt, 12-Uhr-Regel
   - [Werkzeugübersicht](../data-tools/README.md) — interne Einzelprogramme
   - [GUI-Vorlagen](../sample/README.md) — Basis der neuen Homepage

## Überblick

TankApp beantwortet an der Säule in ≤5 Sekunden:

- **F1:** Jetzt oder warten? (Ampel + Zeitfenster + € + P_besser)
- **F2:** Hier oder woanders? (Netto-€ nach Umweg)
- **F3:** Heute oder später? (Top-3 Fenster)

Die GUI hat zwei Modi:

- **Alltag** (`sample/good gui` Basis) — Entscheidungs-Kompass, ≤3 primäre Zahlen
- **Werkstatt** (`sample/good statistic gui` Basis) — Scoreboard, Fan-Chart, Heatmaps, Meine Stationen, Paarvergleich, System-Status

## Schnellstart

```bash
# Pi: Gütersloh aufnehmen (direkt auf dem Pi)
python3 tankapp.py add-city
sudo python3 tankapp.py activate-polling

# NAS: ein App-Dienst für GUI, Archiv, Modelle, Selektion
bash ops/nas/preflight.sh
python3 tankapp.py nas-up
# Browser: http://<NAS>:1355
# RP2 (optional): http://<Pi>:8000 zeigt automatisch NAS oder Fallback
```

## Architektur Kurzfassung

```text
Tankerkönig live ──→ Pi: Collector + RAM-Puffer (/dev/shm/tankapp) ──→ NAS: InfluxDB
Tankerkönig-Archiv ───────────────────────────────────────────────→ NAS: Roharchiv + Cache
                                                                  ↓
                                                         Modelle + Selektion
                                                                  ↓
                                                         NAS: API + Web-GUI (1355)
                                                                  ↓
                                                          Handy/PC: Browser
Pi → NAS: collector_status (Herzschlag) via InfluxDB
```

- **Pi:** 24/7 sammeln, RAM-Puffer, heartbeat.json, Upload
- **NAS:** Archiv, InfluxDB, Fits, Selektion, Heatmaps, API, GUI
- **PC/Handy:** nur Browser

## API Übersicht

| Endpunkt | Aufgabe |
|---|---|
| `GET /api/v1/health` | App online, Jobs, Archiv, Modelle, Selektion, Collector |
| `GET /api/v1/stations?fuel=e10&city=...` | Aktuelle Preise, frisch ≤30 Min |
| `GET /api/v1/series?city=...&station_id=...&fuel=...&hours=24` | Verlauf |
| `GET /api/v1/forecast?city=...&station_id=...&fuel=...` | Modell-Ausblick 24h + 3d/7d |
| `GET /api/v1/last_forecasts` | Für RP2-Cache |
| `GET /api/v1/heatmap?city=...&fuel=...&kind=level\|probability&weeks=6&station_id=...` | **B3.9** DoW×Stunde Niveau + Cheap-Prob |
| `GET /api/v1/selection?fuel=...&city=...` | **B3.10** Meine Stationen mit δ̂, KI, AV, billigste Stunde |
| `GET /api/v1/collector/status` | **B3.11** Pi/tmpfs Livestatus |
| `GET /api/v1/route/evaluate?...` | **B3.12** Umweg-Ökonomie serverseitig (deprecated, Nachfolger `/api/v1/decide`) |
| `GET /api/v1/decide?...&latest_by=...&mode=...` | **B4/B5** Ampel, Alternativen, Fenster — jetzt mit Zeithorizont und Fahrtmodus |

Details: [API.md](API.md)

## Alte Anleitungen aufräumen

Früher gab es viele verstreute Anleitungen (rp2/ANLEITUNG.md, rp2/README.md, engine/README.md mit Installations-Schritten, INSTALL.md mit riesigem <details>-Block).

**Jetzt:**

- `docs/README.md` ist das Inhaltsverzeichnis mit Links
- `INSTALL.md` enthält nur den verbindlichen Ablauf (ohne 600 Zeilen Technik-Details)
- Technik-Details → `BETRIEB.md`
- Analyse/Methodik → `ANALYSE.md`
- API → `API.md`
- Architektur → `ARCHITEKTUR.md`
- RP2 → `RP2.md` (konsolidiert)
- `rp2/AENDERUNGEN.md` bleibt als Changelog, wird von RP2.md verlinkt
- `engine/README.md` und `data-tools/README.md` sind reine Werkstatt-Referenzen, keine Installationsketten

Beim Aufräumen wurden keine Demo-Daten oder GUI-Vorlagen gelöscht (`sample/` bleibt).

## Footer

Daten: MTS-K via tankerkoenig.de (CC BY 4.0) · Token-Bucket 1 R/300s · Fenster 06–24 Uhr
