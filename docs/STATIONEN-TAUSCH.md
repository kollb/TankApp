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

- [Regeln, bevor du anfängst](#regeln-bevor-du-anfängst)
- [A) Befund absichern (nur lesend)](#a-befund-absichern-nur-lesend)
- [B) Ersatz suchen — ungeeignete bei der Suche ausfiltern](#b-ersatz-suchen--ungeeignete-bei-der-suche-ausfiltern)
- [C) Vorschlag bauen (1:1-Tausch, validiert)](#c-vorschlag-bauen-11-tausch-validiert)
- [D) Auf dem Pi aktivieren](#d-auf-dem-pi-aktivieren)
- [E) NAS-Kopie aktualisieren](#e-nas-kopie-aktualisieren)
- [F) Verifikation und Erwartungen](#f-verifikation-und-erwartungen)
- [Rollback](#rollback)

---

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
| `status:"open"`, `e10` numerisch | Station lebt, liefert E10 | **nicht tauschen** — wenn trotzdem 0 Trainingspunkte: Upload/Export-Kette prüfen (Phase F/G) |
| `status:"closed"` oder Station fehlt in der Antwort | stillgelegt / UUID tot | tauschen |
| `status:"open"`, aber `e10: false`/fehlt | führt den Kraftstoff nicht | für diesen Kraftstoff tauschen (für E5/Diesel-Modelle bleibt sie brauchbar) |

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

# 3) Kandidaten suchen — tote/ungeeignete fallen durch --check-history raus:
python3 data-tools/discover_stations.py \
  --stations data/raw/stations \
  --anchor "<Stadt>:<lat>,<lon>" --radius 5 \
  --check-history data/raw/prices --min-days 28 \
  --out docs/analysis/stations-vorschlag-<Stadt> --write-pool
```

* `--min-days 28` entspricht der Modell-Schwelle: Stationen mit weniger Tagen
  Archivpreis gelten als *nicht geeignet*, werden im Report markiert und
  hinten gereiht — genau das „bei der Suche rausfiltern“. Ist das Archiv
  jünger als 28 Tage, den Wert senken (z. B. 14) und im Report auf
  `hist_first` achten.
* `--radius 5` wie `add-city`-Default; bei zu wenigen Treffern Radius/PLZ
  erweitern (`--plz "<Stadt>:33"`), nicht die Eignungsgrenze diskutieren.
* Die Spalte `hist_fuels` zeigt, welche Sorten die Station im Archiv wirklich
  geliefert hat — Kandidaten ohne `e10` sind für ein E10-Set unbrauchbar.
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

## C) Vorschlag bauen (1:1-Tausch, validiert)

Auf dem NAS (oder dem Pi — dann Pfade anpassen). Entfernt die toten UUIDs aus
`batch` + `stations`, füllt mit den nächstgelegenen geeigneten Kandidaten auf,
validiert das **gesamte** Set (UUID-Format, 1–10 pro Stadt, keine UUID in zwei
Städten) und schreibt **nur** den Vorschlag `data/setup/polling.json`. Das
aktive Set bleibt unverändert.

```bash
cd /mnt/user/appdata/TankApp
python3 - <<'PY'
import csv, json, sys, datetime as dt
from pathlib import Path
sys.path.insert(0, "data-tools")
from polling_plan import validate_sets, atomic_json

CITY_KEY      = "<Stadt>"        # exakter Key aus: jq '.sets | keys'
ACTIVE        = Path("docs/analysis/stations/polling.json")
KANDIDATEN    = Path("docs/analysis/stations-vorschlag-<Stadt>/<stadt>_kandidaten.csv")
MIN_HIST_DAYS = 28
REMOVE = {                       # nur UUIDs eintragen, die A1/A2 als tot belegen
    "<UUID1>", "<UUID2>", "<UUID3>", "<UUID4>",
}

plan = json.loads(ACTIVE.read_text(encoding="utf-8-sig"))
validate_sets(plan)
group = plan["sets"][CITY_KEY]
batch = list(group.get("batch") or [s["uuid"] for s in group.get("stations", [])])
by_id = {s["uuid"].lower(): s for s in group.get("stations", [])}
drop  = {u.lower() for u in batch if u.lower() in REMOVE}
if not drop:
    sys.exit("Keine der REMOVE-UUIDs ist im Set — Schreibweise prüfen.")
occupied = {u.lower()
            for g in plan["sets"].values()
            for u in (g.get("batch") or [s["uuid"] for s in g.get("stations", [])])}

rows = []
with KANDIDATEN.open(newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        uid = (r.get("uuid") or "").strip()
        if uid.lower() in occupied or uid.lower() in REMOVE:
            continue
        try:
            days = int(float(r.get("hist_days") or 0))
        except ValueError:
            days = 0
        fuels = [x.strip().lower() for x in (r.get("hist_fuels") or "").split("/") if x.strip()]
        if days < MIN_HIST_DAYS or "e10" not in fuels:
            continue
        rows.append((float(r["dist_km"]), uid, r))
rows.sort(key=lambda t: t[0])

need = len(drop)
if len(rows) < need:
    sys.exit(f"Nur {len(rows)} brauchbare Ersatz-Kandidaten für {need} Plätze — "
             "erst Suche erweitern (Radius/PLZ/--min-days); aktives Set bleibt unverändert.")

alive  = [u for u in batch if u.lower() not in drop]
chosen = rows[:need]
for _, uid, r in chosen:
    by_id[uid.lower()] = {
        "uuid": uid, "name": (r.get("name") or "").strip(),
        "brand": (r.get("brand") or "").strip(),
        "lat": float(r["lat"]), "lon": float(r["lon"]),
        "dist_km": round(float(r["dist_km"]), 3),
    }
    alive.append(uid)

group["batch"] = alive
if "stations" in group:
    group["stations"] = [by_id[u.lower()] for u in alive]
plan["proposal"] = False          # Kandidaten wurden in B3 live verifiziert
plan["source"] = ("manueller Stationswechsel "
                  + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"))
validate_sets(plan)
out = Path("data/setup/polling.json"); atomic_json(out, plan)
print(f"Entfernt ({len(drop)}):"); [print("  -", u) for u in sorted(drop)]
print(f"Neu ({len(chosen)}):")
for _, uid, r in chosen:
    print(f"  + {r.get('brand')} {r.get('name')} ({uid}), {r['dist_km']} km, {r.get('hist_days')} Archivtage")
print(f"Vorschlag: {out} — {CITY_KEY}: {len(alive)} UUIDs, Gesamtset gültig.")
PY
```

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
