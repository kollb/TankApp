# RP2 Fallback-GUI + NAS-Proxy für TankApp

**24/7 Zugang zur TankApp über eine einzige Adresse — den RP2 (Port 8000).**

```
Browser ──► http://<RP2-IP>:8000
                 │
                 ├─ NAS online  ──► transparenter Proxy: volle NAS-GUI + Live-API
                 │
                 └─ NAS offline ──► Fallback-GUI:
                     • Live-Preise aus /dev/shm/tankapp (eigene Datenalter)
                     • Stationennamen/Marken/Koordinaten aus polling.json
                     • gecachte Prognosen (F1/F2/F3) aus /tmp/tankapp_cache
```

Das NAS läuft nur ~6 h/Tag, der RP2 24/7. Seit v2.0 leitet der RP2 alle
Requests an das NAS weiter, solange es erreichbar ist — du musst zwischen
`<NAS-IP>:1355` und `<RP2-IP>:8000` nie mehr wechseln. Ist das NAS weg,
wechseln dieselbe Adresse automatisch (max. 1 Request später) in den
Fallback-Modus.

## 🎯 Funktionen

| Funktion | NAS Online (proxied) | NAS Offline (Fallback) |
|----------|----------------------|------------------------|
| **Vollständige GUI** (React, Live-Charts, System) | ✅ direkt vom NAS | ❌ (bewusst reduziert) |
| **Live-Preise** | ✅ | ✅ aus RP2-Puffer, echte Datenalter je Station |
| **F2 (Günstigste Station)** | ✅ | ✅ mit Ersparnis je Liter & pro Tank (Tankgröße einstellbar) |
| **F1 (Jetzt oder warten?)** | ✅ exakt (NAS) | ✅ vereinfachte Quantil-Logik aus gecachten Prognosen |
| **F3 (Beste Zeitfenster)** | ✅ exakt (NAS) | ✅ Top-3-Fenster aus gecachten Prognosen (24 h) |
| **Dark/Light Mode** | ✅ (NAS-GUI) | ✅ Default Dark, Toggle wird gespeichert |
| **E10/E5/Diesel-Umschalter** | ✅ | ✅ |

Die Fallback-Entscheidung arbeitet ehrlich: aus den quantilierten Punkten
(q025…q975) der NAS-Prognosen werden Wahrscheinlichkeit
(P(Prognose < aktueller Preis)) und erwartete Ersparnis pro Liter unter
Gleichverteilungs-Annahme geschätzt — Basis steht im Antworttext und in der
GUI. Die exakte Berechnung läuft weiterhin nur auf dem NAS.

## 📁 Dateistruktur

```
rp2/
├── fallback_gui.py               # Webserver: NAS-Proxy + Fallback-GUI (Port 8000)
├── cache_forecasts.py            # Lädt /api/v1/last_forecasts vom NAS (alle 5 min)
├── templates/                    # wird beim Start selbst erzeugt (gitignored)
│   └── index.html                # Fallback-GUI (HTML+CSS+JS, eine Datei)
├── tankapp-forecast-cache.service
├── tankapp-fallback-gui.service
├── ANLEITUNG.md                  # Schritt-für-Schritt-Anleitung
└── README.md                     # diese Datei
```

## ⚙️ Konfiguration (systemd-Drop-in, `sudo systemctl edit tankapp-fallback-gui`)

| Variable | Default | Bedeutung |
|----------|---------|-----------|
| `NAS_IP` | – | NAS-Adresse; **ohne Wert: immer Fallback, kein Proxy** |
| `NAS_PORT` | `1355` | NAS-Port |
| `NAS_HEALTH_URL` | – | komplette Health-URL (überschreibt IP/Port) |
| `FALLBACK_GUI_PORT` | `8000` | Port der RP2-GUI |
| `POLL_DIR` | `/dev/shm/tankapp` | Collector-Ringpuffer |
| `CACHE_DIR` | `/tmp/tankapp_cache` | Prognose-Cache |
| `STATION_META` | – | Pfad zu `polling.json` (sonst Standardorte) |
| `FORCE_FALLBACK` | – | `1` = Proxy deaktiviert, immer Fallback-GUI |

