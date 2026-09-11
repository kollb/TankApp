import csv
import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent.parent / "data-tools"
sys.path.insert(0, str(TOOLS))

import swap_stations  # noqa: E402

DEAD = {
    "avia": "75b5a2e6-8ee6-49a3-93a2-f58b034bdecc",
    "gtb": "10bd27c9-f134-40d9-8fa0-137b46e30cc9",
    "tinex": "3a514235-e6a7-4545-991a-3cecf282eba9",
    "aral": "61ee897c-731d-4fbc-a8b0-ec0628f50a39",
}
NEW_A = "33333333-0000-4000-8000-000000000001"
NEW_B = "33333333-0000-4000-8000-000000000002"
FAR = "55555555-0000-4000-8000-000000000001"
MOJIBAKE = "BAT GÃœTERSLOH SÃœD"
REPAIRED = "BAT GÜTERSLOH SÜD"


@pytest.fixture
def installation(tmp_path):
    """Aktives Set (Gütersloh + Frankfurt), Modell-Fehler und Kandidaten-CSV."""

    def station(uuid, name, brand, dist, **extra):
        return {
            "uuid": uuid,
            "name": name,
            "brand": brand,
            "dist_km": dist,
            "lat": 51.9 + dist / 100,
            "lon": 8.4 + dist / 100,
            **extra,
        }

    alive = [f"11111111-0000-4000-8000-0000000000{i:02d}" for i in range(1, 7)]
    gt = [
        *[
            station(uid, f"S{i}", "Marken-" + chr(64 + i), 1.0 + i)
            for i, uid in enumerate(alive, start=1)
        ],
        station(
            DEAD["avia"],
            "AVIA XPress",
            "AVIA XPress",
            0.95,
            fuels="diesel",
            hist_days=367,
        ),
        station(DEAD["gtb"], "GTB", "GTB", 2.2, fuels="e5/e10", hist_days=25),
        station(DEAD["tinex"], "Tinex", "Tinex", 2.75, fuels="", hist_days=0),
        station(DEAD["aral"], f"Aral {MOJIBAKE}", "ARAL", 3.16, fuels="", hist_days=0),
    ]
    active = tmp_path / "polling-aktiv.json"
    active.write_text(
        json.dumps(
            {
                "poll_size": 10,
                "request_interval_seconds": 300,
                "proposal": False,
                "sets": {
                    "Gütersloh": {
                        "label": "Gütersloh",
                        "anchor": [51.9, 8.4],
                        "stations": gt,
                        "batch": [s["uuid"] for s in gt],
                    },
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.1, 8.6],
                        "stations": [
                            station(
                                "22222222-0000-4000-8000-000000000001", "F1", "F", 2.0
                            )
                        ],
                        "batch": ["22222222-0000-4000-8000-000000000001"],
                    },
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    failures = tmp_path / "current.json"
    failures.write_text(
        json.dumps(
            {
                "failures": [
                    {
                        "city": "Gütersloh",
                        "station_id": uid,
                        "station_name": name,
                        "fuel": "E10",
                        "reason": "insufficient_or_invalid_training_data",
                    }
                    for uid, name in (
                        (DEAD["avia"], "AVIA XPress"),
                        (DEAD["gtb"], "GTB"),
                        (DEAD["tinex"], "Tinex"),
                        (DEAD["aral"], "Aral"),
                    )
                ]
            }
        ),
        encoding="utf-8",
    )

    kandidaten = tmp_path / "vorschlag"
    kandidaten.mkdir()
    with (kandidaten / "gütersloh_kandidaten.csv").open(
        "w", newline="", encoding="utf-8"
    ) as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "dist_km",
                "brand",
                "name",
                "plz",
                "city",
                "lat",
                "lon",
                "uuid",
                "hist_days",
                "hist_first",
                "hist_last",
                "hist_fuels",
            ]
        )
        writer.writerow(
            [
                "3.30",
                "ARAL",
                f"Aral {MOJIBAKE}",
                "33330",
                "Gütersloh",
                "51.908",
                "8.429",
                NEW_A,
                "250",
                "2025-09-01",
                "2026-09-09",
                "e5/e10",
            ]
        )
        writer.writerow(
            [
                "4.10",
                "AVIA XPress",
                "AVIA Energy",
                "33330",
                "Gütersloh",
                "51.916",
                "8.433",
                FAR,
                "300",
                "2025-09-01",
                "2026-09-09",
                "diesel",
            ]
        )
        writer.writerow(
            [
                "4.20",
                "Esso",
                "Esso Nord",
                "33330",
                "Gütersloh",
                "51.917",
                "8.434",
                NEW_B,
                "10",
                "2026-08-01",
                "2026-09-09",
                "e5/e10",
            ]
        )
        writer.writerow(
            [
                "4.30",
                "Aral",
                "Aral Sued",
                "33330",
                "Gütersloh",
                "51.900",
                "8.430",
                DEAD["aral"],
                "200",
                "2025-09-01",
                "2026-09-09",
                "e5/e10",
            ]
        )
        for index, name in enumerate(("StationA", "StationB", "StationC"), start=1):
            writer.writerow(
                [
                    f"{3.5 + 0.1 * index:.2f}",
                    name,
                    name,
                    "33330",
                    "Gütersloh",
                    f"51.9{index:02d}",
                    "8.41",
                    f"44444444-0000-4000-8000-0000000000{index:02d}",
                    "150",
                    "2025-09-01",
                    "2026-09-09",
                    "e5/e10",
                ]
            )
    return {"active": active, "failures": failures, "kandidaten": kandidaten}


