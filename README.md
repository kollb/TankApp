# TankApp

TankApp beantwortet mit echten Tankstellenpreisen drei Fragen: **Jetzt oder
warten? Hier oder woanders? Heute oder später?** Preisbeobachtung,
Modellprognose und persönliche Tankbilanz bleiben dabei getrennt.

> Stand: 23.09.2026 · App-Version **0.69.0**
> [Dokumentation](docs/README.md) · [Offene Aufgaben](docs/planung/TODO.md) ·
> [Release-Historie](docs/releases/CHANGELOG.md) · [Mitwirken](CONTRIBUTING.md)

## Inhaltsverzeichnis

- [Einstieg](#einstieg)
- [System und Oberfläche](#system-und-oberfläche)
- [Repository](#repository)
- [Entwicklung](#entwicklung)
- [Daten und private Konfiguration](#daten-und-private-konfiguration)

## Einstieg

| Aufgabe | Dokument |
|---|---|
| Pi und NAS einrichten | [Installation](docs/betrieb/INSTALL.md) |
| Dienste betreiben, sichern und Fehler beheben | [Betrieb](docs/betrieb/BETRIEB.md) |
| Produkt und Grenzen verstehen | [Konzept](docs/produkt/KONZEPT.md) |
| Implementierung und offene Abnahmen prüfen | [Projektstand](docs/planung/LUECKEN.md) |
| Endpunkte nachschlagen | [API](docs/referenz/API.md) |

## System und Oberfläche

- **Pi/RP2:** Collector, RAM-Puffer und Upload zum NAS. Optional dient Port
  8000 als NAS-Proxy mit einer lesenden Fallback-Oberfläche.
- **NAS:** Archiv, InfluxDB, Aufbereitung, Modell-Läufe, API und Web-GUI auf
  Port 1355. Persönliche Belege und Jobzustände liegen in `runtime/`.
- **PC/Handy:** Browser; der PC ist kein notwendiger Dauerdienst.

Die Hauptnavigation besteht aus **Jetzt, Woche, Stationen** und **Mehr**.
Hinter „Mehr“ liegen Labor, Ich, System und Glossar; auf dem Desktop sind
sie als Studio-Gruppe erreichbar. Details: [UI](docs/produkt/UI.md).

Der Modell-Default ist `profile_ar2` mit gemeinsamer Bootstrap-Ziehung und
Day-Pair-Blöcken. Eine technische PIT-Rekalibrierung ist nur für 24 Stunden
vorgesehen. **Sie ist keine Produktfreigabe:** Empfehlungen brauchen zusätzlich
das M7-Ledger-Gate und die Freigabekette (A21-B1.4) — frische Preise,
gültiger Prognosezeitraum, vollständige Pfade, veröffentlichte Güte. Ohne
die erforderliche Evidenz bleibt `decision_ready=false`; aktuelle Preise und
Sperrgründe (`blocking_reasons`) können trotzdem angezeigt werden. Eine
freigegebene Handlung ist befristet (`valid_until`). Ein Softwaretest ist
weder ein Nachweis für Modellgüte noch eine Geräteabnahme.

## Repository

```text
app/          NAS-App, API, Decision Layer, Ledger und Jobs
engine/       Aufbereitung, Modelle, Bootstrap und Backtest
data-tools/   Collector, Upload, Archiv-Sync und Datenpflege
analysis/     Offline-Selektion und Analysewerkzeuge
web/          React-GUI sowie Unit- und Browser-Tests
rp2/          NAS-Proxy, Prognose-Cache und Fallback-GUI
ops/          Deployment, Backup und Qualitätsmessung
sample/       GUI-Vorlagen; bleiben als Design-Basis erhalten
tests/        Python-Tests
docs/         Thematische Dokumentation; Einstieg: docs/README.md
```

`AGENTS.md`, `tankapp.py`, `pyproject.toml`, `requirements-dev.txt` und die
Git-/Docker-Konfiguration bleiben wegen ihrer technischen Funktion im Root.
Fachliche Dokumente und Release-Historie liegen ausschließlich in `docs/`.

## Entwicklung

Abhängigkeiten und vollständige Prüfsequenz stehen in
[CONTRIBUTING.md](CONTRIBUTING.md). Eine lokale Vorschau nach dem Web-Build
startet mit `python tankapp.py serve`; Hintergrundjobs erfordern `--jobs`.

## Daten und private Konfiguration

Preisdaten stammen von MTS-K über Tankerkönig (**CC BY 4.0**).
Das Polling arbeitet zwischen 06:00 und 24:00 Uhr mit einem gemeinsamen
Budget von einem Request pro 300 Sekunden; mehrere Stadtsets teilen es sich.

Schlüssel, private Konfiguration, Rohdaten und Modelle gehören nicht in Git:
`config.local.json`, `data/`, `runtime/` und lokale Analyseausgaben sind
entsprechend ausgeschlossen. Die Datenlizenz ist keine Lizenzangabe für den
Anwendungscode; eine eigene `LICENSE`-Datei ist im Checkout nicht vorhanden.
