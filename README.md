# TankApp

**Ziel: GUI öffnen → passende Tankstelle und Zeitpunkt sehen → tanken.**
Kein tägliches CSV-Kopieren, kein manuelles Modelltraining.

## Ein Einstieg, eine Reihenfolge

**[Installation und nächster Schritt → docs/INSTALL.md](docs/INSTALL.md)**

1. **Gütersloh ins gemeinsame Polling aufnehmen.** Frankfurt läuft weiter.
2. **Vorhandene GUI mit echten Live-Preisen verbinden.** Nicht auf fertige Prognosen warten.
3. **Parallel das NAS-Archiv automatisch aufbauen:** ein Jahr oder mehr Tankerkönig-Historie, fehlende Tage nachholen.
4. **Berechnung auf dem NAS automatisieren**, danach geprüfte Empfehlungen in derselben GUI ergänzen.

| Gerät | Aufgabe im Endzustand |
|---|---|
| **Pi** | Collector für alle Städte, RAM-Puffer, Upload zum NAS; läuft unabhängig weiter. |
| **NAS** | Tankerkönig-Archiv, InfluxDB, automatische Aufbereitung/Fits, API und Web-GUI. |
| **PC / Handy** | GUI im Browser. PC optional zur Einrichtung oder für schnellere Rechenläufe; kein Dauerbetrieb und keine verpflichtende venv. |

**Stand 08.09.2026:** Collector/Uploader und Offline-Engine vorhanden. Neu sind
gebündelte Stadtaufnahme, Mehrstadt-Polling und ein NAS-Archiv-Sync für cron bzw.
NAS-Aufgabenplanung. Diese Programme sind getestet, auf deinen Geräten aber noch
nicht aktiviert. Die produktive GUI-/API-Anbindung und automatische Modellveröffentlichung
sind noch offen. Die GUI-Vorlagen sind keine bereits fertige Live-App.

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

Private Konfiguration, Rohdaten, Berichte und Modelle bleiben außerhalb von Git.
Die Verzeichnisse `sample/good gui` und `sample/good statistic gui` bleiben erhalten.

</details>
