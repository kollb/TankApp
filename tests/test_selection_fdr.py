"""F2: B=200 ist nach BH bei m=11 Stationen ein Signifikanzblocker."""

import inspect

import numpy as np

from engine.config import Config
from engine.selection import SelectionConfig, _benjamini_hochberg


def test_selection_default_b_is_2000():
    assert SelectionConfig().n_boot == 2000
    assert Config().bootstrap_samples == 2000


def test_nas_jobs_fix_b_at_2000():
    import app.refresh as refresh
    import app.selection as selection
    import app.worker as worker

    assert "n_boot=2000" in inspect.getsource(worker.execute)
    assert "n_boot=200" not in inspect.getsource(worker.execute).replace(
        "n_boot=2000", ""
    )
    assert "n_boot=2000" in inspect.getsource(refresh.refresh)
    assert selection.build_selection.__defaults__[-1] == 2000


def test_bh_q_unreachable_at_b200_reachable_at_b2000():
    # Strengster Fall: eine Alternative, zehn H0-wahr (q ≈ p_min * m).
    m = 11
    p200 = np.ones(m)
    p200[0] = 1 / (200 + 1)
    p2000 = np.ones(m)
    p2000[0] = 1 / (2000 + 1)
    q200 = _benjamini_hochberg(p200)
    q2000 = _benjamini_hochberg(p2000)
    assert float(q200.min()) > 0.05
    assert float(q2000.min()) < 0.05
