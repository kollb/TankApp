"""Dual-Ledger Feedback & Episode Tracking for TankPuls (Konzept §5.2, §5.4, §5.5).

Trennt strikt:
  1. Advice-Ledger  (Modell-Qualität, kein Nutzer-Input nötig):
     Snapshots kollabiert (30-min-Regel), Auto-Settlement nach Fensterende (Brier, Trefferquote).
  2. Wallet-Ledger  (Persönliche Tank-Bilanz, Nutzer meldet Füllung):
     Fills werden offener Episode zugeordnet (Slack-Matching), persönliche €-Ersparnis.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import random
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from polling_plan import atomic_json, collector_lock
from .data import PRICE_PLAUSIBLE_MAX, PRICE_PLAUSIBLE_MIN, metadata
from .outcomes import outcome_credit, symmetric_threshold_outcome, threshold_outcome
from .route import net_economics
from engine.personalization import hourly_profile, weekday_profile

UTC = dt.timezone.utc

try:
    from zoneinfo import ZoneInfo

    BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover
    BERLIN_TZ = UTC

FUELS = {"e10", "e5", "diesel"}
# Füllungs-Validierung (§11.2, Prüfstand §3.1): ein Beleg außerhalb dieser
# Grenzen ist kein Messwert, sondern Eingabemüll — 4xx statt still verbuchen.
MIN_LITERS = 5.0
MAX_LITERS = 100.0
# O35: dieselben Grenzen wie der Trainings- und der Live-Pfad — eine Quelle
# (``app/data.py``), drei Aliasse. Ein Beleg außerhalb dieser Grenzen ist
# kein Messwert, ein Live-Wert außerhalb ist kein Preis.
MIN_PRICE_PAID = PRICE_PLAUSIBLE_MIN
MAX_PRICE_PAID = PRICE_PLAUSIBLE_MAX
# Feedback-Store-Grenze: darüber wird nicht mehr still geleert, sondern
# explizit ``store_too_large`` gemeldet (Prüfstand §3.5). Rotation 90 Tage
# verhindert, dass der Store überhaupt dort ankommt.
FEEDBACK_MAX_BYTES = 10_000_000
FEEDBACK_RETENTION_DAYS = 90
# B5: Plausibilitätsfenster für ``tanked_at`` — eine Beleg-Zeit darf wenige
# Minuten in der Zukunft liegen (Uhrversatz), aber nie weiter zurück als die
# Retention (älter wäre beim nächsten Retention-Lauf sofort archiviert).
TANKED_AT_FUTURE_GRACE_MINUTES = 15
# B5: Freitext-Caps. ``station_name``/``source`` sind Anzeige-Metadaten, keine
# Fachdaten — ein defekter Client darf das Ledger nicht mit Riesen-Zeilen
# füllen (das 100-kB-Body-Cap schützt nicht gegen viele mittelgroße Strings).
MAX_STATION_NAME_CHARS = 120
MAX_SOURCE_CHARS = 40

# B2: Schema-Version des Feedback-Stores. Ohne Versionsfeld bricht die nächste
# Feldänderung Altbestände **still** (alte store.json, neuer Code — fehlende
# Schlüssel führen zu leeren Bilanzen statt zu einem Fehler). Regel ab jetzt:
#   1 = Ursprungsfassung (0.10–0.12, Datei ohne ``schema_version``)
#   2 = A3-Felder als feste Sammlungen (``audit``, ``voided`` je Beleg)
#   3 = Ablehnungsgrund am Snapshot (``decline_reason``): Das Tagebuch nennt je
#       „keine Empfehlung“ den Grund der Tabelle; eine bestätigte Ablehnung
#       bleibt eine Zeile. Eine Bestätigung schreibt den Store nicht neu — sie
#       ist keine neue Entscheidung (siehe ``record_snapshot``).
#   4 = O1: Tankuhrzeit je Beleg samt Herkunft (``clock_hour`` aus ``tanked_at``
#       in Europe/Berlin, ``clock_hour_source``). Altbestände werden nicht
#       still umgeschrieben: Die Migration rekonstruiert die Stunde aus dem
#       gespeicherten Zeitstempel und kennzeichnet sie als ``abgeleitet``;
#       Belege ohne Zeitstempel bleiben bei 12 Uhr und tragen ``default``.
#   5 = O5/O17: Herkunft der P-Schätzung je Snapshot (``p_source``:
#       ``verteilung``|``basisrate``|``keine``) und Herkunft des Belegpreises
#       (``price_source``: ``live``|``manuell``|``prognose``|``nowcast``).
#       Altbestände werden rekonstruiert und gekennzeichnet, nicht
#       umgeschrieben: Snapshots mit gespeicherter Verteilungs-P gelten als
#       ``verteilung``, Snapshots nur mit ``p_correct`` als ``basisrate``
#       (der alte Fallback); Ein-Tipp-Belege (``source == "prompt"``) aus der
#       Zeit des gebuchten Prognose-Medians gelten als ``prognose``.
#   6 = O8/O9/O43: striktes Fenster vs. Kulanz je Beleg (``settled``),
#       reproduzierbare Woanders-Nettoökonomie samt Distanz-Herkunft und eine
#       serverzeitliche Uhrzeit (``clock_hour_source: server``), wenn kein
#       Belegzeitstempel vorliegt.
#   7 = B2: technischer Forecast-Zustand je Advice-Snapshot
#       (``forecast_calibration_state``: ``raw``|``pit_24h``|``unknown``),
#       damit der Ledger-Brier vor/nach PIT-Rekalibrierung vergleichbar bleibt.
#       Altbestand ist ausdrücklich ``unknown``, nicht nachträglich „roh".
# Jeder weitere Sprung: ``FEEDBACK_SCHEMA_VERSION`` anheben und eine
# Schritt-Funktion in ``_STORE_MIGRATIONS`` ergänzen — nie wieder still.
FEEDBACK_SCHEMA_VERSION = 7

SNAPSHOT_COLLAPSE_MINUTES = 30
EPISODE_MAX_HOURS = 72
NOW_GRACE_MINUTES = 45
WAIT_SLACK_BEFORE_MINUTES = 30
WAIT_SLACK_AFTER_MINUTES = 60
SETTLEMENT_LAG_MINUTES = 30
SETTLEMENT_VOID_AFTER_HOURS = 6
THETA_CT = 1.0  # 1 ct/L Signifikanzschwelle
# Laplace-Glättung der internen P-Schätzung (Schrumpfung zu 0,5 bei wenig Daten).
P_PRIOR_WEIGHT = 10

# M7-Kalibrierungs-Gate (Konzept §0.4, §13): ein **Zähl-Gate** über
# abgeschlossene Advice-Settlements — keine Kalendergröße. Die 90-Tage-
# Übergangsregel (engine/bootstrap.py → ``live_only_days``, CLI
# ``--live-only-days``, Default 90) regelt nur die Datenhygiene
# Archiv → Live-Polling und ist kein Nenner für M7: bei ~1 Empfehlung/Tag
# wären 100 Settlements ~100 Tage, M7 soll aber nach ~4 Wochen Live-Betrieb
# schaltbar sein (§13). Beide Schwellen gehen über ``stats_summary`` an die
# GUI, damit dort keine zweite Wahrheit entsteht.
M7_MIN_RECOMMENDATIONS = 100
# A9 (0.31.0): Ab so vielen aktiven Füllungen ist das persönliche
# Tankzeit-Profil w(h) belastbar (Konzept §5.5 Schicht C) — darunter
# bleibt der Default die ehrlichere Wahl.
WH_MIN_FILLS = 8
# O1 (0.44.0): Tankuhrzeit eines Belegs. Vorher buk jeder Beleg ohne
# explizite ``clock_hour``-Angabe auf 12 Uhr — die GUI sendet das Feld nie,
# also lernte das w(h)-Histogramm ab dem achten Beleg aus einer erfundenen
# Uhrzeit (zugleich die Projektionsregel der Engine,
# ``engine/config.py:decision_hour``; der Ausreißer fiel deshalb nicht auf).
# Jetzt wird die Stunde serverseitig aus ``tanked_at`` in Europe/Berlin
# abgeleitet und die Herkunft je Beleg ausgewiesen.
CLOCK_HOUR_DEFAULT = 12.0
# Herkunft der Stunde: ``beleg`` = aus dem Beleg selbst (sein ``tanked_at``
# oder eine explizite Angabe), ``abgeleitet`` = nachträglich aus dem
# gespeicherten Zeitstempel rekonstruiert (Migration von Altbeständen),
# ``default`` = kein Zeitstempel, also die erfundene 12-Uhr-Projektion.
CLOCK_HOUR_SOURCES = ("beleg", "server", "abgeleitet", "default")
# O5 (0.45.0): Herkunft der P-Schätzung je Snapshot. Vorher buk
# ``record_snapshot`` die Verteilungs-P und die selbstkalibrierte
# Ledger-Quote (``estimate_p``) in eine Zahl (``p_correct``) — der Brier
# mischte zwei Quellen und das M7-Gate konnte sich selbst erfüllen.
# Jetzt trägt jede Zeile ihre Quelle: ``verteilung`` (P aus den
# Prognose-Draws, Konzept §4.1/§4.2), ``basisrate`` (Ledger-Quote als
# Fallback, wenn keine Draws veröffentlicht sind) oder ``keine``
# (keine Schätzung — fällt aus Zähler und Nenner). Das M7-Gate rechnet
# ausschließlich über ``verteilung``.
P_SOURCES = ("verteilung", "basisrate", "keine")
# B2: Zeitpunktgebundene technische Forecast-Schicht im Advice-Ledger. Nur
# ``raw`` und ``pit_24h`` sind A/B-Messgruppen; Altbestand bleibt ``unknown``.
FORECAST_CALIBRATION_STATES = ("raw", "pit_24h", "unknown")
# O17 (0.45.0): Herkunft des Belegpreises. ``live`` = Ein-Tipp-Beleg mit
# frischem Live-Preis; ``manuell`` = eingetragen, nicht live-verifiziert;
# ``prognose`` = Altbestand aus der Zeit, als der Prognose-Median gebucht
# wurde (nur via Migration, nie für neue Belege); ``nowcast`` = der Server
# hat den Preis aus dem frischen Poll ergänzt (live-äquivalent,
# historischer Name aus record_fill).
PRICE_SOURCES = ("live", "manuell", "prognose", "nowcast")
M7_BRIER_THRESHOLD = 0.25
# O6 (0.45.0): Das M7-Gate vergleicht kein Punkt-Brier mehr gegen 0,25
# (Münz-Niveau — das Feld bleibt als dokumentierte Referenz in der Antwort),
# sondern die Obergrenze eines Block-Bootstrap-Intervalls über Tagesblöcke
# gegen zwei Referenzen (konstante Basisrate, Klimatologie). 1000 Ziehungen
# mit festem Samen: Das Intervall ist über Läufe stabil und damit
# testbar; die Blöcke sind Kalendertage in Europe/Berlin. Unter 10 Blöcken
# ist das Intervall degeneriert (ein Block hätte Varianz null) und bleibt
# None — das Gate meldet dann „nicht messbar“ statt „kalibriert“.
GATE_BOOTSTRAP_SAMPLES = 1000
GATE_BOOTSTRAP_SEED = 20260917
GATE_MIN_DAY_BLOCKS = 10
GATE_BLOCK_DAYS = 1
# B2: Eine gut aussehende Brier-Zahl kann eine zu flache/steile
# Zuverlässigkeitskurve verdecken. Die Steigung von Ergebnis auf versprochene
# Wahrscheinlichkeit soll 1 sein; ihr Tagesblock-Intervall wird gegen diesen
# Referenzwert geprüft, nicht ihr Punktwert gegen eine frei gewählte Grenze.
# B2-Fix: Zusätzlich |slope-1|<0.3 und CI-Breite<1.0 – sonst wäre ein
# Intervall [-5, 5] immer „ok“ (enthält 1), aber ohne Aussagekraft.
GATE_RELIABILITY_SLOPE_TARGET = 1.0
GATE_RELIABILITY_SLOPE_MAX_ABS_DEV = 0.3
GATE_RELIABILITY_SLOPE_MAX_CI_WIDTH = 1.0

_STORE_THREAD_LOCK = threading.Lock()

# B11: Lock-Wartezeit des Feedback-Stores. Server (decide/fills/intent) und
# Worker (settlement) teilen sich eine Datei; auf der NAS-Platte braucht ein
# Lese-/Schreibzyklus länger als im Sandkasten. 100 × 0,05 s = 5 s Obergrenze,
# danach ``store_locked`` (503, wiederholbar) statt eines irreführenden 400.
LOCK_ATTEMPTS = 100
LOCK_RETRY_SECONDS = 0.05


class StoreTooLarge(RuntimeError):
    """Feedback-Store überschreitet die Größen-Grenze (Prüfstand §3.5).

    Bewusst KEIN ``ValueError``: ``locked_store`` fängt ``ValueError`` ab und
    würde sonst endlos neu laden. Der Aufrufer muss das als expliziten
    Fehlerzustand behandeln statt still mit einem leeren Store
    weiterzurechnen — sonst wären Advice-Historie, Brier-Grundlage und
    Wallet ohne Warnung weg.
    """


class StoreSchemaTooNew(RuntimeError):
    """Store wurde von einer **neueren** App-Version geschrieben (B2).

    Wird bewusst nicht als leerer Store behandelt — sonst würde der nächste
    Schreibvorgang den neueren Bestand wegpeitschen. Der Fehler fällt als
    503 auf („Server kann den Store nicht lesen“), nicht als Datenverlust;
    Abhilfe ist das App-Update, nicht ein Überschreiben.
    """


class StoreCorrupted(RuntimeError):
    """Bestehender Feedback-Store ist unlesbar oder ungültig (S3).

    „Datei fehlt“ (Erststart) und „Datei existiert, aber ist kaputt“ sind
    zwei verschiedene Zustände. Der Defekt wird **fail-closed** behandelt:
    Alle Writes schlagen mit diesem Fehler fehl, der Bestand bleibt
    unverändert und wird unverändert in einer Quarantäne-Kopie aufbewahrt —
    statt ein leerer Store den nächsten Schreibvorgang darüberzuschieben
    (stiller Datenverlust). Abhilfe ist Wiederherstellung aus einer
    Sicherung, nicht ein Überschreiben.
    """


def _hour_from_stamp(stamp: dt.datetime) -> float:
    """Ganze Stunde eines Zeitstempels in Europe/Berlin — Bucket von w(h).

    Die App denkt Tankzeiten lokal (Anzeige, Bilanz, Heatmap): Ein Beleg um
    18:40 Uhr MESZ gehört in die 18-Uhr-Spalte, nicht in die 16-Uhr-Spalte
    (UTC) und nicht in die erfundene 12-Uhr-Spalte der Projektionsregel.
    """
    return float(stamp.astimezone(BERLIN_TZ).hour)


def _local_hour_fraction(stamp: dt.datetime) -> float:
    """Stunde mit Minutenanteil (18:40 → 18,6667) für den Stunden-Fallback.

    ``classify_compliance`` vergleicht im Fallback-Pfad (Altdaten ohne
    ISO-Zeiten) Beleg-Stunde und Snapshot-Stunde mit einer 45-Minuten-Toleranz
    — dafür ist die ganze Stunde zu grob. Gespeichert wird trotzdem die ganze
    Stunde: ``clock_hour`` ist der Bucket des w(h)-Histogramms.
    """
    local = stamp.astimezone(BERLIN_TZ)
    return round(local.hour + local.minute / 60 + local.second / 3600, 4)


def clock_hour_from_fill(
    fill_data: dict[str, Any], tanked_at: str | None, *, server_timestamp: bool = False
) -> tuple[float, str]:
    """(Tankuhrzeit, Herkunft) eines Belegs — O1: gemessen statt erfunden.

    Reihenfolge: ``tanked_at`` (serverseitig validiert, Europe/Berlin) →
    explizite ``clock_hour``-Angabe des Clients → Default 12 Uhr. Der
    Zeitstempel gewinnt, weil Beleg-Zeit und Beleg-Stunde sonst zwei
    Wahrheiten wären: Ein Client, der beides schickt, dürfte sich
    widersprechen, und das Histogramm wüsste nicht, welcher Wert gilt.

    Die Herkunft (``CLOCK_HOUR_SOURCES``) wird je Beleg gespeichert, damit
    das w(h)-Histogramm sagt, worauf es steht — ein Beleg ohne Zeitstempel
    bleibt die erfundene 12-Uhr-Projektion der Engine und ist als solche
    gekennzeichnet, statt als Messung durchzugehen.
    """
    stamp = _parse_ts(tanked_at)
    if stamp is not None:
        return _hour_from_stamp(stamp), "server" if server_timestamp else "beleg"
    explicit = _to_float(fill_data.get("clock_hour"))
    if explicit is not None:
        return explicit % 24.0, "beleg"
    return CLOCK_HOUR_DEFAULT, "default"


def _migrate_store_v1_to_v2(store: dict[str, Any]) -> dict[str, Any]:
    """1 → 2 (0.10–0.12 → neu): A3-Felder als feste Sammlungen sichern.

    Altbestände kennen ``audit`` nicht und tragen ``voided`` je Beleg nur
    lückenhaft. Die Migration ergänzt die Schlüssel mit Neutralwerten;
    Einzelfelder, die in alten Belegen fehlen (``tanked_at``,
    ``price_source``), bleiben weg — der Lese-Code arbeitet dort ohnehin
    mit ``.get()``-Defaults, und Werte zu erfinden wäre schlimmer als
    „feld fehlt“.
    """
    store.setdefault("audit", [])
    for fill in store.get("fills", []) or []:
        if isinstance(fill, dict):
            fill.setdefault("voided", False)
    return store


def _migrate_store_v2_to_v3(store: dict[str, Any]) -> dict[str, Any]:
    """2 → 3 (0.39 → 0.40): Ablehnungsgrund je Snapshot.

    ``decline_reason`` bleibt bei Altbeständen ``None`` — der Grund einer
    damaligen Ablehnung ist nicht rekonstruierbar, und ihn zu erfinden wäre
    schlimmer als „Feld fehlt“.
    """
    for ep in store.get("episodes", []) or []:
        if not isinstance(ep, dict):
            continue
        for snap in ep.get("snapshots", []) or []:
            if not isinstance(snap, dict):
                continue
            snap.setdefault("decline_reason", None)
        # ``first_snapshot``/``last_snapshot`` tragen dieselben Zeilen wie
        # ``snapshots`` — sie werden mitgezogen, sonst driften die drei
        # Sichten nach einer Migration auseinander.
        for key in ("first_snapshot", "last_snapshot"):
            snap = ep.get(key)
            if isinstance(snap, dict):
                snap.setdefault("decline_reason", None)
    return store


def _migrate_store_v3_to_v4(store: dict[str, Any]) -> dict[str, Any]:
    """3 → 4 (0.43 → 0.44): Tankuhrzeit je Beleg samt Herkunft (O1).

    Vor 0.44.0 buk jeder Beleg ohne explizite ``clock_hour``-Angabe auf 12 Uhr
    — die GUI sendet das Feld nie, also stand das persönliche Zeitprofil ab dem
    achten Beleg auf einer Uhrzeit, die nie gemessen war. Altbestände werden
    nicht still umgeschrieben, sondern **mit Kennzeichnung** rekonstruiert:

    * Beleg mit ``tanked_at`` → Stunde in Europe/Berlin, Herkunft
      ``"abgeleitet"`` (nachträglich aus dem gespeicherten Zeitstempel; ob das
      damals die Tank- oder die Buchungszeit war, ist nicht mehr zu trennen).
    * Beleg ohne Zeitstempel, aber mit einer Stunde, die nicht der Default ist
      → Wert bleibt, Herkunft ``"beleg"`` (ein Client hat ihn angegeben).
    * Beleg ohne Zeitstempel und ohne eigene Stunde → 12 Uhr, Herkunft
      ``"default"``: ausdrücklich die erfundene Projektions-Uhrzeit.

    Idempotent: Belege, die ``clock_hour_source`` schon tragen, bleiben
    unverändert (ein zweiter Lauf schreibt nichts um).
    """
    for fill in store.get("fills", []) or []:
        if not isinstance(fill, dict) or "clock_hour_source" in fill:
            continue
        stamp = _parse_ts(fill.get("tanked_at"))
        if stamp is not None:
            fill["clock_hour"] = _hour_from_stamp(stamp)
            fill["clock_hour_source"] = "abgeleitet"
            continue
        explicit = _to_float(fill.get("clock_hour"))
        if explicit is not None and explicit % 24.0 != CLOCK_HOUR_DEFAULT:
            fill["clock_hour"] = explicit % 24.0
            fill["clock_hour_source"] = "beleg"
        else:
            fill["clock_hour"] = CLOCK_HOUR_DEFAULT
            fill["clock_hour_source"] = "default"
    return store


def _migrate_store_v4_to_v5(store: dict[str, Any]) -> dict[str, Any]:
    """4 → 5 (0.44 → 0.45): Herkunft je Ledger-Zeile (O5, O17).

    Snapshots bekommen ``p_source``: Wer eine gespeicherte Verteilungs-P
    (``p_besser``) trägt, gilt als ``verteilung``; wer nur ``p_correct``
    trägt, als ``basisrate`` (genau das war der alte Fallback in
    ``record_snapshot``); ohne beide als ``keine``. Belege bekommen
    ``price_source``: Ein-Tipp-Belege (``source == "prompt"``) aus der Zeit
    des gebuchten Prognose-Medians gelten als ``prognose`` — das ist
    Rekonstruktion aus dem Buchungsweg, kein Messwert; explizit
    mitgeschickte Preise (``explicit``, auch fehlende Angaben) gelten als
    ``manuell``; ``nowcast`` bleibt (serverseitig aus dem Poll ergänzt).

    Idempotent: Zeilen, die ihre Herkunft schon tragen, bleiben unverändert.
    """
    for ep in store.get("episodes", []) or []:
        if not isinstance(ep, dict):
            continue
        seen: list[dict[str, Any]] = []
        for snap in ep.get("snapshots", []) or []:
            if isinstance(snap, dict):
                seen.append(snap)
        for key in ("first_snapshot", "last_snapshot"):
            snap = ep.get(key)
            if isinstance(snap, dict) and all(snap is not s for s in seen):
                seen.append(snap)
        for snap in seen:
            if snap.get("p_source") in P_SOURCES:
                continue
            if _to_float(snap.get("p_besser")) is not None:
                snap["p_source"] = "verteilung"
            elif _to_float(snap.get("p_correct")) is not None:
                snap["p_source"] = "basisrate"
            else:
                snap["p_source"] = "keine"
    for fill in store.get("fills", []) or []:
        if not isinstance(fill, dict):
            continue
        if fill.get("price_source") in PRICE_SOURCES:
            continue
        if fill.get("source") == "prompt":
            fill["price_source"] = "prognose"
        else:
            fill["price_source"] = "manuell"
    return store


def _migrate_store_v5_to_v6(store: dict[str, Any]) -> dict[str, Any]:
    """5 → 6: explicit receipt/window and detour-economic provenance (O8/O9/O43)."""
    for fill in store.get("fills", []) or []:
        if not isinstance(fill, dict):
            continue
        fill.setdefault("settled", None)
        fill.setdefault("elsewhere_net_eur", None)
        fill.setdefault("elsewhere_net_provenance", None)
        # Old fills without an origin retain the documented old default rather
        # than being falsely promoted to a server-time measurement.
        fill.setdefault("clock_hour_source", "default")
    for ep in store.get("episodes", []) or []:
        if not isinstance(ep, dict):
            continue
        seen: list[dict[str, Any]] = []
        for snap in ep.get("snapshots", []) or []:
            if isinstance(snap, dict):
                seen.append(snap)
        for key in ("first_snapshot", "last_snapshot"):
            snap = ep.get(key)
            if isinstance(snap, dict) and all(snap is not prior for prior in seen):
                seen.append(snap)
        for snap in seen:
            snap.setdefault("elsewhere_economics", None)
    return store


def _migrate_store_v6_to_v7(store: dict[str, Any]) -> dict[str, Any]:
    """6 → 7 (B2): A/B-Herkunft für den Ledger-Brier, ohne Altwerte zu raten."""
    for ep in store.get("episodes", []) or []:
        if not isinstance(ep, dict):
            continue
        seen: list[dict[str, Any]] = []
        for snap in ep.get("snapshots", []) or []:
            if isinstance(snap, dict):
                seen.append(snap)
        for key in ("first_snapshot", "last_snapshot"):
            snap = ep.get(key)
            if isinstance(snap, dict) and all(snap is not prior for prior in seen):
                seen.append(snap)
        for snap in seen:
            # Der alte Store kennt den technischen Zustand nicht. Ihn anhand
            # heutiger Artefakte zu erraten wäre Zeit-Leakage in der A/B-Bilanz.
            if (
                snap.get("forecast_calibration_state")
                not in FORECAST_CALIBRATION_STATES
            ):
                snap["forecast_calibration_state"] = "unknown"
    return store


# Jeder Versionssprung genau eine Funktion; ``migrate_store`` läuft sie der
# Reihe nach ab. Schlüssel = Version, **von der** die Funktion hochführt.
_STORE_MIGRATIONS = {
    1: _migrate_store_v1_to_v2,
    2: _migrate_store_v2_to_v3,
    3: _migrate_store_v3_to_v4,
    4: _migrate_store_v4_to_v5,
    5: _migrate_store_v5_to_v6,
    6: _migrate_store_v6_to_v7,
}


def migrate_store(raw: dict[str, Any]) -> dict[str, Any]:
    """Bringt einen geladenen Store auf ``FEEDBACK_SCHEMA_VERSION`` (B2).

    Rein im Speicher: gesichert wird beim nächsten Schreibvorgang über
    ``locked_store`` (Digest-Vergleich) — reine Lese-Pfade ändern die Datei
    nie. Ein Store ohne ``schema_version`` gilt als Version 1; kaputtes
    Versionsfeld ebenso (Migrationen sind idempotent). Ein Store aus einer
    *neueren* Version ist ein harter Fehler (``StoreSchemaTooNew``).
    """
    try:
        version = int(raw.get("schema_version", 1))
    except (TypeError, ValueError):
        version = 1
    version = max(1, version)
    if version > FEEDBACK_SCHEMA_VERSION:
        raise StoreSchemaTooNew(
            f"Feedback-Store hat Schema-Version {version}, der Code kennt nur "
            f"{FEEDBACK_SCHEMA_VERSION}. Erst die App aktualisieren — der "
            "Store wird nicht überschrieben."
        )
    store = dict(raw)
    while version < FEEDBACK_SCHEMA_VERSION:
        step = _STORE_MIGRATIONS.get(version)
        if step is None:  # defensiv: Lücke in der Migrationstabelle
            break
        store = step(store)
        version += 1
    store["schema_version"] = FEEDBACK_SCHEMA_VERSION
    return store


# O26/O37: Beobachtbarkeit der Sperre. Wer misst, sieht den Konflikt, bevor
# er wehtut: ``acquired`` zählt jede Akquise der Store-Sperre, ``wait_seconds``
# die dabei verlorene Zeit (Thread- **und** Dateisperre). Der reine Lesepfad
# (``/decide``-Poll) darf den Zähler nicht bewegen — das ist der Nachweis,
# dass er sperrenfrei ist (``tests/test_o26_read_path_lock.py``).
_LOCK_STATS = {"acquired": 0, "wait_seconds": 0.0}
_LOCK_STATS_LOCK = threading.Lock()


def lock_stats() -> dict[str, Any]:
    """Sperren-Zähler des Feedback-Stores als JSON-taugliche Kopie (O26/O37).

    ``/api/v1/health`` zeigt den Block (``store_lock``), damit ein wachsender
    Zähler im Dauerbetrieb auffällt — und ein Test kann beweisen, dass ein
    Lese-Poll keine Sperre nimmt.
    """
    with _LOCK_STATS_LOCK:
        return {
            "acquired": _LOCK_STATS["acquired"],
            "wait_ms": round(_LOCK_STATS["wait_seconds"] * 1000.0, 1),
        }


@contextmanager
def locked_store(settings):
    """Thread- + prozessübergreifend essicheres Lesen/Schreiben des Feedback-Stores.

    Server (decide/fills/intent) und Worker (settlement) schreiben dieselbe
    Datei; ohne Sperre gingen Snapshots bei gleichzeitigen Requests verloren.

    Schreibt nur bei echter Änderung (Digest-Vergleich) und kappt dabei die
    Retention (90 Tage) — ausgelagerte Einträge landen im JSONL-Archiv.

    Die Lock-Akquise wird bei Kollision retryt; ein ``ValueError`` aus dem
    Rumpf (z. B. Fill-Validierung) wird dagegen unverändert durchgereicht —
    sonst würde die Validierung als „Lock belegt" verschluckt und endlos neu
    versucht.

    B11: Wartezeit und Fehlerbild. Der Store liegt auf der NAS-Platte; Lesen,
    Retention-Schnitt und Schreiben dauern dort länger als im Sandkasten, und
    50 × 0,05 s reichten nicht. Jetzt ``LOCK_ATTEMPTS`` × ``LOCK_RETRY_SECONDS``
    (5 s), und beim Aufgeben kommt ``ValueError("store_locked")`` — ein
    maschinenlesbarer, wiederholbarer Code (HTTP 503 in ``app/server.py``,
    Text in ``web/src/data.ts``) statt des Rohtexts „in diesem Verzeichnis
    läuft bereits ein Prozess", den die API als ``invalid_query`` (400)
    ausgegeben hat: klingt nach falscher Eingabe, war aber belegter Speicher.

    O26: Diese Sperre ist ein **Schreib**-Werkzeug. Reine Lesepfade nehmen sie
    nicht: ``record_snapshot`` prüft vorher sperrenfrei, ob der Aufruf den
    Store überhaupt ändert (``_peek_confirmation``), und bleibt sonst ohne
    Sperre. Sonst wartet ein Beleg hinter einem Poll, der nichts schreibt.
    """
    started = time.monotonic()
    with _STORE_THREAD_LOCK:
        lock = None
        last_error = None
        for _ in range(LOCK_ATTEMPTS):
            try:
                lock = collector_lock(
                    feedback_path(settings).parent, label="Feedback-Store"
                )
                lock.__enter__()
                break
            except ValueError as exc:
                last_error = exc
                lock = None
                time.sleep(LOCK_RETRY_SECONDS)
        if lock is None:
            raise ValueError("store_locked") from last_error
        with _LOCK_STATS_LOCK:
            _LOCK_STATS["acquired"] += 1
            _LOCK_STATS["wait_seconds"] += time.monotonic() - started
        try:
            store = load_store(settings)
            before = _store_digest(store)
            yield store
            archived = _prune_and_archive(store)
            if archived:
                _append_archive(settings, archived)
            if _store_digest(store) != before:
                save_store(settings, store)
        finally:
            lock.__exit__(None, None, None)


def _now_iso(clock=None) -> str:
    now = clock() if clock else dt.datetime.now(UTC)
    return now.isoformat()


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def feedback_path(settings) -> Path:
    p = settings.runtime / "feedback" / "store.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def feedback_archive_path(settings) -> Path:
    return feedback_path(settings).parent / "archive.jsonl"


def feedback_quarantine_dir(settings) -> Path:
    """S3: Ablage für unveränderte Defekt-Kopien des Feedback-Stores."""
    return feedback_path(settings).parent / "quarantine"


def _empty_feedback_store() -> dict[str, Any]:
    """Store eines Erststarts — die einzige Situation, in der „leer“ rechtens ist."""
    return {
        "schema_version": FEEDBACK_SCHEMA_VERSION,
        "episodes": [],
        "fills": [],
        "settlements": [],
        "audit": [],
    }


def _corrupt_feedback_store(settings, path, exc) -> StoreCorrupted:
    """S3: Bestand unlesbar/ungültig — quarantänisieren und fail-closed.

    Kopie statt Verschiebung: Die Quelldatei bleibt am Ort (der Fehler bleibt
    reproduzierbar und sichtbar), die quarantänierten Bytes bewahren den
    Bestand für die Wiederherstellung. Der Report legt Zeitstempel, Größe,
    Hash und Ursache daneben. Die Quarantäne darf nie den Lese-/Schreibpfad
    sprengen — gelingt die Kopie nicht, steht das im Fehler.
    """
    copied = False
    try:
        raw_bytes = path.read_bytes()
        stamp = dt.datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        quarantine = feedback_quarantine_dir(settings)
        quarantine.mkdir(parents=True, exist_ok=True)
        target = quarantine / f"store-{stamp}.json"
        target.write_bytes(raw_bytes)
        (quarantine / f"store-{stamp}.report.json").write_text(
            json.dumps(
                {
                    "at": dt.datetime.now(UTC).isoformat(),
                    "source": str(path),
                    "size_bytes": len(raw_bytes),
                    "sha256": hashlib.sha256(raw_bytes).hexdigest(),
                    "error": str(exc) or type(exc).__name__,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        copied = True
    except OSError:
        pass
    note = (
        " Der Defekt liegt unverändert in der Quarantäne."
        if copied
        else " Der Defekt konnte nicht für die Quarantäne kopiert werden."
    )
    return StoreCorrupted(
        f"Feedback-Store ist unlesbar ({type(exc).__name__}: {exc}). "
        f"Der Bestand bleibt unverändert und wird nicht überschrieben.{note} "
        "Wiederherstellung aus einer Laufzeit-Sicherung (docs/betrieb/BETRIEB.md)."
    )


def store_recovery_options(settings) -> dict[str, Any]:
    """S3: Was der Betrieb zur Wiederherstellung eines Defekts nutzen kann.

    ``quarantine``: die quarantänierten Defekt-Kopien (neueste zuerst, fünf)
    relativ zum Laufzeitverzeichnis. ``backup``: das neueste Laufzeit-Backup
    (``app/backup.py``) — darin liegt der letzte gute Store-Stand; nur, wenn
    ein Backup-Ziel eingerichtet ist (ohne Ziel weiß die App nichts).
    """
    options: dict[str, Any] = {"quarantine": [], "backup": None}
    try:
        quarantine = feedback_quarantine_dir(settings)
        copies = sorted(
            (
                path
                for path in quarantine.glob("store-*.json")
                if path.is_file() and ".report." not in path.name
            ),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )[:5]
        runtime = Path(getattr(settings, "runtime", Path(".")))
        options["quarantine"] = [str(path.relative_to(runtime)) for path in copies]
    except OSError:
        pass
    try:
        from .backup import backup_status

        status = backup_status(settings)
        if status.get("configured"):
            options["backup"] = {
                "dir": status.get("dir"),
                "newest_at": status.get("newest_at"),
                "stale": status.get("stale"),
            }
    except Exception:
        pass
    return options


def _store_digest(store: dict[str, Any]) -> bytes:
    """Kanonischer Fingerabdruck des Stores — Grundlage des Write-Throttles."""
    payload = json.dumps(store, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).digest()


def _prune_and_archive(store: dict[str, Any]) -> list[dict[str, Any]]:
    """Retention: Einträge älter als ``FEEDBACK_RETENTION_DAYS`` auslagern.

    Gibt die ausgelagerten Einträge zurück (der Aufrufer archiviert sie als
    JSONL). Felder ohne parsebaren Zeitstempel bleiben erhalten (Altdaten).
    """
    cutoff = dt.datetime.now(UTC) - dt.timedelta(days=FEEDBACK_RETENTION_DAYS)
    archived: list[dict[str, Any]] = []
    for key, field in (
        ("episodes", "opened_at"),
        ("settlements", "settled_at"),
        ("fills", "tanked_at"),
    ):
        kept = []
        for item in store.get(key, []):
            stamp = _parse_ts(item.get(field))
            if stamp is None or stamp >= cutoff:
                kept.append(item)
            else:
                archived.append({"collection": key, **item})
        store[key] = kept
    return archived


def _append_archive(settings, items: list[dict[str, Any]]) -> None:
    if not items:
        return
    with feedback_archive_path(settings).open("a", encoding="utf-8") as fh:
        for item in items:
            fh.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")


def load_archive_records(settings) -> dict[str, list]:
    """JSONL archive produced by 90-day prune — empty collections if missing."""
    collections: dict[str, list] = {"episodes": [], "fills": [], "settlements": []}
    path = feedback_archive_path(settings)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return collections
    except OSError:
        return collections
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if not isinstance(item, dict):
            continue
        key = item.get("collection")
        if key not in collections:
            continue
        collections[key].append({k: v for k, v in item.items() if k != "collection"})
    try:
        migrated = migrate_store(
            {
                "schema_version": 1,
                "episodes": collections["episodes"],
                "fills": collections["fills"],
                "settlements": collections["settlements"],
                "audit": [],
            }
        )
    except StoreSchemaTooNew:
        return collections
    return {
        "episodes": migrated.get("episodes") or [],
        "fills": migrated.get("fills") or [],
        "settlements": migrated.get("settlements") or [],
    }


def _merge_by_id(hot: list, archived: list, id_key: str) -> list:
    """Archive first, then hot — duplicate ``id_key`` keeps the hot row."""
    by_id: dict[Any, dict] = {}
    order: list[Any] = []
    anon = 0
    for item in list(archived) + list(hot):
        if not isinstance(item, dict):
            continue
        ident = item.get(id_key)
        if ident:
            if ident not in by_id:
                order.append(ident)
            by_id[ident] = item
        else:
            anon += 1
            order.append(("anon", anon, item))
    out = []
    for key in order:
        if isinstance(key, tuple):
            out.append(key[2])
        else:
            out.append(by_id[key])
    return out


def load_ledger(settings) -> dict[str, Any]:
    """Hot store plus ``archive.jsonl`` for year/all-time/M7 (F3).

    Writes, diary and the live episode list stay on ``load_store`` (90-day
    hot window). Hot wins on duplicate ``id`` / ``snapshot_id``.
    """
    hot = load_store(settings)
    archived = load_archive_records(settings)
    return {
        "schema_version": hot.get("schema_version"),
        "episodes": _merge_by_id(hot.get("episodes") or [], archived["episodes"], "id"),
        "fills": _merge_by_id(hot.get("fills") or [], archived["fills"], "id"),
        "settlements": _merge_by_id(
            hot.get("settlements") or [], archived["settlements"], "snapshot_id"
        ),
        "audit": hot.get("audit") or [],
    }


def load_store(settings) -> dict[str, Any]:
    """Lädt den Feedback-Store — trennt Erststart von Defekt (S3).

    * **Datei fehlt** → Erststart: leerer Store (wie bisher).
    * **Datei vorhanden, aber unlesbar, ungültiges JSON oder kein Store**
      → Defekt: ``StoreCorrupted``. Der Bestand wird unverändert in eine
      Quarantäne-Kopie gelegt (``feedback_quarantine_dir``) und bleibt, wo
      er liegt; alle weiteren Writes schlagen mit demselben Fehler fehl
      statt den Defekt mit einem leeren Zustand zu überschreiben (stiller
      Datenverlust).
    * **Datei größer als ``FEEDBACK_MAX_BYTES``** → ``StoreTooLarge``.
    """
    path = feedback_path(settings)
    try:
        stat = path.stat()
    except FileNotFoundError:
        return _empty_feedback_store()
    except (OSError, ValueError) as exc:
        # Selbst das ``stat`` schlägt fehl (Rechte, Dateisystem-Zustand):
        # „fehlt“ von „defekt“ lässt sich nicht trennen — fail-closed,
        # kein leerer Store.
        raise _corrupt_feedback_store(settings, path, exc) from exc
    if stat.st_size > FEEDBACK_MAX_BYTES:
        raise StoreTooLarge(
            f"Feedback-Store zu groß ({stat.st_size} Bytes > "
            f"{FEEDBACK_MAX_BYTES}) — Retention/Archivierung prüfen."
        )
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise _corrupt_feedback_store(settings, path, exc) from exc
    if not isinstance(raw, dict) or "episodes" not in raw:
        raise _corrupt_feedback_store(
            settings,
            path,
            ValueError("kein Feedback-Store (ungültige JSON-Struktur)"),
        )
    # B2: erst auf die aktuelle Schema-Version bringen — ein Altbestand
    # ohne ``schema_version`` wird dadurch nie mehr still falsch gelesen.
    store = migrate_store(raw)
    return {
        "schema_version": store["schema_version"],
        "episodes": store.get("episodes") or [],
        "fills": store.get("fills") or [],
        "settlements": store.get("settlements") or [],
        # A3: Audit-Spur (Storno-Vermerke) bleibt beim Laden erhalten —
        # sonst ginge die Nachvollziehbarkeit eines Stornos still verloren.
        "audit": store.get("audit") or [],
    }


def save_store(settings, store: dict[str, Any]) -> None:
    atomic_json(feedback_path(settings), store)


def _same_advice(a: dict, b: dict) -> bool:
    """Ist der neue Snapshot nur die **Bestätigung** der letzten Entscheidung?

    Gleiche Aktion, gleiche Station (und Ausweichstation), gleicher
    Kraftstoff, gleicher Ablehnungsgrund — und innerhalb von
    ``SNAPSHOT_COLLAPSE_MINUTES``. Ablehnungen (``no_advice``) kennen dieses
    Zeitfenster nicht: Sie tragen keine Messung, ihr wiederholtes Bestätigen
    ist kein neuer Eintrag.
    """
    if not a or not b:
        return False
    action_match = a.get("action") == b.get("action")
    station_match = a.get("station_id") == b.get("station_id")
    alt_match = a.get("alt_station_id") == b.get("alt_station_id")
    fuel_match = a.get("fuel") == b.get("fuel")
    try:
        t_a = dt.datetime.fromisoformat(a.get("emitted_at", "").replace("Z", "+00:00"))
        t_b = dt.datetime.fromisoformat(b.get("emitted_at", "").replace("Z", "+00:00"))
        delta_m = abs((t_b - t_a).total_seconds()) / 60.0
    except Exception:
        delta_m = 999.0
    if not (action_match and station_match and alt_match and fuel_match):
        return False
    # Der Grund gehört zur Aussage: Wechselt er (etwa von „keine Prognose“ auf
    # „Preislage unentschieden“), ist das eine neue Zeile — in der alten stünde
    # sonst der falsche Grund.
    if a.get("decline_reason") != b.get("decline_reason"):
        return False
    # Ein A/B-Wechsel ist eine neue Messbedingung. Er darf nicht mit der
    # früheren Roh-/PIT-Zeile kollabieren, selbst wenn die Tabellen-Aktion
    # zufällig identisch blieb.
    if snapshot_calibration_state(a) != snapshot_calibration_state(b):
        return False
    # Eine erneut bestätigte Ablehnung ist keine neue Entscheidung: Es gibt
    # keinen Vergleichspreis, nichts zu messen. Sie wird ohne Zeitfenster
    # kollabiert — sonst schriebe jede Abfrage eines offenen Fensters einen
    # eigenen „keine Empfehlung“-Eintrag ins Ledger (bei 30 Minuten Abstand
    # greift die 30-Minuten-Regel nicht mehr: ``delta_m < 30``), und das
    # Tagebuch füllte sich mit Zeilen, die alle dasselbe sagen. Die
    # 30-Minuten-Regel gilt weiter für Handlungsempfehlungen, wo jeder
    # Emit-Zeitpunkt einen eigenen Ankerpreis und damit eine eigene Messung
    # trägt.
    if a.get("action") == "no_advice":
        return True
    return delta_m < SNAPSHOT_COLLAPSE_MINUTES


def _open_episode(store: dict[str, Any]) -> dict[str, Any] | None:
    for ep in store.get("episodes", []):
        if ep.get("status") in ("open", "waiting", "due"):
            return ep
    return None


def _parse_ts(value: Any) -> dt.datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return stamp


def estimate_p(store: dict[str, Any], action: str) -> float | None:
    """Interne sequenzielle P-Schätzung je Aktion (Konzept §5.1, §0.4).

    Schrumpfungs-Schätzer über bereits gesettelte Snapshots derselben Aktion:
    p = (hits + k·0,5) / (n + k), k = 10. Bei n = 0 also 0,5 (uninformativ),
    mit wachsendem n nähert sich p der empirischen Trefferquote. Die Schätzung
    wird zum Emit-Zeitpunkt aus *früheren* Settlements gebildet (expanding
    window) — der Brier-Score darüber ist damit ehrlich sequenziell, nicht
    in-sample. Angezeigt wird p erst nach dem M7-Gate (n ≥ 100, Brier < 0,25);
    gespeichert wird es immer, sonst könnte das Gate nie öffnen.
    """
    track = action_track_record(store, action)
    if track is None:
        return None
    return track["p"]


def action_track_record(store: dict[str, Any], action: str) -> dict[str, Any] | None:
    """Gibt {'p': Schätzer, 'n': bewertete Settlements} je Aktion zurück."""
    if action not in ("wait", "refuel_now", "refuel_elsewhere"):
        return None
    episodes = store.get("episodes", [])
    by_id = {s["id"]: s for ep in episodes for s in ep.get("snapshots", [])}
    n = 0
    hits = 0.0
    for s in store.get("settlements", []):
        if s.get("outcome") not in ("win", "loss", "tie"):
            continue
        snap = by_id.get(s.get("snapshot_id"))
        if not snap or snap.get("action") != action:
            continue
        n += 1
        hits += outcome_credit(s.get("outcome"))
    return {
        "p": round((hits + P_PRIOR_WEIGHT * 0.5) / (n + P_PRIOR_WEIGHT), 4),
        "n": n,
    }


def snapshot_p_source(snap: dict[str, Any] | None) -> str:
    """Herkunft der P-Schätzung eines Snapshots (O5) — defensiv.

    Migrierte Stores tragen ``p_source``; handgebaute Stores (Tests, alte
    Exporte) nicht. Die Rekonstruktion folgt derselben Regel wie die
    Migration 4 → 5: gespeicherte Verteilungs-P → ``verteilung``, nur
    ``p_correct`` → ``basisrate`` (der alte Fallback in ``record_snapshot``),
    sonst ``keine``. Eine explizit gespeicherte Quelle gewinnt immer.
    """
    if not isinstance(snap, dict):
        return "keine"
    stored = snap.get("p_source")
    if stored in P_SOURCES:
        return stored
    if _to_float(snap.get("p_besser")) is not None:
        return "verteilung"
    if _to_float(snap.get("p_correct")) is not None:
        return "basisrate"
    return "keine"


def snapshot_calibration_state(snap: dict[str, Any] | None) -> str:
    """B2-A/B-Gruppe am Emit-Zeitpunkt, mit ehrlichem Altbestand-Fallback."""
    if not isinstance(snap, dict):
        return "unknown"
    state = snap.get("forecast_calibration_state")
    return state if state in FORECAST_CALIBRATION_STATES else "unknown"


def _peek_confirmation(
    settings, snapshot_data: dict[str, Any], clock=None
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """O26: Sperrenfreier Vorblick — ändert dieser Snapshot den Store nicht?

    Der ``/decide``-Poll läuft über diesen Aufruf, und die GUI pollt ihn.
    Vorher nahm jeder Poll die exklusive Store-Sperre, auch wenn am Ende
    ``_same_advice`` feststellte, dass nichts zu schreiben war: Ein Beleg
    (Schreibpfad) wartete dann hinter einer Abfrage, die nichts ändert.

    Der Vorblick liest den Store **ohne** Sperre (``atomic_json`` schreibt
    über ``os.replace``, ein Leser sieht also immer einen ganzen Stand) und
    prüft dieselben Bedingungen, unter denen der Pfad unter Sperre ohne
    Änderung zurückkehrt:

    - es gibt eine offene Episode (sonst entstünde eine neue — Schreibvorgang),
    - ihr letzter Snapshot ist dieselbe Entscheidung (``_same_advice``),
    - keine Episode läuft gerade ab (der Ablauf ändert ``status``/``closed_at``).

    Trifft alles zu, ist ``(store, episode)`` die Antwort — ohne Sperre.
    Sonst ``None``: Dann entscheidet der volle Pfad unter Sperre, inklusive
    erneuter Prüfung. Ein Wettlauf zwischen Vorblick und Schreibvorgang ist
    damit harmlos: Der Vorblick kann nur „keine Änderung" sagen, wenn sie zum
    Lesezeitpunkt galt; die Sperre übernimmt, sobald Zweifel bestehen.
    """
    try:
        store = load_store(settings)
    except Exception:
        # Zu groß, unlesbar, Schema zu neu: Der Pfad unter Sperre meldet es
        # mit demselben Fehler — der Vorblick entscheidet nichts.
        return None
    now_str = _now_iso(clock)
    clock_now = clock() if clock else dt.datetime.now(UTC)
    for ep in store.get("episodes", []):
        if ep.get("status") not in ("open", "waiting", "due"):
            continue
        opened = _parse_ts(ep.get("opened_at"))
        if opened is None:
            continue
        age_h = (clock_now - opened).total_seconds() / 3600.0
        if age_h > EPISODE_MAX_HOURS:
            return None  # Ablauf setzt status/closed_at → Schreibvorgang
    ep = _open_episode(store)
    if not ep or not ep.get("last_snapshot"):
        return None  # neue Episode bzw. erster Snapshot → Schreibvorgang
    probe = {
        "action": snapshot_data.get("action", "no_advice"),
        "station_id": snapshot_data.get("station_id"),
        "alt_station_id": snapshot_data.get("alt_station_id"),
        "fuel": snapshot_data.get("fuel", "e10"),
        "decline_reason": snapshot_data.get("decline_reason"),
        "forecast_calibration_state": snapshot_data.get("forecast_calibration_state"),
        "emitted_at": now_str,
    }
    if not _same_advice(ep["last_snapshot"], probe):
        return None
    return store, ep


def record_snapshot(
    settings, snapshot_data: dict[str, Any], clock=None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Registriert einen Snapshot nach der 30-min-Kollabierungsregel (§5.4).

    Gibt (store, episode) zurück. Die interne P-Schätzung (estimate_p) wird
    aus früheren Settlements gebildet und immer gespeichert — angezeigt wird
    sie erst nach dem M7-Gate.

    Bestätigt der Aufruf die letzte Entscheidung (``_same_advice``), ändert
    das **nichts am Store**: kein Merge, kein Schreiben. Eine **Ablehnung**
    (``no_advice``) wird dabei zeitunabhängig kollabiert — sie ist kein
    Vorschlag, sondern der Zustand „diesmal nichts zu vergleichen“: genau
    eine Zeile je Episode. (Sonst füllte jede Abfrage eines offenen Fensters
    das Tagebuch mit identischen Zeilen, und der „nicht bewertbar“-Zähler
    zählte Abfragen statt Entscheidungen.)

    Der Schreibverzicht ist zugleich die Bedingung dafür, dass die
    ETag-Revalidierung von ``/overview`` greift: ``data_version`` liest den
    mtime-Wert dieses Stores — schriebe jeder Aufruf, wäre das ETag der
    Antwort schon beim Ausliefern veraltet und jede Aktualisierung liefe in
    ein 200 samt Neuberechnung (B7).

    O26: Derselbe Schreibverzicht gilt jetzt auch der **Sperre**. Eine
    Bestätigung läuft über ``_peek_confirmation`` sperrenfrei; die Sperre
    wird nur noch genommen, wenn der Aufruf den Store wirklich ändern kann.
    """
    confirmed = _peek_confirmation(settings, snapshot_data, clock)
    if confirmed is not None:
        return confirmed
    with locked_store(settings) as store:
        now_str = _now_iso(clock)
        clock_now = clock() if clock else dt.datetime.now(UTC)

        # 1. Prüfe abgelaufene Episoden
        for ep in store.get("episodes", []):
            if ep.get("status") in ("open", "waiting", "due"):
                opened = _parse_ts(ep.get("opened_at"))
                if opened is None:
                    continue
                age_h = (clock_now - opened).total_seconds() / 3600.0
                if age_h > EPISODE_MAX_HOURS:
                    ep["status"] = "expired"
                    ep["closed_at"] = now_str

        ep = _open_episode(store)
        action = snapshot_data.get("action", "no_advice")

        # Verteilungs-P (§4.1/§4.2): dieselbe Zahl, die das UI nach dem
        # M7-Gate zeigt. Fehlt sie (Altbestand, kein Modell), fällt die
        # gespeicherte Schätzung auf die interne Ledger-Quote zurück.
        # O5: Die Quelle steht je Zeile dabei (``p_source``) — der Brier wird
        # je Quelle getrennt ausgewiesen und das M7-Gate rechnet nur über
        # Verteilungs-P. Eine nicht-finite Verteilungs-P ist keine Messung
        # und fällt ebenfalls auf die Basisrate zurück.
        p_dist = _to_float(snapshot_data.get("p_besser"))
        if p_dist is not None:
            p_besser = p_dist
            p_source = "verteilung"
        else:
            p_besser = estimate_p(store, action)
            p_source = "basisrate" if p_besser is not None else "keine"

        # O1: Auch der Snapshot nennt keine erfundene Uhrzeit. ``decide``
        # schickt die gemessene Stunde (Europe/Berlin, mit Minutenanteil);
        # fehlt sie, ist der Emit-Zeitpunkt die Quelle — nicht 12 Uhr.
        snap_hour = _to_float(snapshot_data.get("clock_hour"))
        if snap_hour is None:
            snap_hour = _local_hour_fraction(clock_now)

        state_raw = snapshot_data.get("forecast_calibration_state")
        calibration_state = (
            state_raw if state_raw in FORECAST_CALIBRATION_STATES else "unknown"
        )

        snap_id = _uid("snap")
        snap = {
            "id": snap_id,
            "emitted_at": now_str,
            "clock_hour": snap_hour,
            "action": action,
            "city": snapshot_data.get("city"),
            "station_id": snapshot_data.get("station_id"),
            "station_name": snapshot_data.get("station_name"),
            "alt_station_id": snapshot_data.get("alt_station_id"),
            "alt_station_name": snapshot_data.get("alt_station_name"),
            # O9: actual receipt economics must retain its original reference
            # price and estimated route assumptions; old snapshots remain null.
            "elsewhere_economics": snapshot_data.get("elsewhere_economics"),
            "price_now": snapshot_data.get("price_now"),
            "window_start": snapshot_data.get("window_start"),
            "window_end": snapshot_data.get("window_end"),
            "window_start_hour": snapshot_data.get("window_start_hour"),
            "window_end_hour": snapshot_data.get("window_end_hour"),
            "expected_price": snapshot_data.get("expected_price"),
            "expected_min_price": snapshot_data.get("expected_min_price"),
            "expected_saving_eur": snapshot_data.get("expected_saving_eur", 0.0),
            "expected_saving_median_eur": snapshot_data.get(
                "expected_saving_median_eur", 0.0
            ),
            # Grund der Ablehnung in Klartext (nur bei ``no_advice``): Das
            # Tagebuch zeigt damit „warum“, nicht nur „keine Empfehlung“.
            "decline_reason": snapshot_data.get("decline_reason"),
            "p_besser": p_dist,
            "p_correct": p_besser,
            # O5: Herkunft der gespeicherten Schätzung — ``p_besser`` ist die
            # bereinigte Verteilungs-P (nicht-finite Angaben sind keine
            # Messung und landen nicht im Ledger).
            "p_source": p_source,
            # B2: Der Brier muss den technischen Zustand zum *damaligen*
            # Emit-Zeitpunkt tragen, sonst ist A/B nur eine nachträgliche
            # Behauptung. ``unknown`` bleibt von Altbeständen getrennt.
            "forecast_calibration_state": calibration_state,
            "liters_assumed": snapshot_data.get("liters_assumed", 40.0),
            "fuel": snapshot_data.get("fuel", "e10"),
            # Konzepteigene Felder (Prüfstand §3.7): Fahrtmodus und
            # Deadline müssen im Store landen, sonst sind spätere
            # Auswertungen (Dedicated? Deadline-Druck?) unmöglich.
            "trip_mode": snapshot_data.get("trip_mode"),
            "latest_by": snapshot_data.get("latest_by"),
            # A2: Tankstand-Zustand („empty“/„low“/„ok“/None) — rein
            # informativ für spätere Auswertungen; die Snapshot-
            # Kollabierung hängt weiter nur an Aktion/Station/Fenster.
            "tank_state": snapshot_data.get("tank_state"),
        }

        if not ep:
            # Neue Episode
            ep_id = _uid("ep")
            ep = {
                "id": ep_id,
                "opened_at": now_str,
                "closed_at": None,
                "status": "open",
                "intent": "none",
                "first_snapshot": snap,
                "last_snapshot": snap,
                "snapshots": [snap],
            }
            store["episodes"].insert(0, ep)
        else:
            last = ep.get("last_snapshot")
            if last and _same_advice(last, snap):
                # Bestätigung derselben Entscheidung — es bleibt beim
                # vorhandenen Eintrag (Emit-Zeitpunkt, P-Schätzung, Fenster,
                # Ablehnungsgrund). Ein Merge würde nur Werte desselben
                # Vorschlags überschreiben und den Store neu schreiben; genau
                # das verhindert diese Regel.
                return store, ep
            # Advice gekippt, Grund gewechselt oder > 30 min vergangen ->
            # neuen Snapshot anhängen
            ep["last_snapshot"] = snap
            ep["snapshots"].append(snap)

        return store, ep


