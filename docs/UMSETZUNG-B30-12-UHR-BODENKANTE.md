# UMSETZUNG-B30 — 12-Uhr-Bodenkante für Beobachtung und Kalibrierung

> Stand: 18.09.2026 · App-Version **0.50.1** → Ziel **0.51.0** ·
> Auftrag: [TODO.md](../TODO.md) **B30**, Befund
> [BEFUND-12-UHR-REGEL.md](BEFUND-12-UHR-REGEL.md) §4 („Schritt 3").
> Dieses Dokument ist die Arbeitsunterlage **vor** dem Code: Was gebaut wird,
> was bewusst nicht, und woran die Abnahme hängt. Nach dem Merge in
> [archiv/](archiv/README.md) auslagern.

## Inhaltsverzeichnis

- [0 · Nachgerechnet: Was der Befund übersieht](#0--nachgerechnet-was-der-befund-übersieht)
- [1 · Ziel und Leitplanken](#1--ziel-und-leitplanken)
- [2 · Paket 1 — Bodenkante der Beobachtungs-Panels](#2--paket-1--bodenkante-der-beobachtungs-panels)
- [3 · Paket 2 — Kalibrierung ab Gesetzesdatum](#3--paket-2--kalibrierung-ab-gesetzesdatum)
- [4 · Messung — wie viel Vor-Gesetz-Material nachzieht](#4--messung--wie-viel-vor-gesetz-material-nachzieht)
- [5 · Tests und Abnahme](#5--tests-und-abnahme)
- [6 · Was offen bleibt und warum](#6--was-offen-bleibt-und-warum)

## 0 · Nachgerechnet: Was der Befund übersieht

Der Befund-Report §4 nennt als „Null-Pfad ohne Code": *„Das 42-Tage-Fenster
läuft sich in ~6 Wochen von selbst vollständig in die Nach-Gesetz-Ära."*
Nachgerechnet gegen den Stand des Reports (18.09.2026) ist das überholt:

| Fenster | Quelle | Start am 18.09.2026 | Vor-Gesetz-Material? |
|---|---|---|---|
| Modell-Training 42 Tage | `engine/config.py: train_days` | 07.08.2026 | nein |
| Selektion/δ̂ 120 Tage | `app/config.py: model_days` | 21.05.2026 | nein |
| Heatmap 4/6/12 Wochen | `web/src/data.ts: HEATMAP_WEEKS` | 26.06.2026 (max.) | nein |

Das Gesetz gilt seit dem **01.04.2026** — 170 Tage vor dem Stand des Reports.
Das 42-Tage-Fenster ist seit dem **13.05.2026** vollständig nachgesetzlich;
die „~6 Wochen" waren zu diesem Zeitpunkt seit vier Monaten abgelaufen.

**Folgerung für diese Umsetzung:** Die Live-Panels zeigen heute kein
Vor-Gesetz-Muster mehr — die Bodenkante repariert keine aktuell falsche
Anzeige. Sie ist eine **Garantie** für die drei Fälle, in denen die Mischung
zurückkommt:

1. **Das Gesetz ändert sich** (befristet, §5 Zeile 4 des Befunds): Sobald
   `price_law_local` auf ein neues Datum rückt, mischt jedes rollierende
   Fenster wieder zwei Rechtslagen — bis es sich erneut herausgerollt hat.
2. **Archiv-Nachzug** (`app/gapfill.py`, `app/history.py`): Lücken werden aus
   den Tankerkönig-Tagesdateien gefüllt; liegt ein Archivtag vor dem
   Regimewechsel, zieht er das alte Muster ins Training.
3. **Offline-Werkzeuge ohne Fenster:** `analysis/station_selection.py` und
   `engine/station_comparison.py` werten den gesamten übergebenen Bestand aus.
   Der Anhang des Befund-Reports füttert sie selbst mit
   `ingest_history.py --since 2026-03-01` — also genau mit Vor-Gesetz-Daten.

Der Befund-Report wird deshalb korrigiert (§4), nicht stillschweigend
umgesetzt, als stünde die Behauptung noch.

## 1 · Ziel und Leitplanken

**Ziel (B30-DoD):** Kein Panel behauptet das Abend-Muster, während
Nach-Gesetz-Daten das Gegenteil sagen; die Kalibrierung lernt nur aus
Nach-Gesetz-Daten; das Gesetz bleibt **Konfiguration statt Logik**.

Leitplanken:

- **Eine Quelle.** Der Zeitpunkt steht weiter ausschließlich in
  `engine/config.py: price_law_local`. Die App-Seite bekommt das Feld über
  `Settings`/`TANKAPP_PRICE_LAW_LOCAL` in dieselbe Engine-Konfiguration
  durchgereicht — dasselbe Muster wie `decision_hour` (O36), kein zweites
  Literal mit eigenem Leben.
- **Kein pandas im Live-Pfad.** `app/heatmap.py` bleibt
  Standardbibliothek; die Umrechnung lokaler Zeitpunkt → UTC-Instanz lebt in
  einem eigenen kleinen Modul.
- **Ehrlich zählen, nicht still werfen.** Jeder gefilterte Punkt wird im
  Payload gezählt (`points_before_law`) und in der GUI benannt. Eine Zahl,
  die verschwindet, ohne dass die Anzeige es sagt, ist dieselbe
  Unehrlichkeit in die andere Richtung.
- **Gegenmessung bleibt möglich.** `TANKAPP_LAW_FLOOR=0` schaltet die Kante
  ab und stellt den Mischbestand wieder her — sonst ist der Nachweis „die
  Kante ändert heute nichts" nicht führbar.
- **Kein Hardcode des Gesetzes.** Weder „günstig 20–22 Uhr" noch
  „12-Uhr-Schritt" wandert als Konstante in Anzeige oder Logik.

## 2 · Paket 1 — Bodenkante der Beobachtungs-Panels

| Baustein | Änderung |
|---|---|
| `app/law.py` (neu) | `law_floor(settings)` → UTC-Instanz oder `None`; `law_floor_enabled(settings)`; Klartext `law_floor_label()`. Nur Standardbibliothek (`zoneinfo`, `datetime`). |
| `app/config.py` | `Settings.price_law_local` + `Settings.law_floor` aus `TANKAPP_PRICE_LAW_LOCAL` / `TANKAPP_LAW_FLOOR`; `engine_config()` reicht `price_law_local` durch. |
| `app/heatmap.py` | `build_heatmap(..., law_floor=None)`: Punkte vor der Kante zählen und verwerfen; Ergebnis trägt `law_floor` + `points_before_law`. |
| `app/data.py::heatmap` | Kante aus den Settings einsetzen, beide Felder in den Payload. |
| `engine/selection.py` | `SelectionConfig.law_floor`; `analyse_city_light` schneidet die Matrix **vor** δ̂/AV/`best_hour`; Stadt- und Fuel-Eintrag nennen `law_floor`, `points_before_law`, `days_before_law`. |
| `app/selection.py`, `app/refresh.py` | Kante über `SelectionConfig.from_engine_config` — kein zweiter Pfad. |
| `web/src/data.ts` | `heatmapLawFloorNote()` + `selectionLawFloorNote()`: „Beobachtungen ab …" nach [MICROCOPY.md](MICROCOPY.md). |
| `analysis/station_selection.py`, `engine/station_comparison.py` | Bodenkante + `--ignore-law-floor` für bewusste Vor-/Nach-Gesetz-Kontraste. |

**Warum die Selektion als Ganzes geschnitten wird** (nicht nur `best_hour`):
δ̂, AV-Score und billigste Stunde lesen dieselbe Matrix. Zwei Fenster in
einem Artefakt wären zwei Wahrheiten über denselben Bestand — genau der
Fehler, den O36 beseitigt hat.

## 3 · Paket 2 — Kalibrierung ab Gesetzesdatum

`engine/models.py::fit` klemmt den Trainingsbeginn auf die Kante:

```text
start = max(calendar_before(origin, train_days), law_since_utc(cfg))
```

Das Fit-Artefakt nennt danach `training_start`, `law_floor` und
`pre_law_points_excluded`, damit in der Werkstatt sichtbar ist, ob die Kante
gegriffen hat. Reicht der Nach-Gesetz-Bestand nicht für
`min_train_days`, **scheitert der Fit mit Grund** — statt still den alten
Tagesrhythmus mitzulernen.

Die drei bestehenden Gesetzesebenen (Mittags-Schritt im Strukturmodell,
PAVA-Projektion je Segment, `law_rise_outside_noon` als Datenqualitäts-Zähler,
siehe [ENGINE.md](ENGINE.md#12-uhr-regel-preiserhöhungen-nur-um-1200-uhr))
bleiben unverändert — die Kante ist eine vierte, vorgelagerte Ebene.

## 4 · Messung — wie viel Vor-Gesetz-Material nachzieht

B30 verlangt, vor dem Schnitt zu messen, wie viel vorgesetzliches Muster die
Archiv-Füllung dauerhaft nachzieht. `app/refresh.py` meldet deshalb je
Kraftstoff im Modell-Artefakt:

| Feld | Bedeutung |
|---|---|
| `law_floor` | wirksame UTC-Instanz der Kante |
| `points_total` | Beobachtungen im Trainingsbestand |
| `points_before_law` | davon vor der Kante |
| `gapfill_points_before_law` | davon aus der Archiv-Lückenfüllung |

Solange `points_before_law` null ist, ist die Kante eine Garantie ohne
Wirkung — und das steht dann da, statt behauptet zu werden.

## 5 · Tests und Abnahme

- `tests/test_b30_law_floor.py`: Kanten-Umrechnung (inkl. DST-Kante und
  ungültigem Wert), Heatmap-Filter + Zähler, Selektions-Schnitt, Fit-Klemme,
  `TANKAPP_LAW_FLOOR=0` als Gegenmessung, **No-op-Nachweis auf heutigen
  Fenstern** (Kante hinter Fensterbeginn ⇒ identische Zahlen).
- CI-Spiegel aus [AGENTS.md](../AGENTS.md): `ruff check`, `ruff format --check`,
  `pytest -q`, `npm --prefix web test`, `npm --prefix web run build`,
  Playwright-Suiten.
- Abnahme: `/api/v1/heatmap` und `/api/v1/selection` nennen `law_floor` und
  `points_before_law`; das Labor zeigt die Zeile „Beobachtungen ab …";
  `/api/v1/health` bleibt unverändert.

## 6 · Was offen bleibt und warum

- **Der B30-DoD „Kalibrierung belegt Backtest ohne Qualitätsverlust"** braucht
  echte NAS-Daten (20 Stationen, 5-Minuten-Takt). In der Arbeitsumgebung läuft
  nur ein synthetischer Nachweis, dass die Klemme fit- und backtestfähig
  bleibt. Der echte Labor-Backtest ist ein Betriebsschritt — Rezept in
  [DATENWERKZEUGE.md](DATENWERKZEUGE.md#12-uhr-regel-check).
- **Keine rückwirkende Korrektur** bereits angezeigter Werte
  (Befund §5): Ummalen erfindet eine andere Vergangenheit.
