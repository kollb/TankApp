# Gemergtes Polling-Set (Frankfurt Basis + Gütersloh aktualisiert 2026-09-11)

Erzeugt: 2026-09-11T09:22:29Z
Quelle: run_pipeline.py aus station_scores_e10.csv (Selektion, --step-min 30) + data/raw/stations/2026/09/2026-09-10-stations.csv.gz (Gütersloh aktualisiert, 2026-09-11)
poll_size: 10, proposal: False, Intervall: 300s (5 min pro Request, je Stadt ~ 10 min)

## UTF-Hinweis
Alle Umlaute korrekt als UTF-8 geschrieben (nicht mehr GÃ¼tersloh / BetriebsstÃ¤tte).
Prüfung: Gütersloh, Förster, Betriebsstätte, Straßen-km, ≤ ≥ — — korrekt kodiert.

## Frankfurt — 10 Stationen, Radius 25.0 km

| # | UUID | Name | Marke | Dist km | Zusatz |
|---:|---|---|---|---|---|
| 1 | `6a7fe9a1-e30d-422e-a6a9-00bea6621c6f` | Esso Tankstelle | ESSO | 2.25 | δ̂ +1.0 ct, nahe |
| 2 | `b096653c-b8e2-4a2e-8561-c24d7b5a19ef` | Aral Tankstelle | ARAL | 2.9 | δ̂ +2.0 ct, nahe |
| 3 | `a0ada894-e0ea-4088-a8cc-cf36c403abdc` | Esso Tankstelle | ESSO | 3.07 | δ̂ +2.0 ct, nahe |
| 4 | `eed1f8be-6ec6-7eb6-1cf7-688b969574e1` | Globus Handelshof St. Wendel GmbH & Co. KG Betriebsstätte Eschborn | Globus SB Warenhaus | 7.54 | δ̂ -2.5 ct, sign., auffuellung |
| 5 | `51d4b557-a095-1aa0-e100-80009459e03a` | Supermarkt-Tankstelle FRANKFURT GUERICKESTR. 8 | Supermarkt-Tankstelle | 6.79 | δ̂ -2.0 ct, sign., auffuellung |
| 6 | `51d4b5a2-a095-1aa0-e100-80009459e03a` | Supermarkt-Tankstelle FRANKFURT AM RIEDERBRUCH 10 | Supermarkt-Tankstelle | 9.31 | δ̂ -1.5 ct, sign., auffuellung |
| 7 | `54a737cc-42a1-4caf-9786-575e2212a304` | bft-Tankstelle Förster, Frankfurt | bft | 7.87 | δ̂ -1.0 ct, sign., auffuellung |
| 8 | `c6433b60-39db-47c2-aac4-19598526e5d8` | Calpam Tankstelle | Calpam | 6.0 | δ̂ -1.0 ct, auffuellung |
| 9 | `cb35439c-054b-4d15-859a-78ca2c86527a` | Shell Frankfurt Am Main Westerbachstr. 204 | Shell | 5.19 | δ̂ +0.0 ct, auffuellung |
| 10 | `5d73b461-5646-4b7b-a98d-aa866b87fdd3` | Aral Tankstelle | ARAL | 6.03 | δ̂ +0.0 ct, auffuellung |

## Gütersloh — 10 Stationen, Radius 5.0 km

| # | UUID | Name | Marke | Dist km | Zusatz |
|---:|---|---|---|---|---|
| 1 | `346d2d31-456e-42b5-bcad-28403aa1e60e` | Fricke | AVIA | 0.83 | diesel/e10/e5, 374 Tage |
| 2 | `9430923b-d777-4c54-b181-3e1de75fd6dc` | Shell Guetersloh Verler Str. 158 | Shell | 1.62 | diesel/e10/e5, 375 Tage |
| 3 | `36923c0f-fe05-4663-8f52-ec4e770fe34c` | Automatentankstelle | Markant (Tankautomat) | 1.8 | diesel/e10/e5, 375 Tage |
| 4 | `74e6e139-ba6c-4706-b9ea-261ddf1933a5` | Esso Tankstelle | ESSO | 1.93 | diesel/e10/e5, 375 Tage |
| 5 | `10bd27c9-f134-40d9-8fa0-137b46e30cc9` | GTB-Tankstelle, Isselhorster Str. 10-12 | GT Brennstoffvertrieb GmbH | 2.48 | diesel/e10/e5, 256 Tage |
| 6 | `dcbcdba0-9864-4a5d-aeec-c070cf4ad630` | Tankstelle | Tankstelle | 2.76 | diesel/e10/e5, 375 Tage |
| 7 | `665dfee1-10ff-4d2d-beb9-aed7b482d7a9` | Fricke | AVIA XPress | 2.86 | diesel/e10/e5, 374 Tage |
| 8 | `919e1134-4e60-4c32-849f-d3dbe8577ceb` | A. Westerbarkei |  | 4.02 | diesel/e10/e5, 374 Tage |
| 9 | `51d4b48e-a095-1aa0-e100-80009459e03a` | JET GUETERSLOH NORDRING 99 | JET | 4.12 | diesel/e10/e5, 375 Tage |
| 10 | `b7a8ef15-eeef-451b-a281-72d374e066cf` | bft Tankstelle | bft | 4.15 | diesel/e10/e5, 375 Tage |

### Anker-Koordinaten
In diesem Beispiel als Platzhalter (xxx → 50.110/8.682 Frankfurt, 51.904/8.42 Gütersloh) gezeigt.
Im echten privaten `docs/analysis/stations/polling.json` stehen die echten Werte aus `analysis/config.local.json`.
Beim Übertragen auf Pi/NAS die echten Koordinaten einsetzen; Datei bleibt gitignored.

### Validierung
`validate_sets()` erfolgreich (je Stadt 1–10 UUIDs, keine UUID doppelt, Format korrekt).