def set_intent(settings, episode_id: str, intent: str, clock=None) -> dict[str, Any]:
    """Nutzer setzt Intent: 'wait' | 'navigate' | 'refuel_now' | 'dismiss'.

    Strikt je Episode: Eine unbekannte ID liefert 404, statt still eine
    andere offene Episode umzuschreiben (falsche Intent-Zuordnung würde
    Due-Prompts und Wallet-Matching verfälschen).
    """
    with locked_store(settings) as store:
        now_str = _now_iso(clock)

        for ep in store.get("episodes", []):
            if ep.get("id") == episode_id:
                ep["intent"] = intent
                if intent in ("wait", "navigate"):
                    if ep.get("status") == "open":
                        ep["status"] = "waiting"
                elif intent == "dismiss":
                    ep["status"] = "expired"
                    ep["closed_at"] = now_str
                return ep

        return {"error_code": "episode_not_found"}


def window_settlement_kind(
    ep: dict[str, Any] | None, station_id: str, tanked_at: Any
) -> str | None:
    """Classify a matching wait receipt as exact window or documented grace.

    ``im_fenster`` is intentionally stricter than compliance slack. A receipt
    in [start−30 min, end+60 min] remains visible as ``kulanz`` but cannot
    increase the strict followed/quality count (O8).
    """
    if not ep:
        return None
    snap = ep.get("last_snapshot")
    if not isinstance(snap, dict) or snap.get("action") != "wait":
        return None
    start = _parse_ts(snap.get("window_start"))
    end = _parse_ts(snap.get("window_end"))
    filled = _parse_ts(tanked_at)
    same_station = station_id in {snap.get("station_id"), snap.get("alt_station_id")}
    if not same_station or start is None or end is None or filled is None:
        return None
    if start <= filled <= end:
        return "im_fenster"
    grace_start = start - dt.timedelta(minutes=WAIT_SLACK_BEFORE_MINUTES)
    grace_end = end + dt.timedelta(minutes=WAIT_SLACK_AFTER_MINUTES)
    if grace_start <= filled <= grace_end:
        return "kulanz"
    return None


