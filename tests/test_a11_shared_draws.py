"""A11: Gemeinsame Bootstrap-Ziehung über Stationen (Konzept §4.2).

``P_lohnt`` (F2) vergleicht zwei Stationen. Zieht jede Station ihre
Tagesblöcke unabhängig, fällt der gemeinsame Markt aus der Differenz heraus:
Die Differenz verteilt sich zu breit, klare Fälle („lohnt sich fast sicher“)
kommen zu selten vor. Seit 0.31.0 ziehen alle Stationen eines Laufs aus
denselben Zufallszahlen — dieselbe Zahl trifft alle, jede Station bildet sie
aber über ihre **eigene** Blockverteilung ab (comonotone Kopplung).

Getestet werden die Abbildung, die Ableitbarkeit der Zufallszahlen (ohne
gemeinsamen Zustand, damit der Prozess-Pool nicht stört) und die Wirkung auf
gekoppelte Stationen. Keine Bitgleichheit zur unabhängigen Ziehung — das ist
eine fachliche Änderung und wird ausgewiesen.
"""

import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.data import normalize_observations, prepare_series
from engine.models import (
    blocks_from_uniform,
    fit,
    predict,
    shared_day_uniforms,
)

DAYS = 40
RNG_SEED = 11


def _two_stations(cfg: Config):
    """Zwei Stationen mit gemeinsamem Tages-Marktfaktor und eigenem Rauschen."""
    index = pd.date_range(
        "2026-07-01", periods=DAYS * 288, freq="5min", tz="Europe/Berlin"
    )
    hour = index.hour.to_numpy() + index.minute.to_numpy() / 60.0
    day_index = (index.normalize() - index.normalize().min()).days.to_numpy()
    rng = np.random.default_rng(RNG_SEED)
    # Gemeinsamer Markt: Tagesniveau + Tagesform. Ohne ihn gäbe es nichts
    # zu koppeln — das ist der Kern von §4.2.
    level = rng.normal(0.0, 2.0, size=int(day_index.max()) + 1)
    market = 4.0 * np.cos((hour - 4.0) * 2 * np.pi / 24.0) + level[day_index]
    frames = []
    for position in range(2):
        noise = rng.normal(0.0, 0.15, len(index))
        price = 172.0 + position * 2.0 + market + noise
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index.tz_convert("UTC"),
                    "city": "Testmarkt",
                    "station_id": f"station-{position + 1}",
                    "station_name": f"Station {position + 1}",
                    "fuel": "e10",
                    "price": np.round(price, 3) / 100.0,
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    frame = pd.concat(frames, ignore_index=True)
    frame.loc[frame.timestamp.dt.tz_convert("Europe/Berlin").dt.hour < 6, "status"] = (
        "closed"
    )
    normalized, _ = normalize_observations(frame, cfg)
    return prepare_series(normalized, cfg)


@pytest.fixture(scope="module")
def cfg():
    # Kleiner als produktiv, damit die Suite schnell bleibt; die Kopplung
    # zeigt sich auch mit 200 Ziehungen.
    return Config(train_days=30, min_train_days=20, bootstrap_samples=200, seed=5)


# --- Abbildung: Zufallszahlen → Tagesblöcke --------------------------------


def test_blocks_from_uniform_streut_voll_und_clippt_sauber():
    # Zufallszahlen liegen in [0, 1) — die 1.0 prüft nur die Klemme.
    uniform = np.array([0.0, 0.25, 0.5, 0.75, 0.999, 1.0])
    assert blocks_from_uniform(uniform, 4).tolist() == [0, 1, 2, 3, 3, 3]
    # Gewichtete Ziehung: beide Blöcke tragen je die Hälfte.
    assert blocks_from_uniform(uniform, 2, weights=np.array([0.5, 0.5])).tolist() == [
        0,
        0,
        1,
        1,
        1,
        1,
    ]
    # Gewicht 0 heißt: dieser Block wird nie gezogen, auch nicht am Rand.
    assert blocks_from_uniform(
        uniform[:-1], 3, weights=np.array([0.0, 1.0, 0.0])
    ).tolist() == [1, 1, 1, 1, 1]
    # Die Klemme verhindert Indexfehler (1.0 trifft den letzten Block).
    assert blocks_from_uniform(np.array([1.0]), 5).tolist() == [4]
    with pytest.raises(ValueError):
        blocks_from_uniform(uniform, 0)


def test_shared_uniforms_sind_ableitbar_und_trennen_tage():
    cfg = Config(seed=5)
    first = shared_day_uniforms(cfg, 24, 0)
    again = shared_day_uniforms(cfg, 24, 0)
    assert first.shape == (cfg.bootstrap_samples,)
    assert np.array_equal(first, again)  # kein gemeinsamer Zustand nötig
    assert first.min() >= 0.0 and first.max() < 1.0
    # Andere Tagesposition, anderer Horizont → andere Folge.
    assert not np.array_equal(first, shared_day_uniforms(cfg, 24, 1))
    assert not np.array_equal(first, shared_day_uniforms(cfg, 168, 0))
    # Anderer Samen → andere Folge (sonst wäre der „Zufall“ fest verdrahtet).
    assert not np.array_equal(first, shared_day_uniforms(Config(seed=6), 24, 0))


