#!/usr/bin/env python3
"""
RP2 Fallback GUI - Zeigt Live-Preise + gecachte Prognosen an, wenn NAS offline.
Läuft als Webserver auf Port 8000.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import socket
import threading
import urllib.request

# Konfiguration ueber Umgebungsvariablen (systemd: Environment=NAS_IP=...)
NAS_IP = os.environ.get("NAS_IP", "")
NAS_PORT = os.environ.get("NAS_PORT", "1355")
NAS_HEALTH_URL = os.environ.get(
    "NAS_HEALTH_URL", f"http://{NAS_IP}:{NAS_PORT}/api/v1/health"
)
GUI_PORT = int(os.environ.get("FALLBACK_GUI_PORT", "8000"))
CACHE_DIR = Path("/tmp/tankapp_cache")
CACHE_FILE = CACHE_DIR / "last_forecasts.json"
POLL_DIR = Path("/dev/shm/tankapp")
TEMPLATE_DIR = Path(__file__).parent / "templates"

# Stelle sicher, dass Verzeichnisse existieren
CACHE_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)


class FallbackHandler(SimpleHTTPRequestHandler):
    """Request Handler mit Fallback-Logik."""
    
    # Klasse-variable für gemeinsame Daten
    live_prices = []
    forecasts = None
    last_updated = None
    
    def __init__(self, *args, **kwargs):
        # Aktualisiere Daten vor jedem Request
        self.load_data()
        super().__init__(*args, **kwargs)
    
    @classmethod
    def load_data(cls):
        """Lädt Live-Preise und gecachte Prognosen."""
        # Live-Preise laden
        cls.live_prices = cls._load_live_prices()
        
        # Prognosen laden
        cls.forecasts = cls._load_forecasts()
        
        # Zeitstempel
        cls.last_updated = datetime.now(timezone.utc)
    
    @staticmethod
    def _load_live_prices():
        """Lädt aktuelle Preise aus dem RP2-Puffer."""
        today = datetime.now().strftime("%Y-%m-%d")
        poll_file = POLL_DIR / f"{today}.jsonl"
        
        stations_data = {}
        if poll_file.exists():
            try:
                with open(poll_file, "r") as f:
                    for line in f:
                        data = json.loads(line)
                        # Extrahiere Stationen
                        for station in data.get("stations", {}).values():
                            stations_data[station["uuid"]] = station
                        break  # Nur die letzte Zeile
            except Exception:
                pass
        
        prices = []
        if poll_file.exists():
            try:
                with open(poll_file, "r") as f:
                    for line in f:
                        data = json.loads(line)
                        for sid, price_info in data.get("prices", {}).items():
                            if price_info.get("status") == "open":
                                station = stations_data.get(sid, {})
                                prices.append({
                                    "station_id": sid,
                                    "name": station.get("name", sid),
                                    "brand": station.get("brand", ""),
                                    "lat": station.get("lat"),
                                    "lon": station.get("lon"),
                                    "e10": price_info.get("e10"),
                                    "e5": price_info.get("e5"),
                                    "diesel": price_info.get("diesel"),
                                    "status": "open",
                                    "timestamp": data.get("timestamp"),
                                    "age_minutes": 0
                                })
            except Exception:
                pass
        
        return prices
    
    @staticmethod
    def _load_forecasts():
        """Lädt gecachte Prognosen."""
        if CACHE_FILE.exists():
            try:
                with open(CACHE_FILE, "r") as f:
                    return json.load(f)
            except Exception:
                return None
        return None
    
    def do_GET(self):
        """Behandelt GET-Requests."""
        # Immer Daten neu laden
        self.load_data()
        
        # API-Endpunkte
        if self.path.startswith("/api/"):
            self.handle_api()
            return
        
        # Hauptseite
        if self.path in ("/", "/index.html"):
            self.serve_index()
            return
        
        # Statische Dateien (CSS, JS, Bilder)
        self.serve_static()
    
    def handle_api(self):
        """Behandelt API-Requests."""
        if self.path == "/api/v1/health":
            self.send_json({
                "status": "online",
                "mode": "fallback",
                "nas_status": "offline",
                "last_updated": self.last_updated.isoformat() if self.last_updated else None,
                "live_prices_count": len(self.live_prices),
                "forecasts_count": len(self.forecasts.get("forecasts", [])) if self.forecasts else 0
            })
        elif self.path == "/api/v1/stations":
            # Gib Stationen mit aktuellen Preisen zurück
            stations = []
            for price in self.live_prices:
                # Finde den günstigsten verfügbaren Preis
                fuel_price = price.get("e10") or price.get("e5") or price.get("diesel")
                if fuel_price is not None:
                    stations.append({
                        "station_id": price["station_id"],
                        "name": price["name"],
                        "brand": price["brand"],
                        "lat": price["lat"],
                        "lon": price["lon"],
                        "price": float(fuel_price),
                        "status": price["status"],
                        "fuel": "e10" if price.get("e10") else "e5" if price.get("e5") else "diesel",
                        "timestamp": price["timestamp"],
                        "age_minutes": price.get("age_minutes", 0),
                        "fresh": True
                    })
            
            # Sortiere nach Preis
            stations.sort(key=lambda x: x["price"])
            
            self.send_json({
                "generated_at": self.last_updated.isoformat() if self.last_updated else None,
                "fuel": "e10",
                "stations": stations,
                "fresh_prices": len(stations),
                "nas_status": "offline",
                "decision_ready": False,
                "calibrated": False
            })
        elif self.path == "/api/v1/forecasts":
            # Gib gecachte Prognosen zurück
            if self.forecasts:
                self.send_json(self.forecasts)
            else:
                self.send_json({"error": "Keine Prognosen verfügbar"}, status=503)
        elif self.path == "/api/v1/decide":
            # Einfache Entscheidungslogik basierend auf aktuellen Preisen
            self.handle_decide()
        else:
            self.send_error(404)
    
    def handle_decide(self):
        """Einfache F2-Entscheidung: Welche Station ist jetzt am günstigsten?"""
        # Finde günstigste Station
        if not self.live_prices:
            self.send_json({"error": "Keine Preise verfügbar"}, status=503)
            return
        
        # Filtere nur Stationen mit gültigen Preisen
        valid_stations = []
        for price in self.live_prices:
            fuel_price = price.get("e10") or price.get("e5") or price.get("diesel")
            if fuel_price is not None and price["status"] == "open":
                valid_stations.append({
                    **price,
                    "price": float(fuel_price),
                    "fuel": "e10" if price.get("e10") else "e5" if price.get("e5") else "diesel"
                })
        
        if not valid_stations:
            self.send_json({"error": "Keine geöffneten Stationen mit Preisen"}, status=503)
            return
        
        # Sortiere nach Preis
        valid_stations.sort(key=lambda x: x["price"])
        cheapest = valid_stations[0]
        
        # Berechne Ersparnis gegenüber anderen Stationen
        savings = []
        for station in valid_stations[1:4]:  # Top 3 Alternativen
            saving = cheapest["price"] - station["price"]
            if saving > 0:
                savings.append({
                    "station_id": station["station_id"],
                    "name": station["name"],
                    "price": station["price"],
                    "saving_ct": round(saving * 100, 1),
                    "saving_eur": round(saving * 40, 2)  # Annahme: 40L Tank
                })
        
        # F1: Jetzt oder warten? (einfach: wenn günstigste Station < 1,70€, dann jetzt tanken)
        # Das ist eine vereinfachte Logik ohne Prognose
        action = "refuel_now" if cheapest["price"] < 1.70 else "wait"
        
        # F3: Heute später? (nicht verfügbar ohne Prognose)
        windows_today = []
        if self.forecasts:
            # Wenn Prognosen verfügbar, versuche F3
            windows_today = self._extract_windows(self.forecasts)
        
        self.send_json({
            "primary": {
                "action": action,
                "station": {
                    "id": cheapest["station_id"],
                    "name": cheapest["name"],
                    "price_now": cheapest["price"],
                    "fuel": cheapest["fuel"]
                },
                "expected_saving_eur": savings[0]["saving_eur"] if savings else 0,
                "p_correct": None,  # Ohne Prognose nicht verfügbar
                "confidence_badge": "medium",
                "reason_short": "Aktuell günstigste Station" if action == "refuel_now" else "Preis könnte noch fallen"
            },
            "alternatives_nearby": savings,
            "windows_today": windows_today,
            "windows_week": [],
            "nas_status": "offline",
            "forecast_age_hours": self._get_forecast_age(),
            "data_timestamp": self.last_updated.isoformat() if self.last_updated else None
        })
    
    def _extract_windows(self, forecasts_data):
        """Extrahiere Fenster aus Prognosedaten (vereinfacht)."""
        # Das ist eine Platzhalter-Implementierung
        # In der Praxis müsste hier die Decision-Layer-Logik aus dem NAS portiert werden
        windows = []
        if forecasts_data.get("forecasts"):
            # Nimm die ersten 3 Prognose-Punkte als Beispiel
            for i, fc in enumerate(forecasts_data["forecasts"][:3]):
                windows.append({
                    "start": fc.get("origin", ""),
                    "end": "",
                    "expected_price": fc.get("points", [{}])[0].get("price", 0) if fc.get("points") else 0,
                    "p_better": 0.5 + i * 0.1,  # Platzhalter
                    "saving_eur": round((1.70 - (fc.get("points", [{}])[0].get("price", 1.70) or 1.70)) * 40, 2)
                })
        return windows
    
    def _get_forecast_age(self):
        """Berechne Alter der Prognosen in Stunden."""
        if not self.forecasts:
            return None
        cached_at = self.forecasts.get("_cached_at")
        generated_at = self.forecasts.get("generated_at")
        if cached_at:
            try:
                cached_time = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - cached_time).total_seconds() / 3600
                return round(age, 1)
            except:
                pass
        if generated_at:
            try:
                gen_time = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - gen_time).total_seconds() / 3600
                return round(age, 1)
            except:
                pass
        return None
    
    def serve_index(self):
        """Serviert die Haupt-HTML-Seite."""
        # Lade Template
        template_path = TEMPLATE_DIR / "index.html"
        if not template_path.exists():
            self.send_error(404, "Template nicht gefunden")
            return
        
        # Lese Template
        with open(template_path, "r", encoding="utf-8") as f:
            template = f.read()
        
        # Ersetze Platzhalter
        nas_online = self.check_nas()
        nas_status = "✅ Online" if nas_online else "❌ Offline"
        nas_status_class = "online" if nas_online else "offline"
        forecast_age = self._get_forecast_age()
        forecast_age_text = f"{forecast_age}h alt" if forecast_age else "nicht verfügbar"
        data_age = "<5 Min"  # Live-Preise sind immer aktuell
        
        # Finde günstigste Station
        cheapest = None
        if self.live_prices:
            valid_prices = [p for p in self.live_prices 
                          if p.get("status") == "open" and 
                          (p.get("e10") or p.get("e5") or p.get("diesel"))]
            if valid_prices:
                valid_prices.sort(key=lambda x: float(x.get("e10") or x.get("e5") or x.get("diesel") or 999))
                cheapest = valid_prices[0]
                cheapest_price = float(cheapest.get("e10") or cheapest.get("e5") or cheapest.get("diesel") or 0)
        
        # HTML generieren
        html = template.replace("{{NAS_STATUS}}", nas_status)
        html = html.replace("{{NAS_STATUS_CLASS}}", nas_status_class)
        html = html.replace("{{FORECAST_AGE}}", forecast_age_text)
        html = html.replace("{{DATA_AGE}}", data_age)
        
        if cheapest:
            html = html.replace("{{CHEAPEST_NAME}}", cheapest.get("name", "Unbekannt"))
            html = html.replace("{{CHEAPEST_PRICE}}", f"{cheapest_price:.3f}")
            html = html.replace("{{CHEAPEST_BRAND}}", cheapest.get("brand", ""))
            if cheapest.get("lat") and cheapest.get("lon"):
                maps_url = f"https://www.google.com/maps/dir/?api=1&destination={cheapest['lat']},{cheapest['lon']}"
                html = html.replace("{{MAPS_URL}}", maps_url)
                html = html.replace("{{SHOW_MAPS}}", "")
            else:
                html = html.replace("{{MAPS_URL}}", "#")
                html = html.replace("{{SHOW_MAPS}}", "display:none;")
        else:
            html = html.replace("{{CHEAPEST_NAME}}", "Keine Daten")
            html = html.replace("{{CHEAPEST_PRICE}}", "N/A")
            html = html.replace("{{CHEAPEST_BRAND}}", "")
            html = html.replace("{{MAPS_URL}}", "#")
            html = html.replace("{{SHOW_MAPS}}", "display:none;")
        
        # Füge Stationen-Liste hinzu
        stations_html = self._generate_stations_html()
        html = html.replace("{{STATIONS_LIST}}", stations_html)
        
        # Sende Antwort
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html.encode())))
        self.end_headers()
        self.wfile.write(html.encode())
    
    def _generate_stations_html(self):
        """Generiert HTML für die Stationen-Liste."""
        if not self.live_prices:
            return "<tr><td colspan='4'>Keine Stationen verfügbar</td></tr>"
        
        valid_prices = [p for p in self.live_prices 
                      if p.get("status") == "open" and 
                      (p.get("e10") or p.get("e5") or p.get("diesel"))]
        valid_prices.sort(key=lambda x: float(x.get("e10") or x.get("e5") or x.get("diesel") or 999))
        
        rows = []
        for i, price in enumerate(valid_prices[:10]):  # Top 10
            fuel_price = float(price.get("e10") or price.get("e5") or price.get("diesel") or 0)
            cheapest_price = float(valid_prices[0].get("e10") or valid_prices[0].get("e5") or valid_prices[0].get("diesel") or 0)
            saving = cheapest_price - fuel_price
            
            row_class = "cheapest" if i == 0 else ""
            rows.append(f"""
                <tr class="{row_class}">
                    <td>{price.get('brand', '')} {price.get('name', 'Unbekannt')}</td>
                    <td>{fuel_price:.3f} €/L</td>
                    <td>{saving:.3f} €</td>
                    <td>
                        {f'<a href="https://www.google.com/maps/dir/?api=1&destination={price.get("lat")},{price.get("lon")}"" target="_blank">📍 Navigation</a>' if price.get("lat") and price.get("lon") else ''}
                    </td>
                </tr>
            """)
        
        return "\n".join(rows)
    
    def serve_static(self):
        """Serviert statische Dateien."""
        # Versuche, Datei aus Template-Verzeichnis zu laden
        file_path = TEMPLATE_DIR / self.path.lstrip("/")
        if file_path.exists():
            self.send_file(file_path)
            return
        
        # Standard-Verhalten
        super().do_GET()
    
    def send_json(self, data, status=200):
        """Sendet JSON-Antwort."""
        content = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)
    
    def send_file(self, file_path):
        """Sendet eine Datei."""
        self.send_response(200)
        content_type = "text/css" if file_path.suffix == ".css" else \
                      "text/javascript" if file_path.suffix == ".js" else \
                      "text/html"
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.end_headers()
        with open(file_path, "rb") as f:
            self.wfile.write(f.read())
    
    @staticmethod
    def check_nas():
        """Prüft, ob NAS erreichbar ist."""
        if not NAS_IP and "NAS_URL" not in os.environ:
            return False
        try:
            with urllib.request.urlopen(NAS_HEALTH_URL, timeout=2) as response:
                return response.status == 200
        except Exception:
            return False


def get_free_port():
    """Finde einen freien Port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("0.0.0.0", 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def main():
    # Erstelle Template-Verzeichnis, falls nicht vorhanden
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    
    # Erstelle Standard-Index.html, falls nicht vorhanden
    default_template = TEMPLATE_DIR / "index.html"
    if not default_template.exists():
        with open(default_template, "w") as f:
            f.write("""<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TankApp - RP2 Fallback</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
        .status { display: flex; gap: 20px; margin: 20px 0; padding: 10px; background: #f0f0f0; border-radius: 4px; }
        .status-item { display: flex; align-items: center; gap: 5px; }
        .status-online { color: #4CAF50; }
        .status-offline { color: #f44336; }
        .cheapest { background: #d4edda; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4CAF50; }
        .cheapest h2 { margin-top: 0; color: #155724; }
        .cheapest .price { font-size: 2em; font-weight: bold; color: #155724; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; }
        tr:hover { background: #f5f5f5; }
        tr.cheapest { background: #d4edda !important; }
        .btn { display: inline-block; background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-top: 10px; }
        .btn:hover { background: #45a049; }
        .age-info { font-size: 0.9em; color: #666; margin-top: 10px; }
        .fuel-badge { display: inline-block; padding: 3px 8px; background: #e0e0e0; border-radius: 4px; font-size: 0.8em; margin-left: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚗 TankApp - RP2 Fallback</h1>
        
        <div class="status">
            <div class="status-item">
                <strong>NAS:</strong>
                <span class="status-{{NAS_STATUS_CLASS}}">{{NAS_STATUS}}</span>
            </div>
            <div class="status-item">
                <strong>Prognosen:</strong>
                <span>{{FORECAST_AGE}}</span>
            </div>
            <div class="status-item">
                <strong>Preise:</strong>
                <span>{{DATA_AGE}}</span>
            </div>
        </div>

        <div class="cheapest">
            <h2>🏆 Günstigste Station jetzt</h2>
            <div>
                <span class="price">{{CHEAPEST_PRICE}} €/L</span>
                <span class="fuel-badge">{{CHEAPEST_BRAND}}</span>
            </div>
            <p><strong>{{CHEAPEST_NAME}}</strong></p>
            <a href="{{MAPS_URL}}" class="btn" style="{{SHOW_MAPS}}">📍 Navigation</a>
        </div>

        <h2>Alle Stationen (sortiert nach Preis)</h2>
        <table>
            <thead>
                <tr>
                    <th>Station</th>
                    <th>Preis</th>
                    <th>Ersparnis</th>
                    <th>Navigation</th>
                </tr>
            </thead>
            <tbody>
                {{STATIONS_LIST}}
            </tbody>
        </table>

        <div class="age-info">
            <p>💡 <strong>Hinweis:</strong> Dies ist die RP2-Fallback-GUI. Für volle Funktionen (Prognosen, Warte-Empfehlungen) bitte das NAS starten.</p>
        </div>
    </div>
</body>
</html>""")
    
    # Starte Server
    host = "0.0.0.0"
    port = GUI_PORT
    
    print(f"Starte RP2 Fallback GUI auf {host}:{port}")
    print(f"Template-Verzeichnis: {TEMPLATE_DIR}")
    print(f"Cache-Verzeichnis: {CACHE_DIR}")
    
    # Erstelle Handler mit gemeinsamem State
    class SharedHandler(FallbackHandler):
        pass
    
    server = ThreadingHTTPServer((host, port), SharedHandler)
    print(f"Server läuft auf http://{host}:{port}")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Server wird beendet...")
        server.shutdown()


if __name__ == "__main__":
    main()