def classify_compliance(
    ep: dict[str, Any] | None,
    fill_hour: float,
    station_id: str,
    tanked_at: Any = None,
) -> str:
    """Slack-Matching (§5.4): followed | partial | ignored | unrelated.

    Primär über echte Zeitstempel (tanked_at vs. emitted_at/Fenster): Ein
    reiner Stundenvergleich würde über Mitternacht brechen (23:55 vs. 0:05)
    und Folgetage fälschlich matchen. Nur für Altdaten ohne ISO-Zeiten gilt
    die Stunden-Fallback-Regel.
    """
    if not ep:
        return "unrelated"
    snap = ep.get("last_snapshot")
    if not snap:
        return "unrelated"

    action = snap.get("action")
    snap_station = snap.get("station_id")
    alt_station = snap.get("alt_station_id")

    tanked = _parse_ts(tanked_at)
    emitted = _parse_ts(snap.get("emitted_at"))
    window_start = _parse_ts(snap.get("window_start"))
    window_end = _parse_ts(snap.get("window_end"))

    if tanked is not None and (emitted is not None or window_start is not None):
        at_emit_station = station_id == snap_station
        at_alt_station = bool(alt_station) and station_id == alt_station
        if action == "refuel_now" and emitted is not None:
            within = abs((tanked - emitted).total_seconds()) <= NOW_GRACE_MINUTES * 60
            if (at_emit_station or at_alt_station) and within:
                return "followed"
            if at_emit_station or at_alt_station:
                return "partial"
            return "ignored"
        if action == "wait" and window_start is not None and window_end is not None:
            # O8: Slack matches a receipt to the episode, not to its strict
            # quality signal. Only the published window itself is followed.
            settled = window_settlement_kind(ep, station_id, tanked_at)
            same = at_emit_station or at_alt_station
            if same and settled == "im_fenster":
                return "followed"
            if same or settled == "kulanz":
                return "partial"
            return "ignored"
        if action == "refuel_elsewhere":
            if at_alt_station:
                return "followed"
            if at_emit_station:
                return "ignored"
            return "partial"
        return "unrelated"

    # Fallback für Altdaten ohne ISO-Zeiten (stundenbasiert, tagblind).
    snap_hour = snap.get("clock_hour", CLOCK_HOUR_DEFAULT)
    try:
        snap_hour = float(snap_hour)
    except (TypeError, ValueError):
        snap_hour = CLOCK_HOUR_DEFAULT
    same_station = station_id == snap_station or station_id == alt_station

    if action == "refuel_now":
        if same_station and abs(fill_hour - snap_hour) * 60 <= NOW_GRACE_MINUTES:
            return "followed"
        if same_station:
            return "partial"
        return "ignored"

    if action == "wait":
        w_start = (snap.get("window_start_hour") or 17.5) - 0.5
        w_end = (snap.get("window_end_hour") or 20.5) + 1.0
        in_window = w_start <= fill_hour <= w_end
        if same_station and in_window:
            return "followed"
        if same_station or in_window:
            return "partial"
        return "ignored"

    if action == "refuel_elsewhere":
        if station_id == alt_station:
            return "followed"
        if station_id == snap_station:
            return "ignored"
        return "partial"

    return "unrelated"


