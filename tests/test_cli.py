import json
import os
import subprocess
import sys

from engine.cli import main


def test_full_offline_cli_round_trip(observations, tmp_path, capsys):
    data = tmp_path / "input.csv.gz"
    observations(days=35).to_csv(data, index=False)
    quality = tmp_path / "quality.json"
    model = tmp_path / "model.json"
    forecast = tmp_path / "forecast.json"
    report = tmp_path / "backtest"
    common = ["--data", str(data)]
    assert main(["inspect", *common, "--out", str(quality)]) == 0
    assert json.loads(quality.read_text())["stations"][0]["open_days"] == 35
    assert main(["fit", *common, "--at", "2026-08-01", "--out", str(model)]) == 0
    assert (
        main(
            ["forecast", "--model", str(model), "--hours", "72", "--out", str(forecast)]
        )
        == 0
    )
    payload = json.loads(forecast.read_text())
    assert len(payload["forecasts"][0]["points"]) == 3 * 288
    assert payload["decision_ready"] is False
    assert (
        main(
            [
                "backtest",
                *common,
                "--days",
                "2",
                "--until",
                "2026-08-01",
                "--out",
                str(report),
            ]
        )
        == 0
    )
    result = json.loads((report / "report.json").read_text())
    assert result["metrics"]["points"] == 2 * 216
    assert result["m3_complete"] is False
    assert (report / "predictions.csv.gz").exists()
    assert "M3 nicht abgenommen" in capsys.readouterr().out


def test_missing_input_and_insufficient_history_are_actionable(
    observations, tmp_path, capsys
):
    assert main(["inspect", "--data", str(tmp_path / "missing.csv")]) == 1
    assert "Erst Historie/InfluxDB exportieren" in capsys.readouterr().err
    data = tmp_path / "input.csv"
    observations(days=2).to_csv(data, index=False)
    model = tmp_path / "model.json"
    assert main(["fit", "--data", str(data), "--out", str(model)]) == 1
    assert not model.exists()
    assert "mindestens 28" in capsys.readouterr().err
    assert (
        main(["backtest", "--data", str(data), "--out", str(tmp_path / "report")]) == 2
    )
    assert "Zu wenig" in capsys.readouterr().err


def test_missing_polling_member_cannot_silently_shrink_evaluation(
    observations, tmp_path, capsys
):
    data = tmp_path / "input.csv"
    observations(days=2).to_csv(data, index=False)
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps({"sets": {"test": {"batch": ["station-1", "station-2"]}}})
    )
    assert main(["inspect", "--data", str(data), "--polling", str(polling)]) == 1
    assert "station-2" in capsys.readouterr().err


def test_module_entrypoint_requires_no_database():
    env = {**os.environ}
    for key in list(env):
        if key.startswith("TANKAPP_INFLUX"):
            del env[key]
    result = subprocess.run(
        [sys.executable, "-m", "engine", "--help"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "backtest" in result.stdout and "forecast" in result.stdout


def test_forecast_cannot_replace_model(tmp_path, capsys):
    path = tmp_path / "model.json"
    path.write_text("last good artifact")
    assert main(["forecast", "--model", str(path), "--out", str(path)]) == 1
    assert path.read_text() == "last good artifact"
    assert "überschreiben" in capsys.readouterr().err