def run_swap(installation, tmp_path, *extra):
    out = tmp_path / "vorschlag" / "polling.json"
    code = swap_stations.main(
        [
            "--city",
            "Gütersloh",
            "--active",
            str(installation["active"]),
            "--kandidaten",
            str(installation["kandidaten"]),
            "--from-failures",
            str(installation["failures"]),
            "--out",
            str(out),
            *extra,
        ]
    )
    return code, out


def test_swap_filters_fuel_and_days_and_repairs_names(installation, tmp_path):
    code, out = run_swap(installation, tmp_path)
    assert code == 0
    proposal = json.loads(out.read_text(encoding="utf-8"))
    group = proposal["sets"]["Gütersloh"]

    batch = group["batch"]
    assert len(batch) == 10
    for uid in DEAD.values():
        assert uid not in batch
    assert NEW_A in batch  # e10, 250 Tage — nächstgelegener geeigneter Kandidat
    assert FAR not in batch  # nur diesel → ungeeignet
    assert NEW_B not in batch  # 10 Tage → ungeeignet
    assert proposal["proposal"] is True
    assert proposal["excluded_uuids"] == sorted(DEAD.values())

    added = next(s for s in group["stations"] if s["uuid"] == NEW_A)
    assert added["name"] == f"Aral {REPAIRED}"
    assert added["brand"] == "ARAL"

    active = json.loads(installation["active"].read_text(encoding="utf-8"))
    assert active["proposal"] is False
    assert DEAD["aral"] in active["sets"]["Gütersloh"]["batch"]


def test_swap_keeps_requested_station(installation, tmp_path):
    code, out = run_swap(installation, tmp_path, "--keep-uuid", DEAD["gtb"])
    assert code == 0
    group = json.loads(out.read_text(encoding="utf-8"))["sets"]["Gütersloh"]
    assert DEAD["gtb"] in group["batch"]
    assert DEAD["avia"] not in group["batch"]
    assert NEW_A in group["batch"]
    assert len(group["batch"]) == 10


def test_swap_aborts_without_candidates_and_writes_nothing(installation, tmp_path):
    with pytest.raises(SystemExit):
        run_swap(installation, tmp_path, "--min-days", "400")
    assert not (tmp_path / "vorschlag" / "polling.json").exists()


def test_repair_text_roundtrip():
    assert swap_stations.repair_text(f"Aral {MOJIBAKE}") == f"Aral {REPAIRED}"
    assert swap_stations.repair_text("Gütersloh Hempel") == "Gütersloh Hempel"
    assert swap_stations.repair_text("") == ""


def test_eligible_fuel_all_requires_all_three():
    voll = {"hist_days": "200", "hist_fuels": "diesel/e5/e10"}
    assert swap_stations.eligible(voll, 28, "all")
    assert not swap_stations.eligible(
        {"hist_days": "200", "hist_fuels": "diesel/e10"}, 28, "all"
    )
    assert not swap_stations.eligible(
        {"hist_days": "10", "hist_fuels": "diesel/e5/e10"}, 28, "all"
    )
    assert swap_stations.eligible(
        {"hist_days": "200", "hist_fuels": "diesel/e10"}, 28, "e10"
    )