# --- Wirkung: Kopplung statt Unabhängigkeit --------------------------------


def test_gleiches_trainingsfenster_bleibt_voll_gekoppelt(cfg):
    """Produktionsfall: ein Lauf, eine Config, gleiche Blockzahl.

    Vor 0.31.0 koppelte das nur **zufällig** (gleicher Samen → gleiche
    Indexfolge bei gleicher Blockzahl). A11 schreibt diese Kopplung fest
    und macht sie messbar; die Ziehung ändert sich, die Kopplung bleibt.
    """
    series_list = _two_stations(cfg)
    origin = series_list[0].frame.index.max()
    models = [fit(item, origin, cfg) for item in series_list]

    def measure(shared: bool):
        paths = [
            predict(model, hours=24, return_paths=True, shared_draws=shared)[1][:, 0]
            for model in models
        ]
        mask = np.isfinite(paths[0]) & np.isfinite(paths[1])
        return (
            float(np.corrcoef(paths[0][mask], paths[1][mask])[0, 1]),
            float(np.nanstd(paths[0] - paths[1])),
        )

    corr_old, spread_old = measure(False)
    corr_new, spread_new = measure(True)
    assert corr_old > 0.9 and corr_new > 0.9
    # Der Nowcast-Unterschied wird nicht breiter (Marktgleichlauf bleibt
    # erhalten), eher etwas schmaler.
    assert spread_new <= spread_old * 1.05


def test_unterschiedliche_blockzahlen_koppeln_besser_als_vorher(cfg):
    """Der Fall, den A11 wirklich verbessert.

    Haben zwei Stationen unterschiedlich viele Tagesblöcke (z. B. weil eine
    Prognose aus einem früheren Lauf erhalten blieb: `retained_previous`),
    trifft dieselbe Zufallsfolge bei der alten Ziehung unterschiedliche
    Kalendertage — der Marktgleichlauf geht verloren. Die gemeinsame
    Zufallszahl wird je Station über die **eigene** Verteilung abgebildet
    und trifft beide wenigstens annähernd denselben Tag.
    """
    series_list = _two_stations(cfg)
    origin = series_list[0].frame.index.max()
    short_cfg = Config(
        train_days=24,
        min_train_days=20,
        bootstrap_samples=cfg.bootstrap_samples,
        seed=cfg.seed,
    )
    models = [fit(series_list[0], origin, cfg), fit(series_list[1], origin, short_cfg)]
    block_counts = [np.asarray(model["residual_blocks"]).shape[0] for model in models]
    assert block_counts[0] != block_counts[1], "Testfall braucht ungleiche Blockzahlen"

    def measure(shared: bool):
        paths = [
            predict(model, hours=24, return_paths=True, shared_draws=shared)[1][:, 0]
            for model in models
        ]
        mask = np.isfinite(paths[0]) & np.isfinite(paths[1])
        return (
            float(np.corrcoef(paths[0][mask], paths[1][mask])[0, 1]),
            float(np.nanstd(paths[0] - paths[1])),
        )

    corr_old, spread_old = measure(False)
    corr_new, spread_new = measure(True)
    # Ehrlich: bei ganz unterschiedlichen Fenstern ist die Kopplung nicht
    # vollständig herstellbar — besser als vorher ist sie trotzdem, und der
    # Nowcast-Unterschied wird merklich schmaler.
    assert corr_new > corr_old, f"Kopplung nicht verbessert: {corr_new} vs {corr_old}"
    assert spread_new < spread_old, "Unterschiedsverteilung nicht schmaler"


def test_shared_draws_veraendern_quantile_nicht_strukturell(cfg):
    """Kein Freibrief: Die Prognose bleibt dieselbe Form, nur die Draws ändern."""
    series_list = _two_stations(cfg)
    origin = series_list[0].frame.index.max()
    model = fit(series_list[0], origin, cfg)

    plain = predict(model, hours=24, shared_draws=False)
    coupled = predict(model, hours=24, shared_draws=True)

    # Punktprognose und Struktur sind unabhängig von der Ziehung.
    assert np.allclose(
        plain["harmonic_ar2"].to_numpy(),
        coupled["harmonic_ar2"].to_numpy(),
        equal_nan=True,
    )
    # Die Quantile bewegen sich, aber nicht um Größenordnungen.
    value_columns = ["q025", "q50", "q975"]
    delta = np.nanmax(
        np.abs(plain[value_columns].to_numpy() - coupled[value_columns].to_numpy())
    )
    assert 0.0 < delta < 0.05, f"Abweichung unplausibel: {delta:.4f} €"
