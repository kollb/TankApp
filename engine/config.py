from dataclasses import asdict, dataclass
from zoneinfo import ZoneInfo

import pandas as pd


@dataclass(frozen=True)
class Config:
    timezone: str = "Europe/Berlin"
    step_minutes: int = 5
    ffill_minutes: int = 30
    train_days: int = 42
    min_train_days: int = 28
    min_slot_days: int = 7
    bootstrap_samples: int = 2000
    seed: int = 42
    poll_start: int = 6
    poll_end: int = 24
    # Seit diesem lokalen Zeitpunkt dürfen Tankstellen in Deutschland den
    # Preis nur noch um 12:00 Uhr erhöhen (Senkungen jederzeit).
    price_law_local: str = "2026-04-01T12:00"

    def __post_init__(self):
        ZoneInfo(self.timezone)
        parsed = pd.Timestamp(self.price_law_local).tz_localize(self.timezone)
        if pd.isna(parsed):
            raise ValueError(
                "price_law_local muss ein gültiger lokaler Zeitpunkt sein, "
                f"erhalten {self.price_law_local!r}."
            )
        if self.step_minutes != 5:
            raise ValueError("Die erste Engine-Version verwendet ein 5-Minuten-Raster.")
        if not 0 <= self.ffill_minutes <= 30:
            raise ValueError("Forward-Fill muss zwischen 0 und 30 Minuten liegen.")
        if not 7 <= self.min_train_days <= self.train_days <= 366:
            raise ValueError("7 <= min_train_days <= train_days <= 366 erforderlich.")
        if not 2 <= self.min_slot_days <= self.min_train_days:
            raise ValueError("min_slot_days muss zwischen 2 und min_train_days liegen.")
        if not 100 <= self.bootstrap_samples <= 10000:
            raise ValueError("100 bis 10000 Bootstrap-Ziehungen erforderlich.")
        if self.seed < 0:
            raise ValueError("seed muss nichtnegativ sein.")
        if not 0 <= self.poll_start < self.poll_end <= 24:
            raise ValueError("Polling-Fenster muss innerhalb 00–24 Uhr liegen.")

    def to_dict(self):
        return asdict(self)
