# Stationen im Polling-Set tauschen

Eine beobachtete Station liefert dauerhaft keine verwertbaren Preise: geschlossen,
führt den Kraftstoff nicht (z. B. `e10: false`), UUID tot. Dann zieht sie dem
Modelllauf jede Stunde einen `insufficient_or_invalid_training_data`-Fehler und
den Gesamtstatus `partial (some_models_unavailable)` zu. Dieses Runbook tauscht
sie kontrolliert oder filtert sie bereits bei der Kandidatensuche aus.

Verwandt, aber anders gelagert: [Preis-Zwillinge](../engine/README.md#preis-zwillinge)
(redundante Stationen per Selektion ersetzen) und [UUID-Migration](STATIONS-UUID.md)
(vermischte Namensserien — nicht durch einen Tausch reparierbar).

## Inhaltsverzeichnis

- [Kurzfassung](#kurzfassung-wenn-der-befund-schon-feststeht)
- [Regeln, bevor du anfängst](#regeln-bevor-du-anfängst)
- [A) Befund absichern (nur lesend)](#a-befund-absichern-nur-lesend)
- [B) Ersatz suchen — ungeeignete bei der Suche ausfiltern](#b-ersatz-suchen--ungeeignete-bei-der-suche-ausfiltern)
- [C) Vorschlag bauen (1:1-Tausch, ein Befehl)](#c-vorschlag-bauen-11-tausch-ein-befehl)
- [D) Auf dem Pi aktivieren](#d-auf-dem-pi-aktivieren)
- [E) NAS-Kopie aktualisieren](#e-nas-kopie-aktualisieren)
- [F) Verifikation und Erwartungen](#f-verifikation-und-erwartungen)
- [Rollback](#rollback)

---

## Kurzfassung (wenn der Befund schon feststeht)

```bash
# NAS — Ersatz suchen (filtert tote/ohne-e10-Stationen aus) …
python3 data-tools/discover_stations.py --stations data/raw/stations \
  --anchor "<Stadt>:<lat>,<lon>" --radius 5 \
  --check-history data/raw/prices --min-days 28 --fuel e10 \
  --out docs/analysis/stations-vorschlag-<Stadt> --write-pool
# NAS … Vorschlag bauen (entfernt die Modell-Fehler-UUIDs dieser Stadt):
python3 data-tools/swap_stations.py --city <Stadt> \
  --kandidaten docs/analysis/stations-vorschlag-<Stadt> --stations data/raw/stations
# PI — Vorschlag nach data/setup/ übertragen, dann:
sudo systemctl stop tankapp-collector \
  && cp -p data/setup/polling.json docs/analysis/stations/polling.json \
  && sudo systemctl restart tankapp-collector tankapp-uploader
# NAS — Kopie vom Pi holen und App neu starten:
python3 tankapp.py nas-up
```

Details, Prüfschritte und Rollback: unten.

## Regeln, bevor du anfängst

1. **`tankapp.py activate-polling` tauscht nicht.** Der Befehl ist ausdrücklich
   nur für die *Addition neuer Stadtsets* gebaut und bricht ab, sobald ein
   bestehendes Set verändert würde (`Bestehendes Set … wäre verändert`).
   Ein Tausch läuft deshalb über: Backup → Collector stoppen → Datei einsetzen
   → Collector/Uploader neu starten (genau wie `activate-polling` es intern tut).
2. **Pro Stadtset 1–10 UUIDs** (`prices.php?ids=` bündelt max. 10 je Request).
   1:1 tauschen hält das Request-Budget konstant.
3. **Eine neue Station braucht wieder Zeit:** mindestens 28 Tage mit
   ≥ 672 offenen 5-Minuten-Preisen im 42-Tage-Trainingsfenster, bevor ihr
   erster Fit durchgeht. Bis dahin bleibt der Modelllauf `partial` — der
   stündliche Retry versorgt alle anderen Stationen trotzdem weiter
   (`retained_previous`), die neuen Stationen stehen dann als einzige in
   `failures`.
4. **δ̂-Selektion einer Stadt** braucht ≥ 4 Stationen mit ≥ 85 % Coverage im
   42-Tage-Fenster; einzelne tote Stationen behindern das nicht (Coverage-Gate
   schließt sie je Station aus), aber jede neu aufgenommene Station startet
   wieder bei niedriger Coverage.
5. **`polling.json` ist privat und zweifach nötig:** aktiv auf dem Pi
   (`~/TankApp/docs/analysis/stations/polling.json`), Kopie im NAS-Checkout.
   Nach jeder Änderung: Pi → NAS kopieren und `python3 tankapp.py nas-up`
   wiederholen (private Dateien sind read-only in den Container gemountet).
6. Fairness gegenüber der API: keine eigenen Poll-Schleifen bauen; einzelne
   diagnostic `prices.php`-Abfragen sind harmlos, der Collector erzwingt den
   5-Minuten-Abstand über den persistenten Zeitplan selbst.

## A) Befund absichern (nur lesend)

### A1 — Live-Status je UUID (auf dem Pi, dort liegt der Collector-Key)

```bash
cd ~/TankApp
KEY=$(cat data/apikey.txt)
curl -s "https://creativecommons.tankerkoenig.de/json/prices.php?ids=<UUID1>,<UUID2>,<UUID3>,<UUID4>&apikey=$KEY" | jq '.prices'
```

Tagsüber (06–24 Uhr) gedeutet:

| Befund | Bedeutung | Konsequenz |
|---|---|---|
| `status:"open"`, `e10` numerisch | Station lebt, liefert E10 | **nicht tauschen** — wenn trotzdem 0 Trainingspunkte: Upload/Export-Kette prüfen (Schritt F) |
| `status:"closed"` oder Station fehlt in der Antwort | stillgelegt / UUID tot | tauschen |
| `status:"open"`, aber `e10: false`/fehlt | führt den Kraftstoff nicht | für diesen Kraftstoff tauschen (für E5/Diesel-Modelle bleibt sie brauchbar) |

Die Felder `fuels`/`hist_days` in den `stations`-Einträgen des aktiven
`polling.json` stammen aus dem Archiv-Scan beim Aufbau des Sets und geben
dieselbe Auskunft: `fuels:"diesel"` bei 367 Tagen heißt *führt kein E10/E5*
(für E10-Modelle wertlos, auch wenn die Station lebt), `hist_days:0` mit
leerem `fuels` heißt *nie Preise gesehen* (UUID praktisch tot).

**Zu `GÃœTERSLOH SÃœD`:** das ist doppelt kodierte UTF-8-Anzeige
(„GÜTERSLOH SÜD“, so in den Stationslisten des Datenrepos) — rein kosmetisch,
betrifft nur den Anzeigenamen, nie UUIDs oder Preise. Sowohl
`discover_stations.py` (beim Lesen der Stationsliste) als auch
`swap_stations.py` (beim Tausch) reparieren Namen/Marken automatisch; gefiltert
wird ausschließlich nach UUID, Tagen und Kraftstoff. Werden in der eigenen
Terminal-Ausgabe trotzdem „Ã¼/Ã¤/Ã¶“ angezeigt, ist zusätzlich das Terminal
nicht auf UTF-8 gestellt (`locale`/`LANG` prüfen) — die Dateien selbst sind
UTF-8.

### A2 — hatte die Station jemals Preise? (NAS-Archiv, korrektes Namensmuster)

Archivdateien heißen `data/raw/prices/YYYY/MM/YYYY-MM-DD-prices.csv.gz` —
ein Glob wie `09-*.csv.gz` greift ins Leere. Richtig:

```bash
cd /mnt/user/appdata/TankApp
for u in <UUID1> <UUID2> <UUID3> <UUID4>; do
  hits=$(zgrep -l "$u" data/raw/prices/*/*/*-prices.csv.gz 2>/dev/null)
  n=$(printf '%s' "$hits" | grep -c .)
  echo "$u: $n Archivtage"
  [ "$n" -gt 0 ] && printf '%s\n' "$hits" | sed -n '1p;$p'   # erster … letzter Tag
done
```

`zgrep -l` liest jede Datei nur bis zum ersten Treffer; fehlende UUIDs werden
voll gescannt (IO-limitiert, auf dem SSD-Share ok). `0` Tage = nie im Archiv —
tote UUID praktisch sicher. Ein letzter Tag kurz vor heute + Live-Befund „tot“
= erst kürzlich geschlossen → trotzdem tauschen: der Fit braucht Tage im
*jetzigen* 42-Tage-Fenster.

### A3 — Grenzfall „fast genug“

Eine Station knapp unter der Schwelle (z. B. 25 nutzbare Tage mit 683 ≥ 672
Punkten) muss **nicht** getauscht werden, solange sie live offene Preise
liefert: ihr fehlen wenige Tage, der nächste erfolgreiche Fit kommt von allein.
Erst wenn A1 sie tot meldet, tauschen.

## B) Ersatz suchen — ungeeignete bei der Suche ausfiltern

Auf dem NAS (dort liegt das Archiv); die Stationsliste ist bundesweit, ein
größerer Radius macht das Archiv also nicht kleiner, nur die Kandidatenliste.

```bash
cd /mnt/user/appdata/TankApp

# 1) Stationsbasis aktuell? (history-sync legt sie täglich ab)
ls -t data/raw/stations/*/*/*-stations.csv.gz | head -3
# fehlt/zu alt:
python3 data-tools/fetch_history.py --stations-latest --outdir data/raw --netrc data/_netrc

# 2) Anker aus dem aktiven Set übernehmen (Label + Koordinaten):
jq '.sets | to_entries[] | {set:.key, label:.value.label, anchor:(.value.anchor // [.value.lat,.value.lon])}' docs/analysis/stations/polling.json

# 3) Kandidaten suchen — tote/falsche-Sorte-Stationen fallen raus:
python3 data-tools/discover_stations.py \
  --stations data/raw/stations \
  --anchor "<Stadt>:<lat>,<lon>" --radius 5 \
  --check-history data/raw/prices --min-days 28 --fuel e10 \
  --out docs/analysis/stations-vorschlag-<Stadt> --write-pool
```

* `--min-days 28` entspricht der Modell-Schwelle: Stationen mit weniger Tagen
  Archivpreis gelten als *nicht geeignet*. Sie erscheinen weiter in Report und
  `*_kandidaten.csv` (dort mit Grund markiert), kommen aber **nicht** ins
  erzeugte `polling.json`-Set. Ist das Archiv jünger als 28 Tage, den Wert
  senken (z. B. 14) und im Report auf `hist_first` achten.
* `--fuel e10` verlangt zusätzlich, dass die Station genau diese Sorte im
  Archiv wirklich geliefert hat. Ohne dieses Flag gilt eine Station schon
  mit *irgendeinem* Kraftstoff als geeignet — eine 367-Tage-Diesel-Only-Bude
  (AVIA-Fall) würde sonst fälschlich ins Set rutschen. `--fuel all` verlangt
  alle drei Sorten (diesel/e5/e10) gemeinsam — praktisch, wenn ein Set alle
  drei Kraftstoffmodelle aus derselben Station bedienen soll.
* Reichen die geeigneten Kandidaten nicht für 10 Plätze, bleibt das Set
  **bewusst kürzer** und der Report warnt (`⚠ nur N geeignete Stationen …`).
  Dann `--radius`/`--plz` erweitern (`--plz "<Stadt>:33"`), nicht die
  Eignungsgrenze aufweichen. Wer das alte Verhalten (Auffüllen auch mit
  ungeeigneten Stationen) ausnahmsweise braucht: `--allow-ineligible`.
* Die Spalte `hist_fuels` zeigt, welche Sorten die Station im Archiv wirklich
  geliefert hat — leer (`""`) zusammen mit `hist_days: 0` heißt *nie im
  Preisarchiv gesehen*. Vor dem Schluss „tote UUID“ erst prüfen, ob das
  Archiv überhaupt aktuell ist (letzter Tag in `data/raw/prices`,
  `hist_last` im Report): Fehlende Tage holt
  `python3 data-tools/fetch_history.py --since <YYYY-MM-DD> --outdir data/raw`
  resümierbar nach; `--stations-latest` aktualisiert **nur die
  Stationsliste**, keine Preise. Nach dem Nachladen `--check-history`
  wiederholen. Bleibt es bei 0 Tagen (Neubau/neue UUID/geschlossen), ist die
  Station für einen sofortigen Tausch unbrauchbar; eine brandneue Station
  sammelt erst ab jetzt die nötigen 28 Tage.
* Ausgaben landen im **separaten** Ordner (`*_kandidaten.csv`, `report.md`,
  `polling.json`) — nie direkt in `docs/analysis/stations/`, das aktive Set
  bleibt unberührt.

### Live-Gegenprobe der Wunsch-Kandidaten (Pi, ein Request)

```bash
KEY=$(cat data/apikey.txt)
curl -s "https://creativecommons.tankerkoenig.de/json/prices.php?ids=<NEU1>,<NEU2>,<NEU3>,<NEU4>&apikey=$KEY" | jq '.prices'
```

Nur Kandidaten mit `status:"open"` **und** numerischem E10 einsetzen. Das
Archiv beweist Vergangenheit, nicht Gegenwart — eine seit Kurzem geschlossene
Station kann trotzdem ≥ 28 Archivtage haben.

## C) Vorschlag bauen (1:1-Tausch, ein Befehl)

Auf dem NAS. `swap_stations.py` entfernt die Fehler-UUIDs aus `batch` +
`stations`, füllt mit den nächstgelegenen geeigneten Kandidaten aus der
Kandidaten-CSV auf (Sorte + Mindesttage geprüft, keine Zwillings-Marke in
1,5 km zu einer verbleibenden Station, exakte Koordinaten aus der
Stationsliste, Namen/Marken mit reparierter Kodierung), validiert das
**gesamte** Set und schreibt **nur** den Vorschlag `data/setup/polling.json`.
Das aktive Set bleibt unverändert. Bei zu wenigen geeigneten Kandidaten wird
sauber abgebrochen.

```bash
cd /mnt/user/appdata/TankApp
python3 data-tools/swap_stations.py --city Gütersloh \
  --kandidaten docs/analysis/stations-vorschlag-gt \
  --stations data/raw/stations
```

* Die zu entfernenden UUIDs kommen standardmäßig aus den Modell-Fehlern in
  `data/runtime/engine/current.json` (nur die der gewählten Stadt und des
  `--fuel`, Default `e10`). Zusätzlich/ersatzweise: `--remove-uuid <uuid>`.
* Eine Fehler-Station behalten (z. B. GTB kurz unter der 28-Tage-Grenze, aber
  live offen): `--keep-uuid <uuid>`.
* Vorher ungesehen ansehen: `--dry-run` — gleiche Ausgabe, nichts geschrieben.
* Ohne `--stations` werden gerundete Koordinaten (~100 m) aus der
  Kandidaten-CSV übernommen; mit `--stations data/raw/stations` exakte.

Die Ausgabe listet Entfernt/Neu auf und druckt die Folge-Befehle (inklusive
der fertigen `curl`-Zeile für die Live-Gegenprobe der neuen UUIDs) —
unterwegs nichts anfassen, das aktive Set bleibt bis Schritt D in Betrieb.

## D) Auf dem Pi aktivieren

Vorschlag auf den Pi übertragen (z. B. `scp`), dann im TankApp-Ordner des Pi:

```bash
cd ~/TankApp

# 1) Vorschlag unabhängig validieren (gleiche Regeln wie activate-polling):
python3 - <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, "data-tools")
from polling_plan import validate_sets
validate_sets(json.loads(Path("data/setup/polling.json").read_text(encoding="utf-8-sig")))
print("Vorschlag gültig.")
PY

# 2) Backup — Rollback-Anker:
cp -p docs/analysis/stations/polling.json \
      "data/setup/polling-backup-$(date -u +%Y%m%dT%H%M%SZ).json"

# 3) Einsetzen und neu starten (Reihenfolge wie activate-polling):
sudo systemctl stop tankapp-collector
cp -p data/setup/polling.json docs/analysis/stations/polling.json
sudo systemctl restart tankapp-collector tankapp-uploader
systemctl is-active tankapp-collector tankapp-uploader

# 4) Live prüfen:
journalctl -u tankapp-collector -n 20 --no-pager        # „Poll ok: x/y offen“
tail -n 1 "/dev/shm/tankapp/$(date +%F).jsonl" | python3 -m json.tool | head
sudo systemctl restart tankapp-fallback-gui             # Namen/Marken der Fallback-GUI
```

Der Collector liest `polling.json` beim Start; der persistente Request-Zeitplan
(`meta/poll-schedule.json` im tmpfs) bleibt erhalten — kein Burst, kein
Ack-Reset, keine Datenlöschung.

## E) NAS-Kopie aktualisieren

```bash
scp pi@<pi-ip>:~/TankApp/docs/analysis/stations/polling.json \
    /mnt/user/appdata/TankApp/docs/analysis/stations/polling.json
cd /mnt/user/appdata/TankApp
python3 tankapp.py nas-up
```

`nas-up` erneut ausführen ist Pflicht (private Dateien sind read-only
eingebunden); ein Image-Rebuild ist ohne Code-Änderung nicht nötig.

## F) Verifikation und Erwartungen

```bash
# NAS: Jobstatus und nächste Ausführung (Fehler → Retry jede Stunde):
jq '{state, error_code, next_run_at}' data/runtime/jobs/models.json
# Nach dem ersten Lauf mit dem neuen Set:
jq '.failures' data/runtime/engine/current.json
curl -s "http://localhost:1355/api/v1/selection?fuel=e10" | head -c 300
```

* Die alten Fehler-UUIDs sind weg (der Export liest nur UUIDs des aktiven Sets).
* Neue Stationen stehen erwartbar als `insufficient_or_invalid_training_data`
  in `failures`, bis sie 28 Tage × 672 Punkte im Fenster haben (~4 Wochen
  Polling). Solange bleibt der Lauf `partial (some_models_unavailable)` — das
  ist hier **normal** und blockiert die anderen Prognosen nicht.
* Die δ̂-Selektion der Stadt erscheint erst, wenn ≥ 4 Stationen ≥ 85 % Coverage
  im 42-Tage-Fenster erreicht haben (bei einem jungen Set also einige Tage nach
  den ersten erfolgreichen Fits).
* Pi-seitig die ersten Tage beobachten: `journalctl -u tankapp-collector -f`
  und der „no prices“-Alarm (`⚠ … aus Monitoring prüfen`) darf für die neuen
  UUIDs nicht zurückkommen.

## Rollback

```bash
cd ~/TankApp
sudo systemctl stop tankapp-collector
cp -p data/setup/polling-backup-<Zeitstempel>.json docs/analysis/stations/polling.json
sudo systemctl restart tankapp-collector tankapp-uploader
```

Danach NAS-Kopie wieder vom Pi holen und `nas-up` wiederholen (Schritt E).
