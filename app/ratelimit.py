"""Rate-Limit und API-Key-Schutz für die TankPuls-API (Konzept §11).

Auth-Modell:
- anonym: 60 Anfragen/Minute, 10 000/Tag
- Header ``X-Api-Key`` (in ``TANKAPP_API_KEYS`` konfiguriert): 300/min,
  50 000/Tag

Der Zähler ist ein einfaches Fenster-Bucket je Client (Minute + Tag) im
Prozessspeicher — ausreichend für den einen NAS-Prozess hinter dem Reverse
Proxy. Überschreitungen antworten mit ``429``, ``Retry-After`` und
``error_code: rate_limited``; jede Antwort trägt ``X-RateLimit-*``.

Der Client-Schlüssel ist der API-Key (gehasht) bzw. die Peer-Adresse.
Der Key selbst wird nie gespeichert oder geloggt — nur sein SHA-256-Kürzel.
"""

from __future__ import annotations

import hashlib
import hmac
import threading
import time
from typing import Any

MINUTE = 60.0
DAY = 86400.0
# Obergrenze der vorgehaltenen Client-Buckets. Darüber hinaus werden die am
# längsten ungenutzten Einträge verworfen (LRU) — als öffentlich exponierte
# API (§12 P1) darf ``self._buckets`` kein unbegrenzt wachsender
# Speicherfresser sein (Prüfstand §3.3).
MAX_BUCKETS = 4096


def key_fingerprint(api_key: str) -> str:
    """Stabile, nicht rückrechenbare Kennung eines API-Keys."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]


class RateLimiter:
    """Fensterzähler pro Client (Minute + Tag), thread-sicher."""

    def __init__(
        self,
        anon_per_min: int = 60,
        key_per_min: int = 300,
        anon_per_day: int = 10_000,
        key_per_day: int = 50_000,
        api_keys: tuple[str, ...] = (),
    ) -> None:
        self.anon_per_min = max(1, int(anon_per_min))
        self.key_per_min = max(1, int(key_per_min))
        self.anon_per_day = max(1, int(anon_per_day))
        self.key_per_day = max(1, int(key_per_day))
        self._fingerprints = {key_fingerprint(k) for k in api_keys if k}
        self._buckets: dict[str, dict[str, list]] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings: Any) -> "RateLimiter":
        return cls(
            anon_per_min=getattr(settings, "rate_limit_anon_per_min", 60),
            key_per_min=getattr(settings, "rate_limit_key_per_min", 300),
            anon_per_day=getattr(settings, "rate_limit_anon_per_day", 10_000),
            key_per_day=getattr(settings, "rate_limit_key_per_day", 50_000),
            api_keys=tuple(getattr(settings, "api_keys", ()) or ()),
        )

    def valid_key(self, api_key: str | None) -> bool:
        """Konstanter Zeitvergleich gegen die konfigurierten Schlüssel."""
        if not api_key or not self._fingerprints:
            return False
        fingerprint = key_fingerprint(api_key)
        return any(hmac.compare_digest(fingerprint, ref) for ref in self._fingerprints)

    def client_id(self, api_key: str | None, peer: str) -> tuple[str, bool]:
        """(Client-Kennung, keyed)."""
        if api_key and self.valid_key(api_key):
            return f"key:{key_fingerprint(api_key)}", True
        return f"ip:{peer or 'unknown'}", False

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()

    def check(
        self, api_key: str | None, peer: str, now: float | None = None
    ) -> tuple[
        bool,
        dict[str, Any],
    ]:
        """Prüft und verbucht eine Anfrage.

        Rückgabe: ``(allowed, info)``. ``info`` enthält Limit, verbleibendes
        Kontingent, Reset-Sekunden und ``keyed`` — für die ``X-RateLimit-*``
        Header.
        """
        stamp = time.monotonic() if now is None else now
        client, keyed = self.client_id(api_key, peer)
        per_min = self.key_per_min if keyed else self.anon_per_min
        per_day = self.key_per_day if keyed else self.anon_per_day

        with self._lock:
            bucket = self._buckets.get(client)
            if bucket is None:
                bucket = {"minute": [0.0, 0], "day": [0.0, 0]}
                self._buckets[client] = bucket
            bucket["_last"] = stamp

            for window, span in (("minute", MINUTE), ("day", DAY)):
                start, count = bucket[window]
                if stamp - start >= span:
                    bucket[window] = [stamp, 0]
                    start = stamp
                bucket[window][0] = start

            allowed = bucket["minute"][1] < per_min and bucket["day"][1] < per_day
            if allowed:
                bucket["minute"][1] += 1
                bucket["day"][1] += 1

            remaining_min = max(0, per_min - bucket["minute"][1])
            remaining_day = max(0, per_day - bucket["day"][1])
            minute_reset = max(1, int(MINUTE - (stamp - bucket["minute"][0])) + 1)
            day_reset = max(1, int(DAY - (stamp - bucket["day"][0])) + 1)
            if bucket["minute"][1] >= per_min:
                # Minuten-Kontingent ist der Flaschenhals.
                retry_after = minute_reset
            elif bucket["day"][1] >= per_day:
                # Tages-Kontingent erschöpft: Retry-After bis zum Tages-Reset
                # (vorher stand hier minutes-based, als könnte der Client in
                # 60 s weitermachen, Prüfstand §3.3).
                retry_after = day_reset
            else:
                retry_after = minute_reset

            self._evict_if_needed()

        info = {
            "keyed": keyed,
            "limit": per_min,
            "remaining": remaining_min,
            "reset": minute_reset,
            "daily_limit": per_day,
            "daily_remaining": remaining_day,
            "retry_after": retry_after,
        }
        return allowed, info

    def _evict_if_needed(self) -> None:
        """LRU-Eviction: am längsten ungenutzte Buckets verwerfen (Prüfstand §3.3)."""
        if len(self._buckets) <= MAX_BUCKETS:
            return
        overflow = len(self._buckets) - MAX_BUCKETS
        oldest = sorted(
            self._buckets.items(), key=lambda item: item[1].get("_last", 0.0)
        )
        for client, _ in oldest[:overflow]:
            self._buckets.pop(client, None)