def _to_float(value: Any) -> float | None:
    """Strikte Zahl ohne stillen Default: None bei Nicht-Zahl/NaN/∞."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _nowcast_price(
    live_data: Any, station_id: str, city: str, fuel: str
) -> float | None:
    """Frischer Live-Preis der Station (Nowcast, §11.2) — oder None."""
    if live_data is None:
        return None
    try:
        data = live_data.stations(fuel=fuel, city=city)
    except Exception:
        return None
    for s in data.get("stations", []):
        if s.get("station_id") == station_id and s.get("price") is not None:
            try:
                return float(s["price"])
            except (TypeError, ValueError):
                return None
    return None


def _closes_episode(compliance: str, ep: dict[str, Any], station_id: str) -> bool:
    """Nur ein Beleg, der die Empfehlung betrifft, schließt die Folge (§5.4).

    ``unrelated`` (Tanken ohne App) beendet die Advice-Folge NICHT — sonst
    killt ein fachlich fremder Beleg Due-Prompt und M7-Zählfolge
    (Prüfstand §3.2). ``ignored`` schließt nur an der Emit-/Alt-Station
    (z. B. „doch an der empfohlenen Station geblieben“).
    """
    if compliance in ("followed", "partial"):
        return True
    if compliance == "ignored":
        snap = ep.get("last_snapshot") or {}
        emit = snap.get("station_id")
        alt = snap.get("alt_station_id")
        return bool(station_id) and station_id in (emit, alt)
    return False


def _capped_text(value: Any, limit: int) -> str:
    """B5: Freitext-Felder hart kappen — Anzeige-Metadaten, keine Fachdaten."""
    if value is None:
        return ""
    return str(value)[:limit]


def _validated_tanked_at(value: Any, clock=None) -> str | None:
    """B5: Beleg-Zeit nur im Plausibilitätsfenster — kein 1970/2100 im Ledger.

    Bisher wurde ``tanked_at`` ungeprüft gespeichert; ein defekter Client
    konnte Bilanz und w(h)-Profil mit Müllzeiten kippen. Ohne Angabe gilt
    „jetzt“ (Rückgabe None, der Aufrufer setzt den Zeitstempel). Eine
    angegebene Zeit muss ISO-parsebar sein, darf höchstens
    ``FEEDBACK_RETENTION_DAYS`` zurückliegen (älter wäre beim nächsten
    Retention-Lauf sofort archiviert) und wenige Minuten in der Zukunft
    (Uhrversatz, nicht Tippfehler 2100). Sonst ``invalid_tanked_at`` (400).
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    stamp = _parse_ts(value)
    if stamp is None:
        raise ValueError("invalid_tanked_at")
    now = clock() if clock else dt.datetime.now(UTC)
    if stamp > now + dt.timedelta(minutes=TANKED_AT_FUTURE_GRACE_MINUTES):
        raise ValueError("invalid_tanked_at")
    if stamp < now - dt.timedelta(days=FEEDBACK_RETENTION_DAYS):
        raise ValueError("invalid_tanked_at")
    return stamp.isoformat()


