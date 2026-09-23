# Tiefenanalyse Runde 2, 23.09.2026: Labor-Payload, Demo-Vertrag, Karten-Schlüssel

> Stand: 23.09.2026 · Stichtagsprüfung **mit Umsetzung** (dieses Release).
> Anlass: Nutzerbefund „die Karten in Labor → Modell & Parameter zeigen nix —
> kein Beta-Vektor im Forecast-Payload" und erneuter Verdacht, dass GUI, Texte
> und Mathe nicht das berechnen, was sie behaupten. Vorgänger:
> [BEFUND-GUI-TEXTE-STATISTIK-2026-09-23](BEFUND-GUI-TEXTE-STATISTIK-2026-09-23.md)
> (A1–A8/B1–B3, mit PR #220 umgesetzt).
>
> Methode: vollständige Gegenüberstellung **Payload ↔ Typ ↔ Karte** für alle
> acht Parameterkarten gegen den echten Demo-Stack
> (`ops/quality/demo_server.py`, 6 Stationen) und den Publikationspfad
> `app/refresh.py` → `write_split_publication` → `/api/v1/forecast`;
> danach Frischsichtung der mit PR #220 geänderten Stellen
> (`netCostEur`, `m7Progress`, Tagesmedian, A2-Frischekette, A6-Umweg,
> B1-Trennsatz, B2-Interpolation) und der Kernrechenpfade
> (`app/pside.py`, `web/src/lab.ts`, `web/src/week.ts`, `app/stats_summary.py`).

## Inhaltsverzeichnis

- [1. Ergebnis auf einen Blick](#1-ergebnis-auf-einen-blick)
- [2. N1 — Labor-Karten ohne Payload (hoch)](#2-n1--labor-karten-ohne-payload-hoch)
- [3. N2 — Demo-Stack rechnet einen anderen statistischen Vertrag (mittel)](#3-n2--demo-stack-rechnet-einen-anderen-statistischen-vertrag-mittel)
- [4. Entlastet: PR-#220-Fixes und Kernmathe](#4-entlastet-pr-220-fixes-und-kernmathe)
- [5. Umsetzung](#5-umsetzung)

## 1. Ergebnis auf einen Blick

| Nr. | Severity | Befund kurz | Status |
|---|---|---|---|
| N1 | **hoch** | Die acht Karten von Labor → Modell & Parameter lasen Payload-Felder, die der Server nie trug — Karten fielen durchweg auf „Kein … im Payload" zurück | behoben (0.68.1) |
| N1a | — | `app/refresh.py` publizierte `beta`, `ar_phi`, `holiday_beta`, `holiday_source`, `law_*`, `shared_draws`, `bootstrap_samples` nicht (nur im Modell-Artefakt) | behoben |
| N1b | — | `ops/quality/demo_data.py` baute die Zeile von Hand fast ohne Diagnosefelder | behoben |
| N1c | — | GUI las falsche Schlüssel: `ar_detail.root_modulus`/`stable`, `pit.n`/`pit.status`, `pava_pool_stats.n_pools`/`pooled_steps`, `shared_draws` statt `backtest_shared_draws`, `training_days/points` statt `n_days/points`, „B=2000" festgenagelt; Beta-Balken clippten bei \|β\|·10 | behoben |
| N1d | — | Unit-Fixtures arretierten die erfundenen Feldformen (`root_modulus: 0.8, stable: true`, `pit: {n, status}`, `n_pools`) | behoben |
| N2 | mittel | Demo-Stack fuhr mit den Engine-Defaults `predict(kind="harmonic_ar2", shared_draws=False, day_pair=False)` statt dem Betriebsvertrag (`profile_ar2`, gemeinsame Ziehung, Day-Pair) — Draws trugen `shared: false`, der Modellvertrag löste zu „unbekannt" auf | behoben |
| N3 | niedrig | `README.md` trug weiterhin „App-Version 0.59.1" (neun Versionen hinter `app/version.py` 0.68.0) | behoben |

## 2. N1 — Labor-Karten ohne Payload (hoch)

**Beobachtung (Demo-Stack, `/api/v1/forecast`):** Die Antwort trug nur
`points`, `metrics`, `calibration` — **kein** `beta`, **kein** `ar_phi`,
**kein** `ensemble`, **kein** `pava_pool_stats`, **kein** `pit`. Karte 1
fiel auf „Kein Beta-Vektor im Forecast-Payload" zurück, Karte 2 auf
„Kein AR(2) im Payload" — exakt der Nutzerbefund.

**Wurzel 1 (N1a, Server):** `app/refresh.py` legte je Station zwar
`ensemble`, `ar_shrink_events`, `ar_state_reset`, `ar_detail`,
`pava_pool_stats`, `pit` bei — aber **nie** `beta`, `ar_phi`,
`holiday_beta`, `holiday_source` und die Rechtslage-Felder
(`law_floor`, `law_floor_active`, `pre_law_points_excluded`,
`law_rise_outside_noon`). Diese lebten ausschließlich im Modell-Artefakt
(`models-*.json`, `engine/models.py`Fit-Zustand), das die GUI nie liest.
Der TS-Typ `Forecast` in `web/src/data.ts` deklarierte die Felder
trotzdem — die Karte war also gegen einen Vertrag gebaut, den der Server
nie erfüllt hat.

**Wurzel 2 (N1b, Demo):** `ops/quality/demo_data.py::build_publication`
baute die Zeile von Hand und trug fast keine Diagnosefelder ein — der
Demo-Stack (E2E ohne Mocks, Qualitäts-Gates, Lighthouse) zeigte damit
selbst nach N1a noch leere Karten.

**Wurzel 3 (N1c, GUI):** Selbst wo der Server Daten trug, las die Karte
falsche Schlüssel:

| Karte | GUI las | Payload hat (real) |
|---|---|---|
| 2 · AR(2) | `ar_detail.root_modulus`, `ar_detail.stable` | je Kern verschachtelt: `ar_detail["profile_ar2"].root_radius` (+`root_radius_raw`, `shrink_events`, `fallback`); ein `stable`-Flag gibt es nicht |
| 2 · AR(2) | `f.training_days`, `f.training_points` | `n_days`, `n_points` (identische Werte, anderer Name) |
| 3 · Bootstrap | `f.shared_draws` | Produktion: `backtest_shared_draws` (Backtest) — der Lauf-Modus wurde erst mit diesem Fix als `shared_draws` publiziert |
| 3 · Bootstrap | „B=2000 Bloecke" fest | echte Zahl erst mit `bootstrap_samples` im Payload (Demo fährt 200, Betrieb 2000) |
| 3 · B3 | `pit.n`, `pit.status` | `pit.horizons["24h"].all.n` (kein Status-Feld im PIT-Schnitt) |
| 4 · PAVA | `pava_pool_stats.n_pools`, `.pooled_steps`, `.max_pool_size` | `pava_pool_stats.totals["profile_ar2"].{pools, pooled_points, max_pool_size, max_shift_ct}` plus `law_segments` |
| 1 · Beta | Balkenhöhe `min(100, \|β\|·10)` % | Koeffizienten ab 0,1 €/L wurden alle zu 100 % — Skala relativ zum größten gezeigten Betrag |

**Wurzel 4 (N1d, Tests):** `web/src/views/Labor.test.tsx` fütterte die
Karte mit `ar_detail: { root_modulus: 0.8, stable: true }`,
`pava_pool_stats: { n_pools: 5 }`, `pit: { n: 200, status: "ok" }` — die
Tests arretierten die erwarteten, nie gelieferten Formen (dieselbe
Mechanik wie in der Runde-1-Analyse beschrieben: „Tests und E2E-Mocks
bauen die Fehler ein").

**Fix:** Ein gemeinsamer Helfer `app.model_jobs.model_parameter_fields`
liest die Modell-Parameter **eine Quelle** aus dem Fit;
`app/refresh.py` (Betrieb) und `ops/quality/demo_data.py` (Demo) bauen
ihre Zeile damit. Die GUI liest die echten Schlüssel (Kernwahl über
`model_kind`), zeigt für fehlende Felder ehrlich „-" und die echte
Ziehungszahl; die Unit-Fixtures halten die echte Payload-Form fest.
`docs/referenz/API.md` führt die Felder auf.

## 3. N2 — Demo-Stack rechnet einen anderen statistischen Vertrag (mittel)

`ops/quality/demo_data.py` rief `predict(model, hours=24, return_paths=True)`
**ohne** `kind`/`shared_draws`/`day_pair` — die Engine-Defaults sind
`kind="harmonic_ar2"`, `shared_draws=False`, `day_pair=False`
(`engine/models.py::predict`). Der Betrieb läuft mit
`model_kind="profile_ar2"`, `shared_draws=True`, `day_pair=True`
(`app/config.py`, Worker-`_STATE` in `app/model_jobs.py`). Folgen im
Demo-Stack:

- `_draws(..., shared=False)` stempelte die Draws mit `shared: false`,
  obwohl die Dokumentation „gemeinsame Ziehung" als Betriebsmodus nennt;
- `model_contract_id` (`app/gate_context.py`) konnte aus
  `model_kind`/`day_pair`/`draws_24h.shared` nicht den Betriebsvertrag
  „`profile_ar2+day_pair=1+shared=1`" bilden und fiel auf „unbekannt"
  zurück — Gate-Kontext und Herkunftsprüfung der Demo liefen gegenüber dem
  Betrieb in einer anderen Vertragswelt;
- die Karten von N1 zeigten im Demo-Stack zusätzlich „Kein Ensemble im
  Payload" und falsche B-Zahlen.

**Fix:** Der Demo-Lauf rechnet jetzt mit demselben Vertrag wie der
NAS-Lauf (`profile_ar2`, gemeinsame Ziehung, Day-Pair) und schreibt
`model_kind`/`day_pair`/`shared_draws` in die Zeile. Der Verhaltenstest
`tests/test_quality_gates.py::test_demo_stack_liefert_publikation_und_frische_preise`
hält das fest (Beta-Länge 13, `draws_24h.shared` wahr, `model_kind`).

## 4. Entlastet: PR-#220-Fixes und Kernmathe

Mit frischen Augen gegen die Runde-1-Befunde geprüft — sauber:

- **A1** `netCostEur`/`sortAtlasRows`: Vorzeichenkonvention einheitlich
  (negativ = günstiger), Server-`net_eur` wird gedreht statt gemischt;
  Tests expectations (`stations.test.ts`) tragen die echte Konvention.
- **A2** F2-Freigabe bindet `price_fresh` der Alternative
  (`decide.py`, `_decide_table_action`).
- **A3** `m7Progress` liest `gate_n` (Fallback 30-Tage), Trefferzahl mit
  halben Ties konsistent zur `hit_rate`-Klammer.
- **A4** Tagesmedian = Mittelwert der beiden mittleren Stunden-Minima.
- **A5** Stufe B entfernt; `NowStage = "A" | "C"`.
- **A6** `decide.py` schätzt den Anker-Umweg einseitig wie `route.py`.
- **A7** `assumptionHint` benennt das echte Kippverhalten.
- **A8** `scoreRows` weist `null` wie der Server aus.
- **B1** Ebene-1-Trennsatz brutto/netto bei „Woanders"; **B2** Schwellwert
  wird aus `th["now_p"]` interpoliert; **B3** MICROCOPY/Docstrings stehen
  auf dem Code-Stand (Modell-Frische 1440 min, 0,25-pp-Gitter).

Kernmathe erneut gelesen, ohne Befund: `app/pside.py` (Draw-Sichtung
`_supported` einmalig, Median der Fenster-Minima, θ-Rand = halber Credit,
F3-Normalisierung `min(1, p_raw·(k+1))`), `web/src/lab.ts`
(Beta-Quantil-IC), `web/src/week.ts` (Sterne/Wortstufen, bestes Fenster
über `expected_price`), `app/stats_summary.py` ↔ `web/src/data.ts`
Score-Parität, `quality_metrics`-Anzeige (`picp_95`-Fallback), Karte 6
(`wait_n`/`wait_hits` existieren in `live_advice`).

## 5. Umsetzung

- `app/model_jobs.py`: `model_parameter_fields` (eine Quelle für Betrieb
  und Demo), `app/refresh.py`: Felder in der Veröffentlichung +
  `shared_draws`.
- `ops/quality/demo_data.py`: gemeinsamer Helfer + Betriebsvertrag.
- `web/src/views/labor/Modell.tsx`: echte Schlüssel, Kernwahl für
  `ar_detail`, relative Beta-Skala, echte B-Zahl, ehrliche „-"-Zeilen.
- `web/src/data.ts`: `backtest_shared_draws`, `backtest_day_pair`,
  `bootstrap_samples` im `Forecast`-Typ.
- Tests: `tests/test_app_jobs.py` (Helper + Veröffentlichung),
  `tests/test_app.py` (Payload-Durchreichung),
  `tests/test_quality_gates.py` (Demo-Vertrag),
  `web/src/views/Labor.test.tsx` (echte Payload-Form + leere Fälle).
- Dokumentation: `docs/referenz/API.md` (Feldtabelle),
  `docs/releases/CHANGELOG.md`, `README.md`-Versionsstempel (N3),
  App-Version 0.68.1.

Nicht Thema dieser Prüfung (weiterhin offen in
`docs/planung/LUECKEN.md`): Betriebsnachweis auf NAS-Daten, kalibrierte
Produktionsveröffentlichung, Übereinstimmung von `backtest_model_kind`
(harmonic_ar2) und veröffentlichtem `ensemble`-Kern.