`polling.json` wird aus diesen Orten gesucht (erste Treffer zählt):
1. `STATION_META` (Umgebungsvariable)
2. `~/TankApp/docs/analysis/stations/polling.json`
3. `<Repo>/docs/analysis/stations/polling.json`

**Ohne `polling.json` fehlen Namen, Marken und Navigation** — die UUID wird
dann angezeigt. Die Datei liegt beim Collector bereits auf dem Pi
(siehe [docs/INSTALL.md](../docs/INSTALL.md) §2.2).

## 🧪 Verhalten & Tests

- `http://<RP2-IP>:8000/` — NAS-GUI (proxied) oder Fallback-GUI
- `http://<RP2-IP>:8000/?fallback=1` — Fallback-GUI **erzwingen** (auch bei NAS online)
- `http://<RP2-IP>:8000/api/v1/health` — Status (NAS, Preise, Prognosen, Metadaten)
- `http://<RP2-IP>:8000/api/v1/stations?fuel=e10` — alle Stationen, alle Preise
- `http://<RP2-IP>:8000/api/v1/forecasts?fuel=e10` — gecachte Prognosen + 24-h-Zusammenfassung
- `http://<RP2-IP>:8000/api/v1/decide?fuel=e10&liters=40` — F1/F2/F3-Entscheidung
- `http://<RP2-IP>:8000/api/v1/nas-check` — NAS sofort neu prüfen (auch im Proxy-Modus)

Umschaltzeiten:
- NAS geht aus → **nächster Request** fällt sofort in den Fallback zurück.
- NAS kommt zurück → innerhalb von **15 s** (Online-TTL) bzw. spätestens
  beim nächsten `/api/v1/nas-check` (Knopf „🔄 NAS prüfen“ in der Fallback-GUI).

Tests: `python3 -m pytest tests/test_rp2_fallback.py`

## 🔄 Template-Updates

Die GUI speichert sich beim Start `templates/index.html` mit einem
Inhalts-Hash-Marker (`<!-- tankapp-fallback-gui v2.0 sha:… -->`). Ändert sich
das Template im Repo, wird die alte Datei beim nächsten Service-Start nach
`index.html.old` gesichert und die neue Version installiert — **lokale
Änderungen überleben aber, solange sie den aktuellen Marker tragen**
(Zusatz-Bausteine unterhalb des Markers sind möglich). Update-Workflow:
`git pull && sudo systemctl restart tankapp-fallback-gui`.

## 📝 Changelog

| Version | Datum | Änderungen |
|---------|-------|-----------|
| 2.0 | 09.09.2026 | **NAS-Proxy**: bei NAS online zeigt Port 8000 die volle NAS-GUI (automatisch, `?fallback=1` erzwingt Fallback). Stationennamen/Marken/Koordinaten aus `polling.json` (bisher UUIDs). Neue Fallback-GUI: Dark/Light-Mode, E10/E5/Diesel-Umschalter, echte Datenalter je Station, Tankgröße einstellbar, F1/F3 aus echten Quantil-Prognosen (Wahrscheinlichkeit + erwartete Ersparnis), Prognose-Sparklines (q025/q50/q975), Auto-Refresh, „NAS prüfen“-Knopf. Saubere JSON-API (`health/stations/forecasts/decide/nas-check`). Template-Update per Inhalts-Hash. `cache_forecasts.py`: tote `load_live_prices()` entfernt |
| 1.1 | 09.09.2026 | NAS-IP über `NAS_IP`-Env; nur Standardbibliothek; atomarer Cache-Write |
| 1.0 | 08.09.2026 | Initial: RP2 Fallback-GUI mit F1/F2/F3-Caching |
