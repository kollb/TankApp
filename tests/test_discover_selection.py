"""Sicherstellen, dass discover_stations.py:

* doppelt kodierte Namen schon beim Lesen repariert,
* mit --check-history ungeeignete Stationen (zu wenige Tage / falsche Sorte)
  NICHT ins Polling-Set lässt — auch nicht beim Auffüllen auf 10 Plätze,
* --fuel all nur Stationen mit allen drei Sorten nimmt,
* --allow-ineligible das alte Auffüllverhalten wiederherstellt.
"""

import csv
import gzip
import json
import math
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent.parent / "data-tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import discover_stations as disc  # noqa: E402

MOJI = "BAT GÃœTERSLOH SÃœD"
FIXED = "BAT GÜTERSLOH SÜD"
LAT, LON = 51.91, 8.42


# --------------------------------------------------------------- Hilfsfunktionen


def cand(uid, dist, eligible, brand):
    return {
        "uuid": uid,
        "name": uid,
        "brand": brand,
        "dist_km": dist,
        "lat": LAT + dist / 200,
        "lon": LON,
        "eligible": eligible,
    }


def uid(n):
    return f"{n:08x}-0000-4000-8000-{n:012d}"


@pytest.fixture
def archiv(tmp_path):
    """Mini-Datenrepo: Stationsliste + 29 Preistage (genug für --min-days 28).

    10 geeignete Stationen (eine davon ohne e5), dazu eine Diesel-Only-Bude
    mit 367-Tage-Äquivalent und eine Station ganz ohne Preiszeilen."""
    stations_dir = tmp_path / "stations" / "2026" / "09"
    prices_dir = tmp_path / "prices" / "2026" / "08"
    stations_dir.mkdir(parents=True)
    prices_dir.mkdir(parents=True)

    # (uuid, name, marke, entfernung_km, sorten)
    stationen = [
        (uid(1), f"Rast {MOJI}", "BrandA", 0.30, "diesel/e5/e10"),
        (uid(2), "Diesel Automat", "DieselOnly", 0.40, "diesel"),
        (uid(3), "Brandneue Bude", "NoHistory", 0.45, ""),
        (uid(4), "Station B", "BrandB", 0.80, "diesel/e5/e10"),
        (uid(5), "Station C", "BrandC", 1.30, "diesel/e5/e10"),
        (uid(6), "Station D", "BrandD", 1.80, "diesel/e5/e10"),
        (uid(7), "Station E", "BrandE", 2.30, "diesel/e5/e10"),
        (uid(8), "Station F", "BrandF", 2.80, "diesel/e5/e10"),
        (uid(9), "Station G", "BrandG", 3.30, "diesel/e5/e10"),
        (uid(10), "Station H", "BrandH", 3.80, "diesel/e5/e10"),
        (uid(11), "Station I", "BrandI", 4.30, "diesel/e5/e10"),
        (uid(12), "Station J ohne e5", "BrandJ", 4.80, "diesel/e10"),
    ]

    stations_csv = stations_dir / "2026-08-30-stations.csv"
    with stations_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            ["uuid", "name", "brand", "post_code", "city", "latitude", "longitude"]
        )
        for u, name, brand, dist, _ in stationen:
            lon = LON + dist / (111.32 * math.cos(math.radians(LAT)))
            w.writerow(
                [u, name, brand, "33334", "Gütersloh", f"{LAT:.5f}", f"{lon:.5f}"]
            )

    preise = {u: sorten.split("/") for u, _, _, _, sorten in stationen if sorten}
    header = [
        "station_uuid",
        "date",
        "diesel",
        "e5",
        "e10",
        "diesel_change",
        "e5_change",
        "e10_change",
    ]
    for tag in range(1, 30):  # 29 Tage
        tag_p = prices_dir / f"2026-08-{tag:02d}-prices.csv.gz"
        with gzip.open(tag_p, "wt", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(header)
            for u, fuels in preise.items():
                w.writerow(
                    [
                        u,
                        f"2026-08-{tag:02d} 00:00:00",
                        "1.29" if "diesel" in fuels else "",
                        "1.71" if "e5" in fuels else "",
                        "1.65" if "e10" in fuels else "",
                        "1",
                        "1",
                        "1",
                    ]
                )
    return tmp_path


def run_discover(root, out, fuel, *extra, quiet=True):
    argv = [
        "discover_stations.py",
        "--stations",
        str(root / "stations"),
        "--config",
        str(root / "gibt-es-nicht.json"),
        "--anchor",
        f"GT:{LAT},{LON}",
        "--radius",
        "5",
        "--check-history",
        str(root / "prices"),
        "--min-days",
        "28",
        "--fuel",
        fuel,
        "--out",
        str(out),
        *(["--quiet"] if quiet else []),
        *extra,
    ]
    old = sys.argv
    sys.argv = argv
    try:
        return disc.main()
    finally:
        sys.argv = old


# ------------------------------------------------------------- reine Unit-Tests


def test_repair_text_rundreise():
    assert disc.repair_text(f"Aral {MOJI}") == f"Aral {FIXED}"
    assert disc.repair_text("Gütersloh Hempel") == "Gütersloh Hempel"
    assert disc.repair_text("") == ""


def test_stations_from_csv_repariert_kodierung(tmp_path):
    p = tmp_path / "x-stations.csv"
    p.write_text(
        "uuid,name,brand,post_code,city,latitude,longitude\n"
        f"{uid(99)},Aral {MOJI},ARAL,33334,Gütersloh,{LAT},{LON}\n",
        encoding="utf-8",
    )
    st = next(iter(disc.stations_from_csv(p).values()))
    assert st["name"] == f"Aral {FIXED}"
    assert st["brand"] == "ARAL"


def test_strict_gate_hält_ungeeignete_auch_in_phase_2_draußen():
    cands = [
        cand(uid(1), 0.30, True, "A"),
        cand(uid(2), 0.40, False, "DieselOnly"),
        cand(uid(3), 0.45, False, "NoHistory"),
    ]
    cands += [cand(uid(10 + i), 0.8 + 0.5 * i, True, f"B{i}") for i in range(7)]
    cands.append(cand(uid(99), 4.0, True, "A"))  # Zwilling der Marke A, aber geeignet

    strict = disc.select_polling_set(cands, 10, set(), require_eligible=True)
    assert len(strict) == 9  # 8 Marken + gleicher-Marke-Fill, ganz ohne Ungeeignete
    assert all(s["eligible"] for s in strict)

    locker = disc.select_polling_set(cands, 10, set())
    assert len(locker) == 10
    assert any(not s["eligible"] for s in locker)


# ------------------------------------------------------------- End-to-End-Läufe


def test_e10_set_nimmt_keine_toten_oder_diesel_only(archiv, tmp_path):
    out = tmp_path / "vorschlag-e10"
    assert run_discover(archiv, out, "e10") == 0

    data = json.loads((out / "polling.json").read_text(encoding="utf-8"))
    gt = data["sets"]["GT"]
    assert len(gt["batch"]) == 10
    assert uid(2) not in gt["batch"]  # Diesel-Only, näher als die meisten
    assert uid(3) not in gt["batch"]  # ganz ohne Historie
    assert uid(12) in gt["batch"]  # trägt e10 → dabei

    namen = [s["name"] for s in gt["stations"]]
    assert f"Rast {FIXED}" in namen
    assert not any("Ã" in name for name in namen)
    assert all(
        s["hist_days"] >= 28 and "e10" in (s["fuels"] or "") for s in gt["stations"]
    )

    report = (out / "report.md").read_text(encoding="utf-8")
    assert "GÜTERSLOH SÜD" in report
    assert "GÃœTERSLOH" not in report
    kandidaten = (out / "gt_kandidaten.csv").read_text(encoding="utf-8")
    assert "GÜTERSLOH SÜD" in kandidaten


def test_fuel_all_laesst_set_kurz_und_warnt(archiv, tmp_path, capsys):
    out = tmp_path / "vorschlag-all"
    assert run_discover(archiv, out, "all", quiet=False) == 0

    data = json.loads((out / "polling.json").read_text(encoding="utf-8"))
    gt = data["sets"]["GT"]
    assert len(gt["batch"]) == 9  # Station J fehlt e5
    assert uid(12) not in gt["batch"]
    assert uid(2) not in gt["batch"]
    assert all(
        {"diesel", "e5", "e10"} <= set(s["fuels"].split("/")) for s in gt["stations"]
    )
    report = (out / "report.md").read_text(encoding="utf-8")
    assert "⚠" in report
    err = capsys.readouterr().err
    assert "geeignete Stationen" in err


def test_allow_ineligible_stellt_auffuellen_wieder_her(archiv, tmp_path):
    out = tmp_path / "vorschlag-locker"
    assert run_discover(archiv, out, "e10", "--allow-ineligible") == 0

    data = json.loads((out / "polling.json").read_text(encoding="utf-8"))
    batch = data["sets"]["GT"]["batch"]
    assert len(batch) == 10
    assert uid(2) in batch or uid(3) in batch  # die nächsten Ungeeigneten rücken auf