def record_fill(
    settings, fill_data: dict[str, Any], live_data=None, clock=None
) -> dict[str, Any]:
    """Registriert einen Tankbeleg (Wallet-Ledger) — validiert (§11.2).

    Validierung (Prüfstand §3.1): ``liters`` 5–100, ``price_paid`` 0,40–5,00,
    ``fuel`` ∈ {e10, e5, diesel}, ``station_id`` ∈ Polling-Set. Fehlt
    ``price_paid``, wird der Nowcast-Preis der Station gesucht; ohne ihn
    ``ValueError("price_not_available")`` — kein erfundener 1,70-€-Default.
    O17: Der Client deklariert die Preis-Herkunft (``live``|``manuell``);
    ein Ein-Tipp-Beleg (``source == "prompt"``) ohne Live-Nachweis wird mit
    ``ValueError("prompt_price_not_live")`` abgewiesen statt gebucht.
    """
    with locked_store(settings) as store:
        now_str = _now_iso(clock)

        fill_id = fill_data.get("id") or _uid("fill")

        # Idempotenz: derselbe Beleg wird nie doppelt verbucht.
        for existing in store.get("fills", []):
            if existing.get("id") == fill_id:
                return existing

        # --- Validierung (§11.2, Prüfstand §3.1) ---
        fuel = str(fill_data.get("fuel") or "e10").lower()
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")

        station_id = fill_data.get("station_id") or ""
        metas, _problem = metadata(settings)
        city = next((c for (c, uid) in metas if uid == station_id), None)
        if city is None:
            raise ValueError("unknown_station")

        liters = _to_float(fill_data.get("liters"))
        if liters is None or not (MIN_LITERS <= liters <= MAX_LITERS):
            raise ValueError("invalid_liters")

        # O17: Herkunft des Preises. Der Client deklariert „live“ (frischer
        # Poll zur Tipp-Zeit) oder „manuell“ (eingetragen); alles andere ist
        # kein gültiger Nachweis. „prognose“ vergibt nur die Migration 4 → 5
        # für Altbestände — neue Belege mit Prognosepreis werden nicht mehr
        # gebucht (der Ein-Tipp-Beleg nimmt den Live-Preis oder fragt nach,
        # statt den Median zu buchen).
        price_source_raw = fill_data.get("price_source")
        if price_source_raw is None:
            price_source_declared = None
        elif price_source_raw in ("live", "manuell"):
            price_source_declared = price_source_raw
        else:
            raise ValueError("invalid_price_source")

        price_paid_raw = fill_data.get("price_paid")
        if price_paid_raw is None:
            # §11.2: fehlt price_paid → Nowcast/Poll der Station.
            price_paid = _nowcast_price(live_data, station_id, city, fuel)
            if price_paid is None:
                raise ValueError("price_not_available")
            price_source = "nowcast"
        else:
            price_paid = _to_float(price_paid_raw)
            if price_paid is None or not (
                MIN_PRICE_PAID <= price_paid <= MAX_PRICE_PAID
            ):
                raise ValueError("invalid_price")
            price_source = price_source_declared or "manuell"

        episode_id = fill_data.get("episode_id")
        ep = None
        if episode_id:
            for e in store.get("episodes", []):
                if e.get("id") == episode_id:
                    ep = e
                    break
        if not ep:
            ep = _open_episode(store)

        # B5: Freitext hart kappen — siehe _capped_text.
        station_name = _capped_text(
            fill_data.get("station_name"), MAX_STATION_NAME_CHARS
        )
        source = _capped_text(fill_data.get("source"), MAX_SOURCE_CHARS) or "manual"

        # B5: tanked_at nur im Plausibilitätsfenster — vorher wurde jede
        # Angabe ungeprüft gespeichert (1970/2100 inklusive). Ohne Belegzeit
        # ist ``now_str`` die serverseitig dokumentierte Buchungszeit (O43),
        # auch für die Uhrzeitlogik: nie mehr eine erfundene 12-Uhr-Zelle.
        tanked_at = _validated_tanked_at(fill_data.get("tanked_at"), clock)
        effective_tanked_at = tanked_at or now_str
        clock_hour, clock_hour_source = clock_hour_from_fill(
            fill_data, effective_tanked_at, server_timestamp=tanked_at is None
        )
        stamp = _parse_ts(effective_tanked_at)
        # Stunden-Fallback von ``classify_compliance`` (Altdaten ohne ISO-Zeiten
        # am Snapshot): mit Minutenanteil, die 45-Minuten-Toleranz ist sonst
        # bis zu eine Stunde blind.
        fill_hour = _local_hour_fraction(stamp) if stamp is not None else clock_hour

        compliance = classify_compliance(
            ep, fill_hour, station_id, tanked_at=effective_tanked_at
        )
        settled = window_settlement_kind(ep, station_id, effective_tanked_at)

        # Counterfactual = price_now des ersten Snapshots der Folge (oder price_paid wenn keine Folge)
        ref_price = ep.get("first_snapshot", {}).get("price_now") if ep else price_paid
        if ref_price is None or not math.isfinite(ref_price):
            ref_price = price_paid

        saved_eur = round((ref_price - price_paid) * liters, 2)

        # O9: A possible Woanders fill gets a receipt-based net result. The
        # user may provide actual *total* detour km; otherwise the snapshot's
        # estimate stays visibly an estimate. Do not invent driven kilometres.
        elsewhere_net_eur = None
        elsewhere_net_provenance = None
        actual_detour_km = _to_float(
            fill_data.get("actual_detour_km_total", fill_data.get("detour_km_total"))
        )
        if actual_detour_km is not None and not (0.0 <= actual_detour_km <= 200.0):
            raise ValueError("invalid_detour")
        snap = ep.get("last_snapshot") if ep else None
        assumed = snap.get("elsewhere_economics") if isinstance(snap, dict) else None
        if (
            isinstance(assumed, dict)
            and snap.get("action") == "refuel_elsewhere"
            and station_id == snap.get("alt_station_id")
        ):
            detour_km_total = actual_detour_km
            distance_source = (
                "actual_receipt"
                if detour_km_total is not None
                else "estimated_snapshot"
            )
            if detour_km_total is None:
                detour_km_total = _to_float(assumed.get("detour_km_total_est"))
            reference_price = _to_float(assumed.get("reference_price"))
            consumption = _to_float(assumed.get("consumption_l_100km"))
            speed = _to_float(assumed.get("speed_kmh"))
            time_value = _to_float(assumed.get("time_value_eur_h"))
            if all(
                v is not None
                for v in (
                    detour_km_total,
                    reference_price,
                    consumption,
                    speed,
                    time_value,
                )
            ):
                economy = net_economics(
                    reference_price,
                    price_paid,
                    liters,
                    detour_km_total,
                    consumption,
                    speed,
                    time_value,
                )
                elsewhere_net_eur = round(economy["net_eur"], 2)
                elsewhere_net_provenance = {
                    "distance_source": distance_source,
                    "detour_km_total": round(detour_km_total, 3),
                    "reference_price": round(reference_price, 4),
                    "consumption_l_100km": consumption,
                    "speed_kmh": speed,
                    "time_value_eur_h": time_value,
                }

        # O17: Der Ein-Tipp-Beleg („Ja, wie empfohlen“) steht und fällt mit
        # dem Live-Preis — frisch vom Client deklariert oder vom Server aus
        # dem Poll ergänzt. Ohne Live-Nachweis wird nichts gebucht, statt
        # still einen Prognose-Median als gezahlten Preis zu verbuchen.
        if source == "prompt" and price_source not in ("live", "nowcast"):
            raise ValueError("prompt_price_not_live")

        fill_event = {
            "id": fill_id,
            "episode_id": ep.get("id") if ep else None,
            "station_id": station_id,
            "station_name": station_name,
            "tanked_at": effective_tanked_at,
            "clock_hour": clock_hour,
            # O1: Herkunft der Stunde — das w(h)-Histogramm sagt damit, ob es
            # auf gemessenen Tankzeiten steht oder auf der 12-Uhr-Projektion.
            "clock_hour_source": clock_hour_source,
            "liters": liters,
            "price_paid": price_paid,
            "price_source": price_source,
            "fuel": fuel,
            "source": source,
            "compliance": compliance,
            # O8: only an exact window receipt is a followed quality signal;
            # grace remains traceable but is partial, never a hidden hit.
            "settled": settled,
            "saved_vs_always_now_eur": saved_eur,
            "elsewhere_net_eur": elsewhere_net_eur,
            "elsewhere_net_provenance": elsewhere_net_provenance,
        }

        store["fills"].insert(0, fill_event)

        # Episode abschließen — nur wenn der Beleg die Folge betrifft.
        # Das Snapshot-Settlement bleibt Sache des Settlement-Jobs
        # (Fensterende + Lag, gegen beobachtete Preise) — zum Tankzeitpunkt
        # ist das Fenster ggf. noch offen.
        if ep and ep.get("status") in ("open", "waiting", "due"):
            if _closes_episode(compliance, ep, station_id):
                ep["status"] = "resolved"
                ep["closed_at"] = now_str

        return fill_event


def void_fill(settings, fill_id: str, clock=None) -> dict[str, Any] | dict[str, str]:
    """Storniert einen Tankbeleg (A3): ``voided``-Flag statt Löschen + Audit-Zeile.

    Ein falsch gebuchter Beleg verzerrt Wallet, w(h)-Profil und Statistik —
    Löschen wäre Datenverlust und ohne Nachweis. Stattdessen bleibt der Beleg
    erhalten, zählt aber nicht mehr in die Bilanz; die Audit-Spur protokolliert
    das Storno. Idempotent: ein zweites Storno desselben Belegs ändert nichts.

    Rückgabe: der (stornierte) Beleg oder ``{"error_code": "fill_not_found"}``.
    """
    with locked_store(settings) as store:
        for fill in store.get("fills", []):
            if fill.get("id") != fill_id:
                continue
            if fill.get("voided"):
                return fill
            now_str = _now_iso(clock)
            fill["voided"] = True
            fill["voided_at"] = now_str
            audit = store.setdefault("audit", [])
            audit.insert(
                0,
                {
                    "at": now_str,
                    "action": "void_fill",
                    "fill_id": fill_id,
                    "station_id": fill.get("station_id"),
                    "liters": fill.get("liters"),
                    "price_paid": fill.get("price_paid"),
                },
            )
            return fill
        return {"error_code": "fill_not_found"}


def _finite_price(value: Any) -> float | None:
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if math.isfinite(price) and price >= 0 else None


def _realized_min(
    live_data: Any,
    station_id: str,
    city: str,
    fuel: str,
    start: dt.datetime,
    end: dt.datetime,
    now: dt.datetime,
) -> float | None:
    """Billigster *beobachteter* offener Preis im Fenster.

    Fenstergrenzen mit Slack (§5.4): [start − 30 min, end + 60 min].
    None, wenn (noch) kein offener Preis im Fenster bekannt ist — der
    Snapshot bleibt dann 'pending' und wird NIEMALS aus der Prognose
    abgerechnet (kein Self-Grading).
    """
    if live_data is None:
        return None
    hours_back = (now - start).total_seconds() / 3600.0 + 1.0
    if hours_back > 168:
        raise ValueError("unprovable")
    try:
        res = live_data.series(
            station_id, city, fuel, hours=max(1, min(168, math.ceil(hours_back)))
        )
    except Exception:
        return None
    if not isinstance(res, dict) or res.get("error_code"):
        return None
    lo = start - dt.timedelta(minutes=WAIT_SLACK_BEFORE_MINUTES)
    hi = end + dt.timedelta(minutes=WAIT_SLACK_AFTER_MINUTES)
    best = None
    for point in res.get("points", []):
        if point.get("status") != "open":
            continue
        price = _finite_price(point.get("price"))
        stamp = _parse_ts(point.get("timestamp"))
        if price is None or stamp is None:
            continue
        if lo <= stamp <= hi and (best is None or price < best):
            best = price
    return best


def _void_settlement(
    store: dict[str, Any],
    ep: dict[str, Any],
    snap: dict[str, Any],
    now_str: str,
    reason: str,
) -> dict[str, Any]:
    settlement = {
        "snapshot_id": snap.get("id"),
        "episode_id": ep.get("id"),
        "settled_at": now_str,
        "p_emit": snap.get("price_now"),
        "p_realized": None,
        "outcome": "void",
        "void_reason": reason,
        "regret_eur": 0.0,
    }
    store["settlements"].append(settlement)
    return settlement


def _settle_one_snapshot(
    store: dict[str, Any],
    ep: dict[str, Any],
    snap: dict[str, Any],
    now: dt.datetime,
    now_str: str,
    live_data: Any = None,
) -> dict[str, Any] | None:
    """Rechnet einen Snapshot gegen *beobachtete* Preise ab (Konzept §11.2).

    Gibt das Settlement zurück oder None, wenn der Snapshot noch nicht
    abrechenbar ist ('pending': Fenster + Lag noch nicht vorüber, oder die
    realisierten Preise sind noch nicht verfügbar). 'void' bedeutet
    endgültig nicht bewertbar (kein Advice, kein Ankerpreis, Altdaten ohne
    Fenster, Fenster außerhalb der Series-Reichweite, Station geschlossen).
    """
    snap_id = snap.get("id")
    for s in store.get("settlements", []):
        if s.get("snapshot_id") == snap_id:
            return s

    action = snap.get("action", "no_advice")
    if action == "no_advice":
        return _void_settlement(store, ep, snap, now_str, "no_advice")

    p_emit = _finite_price(snap.get("price_now"))
    if p_emit is None:
        return _void_settlement(store, ep, snap, now_str, "no_emit_price")

    start = _parse_ts(snap.get("window_start"))
    end = _parse_ts(snap.get("window_end"))
    if start is None or end is None:
        # Altdaten ohne ISO-Fenster: nicht rekonstruierbar → void, sobald
        # die Episode sicher vorbei ist (Emit + 24 h).
        emitted = _parse_ts(snap.get("emitted_at"))
        if emitted is not None and now < emitted + dt.timedelta(hours=24):
            return None
        return _void_settlement(store, ep, snap, now_str, "legacy_no_window")

    if now < end + dt.timedelta(minutes=SETTLEMENT_LAG_MINUTES):
        return None  # Fenster + Lag noch nicht vorüber → pending

    if (now - start).total_seconds() / 3600.0 > 168:
        return _void_settlement(store, ep, snap, now_str, "beyond_series_range")

    if action == "refuel_elsewhere":
        station_id = snap.get("alt_station_id")
        if not station_id:
            return _void_settlement(store, ep, snap, now_str, "no_alt_station")
    else:
        station_id = snap.get("station_id")
    if not station_id:
        return _void_settlement(store, ep, snap, now_str, "no_station")

    city = snap.get("city")
    if not city:
        # Ohne Stadt wäre die Abrechnung gegen eine geratene Stadt gelaufen
        # (vorher still „Frankfurt", Prüfstand §3.8) — ehrlich void statt falsch.
        return _void_settlement(store, ep, snap, now_str, "no_city")
    fuel = snap.get("fuel") or "e10"
    try:
        p_real = _realized_min(live_data, station_id, city, fuel, start, end, now)
    except ValueError:
        return _void_settlement(store, ep, snap, now_str, "beyond_series_range")
    if p_real is None:
        if now > end + dt.timedelta(hours=SETTLEMENT_VOID_AFTER_HOURS):
            return _void_settlement(store, ep, snap, now_str, "no_realized_price")
        return None  # Influx-Lag o. ä. → später erneut versuchen

    theta = THETA_CT / 100.0  # 0.01 €
    liters = _finite_price(snap.get("liters_assumed")) or 40.0
    saving = p_emit - p_real  # > 0: Warten hat sich gelohnt

    if action == "wait":
        outcome = symmetric_threshold_outcome(saving, theta)
        regret = round(max(0.0, -saving) * liters, 2) if outcome == "loss" else 0.0
    elif action == "refuel_now":
        # Correct if waiting would not clear the significant-saving threshold.
        outcome = threshold_outcome(saving, theta, positive_is_win=False)
        regret = round(max(0.0, saving) * liters, 2) if outcome == "loss" else 0.0
    else:  # refuel_elsewhere, brutto (Umwegkosten stecken in der Empfehlung)
        outcome = symmetric_threshold_outcome(saving, theta)
        regret = round(max(0.0, -saving) * liters, 2) if outcome == "loss" else 0.0

    settlement = {
        "snapshot_id": snap_id,
        "episode_id": ep.get("id"),
        "settled_at": now_str,
        "p_emit": round(p_emit, 3),
        "p_realized": round(p_real, 3),
        "outcome": outcome,
        "regret_eur": regret,
    }
    store["settlements"].append(settlement)
    return settlement


def settle_snapshots(settings, live_data=None, clock=None) -> dict[str, Any]:
    """Settlement-Job (NAS/Worker, §5.4): rechnet Snapshots nach Fensterende ab."""
    with locked_store(settings) as store:
        now_str = _now_iso(clock)
        clock_now = clock() if clock else dt.datetime.now(UTC)

        settled_count = 0
        due_count = 0

        settled_snap_ids = {s.get("snapshot_id") for s in store.get("settlements", [])}

        for ep in store.get("episodes", []):
            status = ep.get("status")
            intent = ep.get("intent", "none")
            last_snap = ep.get("last_snapshot")
            if not last_snap:
                continue

            window_end = _parse_ts(last_snap.get("window_end"))

            # Wenn Intent 'wait' oder 'navigate' gesetzt war und Fenster vorbei
            # ist -> status wird 'due'. Altdaten ohne ISO-Fenster nutzen die
            # tagblinde Stundenregel nur noch für den Due-Prompt.
            window_over = False
            if window_end is not None:
                window_over = clock_now >= window_end + dt.timedelta(
                    minutes=WAIT_SLACK_AFTER_MINUTES
                )
            else:
                window_over = _legacy_window_over(
                    last_snap.get("window_end_hour", 20.5), clock_now
                )
            if intent in ("wait", "navigate") and status in ("open", "waiting"):
                if window_over:
                    ep["status"] = "due"
                    due_count += 1

            # Generelles Snapshot-Settlement für alle abrechenbaren Fenster
            for snap in ep.get("snapshots", []):
                if snap["id"] not in settled_snap_ids:
                    res = _settle_one_snapshot(
                        store, ep, snap, clock_now, now_str, live_data
                    )
                    if res is not None:
                        settled_snap_ids.add(snap["id"])
                        settled_count += 1

        return {
            "status": "ok",
            "settled_count": settled_count,
            "due_count": due_count,
            "total_settlements": len(store.get("settlements", [])),
        }


