# TankApp

**Ziel: GUI öffnen → passende Tankstelle und Zeitpunkt sehen → tanken.**
Kein tägliches CSV-Kopieren, kein manuelles Modelltraining.

## Ein Einstieg, eine Reihenfolge

**[Installation und nächster Schritt → docs/INSTALL.md](docs/INSTALL.md)**

1. **Gütersloh ins gemeinsame Polling aufnehmen.** Frankfurt läuft weiter.
2. **NAS-App mit echten Live-Preisen starten.** Nicht auf fertige Prognosen warten.
3. **Parallel das NAS-Archiv automatisch aufbauen:** ein Jahr oder mehr Tankerkönig-Historie, fehlende Tage nachholen.
4. **NAS-App berechnet und veröffentlicht automatisch**, danach geprüfte Empfehlungen in derselben GUI ergänzen.

| Gerät | Aufgabe im Endzustand |
|---|---|
| **Pi** | Collector für alle Städte, RAM-Puffer, Upload zum NAS; läuft unabhängig weiter. |
| **NAS** | Tankerkönig-Archiv, InfluxDB, automatische Aufbereitung/Fits, API und Web-GUI. |
| **PC / Handy** | GUI im Browser. PC optional zur Einrichtung oder für schnellere Rechenläufe; kein Dauerbetrieb und keine verpflichtende venv. |

**Stand 08.09.2026:** Gemeinsames Mehrstadt-Polling, Live-GUI mit Alltag/Statistik/
System, Nur-Lese-API und gebündelter NAS-App-Dienst sind implementiert. Ein Start
über `python3 tankapp.py nas-up` übernimmt GUI, Archiv-Nachholung und automatische
Modellberechnung/-veröffentlichung. Bestehende InfluxDB weiterverwenden; Ablauf
und private Konfiguration stehen ausschließlich in der Installationsanleitung.

**Nicht gleichbedeutend mit Deployment oder geprüfter Modellgüte:** Auf deinen
Geräten noch nicht aktiviert/abgenommen. Ohne private Daten zeigt die GUI den
Einrichtungszustand, keine Beispielpreise. Prognosen bleiben unkalibriert und
nicht entscheidungsbereit; aktuelle echte Preise sind davon unabhängig nutzbar.

<details>
<summary>Nur für Entwicklung und Fehlersuche — keine zusätzliche Installationsreihenfolge</summary>

- [Engine-Referenz](engine/README.md): Modellwerkstatt, Datenqualität, Übergangsregel.
- [Werkzeugübersicht](data-tools/README.md): interne Einzelprogramme.
- [Architekturkonzept](docs/KONZEPT.md): fachliches Zielbild; der Betriebsplan in INSTALL.md hat Vorrang.
- [GUI-Basis](sample/README.md): beide vorhandenen Oberflächen erhalten, Demo-Inhalte nicht als Echt-Daten ausgeben.
- Spezialdiagnosen: [UUID-Umstellung](docs/STATIONS-UUID.md), [Preis-Zwillinge](engine/README.md#preis-zwillinge).

Softwaretests sind Entwicklerprüfungen, keine Installationspflicht. Windows mit
vorhandenem Python 3.11+, ohne neue venv:

```powershell
py -3 -m pip install -r requirements-dev.txt
py -3 -m pytest -q
```

Frontend-Prüfungen (nur Entwicklung, Node 22):

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
npx --prefix web playwright install chromium
npm --prefix web run test:e2e
```

Für eine lokale Vorschau nach dem Build: `python tankapp.py serve`; nur mit
`--jobs` werden Hintergrundaufgaben eingeschaltet. Browsertests starten ihren
eigenen Server, sofern auf Port 1355 keiner läuft. `app/requirements.txt` enthält
die Pakete für optionale lokale Modellläufe; im NAS-Image bereits installiert.

Private Konfiguration, Rohdaten, Berichte und Modelle bleiben außerhalb von Git.
Die Verzeichnisse `sample/good gui` und `sample/good statistic gui` bleiben erhalten.

</details>