def _legacy_window_over(window_end_hour: Any, clock_now: dt.datetime) -> bool:
    """Tagblinde Stundenregel — nur noch für Due-Prompts von Altdaten."""
    try:
        from zoneinfo import ZoneInfo

        berlin_dt = clock_now.astimezone(ZoneInfo("Europe/Berlin"))
        current_hour = berlin_dt.hour + berlin_dt.minute / 60.0
    except Exception:
        current_hour = clock_now.hour + clock_now.minute / 60.0
    try:
        end = float(window_end_hour)
    except (TypeError, ValueError):
        end = 20.5
    return current_hour >= end + WAIT_SLACK_AFTER_MINUTES / 60.0


def _de(value: float) -> str:
    """Zwei Dezimalstellen in deutscher Schreibweise (0,25 statt 0.25).

    Nur für Anzeigetexte — gerechnet wird weiterhin mit dem Float.
    """
    return f"{value:.2f}".replace(".", ",")


def _emit_day_cell(snap: dict[str, Any] | None) -> tuple[Any, Any, Any]:
    """(Tag, Stunde, Wochentag) des Emits in Europe/Berlin — O6-Blöcke.

    Der Tag ist der Blockschlüssel für den Tagesblock-Bootstrap, die
    (Stunde, Wochentag)-Zelle trägt die Klimatologie-Referenz. Ohne
    parsebaren Emit-Stempel (None, None, None): Die Zeile bildet einen
    eigenen Block und fällt in der Klimatologie auf die globale Basisrate
    zurück — kein Raten, kein Pooling von Unbekanntem.
    """
    if not snap:
        return None, None, None
    stamp = _parse_ts(snap.get("emitted_at"))
    if stamp is None:
        return None, None, None
    try:
        local = stamp.astimezone(BERLIN_TZ)
    except Exception:
        return None, None, None
    return local.date().isoformat(), local.hour, local.weekday()


def _block_bootstrap_ci(
    blocks: list[list[float]],
    samples: int = GATE_BOOTSTRAP_SAMPLES,
    seed: int = GATE_BOOTSTRAP_SEED,
) -> tuple[float | None, float | None]:
    """Block-Bootstrap-Intervall (2,5 %/97,5 %-Perzentile) über Tagesblöcke.

    Dasselbe Verfahren wie der Residuen-Bootstrap der Engine
    (``engine/models.py``: Tagesblöcke, Ziehen mit Zurücklegen): Jede
    Ziehung mittelt die quadrierten Fehler der gezogenen Blöcke, das
    Intervall sind die Perzentile der Ziehungsmittel. Fester Samen — das
    Intervall ist über Läufe stabil und damit testbar. Leere Eingabe →
    (None, None); die Mindestblockzahl prüft der Aufrufer.
    """
    if not blocks or samples <= 0:
        return None, None
    rng = random.Random(seed)
    n_blocks = len(blocks)
    means: list[float] = []
    for _ in range(samples):
        pooled = 0.0
        count = 0
        for _ in range(n_blocks):
            for value in blocks[rng.randrange(n_blocks)]:
                pooled += value
                count += 1
        means.append(pooled / count if count else 0.0)
    means.sort()
    lo_idx = min(len(means) - 1, int(0.025 * len(means)))
    hi_idx = min(len(means) - 1, int(0.975 * len(means)))
    return round(means[lo_idx], 4), round(means[hi_idx], 4)


def _reliability_slope(rows: list[dict[str, float]]) -> float | None:
    """OLS-Steigung ``outcome ~ intercept + p`` einer Reliability-Kurve.

    Ohne Streuung der ausgegebenen Wahrscheinlichkeiten ist eine Steigung
    nicht identifizierbar. ``None`` ist dann ehrlicher als die scheinbar gute
    Steigung 1,0 einer Konstant-Prognose.
    """
    if len(rows) < 2:
        return None
    pairs = [
        (float(row["p"]), float(row["outcome"]))
        for row in rows
        if math.isfinite(float(row["p"])) and math.isfinite(float(row["outcome"]))
    ]
    if len(pairs) < 2:
        return None
    p_mean = sum(p for p, _ in pairs) / len(pairs)
    y_mean = sum(y for _, y in pairs) / len(pairs)
    denominator = sum((p - p_mean) ** 2 for p, _ in pairs)
    if denominator <= 1e-12:
        return None
    return sum((p - p_mean) * (y - y_mean) for p, y in pairs) / denominator


def _block_bootstrap_reliability_ci(
    blocks: list[list[dict[str, float]]],
    samples: int = GATE_BOOTSTRAP_SAMPLES,
    seed: int = GATE_BOOTSTRAP_SEED,
) -> tuple[float | None, float | None]:
    """95-%-Tagesblock-Bootstrap-KI der Reliability-Steigung (B2)."""
    if not blocks or samples <= 0:
        return None, None
    rng = random.Random(seed)
    slopes: list[float] = []
    for _ in range(samples):
        drawn: list[dict[str, float]] = []
        for _ in range(len(blocks)):
            drawn.extend(blocks[rng.randrange(len(blocks))])
        slope = _reliability_slope(drawn)
        if slope is not None and math.isfinite(slope):
            slopes.append(slope)
    if len(slopes) < max(10, samples // 10):
        return None, None
    slopes.sort()
    lo_idx = min(len(slopes) - 1, int(0.025 * len(slopes)))
    hi_idx = min(len(slopes) - 1, int(0.975 * len(slopes)))
    return round(slopes[lo_idx], 4), round(slopes[hi_idx], 4)


def _reference_briers(
    outcomes: list[float], cells: list[tuple[Any, Any] | None]
) -> tuple[float | None, float | None]:
    """Naive Referenzen des Gates auf derselben Grundgesamtheit (O6).

    Basisrate: konstante Vorhersage der empirischen Trefferquote —
    ``mean((q − y)²)``. Klimatologie: Leave-one-out je (Stunde,
    Wochentag)-Zelle — jede Zeile wird mit der Quote der *anderen* Zeilen
    ihrer Zelle bewertet, Einzelzellen fallen auf die globale Quote zurück.
    Ohne LOO wäre die Klimatologie bei dünnen Zellen in-sample-perfekt und
    damit unschlagbar (derselbe Fehler wie O11). Leere Eingabe → (None, None).
    """
    if not outcomes:
        return None, None
    base_rate = sum(outcomes) / len(outcomes)
    ref_base = sum((base_rate - y) ** 2 for y in outcomes) / len(outcomes)
    by_cell: dict[tuple[Any, Any], list[int]] = {}
    for idx, cell in enumerate(cells):
        if cell is None:
            continue
        by_cell.setdefault(cell, []).append(idx)
    sq_sum = 0.0
    for idx, y in enumerate(outcomes):
        cell = cells[idx]
        peers = [i for i in by_cell.get(cell, [])] if cell is not None else []
        peers = [i for i in peers if i != idx]
        if peers:
            forecast = sum(outcomes[i] for i in peers) / len(peers)
        else:
            forecast = base_rate
        sq_sum += (forecast - y) ** 2
    ref_climate = sq_sum / len(outcomes)
    return round(ref_base, 4), round(ref_climate, 4)


def _loo_reference_briers(
    outcomes: list[float], cells: list[tuple[Any, Any] | None]
) -> tuple[float | None, float | None]:
    """O(n)-Variante von ``_reference_briers`` für die Bootstrap-Ziehung.

    Wertgleich (Leave-one-out über Zellsummen statt Peer-Listen), aber ohne
    quadratischen Term — pro Ziehung wird sie ``GATE_BOOTSTRAP_SAMPLES``-mal
    ausgewertet. Leere Eingabe → (None, None).
    """
    if not outcomes:
        return None, None
    n = len(outcomes)
    base_rate = sum(outcomes) / n
    ref_base = sum((base_rate - y) ** 2 for y in outcomes) / n
    cell_sum: dict[Any, float] = {}
    cell_count: dict[Any, int] = {}
    for y, cell in zip(outcomes, cells):
        if cell is None:
            continue
        cell_sum[cell] = cell_sum.get(cell, 0.0) + y
        cell_count[cell] = cell_count.get(cell, 0) + 1
    sq_sum = 0.0
    for y, cell in zip(outcomes, cells):
        count = cell_count.get(cell, 0) if cell is not None else 0
        if count > 1:
            forecast = (cell_sum[cell] - y) / (count - 1)
        else:
            forecast = base_rate
        sq_sum += (forecast - y) ** 2
    return round(ref_base, 4), round(sq_sum / n, 4)


def _block_bootstrap_skill_ci(
    blocks: list[list[dict[str, Any]]],
    samples: int = GATE_BOOTSTRAP_SAMPLES,
    seed: int = GATE_BOOTSTRAP_SEED,
) -> tuple[float | None, float | None]:
    """M5: gemeinsames Block-Bootstrap der Brier-*Differenz* zur Referenz.

    Punktvergleiche (Modell-KI-Obergrenze gegen Punkt-Referenz) mischen zwei
    Unsicherheitsquellen, die auf denselben Tagesblöcken sitzen. Hier wird
    die Differenz ``Brier(Modell) − min(Basisrate, LOO-Klimatologie)`` je
    Ziehung auf *denselben* gezogenen Zeilen neu gerechnet — Referenzen
    inbegriffen — und das 95-%-Intervall der Differenzen berichtet. Das Gate
    besteht erst, wenn die Obergrenze unter 0 liegt: Skill gegen beide
    naive Referenzen zugleich, nicht gegen deren Punktwerte.
    """
    if not blocks or samples <= 0:
        return None, None
    rng = random.Random(seed)
    diffs: list[float] = []
    for _ in range(samples):
        drawn: list[dict[str, Any]] = []
        for _ in range(len(blocks)):
            drawn.extend(blocks[rng.randrange(len(blocks))])
        if not drawn:
            continue
        model = sum(row["sq"] for row in drawn) / len(drawn)
        ref_base, ref_climate = _loo_reference_briers(
            [row["outcome"] for row in drawn], [row["cell"] for row in drawn]
        )
        refs = [value for value in (ref_base, ref_climate) if value is not None]
        if not refs:
            continue
        diffs.append(model - min(refs))
    if len(diffs) < max(10, samples // 10):
        return None, None
    diffs.sort()
    lo_idx = min(len(diffs) - 1, int(0.025 * len(diffs)))
    hi_idx = min(len(diffs) - 1, int(0.975 * len(diffs)))
    return round(diffs[lo_idx], 4), round(diffs[hi_idx], 4)


GATE_RELIABILITY_BIN_EDGES = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)


def _reliability_bins(
    rows: list[dict[str, Any]], edges=GATE_RELIABILITY_BIN_EDGES
) -> list[dict[str, Any]]:
    """M5: Reliability je Wahrscheinlichkeits-Bin (Diagnose, kein Gate).

    Die Steigung ist ein Globalmaß; sie kann lokale Fehlanpassungen über
    den relevanten Wahrscheinlichkeitsbereich mitteln. Die Bins zeigen je
    Abschnitt Trefferquote gegen mittleres P mit 95-%-Binomialband
    (Normalapproximation) — sichtbar im Payload, damit „kalibriert“ nicht
    nur global, sondern über den Bereich nachvollziehbar ist.
    """
    out: list[dict[str, Any]] = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        selected = [
            row
            for row in rows
            if (lo <= row["p"] < hi) or (hi == edges[-1] and row["p"] >= hi)
        ]
        n = len(selected)
        if n == 0:
            continue
        p_mean = sum(row["p"] for row in selected) / n
        rate = sum(row["outcome"] for row in selected) / n
        half = 1.96 * math.sqrt(max(rate * (1.0 - rate), 0.0) / n)
        out.append(
            {
                "lo": round(lo, 2),
                "hi": round(hi, 2),
                "n": n,
                "p": round(p_mean, 4),
                "rate": round(rate, 4),
                "band": [
                    round(max(0.0, rate - half), 4),
                    round(min(1.0, rate + half), 4),
                ],
            }
        )
    return out


def compute_advice_stats(
    store: dict[str, Any], now: dt.datetime | None = None, window_days: int = 30
) -> dict[str, Any]:
    """Berechnet Advice-Ledger-KPIs (Brier, Trefferquoten, Reliability).

    'void'-Settlements (nicht bewertbar, z. B. no_advice oder Station
    geschlossen) zählen weder zu n noch zu Brier.

    Die angezeigten Kennzahlen (``n``, Trefferquoten, ``brier_30d``,
    Reliability) sind ein echtes 30-Tage-Fenster (Prüfstand §3.6) — vorher
    waren es Allzeit-Zahlen unter einem „30d"-Namen. Das M7-Gate selbst ist
    ein Allzeit-Zähl-Gate (§0.4, §13) und rechnet über dieselbe
    Grundgesamtheit wie der Brier (``n_brier_all``), statt Gesamt-n gegen
    die P-Teilmenge zu vergleichen.

    O5: Die P-Schätzung je Snapshot hat eine Quelle (``p_source``) —
    ``brier_30d``/``brier_all`` bleiben der gemischte Score über alle Zeilen
    mit gespeicherter Schätzung (Fortschreibung, als gemischt benannt),
    ``brier_by_source``/``brier_all_by_source`` weisen ihn je Quelle getrennt
    aus, und das Gate (``gate_n``/``gate_brier``) rechnet ausschließlich
    über Zeilen mit ``p_source == "verteilung"``: Die Basisrate ist per
    Konstruktion selbstkalibriert und darf das Gate nicht öffnen.

    O6: Das Gate vergleicht keinen Punkt-Brier gegen 0,25 mehr. Es besteht
    erst, wenn die Obergrenze des Block-Bootstrap-Intervalls (Tagesblöcke,
    95 %) unter beiden naiven Referenzen — konstanter Basisrate und
    Leave-one-out-Klimatologie je (Stunde, Wochentag) — auf derselben
    Grundgesamtheit liegt (``gate_brier_ci``, ``gate_ref_base``,
    ``gate_ref_climate``, ``n_day_blocks``). Unter 10 Tagesblöcken bleibt
    das Intervall None („nicht messbar“).
    """
    now = now or dt.datetime.now(UTC)
    cutoff = now - dt.timedelta(days=window_days)

    episodes = store.get("episodes", [])
    snapshots_by_id = {s["id"]: s for ep in episodes for s in ep.get("snapshots", [])}

    def in_window(settlement: dict[str, Any]) -> bool:
        stamp = _parse_ts(settlement.get("settled_at"))
        return stamp is None or stamp >= cutoff

    settlements_all = [
        s
        for s in store.get("settlements", [])
        if s.get("outcome") in ("win", "loss", "tie")
    ]
    settlements = [s for s in settlements_all if in_window(s)]
    n_void = sum(
        1
        for s in store.get("settlements", [])
        if s.get("outcome") not in ("win", "loss", "tie") and in_window(s)
    )
    # Offene Empfehlungen: ausgespielt (wait/refuel_now/refuel_elsewhere),
    # aber noch ohne Settlement — Fenster läuft noch oder Lag läuft noch.
    # Sie zählen erst nach der Abrechnung zu n (sonst würde „n=4 am 5. Tag“
    # wie ein verlorener Tag aussehen, obwohl die 5. Empfehlung noch läuft).
    settled_ids = {s.get("snapshot_id") for s in store.get("settlements", [])}
    snapshots_total = 0
    n_pending = 0
    for ep in episodes:
        for snap in ep.get("snapshots", []) or []:
            if snap.get("action") not in ("wait", "refuel_now", "refuel_elsewhere"):
                continue
            snapshots_total += 1
            if snap.get("id") not in settled_ids:
                n_pending += 1
    # O38: Fensterbilanz — genutzte vs. verstrichene Fenster je Woche/Monat.
    # Nur Folgen mit mindestens einer echten Empfehlung sind „Fenster“ (reine
    # no_advice-Folgen hatten keines, das hätte verstreichen können).
    # „Genutzt“ = resolved (ein Beleg hat die Folge geschlossen), „verstrichen“
    # = expired (72 h ohne Fill oder dismiss) — beides datiert nach closed_at
    # (Fallback opened_at). Offene Folgen laufen noch und zählen in keine der
    # beiden Seiten. Das Settlement ist davon unabhängig: Auch verstrichene
    # Fenster werden abgerechnet (Konzept §5.4) — die Bilanz ist die
    # Gegenprobe zur Trefferquote, nicht ihre Zerlegung.
    cutoff_7d = now - dt.timedelta(days=7)
    episodes_used_7d = episodes_expired_7d = 0
    episodes_used_30d = episodes_expired_30d = 0
    episodes_open = 0
    for ep in episodes:
        if not any(
            s.get("action") in ("wait", "refuel_now", "refuel_elsewhere")
            for s in ep.get("snapshots", []) or []
        ):
            continue
        status = ep.get("status")
        if status in ("open", "waiting", "due"):
            episodes_open += 1
            continue
        if status not in ("resolved", "expired"):
            continue
        stamp = _parse_ts(ep.get("closed_at")) or _parse_ts(ep.get("opened_at"))
        if stamp is None:
            continue
        if stamp >= cutoff:
            if status == "resolved":
                episodes_used_30d += 1
            else:
                episodes_expired_30d += 1
        if stamp >= cutoff_7d:
            if status == "resolved":
                episodes_used_7d += 1
            else:
                episodes_expired_7d += 1
    n_void_all = sum(
        1
        for s in store.get("settlements", [])
        if s.get("outcome") not in ("win", "loss", "tie")
    )

    n = len(settlements)
    wins = sum(1 for s in settlements if s.get("outcome") == "win")
    losses = sum(1 for s in settlements if s.get("outcome") == "loss")
    ties = sum(1 for s in settlements if s.get("outcome") == "tie")

    wait_n, wait_hits = 0, 0.0
    now_n, now_hits = 0, 0.0
    elsewhere_n, elsewhere_hits = 0, 0.0

    # Brier-Score Berechnung: BS = 1/N * sum((p_pred - actual)^2).
    # O7: actual = 1 für win, 0,5 für tie, 0 für loss. O5: zusätzlich je P-Quelle
    # getrennt (``p_source``) plus Zeilenzähler je Quelle — der gemischte
    # Score bleibt als Fortschreibung daneben stehen.
    brier_sq_errors = []
    brier_by_source: dict[str, list[float]] = {key: [] for key in P_SOURCES}
    brier_by_calibration: dict[str, list[float]] = {
        key: [] for key in FORECAST_CALIBRATION_STATES
    }
    source_counts: dict[str, int] = {key: 0 for key in P_SOURCES}

    # 10 Bins für Reliability Diagramm (0.0–0.1, 0.1–0.2, ..., 0.9–1.0)
    bins = [
        {
            "bin": i,
            "min_p": i * 0.1,
            "max_p": (i + 1) * 0.1,
            "count": 0,
            "p_sum": 0.0,
            "hits": 0,
        }
        for i in range(10)
    ]

    for s in settlements:
        snap = snapshots_by_id.get(s.get("snapshot_id"))
        action = snap.get("action") if snap else None
        p_correct = snap.get("p_correct") if snap else None
        outcome = s.get("outcome")
        source_counts[snapshot_p_source(snap)] += 1

        is_win = outcome_credit(outcome)

        if action == "wait":
            wait_n += 1
            wait_hits += is_win
        elif action == "refuel_now":
            now_n += 1
            now_hits += is_win
        elif action == "refuel_elsewhere":
            elsewhere_n += 1
            elsewhere_hits += is_win

        # Brier nur über Snapshots mit gespeicherter interner P-Schätzung.
        # Snapshots ohne p (Altdaten) würden mit einem erfundenen Default den
        # Score verzerren und fallen daher aus Zähler UND Nenner.
        if p_correct is not None and math.isfinite(p_correct):
            p_val = min(1.0, max(0.0, float(p_correct)))
            sq_error = (p_val - is_win) ** 2
            brier_sq_errors.append(sq_error)
            brier_by_source[snapshot_p_source(snap)].append(sq_error)
            brier_by_calibration[snapshot_calibration_state(snap)].append(sq_error)

            bin_idx = min(9, max(0, int(p_val * 10)))
            bins[bin_idx]["count"] += 1
            bins[bin_idx]["p_sum"] += p_val
            bins[bin_idx]["hits"] += is_win

    n_brier = len(brier_sq_errors)
    brier_30d = round(sum(brier_sq_errors) / n_brier, 4) if n_brier > 0 else None
    hit_rate = (
        round(sum(outcome_credit(s.get("outcome")) for s in settlements) / n, 3)
        if n > 0
        else None
    )
    hit_wait = round(wait_hits / wait_n, 3) if wait_n > 0 else None
    hit_now = round(now_hits / now_n, 3) if now_n > 0 else None
    hit_elsewhere = round(elsewhere_hits / elsewhere_n, 3) if elsewhere_n > 0 else None

    reliability = []
    for b in bins:
        count = b["count"]
        mean_p = (
            round(b["p_sum"] / count, 3)
            if count > 0
            else round((b["min_p"] + b["max_p"]) / 2, 3)
        )
        emp_hit = round(b["hits"] / count, 3) if count > 0 else None
        reliability.append(
            {
                "bin": b["bin"],
                "range": f"{int(b['min_p'] * 100)}–{int(b['max_p'] * 100)}%",
                "count": count,
                "mean_p": mean_p,
                "empirical_hit_rate": emp_hit,
            }
        )

    # Allzeit-Brier über dieselbe Grundgesamtheit wie das Zähl-Gate: nur
    # Settlements, deren Snapshot eine P-Schätzung trägt. O5: je Quelle
    # getrennt — das Gate steht auf der Verteilungs-Teilmenge allein.
    brier_all_sq: list[float] = []
    brier_all_by_source: dict[str, list[float]] = {key: [] for key in P_SOURCES}
    brier_all_by_calibration: dict[str, list[float]] = {
        key: [] for key in FORECAST_CALIBRATION_STATES
    }
    source_counts_all: dict[str, int] = {key: 0 for key in P_SOURCES}
    gate_rows: list[dict[str, Any]] = []
    for s in settlements_all:
        snap = snapshots_by_id.get(s.get("snapshot_id"))
        p_correct = snap.get("p_correct") if snap else None
        source = snapshot_p_source(snap)
        source_counts_all[source] += 1
        if p_correct is None or not math.isfinite(p_correct):
            continue
        is_win = outcome_credit(s.get("outcome"))
        p_val = min(1.0, max(0.0, float(p_correct)))
        sq_error = (p_val - is_win) ** 2
        brier_all_sq.append(sq_error)
        brier_all_by_source[source].append(sq_error)
        brier_all_by_calibration[snapshot_calibration_state(snap)].append(sq_error)
        # O6: Gate-Zeilen mit Block- und Zellenschlüssel für Intervall und
        # Referenzen — dieselbe Grundgesamtheit wie gate_sq (Verteilung).
        if source == "verteilung":
            day, hour, weekday = _emit_day_cell(snap)
            gate_rows.append(
                {
                    "day": day,
                    "cell": (hour, weekday) if hour is not None else None,
                    "outcome": is_win,
                    "p": p_val,
                    "sq": sq_error,
                }
            )
    n_brier_all = len(brier_all_sq)
    brier_all = round(sum(brier_all_sq) / n_brier_all, 4) if n_brier_all > 0 else None

    def _source_block(errors: dict[str, list[float]]) -> dict[str, dict[str, Any]]:
        return {
            key: {
                "brier": round(sum(values) / len(values), 4) if values else None,
                "n": len(values),
            }
            for key, values in errors.items()
        }

    # M7 Kalibrierungs-Gate (§0.4, §6): Allzeit-Zähl-Gate über die
    # Verteilungs-Teilmenge allein (O5) — die Basisrate ist per Konstruktion
    # selbstkalibriert und öffnet das Gate nicht. Die 90-Tage-Übergangsregel
    # (live_only_days) ist Datenhygiene und kein Nenner hier. O6: Kein
    # Punkt-Brier gegen 0,25 mehr — das Gate besteht erst, wenn die
    # Obergrenze des Block-Bootstrap-Intervalls unter beiden naiven
    # Referenzen (Basisrate, Klimatologie) liegt.
    n_all = len(settlements_all)
    gate_sq = brier_all_by_source["verteilung"]
    gate_n = len(gate_sq)
    gate_brier = round(sum(gate_sq) / gate_n, 4) if gate_n > 0 else None
    day_blocks: dict[Any, list[float]] = {}
    reliability_blocks: dict[Any, list[dict[str, float]]] = {}
    bias_blocks: dict[Any, list[float]] = {}
    skill_blocks: dict[Any, list[dict[str, Any]]] = {}
    for pos, row in enumerate(gate_rows):
        key = row["day"] if row["day"] is not None else f"unknown-{pos}"
        day_blocks.setdefault(key, []).append(row["sq"])
        reliability_blocks.setdefault(key, []).append(
            {"p": row["p"], "outcome": row["outcome"]}
        )
        # M5: Kalibrierung im Mittel — Vorzeichenfehler je Zeile; das
        # Block-Intervall muss 0 enthalten.
        bias_blocks.setdefault(key, []).append(row["outcome"] - row["p"])
        skill_blocks.setdefault(key, []).append(row)
    n_day_blocks = len(day_blocks)
    if n_day_blocks >= GATE_MIN_DAY_BLOCKS:
        gate_ci_lo, gate_ci_hi = _block_bootstrap_ci(list(day_blocks.values()))
        gate_slope_ci_lo, gate_slope_ci_hi = _block_bootstrap_reliability_ci(
            list(reliability_blocks.values())
        )
        gate_bias_ci_lo, gate_bias_ci_hi = _block_bootstrap_ci(
            list(bias_blocks.values())
        )
        gate_skill_ci_lo, gate_skill_ci_hi = _block_bootstrap_skill_ci(
            list(skill_blocks.values())
        )
    else:
        gate_ci_lo, gate_ci_hi = None, None
        gate_slope_ci_lo, gate_slope_ci_hi = None, None
        gate_bias_ci_lo, gate_bias_ci_hi = None, None
        gate_skill_ci_lo, gate_skill_ci_hi = None, None
    gate_slope = _reliability_slope(
        [{"p": row["p"], "outcome": row["outcome"]} for row in gate_rows]
    )
    gate_slope_ok = (
        gate_slope is not None
        and gate_slope_ci_lo is not None
        and gate_slope_ci_hi is not None
        and gate_slope_ci_lo <= GATE_RELIABILITY_SLOPE_TARGET <= gate_slope_ci_hi
        and abs(gate_slope - GATE_RELIABILITY_SLOPE_TARGET)
        < GATE_RELIABILITY_SLOPE_MAX_ABS_DEV
        and (gate_slope_ci_hi - gate_slope_ci_lo) < GATE_RELIABILITY_SLOPE_MAX_CI_WIDTH
    )
    # M5: Intercept-/Mittel-Nachweis neben der Steigung. Eine Steigung 1 mit
    # systematischem Versatz (+10 pp) war vorher „kalibriert“ — das Mittel
    # muss stimmen, nicht nur die Empfindlichkeit.
    gate_bias = (
        round(sum(row["outcome"] - row["p"] for row in gate_rows) / gate_n, 4)
        if gate_n > 0
        else None
    )
    gate_bias_ok = (
        gate_bias_ci_lo is not None
        and gate_bias_ci_hi is not None
        and gate_bias_ci_lo <= 0.0 <= gate_bias_ci_hi
    )
    gate_ref_base, gate_ref_climate = _reference_briers(
        [row["outcome"] for row in gate_rows],
        [row["cell"] for row in gate_rows],
    )
    binding_ref = min(gate_ref_base, gate_ref_climate) if gate_rows else None
    gate_skill_diff = (
        round(gate_brier - binding_ref, 4)
        if gate_brier is not None and binding_ref is not None
        else None
    )
    # M5: Skill-Differenz gemeinsam block-resampled (Referenzen je Ziehung
    # neu auf denselben Zeilen) statt Punkt-Referenz gegen KI-Obergrenze.
    gate_skill_ok = gate_skill_ci_hi is not None and gate_skill_ci_hi < 0
    # M5: Proper Scoring (Skill) und Kalibrierung (Steigung + Mittel) sind
    # getrennte Nachweise — alle drei müssen tragen, keiner ersetzt einen.
    calibrated = (
        gate_n >= M7_MIN_RECOMMENDATIONS
        and gate_skill_ok
        and gate_slope_ok
        and gate_bias_ok
    )
    if gate_n < M7_MIN_RECOMMENDATIONS and n_all < M7_MIN_RECOMMENDATIONS:
        gate_status = (
            f"Kalibrierung steht aus (n={gate_n} < {M7_MIN_RECOMMENDATIONS} "
            "Empfehlungen mit Verteilungs-P)"
        )
    elif gate_brier is None:
        # Zählstand reicht, aber keine Zeile trägt eine Verteilungs-P: Der
        # Score ist nicht messbar. „kalibriert" wäre erfunden (§0.4).
        gate_status = (
            f"Kalibrierung nicht messbar (n={n_all}, keine Verteilungs-P im Ledger)"
        )
    elif gate_n < M7_MIN_RECOMMENDATIONS:
        # Gesamt-n reicht, aber die Verteilungs-Teilmenge nicht — der Brier
        # wäre über eine andere Grundgesamtheit gemessen als der Zähler
        # (Prüfstand §3.6), und die Basisrate öffnet das Gate nicht (O5).
        gate_status = (
            f"Kalibrierung nicht messbar (n={n_all}, nur {gate_n} "
            "mit Verteilungs-P im Ledger)"
        )
    elif (
        gate_ci_hi is None
        or binding_ref is None
        or gate_slope_ci_hi is None
        or gate_bias_ci_hi is None
        or gate_skill_ci_hi is None
    ):
        # Zählstand reicht, aber zu wenige Tagesblöcke oder keine P-Streuung
        # für ein belastbares Intervall. Eine konstante Wahrscheinlichkeit
        # bekommt ausdrücklich keine erfundene Steigung 1,0.
        gate_status = (
            f"Kalibrierung nicht messbar (n={gate_n}, {n_day_blocks} Tagesblöcke; "
            "Brier- und Steigungsintervall brauchen Streuung und mindestens "
            f"{GATE_MIN_DAY_BLOCKS} Blöcke)"
        )
    elif not gate_skill_ok:
        gate_status = (
            f"Kalibrierung nicht erreicht (Brier-Differenz zur besseren "
            f"Referenz {_de(gate_skill_diff)} "
            f"[{_de(gate_skill_ci_lo)}–{_de(gate_skill_ci_hi)}] ≥ 0; "
            f"Basis {_de(gate_ref_base)} / Klima {_de(gate_ref_climate)}, "
            "Verteilungs-P)"
        )
    elif not gate_slope_ok:
        gate_status = (
            "Kalibrierung nicht erreicht (Reliability-Steigung "
            f"{_de(gate_slope)} [{_de(gate_slope_ci_lo)}–{_de(gate_slope_ci_hi)}] "
            f"enthält Referenz {_de(GATE_RELIABILITY_SLOPE_TARGET)} nicht "
            f"oder |slope-1|≥{GATE_RELIABILITY_SLOPE_MAX_ABS_DEV} "
            f"oder CI-Breite≥{GATE_RELIABILITY_SLOPE_MAX_CI_WIDTH})"
        )
    elif not gate_bias_ok:
        # M5: +10-pp-Versatz mit Steigung 1 und Brier-Skill ist keine
        # Kalibrierung — das Mittel-Intervall muss 0 enthalten.
        gate_status = (
            "Kalibrierung nicht erreicht (Kalibrierung im Mittel: Bias "
            f"mean(y)−mean(p) {_de(gate_bias)} "
            f"[{_de(gate_bias_ci_lo)}–{_de(gate_bias_ci_hi)}] enthält 0 nicht, "
            "Verteilungs-P)"
        )
    else:
        gate_status = (
            f"Kalibriert (n={gate_n}, Brier {_de(gate_brier)} "
            f"[{_de(gate_ci_lo)}–{_de(gate_ci_hi)}] < Basis {_de(gate_ref_base)} "
            f"/ Klima {_de(gate_ref_climate)}; Steigung {_de(gate_slope)} "
            f"[{_de(gate_slope_ci_lo)}–{_de(gate_slope_ci_hi)}] enthält "
            f"{_de(GATE_RELIABILITY_SLOPE_TARGET)}; Bias {_de(gate_bias)} "
            f"[{_de(gate_bias_ci_lo)}–{_de(gate_bias_ci_hi)}] enthält 0, "
            "Verteilungs-P)"
        )

    return {
        "n": n,
        "n_void": n_void,
        "n_void_all": n_void_all,
        "n_brier": n_brier,
        "n_all": n_all,
        "n_brier_all": n_brier_all,
        "brier_all": brier_all,
        # O5: Brier je P-Quelle (30-Tage-Fenster und Allzeit) plus
        # Zeilenzähler je Quelle — und die Gate-Grundgesamtheit
        # (Verteilungs-P allein) als eigene Zahlen.
        "brier_by_source": _source_block(brier_by_source),
        "brier_all_by_source": _source_block(brier_all_by_source),
        # B2 A/B: Vor/nach PIT-Kurve getrennt; ``unknown`` (Altbestand) ist
        # sichtbar und darf nicht still in eine Seite der Messung fallen.
        "brier_by_calibration": _source_block(brier_by_calibration),
        "brier_all_by_calibration": _source_block(brier_all_by_calibration),
        "p_source_counts": dict(source_counts),
        "p_source_counts_all": dict(source_counts_all),
        "gate_n": gate_n,
        "gate_brier": gate_brier,
        # O6: Intervall (Block-Bootstrap über Tagesblöcke, 95 %), beide naive
        # Referenzen auf derselben Grundgesamtheit und die Fenstergröße —
        # das Gate besteht erst, wenn die Obergrenze unter beiden liegt.
        "gate_brier_ci": ([gate_ci_lo, gate_ci_hi] if gate_ci_hi is not None else None),
        "gate_ref_base": gate_ref_base,
        "gate_ref_climate": gate_ref_climate,
        # B2: Zweiter unabhängiger M7-Nachweis — das KI muss die ideale
        # Reliability-Steigung 1 einschließen, sonst öffnet ein guter Brier
        # allein das Produkt-Gate nicht.
        "gate_reliability_slope": round(gate_slope, 4)
        if gate_slope is not None
        else None,
        "gate_reliability_slope_ci": (
            [gate_slope_ci_lo, gate_slope_ci_hi]
            if gate_slope_ci_hi is not None
            else None
        ),
        "gate_reliability_target": GATE_RELIABILITY_SLOPE_TARGET,
        "gate_reliability_ok": gate_slope_ok,
        # M5: Kalibrierung im Mittel (Intercept) — Block-Bootstrap-Intervall
        # des Vorzeichenfehlers mean(y)−mean(p); das Gate besteht nur, wenn
        # das Intervall 0 enthält. Steigung 1 allein reicht nicht (+10 pp).
        "gate_bias": gate_bias,
        "gate_bias_ci": (
            [gate_bias_ci_lo, gate_bias_ci_hi] if gate_bias_ci_hi is not None else None
        ),
        "gate_bias_ok": gate_bias_ok,
        # M5: Brier-Differenz zur besseren naiven Referenz, je Ziehung
        # gemeinsam block-resampled (Referenzen auf denselben Zeilen neu
        # gerechnet). Obergrenze < 0 = Skill-Nachweis.
        "gate_skill_diff": gate_skill_diff,
        "gate_skill_diff_ci": (
            [gate_skill_ci_lo, gate_skill_ci_hi]
            if gate_skill_ci_hi is not None
            else None
        ),
        "gate_skill_ok": gate_skill_ok,
        # M5: Reliability über den Wahrscheinlichkeitsbereich (Diagnose mit
        # Binomialbändern) — die globale Steigung mittelt lokale Mängel.
        "gate_reliability_bins": _reliability_bins(gate_rows),
        "n_day_blocks": n_day_blocks,
        "min_day_blocks": GATE_MIN_DAY_BLOCKS,
        "block_days": GATE_BLOCK_DAYS,
        "bootstrap_samples": GATE_BOOTSTRAP_SAMPLES,
        # Zähl-Ehrlichkeit: ausgespielt vs. abgeschlossen vs. noch offen.
        # O6: ``brier_threshold`` (0,25) ist kein Gate-Kriterium mehr, sondern
        # das dokumentierte Münz-Niveau zum Einordnen — das Gate vergleicht
        # die Intervall-Obergrenze gegen Basis- und Klima-Referenz.
        "snapshots_total": snapshots_total,
        "n_pending": n_pending,
        # O38: Fensterbilanz — genutzte (resolved) vs. verstrichene (expired)
        # Fenster je Woche/Monat plus laufende Folgen (in keiner der Seiten).
        "episodes_used_7d": episodes_used_7d,
        "episodes_expired_7d": episodes_expired_7d,
        "episodes_used_30d": episodes_used_30d,
        "episodes_expired_30d": episodes_expired_30d,
        "episodes_open": episodes_open,
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "hit_rate": hit_rate,
        "hit_wait": hit_wait,
        "hit_now": hit_now,
        "hit_elsewhere": hit_elsewhere,
        "wait_n": wait_n,
        "wait_hits": wait_hits,
        "now_n": now_n,
        "now_hits": now_hits,
        "elsewhere_n": elsewhere_n,
        "elsewhere_hits": elsewhere_hits,
        "brier_30d": brier_30d,
        "calibrated": calibrated,
        "gate_status": gate_status,
        # Schwellen des Zähl-Gates mitliefern: Die GUI zeigt damit „n von 100
        # Empfehlungen" aus demselben Wert, an dem auch hier gerechnet wird —
        # und muss nicht die 90-Tage-Übergangsregel als Nenner missbrauchen.
        "min_recommendations": M7_MIN_RECOMMENDATIONS,
        "brier_threshold": M7_BRIER_THRESHOLD,
        "reliability": reliability,
    }


def compute_wallet_stats(
    store: dict[str, Any], now: dt.datetime | None = None, window_days: int = 30
) -> dict[str, Any]:
    """Berechnet Wallet-Ledger-KPIs (Fills, Ersparnis, Compliance, w(h)-Profil).

    ``n_fills``/Compliance/``saved_eur`` sind ein echtes 30-Tage-Fenster
    (Prüfstand §3.6: die Felder hießen vorher ``…_30d``, zählten aber
    Allzeit). Das w(h)-Profil nutzt weiterhin alle Füllungen — es ist ein
    Langzeitprofil, kein 30-Tage-Wert.
    """
    now = now or dt.datetime.now(UTC)
    cutoff = now - dt.timedelta(days=window_days)

    # A3: stornierte Belege (voided) zählen nicht in Bilanz und Profil.
    fills_active = [f for f in store.get("fills", []) if not f.get("voided")]

    def in_window(fill: dict[str, Any]) -> bool:
        stamp = _parse_ts(fill.get("tanked_at"))
        return stamp is None or stamp >= cutoff

    fills = [f for f in fills_active if in_window(f)]
    n_fills = len(fills)

    followed = sum(1 for f in fills if f.get("compliance") == "followed")
    partial = sum(1 for f in fills if f.get("compliance") == "partial")
    ignored = sum(1 for f in fills if f.get("compliance") == "ignored")
    unrelated = sum(1 for f in fills if f.get("compliance") == "unrelated")
    # O8 reports strict receipt timing separately from slack. These values do
    # not alter model settlement; they only make wallet compliance auditable.
    settled_in_window = sum(1 for f in fills if f.get("settled") == "im_fenster")
    settled_grace = sum(1 for f in fills if f.get("settled") == "kulanz")

    saved_eur = round(sum(f.get("saved_vs_always_now_eur", 0.0) for f in fills), 2)
    # O30: Wer 3 km Umweg fährt, zahlt Sprit und Zeit — die Entscheidung
    # rechnete netto, die Bilanz wies brutto aus. Beide Zeilen, dieselbe
    # Formel (``net_economics``), dieselben Parameter wie im Profil.
    detour = _detour_totals(fills)

    # O17: Belege mit Prognosepreis (Altbestand, nur via Migration 4 → 5)
    # tragen keinen gezahlten Preis — die verifizierte Ersparnis rechnet
    # ohne sie und ist die zweite, ausdrücklich so benannte Spalte.
    verified_fills = [f for f in fills if f.get("price_source") != "prognose"]
    n_prognosis_price = len(fills) - len(verified_fills)
    saved_verified_eur = round(
        sum(f.get("saved_vs_always_now_eur", 0.0) for f in verified_fills), 2
    )

    # O2/O3: One weekday-aware receipt profile shared with engine selection.
    # A first receipt has a small, visible influence through the eight-fill
    # prior; no 7/8 activation cliff remains.
    time_profile = weekday_profile(fills_active, prior_strength=WH_MIN_FILLS)
    wh_weekday = time_profile["weights"]
    wh_hours = hourly_profile(wh_weekday)
    wh_n = time_profile["n_fills"]

    # O1: Herkunft der Tankuhrzeiten. Ein Beleg ohne Zeitstempel zählt weiter
    # mit der 12-Uhr-Projektion — aber gezählt und benannt, statt als Messung
    # durchzugehen. Altbestand ohne Kennzeichnung (vor Schema 4) gilt als
    # Default: Gebucht wurde dort immer 12 Uhr, egal wann getankt wurde.
    clock_sources = {key: 0 for key in CLOCK_HOUR_SOURCES}
    for f in fills_active:
        key = f.get("clock_hour_source")
        clock_sources[key if key in clock_sources else "default"] += 1

    return {
        "n_fills": n_fills,
        "followed": followed,
        "partial": partial,
        "ignored": ignored,
        "unrelated": unrelated,
        "settled_in_window": settled_in_window,
        "settled_grace": settled_grace,
        "saved_eur": saved_eur,
        # O30: dieselbe Ersparnis nach den bekannten Umwegkosten.
        "saved_net_eur": round(saved_eur - detour["detour_cost_eur"], 2),
        **detour,
        # O17: Ersparnis ohne Prognosepreis-Belege plus deren Anzahl.
        "saved_verified_eur": saved_verified_eur,
        "n_prognosis_price": n_prognosis_price,
        "wh_hours": wh_hours,
        # A9: Wieviel hinter dem Profil steckt — die GUI sagt damit, ab wann
        # die persönliche Fensterreihenfolge gilt (Konzept §5.5 Schicht C).
        "wh_n": wh_n,
        "wh_personalized": time_profile["source"] == "shrunk_receipts",
        "wh_min_fills": WH_MIN_FILLS,
        "wh_weekday": wh_weekday,
        "wh_profile_source": time_profile["source"],
        "wh_prior_strength": time_profile["prior_strength"],
        # O1: Worauf das Histogramm steht — Belege mit gemessener/rekonstruierter
        # Tankzeit und Belege mit der erfundenen Default-Stunde.
        "wh_clock_sources": clock_sources,
        "wh_measured_n": (
            clock_sources["beleg"]
            + clock_sources["server"]
            + clock_sources["abgeleitet"]
        ),
        "wh_default_n": clock_sources["default"],
        "last_fill": fills_active[0] if fills_active else None,
    }


def fill_detour_cost_eur(fill: dict[str, Any]) -> tuple[float, str | None]:
    """O30: Umwegkosten eines Belegs — dieselbe Formel wie die Entscheidung.

    Rückgabe ``(kosten_eur, quelle)``. ``quelle`` ist ``actual_receipt``
    (vom Nutzer eingegebene Kilometer), ``estimated_snapshot`` (die zur
    Empfehlung gehörende Schätzung, sichtbar als Schätzung) oder ``None``:
    Kein bekannter Umweg kostet nichts — erfundene Kilometer gibt es nicht.
    """
    provenance = fill.get("elsewhere_net_provenance")
    if not isinstance(provenance, dict):
        return 0.0, None
    km = _to_float(provenance.get("detour_km_total"))
    consumption = _to_float(provenance.get("consumption_l_100km"))
    speed = _to_float(provenance.get("speed_kmh"))
    time_value = _to_float(provenance.get("time_value_eur_h"))
    reference = _to_float(provenance.get("reference_price"))
    price_paid = _to_float(fill.get("price_paid"))
    liters = _to_float(fill.get("liters"))
    values = (km, consumption, speed, time_value, reference, price_paid, liters)
    if any(value is None for value in values):
        return 0.0, None
    economy = net_economics(
        float(reference),
        float(price_paid),
        float(liters),
        float(km),
        float(consumption),
        float(speed),
        float(time_value),
    )
    source = str(provenance.get("distance_source") or "estimated_snapshot")
    return float(economy["detour_cost_eur"]), source


def _detour_totals(fills: list[dict[str, Any]]) -> dict[str, Any]:
    """O30: Umwegkosten einer Beleggruppe, aufgeschlüsselt nach Herkunft."""
    total = 0.0
    known = 0
    estimated = 0
    for fill in fills:
        cost, source = fill_detour_cost_eur(fill)
        if source is None:
            continue
        total += cost
        known += 1
        if source == "estimated_snapshot":
            estimated += 1
    return {
        "detour_cost_eur": round(total, 2),
        "n_detour_fills": known,
        "n_detour_estimated": estimated,
    }


def _balance_row(key: str, fills: list[dict[str, Any]]) -> dict[str, Any]:
    """Eine Monats- oder Jahreszeile der Bilanz aus den zugehörigen Fills."""
    liters = sum(float(f.get("liters") or 0.0) for f in fills)
    total_eur = sum(
        float(f.get("liters") or 0.0) * float(f.get("price_paid") or 0.0) for f in fills
    )
    saved_eur = sum(float(f.get("saved_vs_always_now_eur") or 0.0) for f in fills)
    # „Immer sofort getankt“-Baseline: pro Beleg Referenzpreis × Liter —
    # rechnerisch total_eur + saved_eur (deshalb darf saved_eur auch negativ
    # sein: wer teurer als der Referenzpreis tankt, hat gegen die Baseline
    # verloren). Belege ohne saved-Feld (Altbestand) tragen 0 — kein Reim.
    baseline_eur = total_eur + saved_eur
    # O17: zweite Spalte ohne Prognosepreis-Belege (Altbestand, kein
    # gezahlter Preis) plus deren Anzahl — je Zeile, nicht nur overall.
    verified = [f for f in fills if f.get("price_source") != "prognose"]
    saved_verified_eur = sum(
        float(f.get("saved_vs_always_now_eur") or 0.0) for f in verified
    )
    # O30: Die Bilanz entschied netto (Umwegkosten), wies aber brutto aus.
    # Beide Zeilen stehen jetzt da, mit derselben Formel wie ``p_lohnt``.
    detour = _detour_totals(fills)
    return {
        "key": key,
        "fills": len(fills),
        "liters": round(liters, 1),
        "total_eur": round(total_eur, 2),
        "avg_eur_per_fill": round(total_eur / len(fills), 2) if fills else None,
        "avg_eur_per_liter": round(total_eur / liters, 3) if liters > 0 else None,
        "saved_eur": round(saved_eur, 2),
        "saved_verified_eur": round(saved_verified_eur, 2),
        "n_prognosis_price": len(fills) - len(verified),
        # O30: netto = brutto − bekannte Umwegkosten (Sprit + Zeitwert).
        "saved_net_eur": round(saved_eur - detour["detour_cost_eur"], 2),
        **detour,
        "baseline_eur": round(baseline_eur, 2),
    }


def compute_wallet_balance(
    store: dict[str, Any], now: dt.datetime | None = None
) -> dict[str, Any]:
    """A4: Monats-/Jahresbilanz des Wallet-Ledgers (Konzept §12).

    „Wallet-Ledger im Alltag, Jahresbilanz in der Werkstatt“: Gruppiert die
    aktiven (nicht stornierten) Belege je Kalendermonat und -jahr in
    Europe/Berlin (die App zeigt Uhrzeiten lokal, die Bilanz folgt dem
    Kalender des Nutzers — nicht UTC).

    Felder je Zeile: Füllungen, Liter, € gesamt, Ø €/Tankung, Ø €/l,
    Ersparnis und die „immer sofort getankt“-Baseline. Belege ohne
    interpretierbaren ``tanked_at`` fließen in ``overall`` ein, aber in keine
    Monats-/Jahreszeile — die Differenz wird als ``n_without_date`` genannt,
    nicht still verschwiegen.
    """
    now = now or dt.datetime.now(UTC)
    months: dict[str, list[dict[str, Any]]] = {}
    years: dict[str, list[dict[str, Any]]] = {}
    n_without_date = 0

    fills_active = [f for f in store.get("fills", []) if not f.get("voided")]
    n_total = len(fills_active)
    for fill in fills_active:
        stamp = _parse_ts(fill.get("tanked_at"))
        if stamp is None:
            n_without_date += 1
            continue
        local = stamp.astimezone(BERLIN_TZ)
        months.setdefault(local.strftime("%Y-%m"), []).append(fill)
        years.setdefault(local.strftime("%Y"), []).append(fill)

    month_rows = [
        _balance_row(key, group) for key, group in sorted(months.items(), reverse=True)
    ]
    year_rows = [
        _balance_row(key, group) for key, group in sorted(years.items(), reverse=True)
    ]
    overall = _balance_row("overall", fills_active)
    overall.pop("key", None)
    overall["n_without_date"] = n_without_date
    baseline = overall.get("baseline_eur") or 0.0
    overall["saved_pct"] = (
        round(100.0 * overall["saved_eur"] / baseline, 1) if baseline > 0 else None
    )

    return {
        "generated_at": now.isoformat(),
        "n_fills_total": n_total,
        "months": month_rows,
        "years": year_rows,
        "overall": overall,
    }
