# TankApp – V3 GUI Analyse: Grafische Inkonsistenzen & erfundene Defaults

> 2026-09-11 · Commit 440402e + Branch arena/01a08eeb-tankapp · Ergänzung zu TIEFENANALYSE + V2

**Kurzantwort:** Fallback-GUI hatte 5 grafische/semantische Bugs (Top1 vs Top10, Doppel-Header, table-layout fixed, save-neg rot, mobile Spalten). Haupt-GUI hatte dieselben Kategorien plus erfundene Preis-Defaults (1.689 / 1.649) und fehlendes error_code Handling bei Intent/Fill. Alle jetzt gefixt.

---

## 1. Fallback-GUI (rp2/fallback_gui.py) – Bugs & Fixes

### Vorher
- **F2 Top1 vs Top10 nicht sinnvoll:** `saving_ct_per_l = (priciest - cheapest)*100` verglich günstigste mit teuerster (Top1 vs Top10). Nutzer will aber wissen, was er vs zweitgünstigste spart (Top1 vs Top2) – Top10 Vergleich ist Clickbait, nicht Entscheidungshilfe. Bug: "spart bis zu 8ct/L" klang toll, aber vs teuerste die niemand tankt.
- **Hero vsLabel irreführend:** `vs. teuerste (Top10-Vergleich)` als Label, aber semantisch falsch.
- **CSS table-layout fixed + station-cell wrap:** `table-layout: fixed` mit `min-width: 180px max-width 380px` führte dazu, dass Liste nicht skaliert, horizontal scrollen muss, Spalten abgeschnitten. Auf Mobile 320px war Tabelle unlesbar.
- **save-neg nicht rot:** Ersparnis war immer grün, auch wenn Station teurer (negativ). Farbe sollte bei teurer dezent rot.
- **Mobile Spalten-Hide fehlte:** Auf <700px alle 7 Spalten sichtbar → Overflow, Doppel-Header "Jetzt tanken oder warten?" / "Jetzt tanken" (H2 + Empfehlungs-Chip) verwirrend.
- **Doppel-Header:** H2 "Jetzt tanken oder warten?" + darunter Chip "JETZT TANKEN" = doppelter Header, visuell redundant.

### Nachher (Fix)
- `second = open_stations[1]`, `ref_for_saving = second if second else priciest`, `saving_vs = "second" | "most_expensive"` → Top1 vs Top2 als Default, Fallback vs teuerste nur wenn nur 1 Station offen.
- `vsLabel`: `vs. ${second_name} (2.)` statt Top10.
- CSS: `table-layout: auto` auf Mobile, `table-layout: fixed` nur Desktop, `station-cell { white-space: normal; word-break: break-word; min-width 180px max-width 380px }`, Mobile `max-width 200px`. `.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch }`, `button,input,select { max-width: 100% }`.
- `save-neg` Klasse: `td.num.save-neg { color: var(--bad); font-weight: 600; opacity: 0.9 }`, `save-pos` grün, `save-zero` muted. Logik: `save <=0.001 ? save-zero : save-neg` (teurer = rot).
- Mobile Hide: `@media (max-width: 700px) { th:nth-child(4), td:nth-child(4), th:nth-child(6)... display:none }` + `grid { 1fr }` + `.decision .numbers { 1fr }` + `.liters { width:100% }`.
- Decision: wenn keine Prognose `rec = "Aktueller Preisvergleich"` statt "Jetzt tanken" – entschärft Doppel-Header.

**Datei:** `rp2/fallback_gui.py` – `DEFAULT_INDEX_HTML` + `f2` Logik, vollständig gefixt.

---

## 2. Haupt-GUI (web/src/Dashboard.tsx) – Bugs & Fixes V3

### 2.1 Erfundene Preis-Defaults – §0.4 Verstoß

**Vorher:**
```tsx
const [customPrice, setCustomPrice] = useState<number>(1.689); // erfundener Default
~{euro(bestPrice || 1.649,3)} €/L // verspricht 1,649€ wenn kein Preis bekannt
```
- 1.689€ Vorbelegung suggeriert echten Preis, obwohl keiner gemessen.
- Button "✓ Ja, wie empfohlen (1,649 €/L)" wenn `bestPrice===null` – Verstoß "fehlende als fehlend zeigen", irreführende Ersparnis.

**Nachher:**
```tsx
const [customPrice, setCustomPrice] = useState<number>(0); // 0 = bitte eingeben
useEffect(() => {
  if (bestPrice !== null && Number.isFinite(bestPrice) && customPrice===0)
    setCustomPrice(Math.round(bestPrice*1000)/1000);
}, [bestPrice, customPrice]);

<button disabled={bestPrice===null} title={bestPrice===null ? "Kein frischer Preis – bitte manuell erfassen" : `Wie empfohlen ${euro(bestPrice,3)} €/L`}>
  {bestPrice!==null ? `${euro(bestPrice,3)} €/L` : "Preis unbekannt"}
</button>
```
- Kein erfundener Fallback mehr, disabled + "Preis unbekannt", sync mit live bestPrice wenn verfügbar.
- Validierung `handleCustomFill` prüft `>0`.

### 2.2 Erfolgsmeldung bei Fehler (P1 aus V2 noch offen)

**Vorher:**
```tsx
await postFill({...});
setActionFeedback("✓ Füllung verbucht!"); // auch bei 429/offline
await postIntent(epId, "dismiss"); // ohne error_code Check
```
- `postFill`/`postIntent` catch → `{error_code: "request_failed"}`, Aufrufer zeigten trotzdem Erfolg.

**Nachher:**
```tsx
const res = await postFill({...});
if (res?.error_code) {
  setActionFeedback(`! Speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – bitte erneut versuchen.`);
  return;
}
```
- Gleiches für `handleCustomFill`, `handleDismissDue`, `handleIntent` – alle 4 Handler prüfen jetzt `error_code`.

### 2.3 Metric "Unterschied zur Vergleichsstation" ohne Farbcode

**Vorher:** `euro(difference)` immer slate-200, kein Hinweis ob teurer/günstiger.

**Nachher:**
```tsx
<span className={difference>0.01 ? "text-rose-300" : difference<-0.01 ? "text-emerald-300" : "text-slate-200"}>
  {euro(difference)} €
</span>
```
- Grün günstiger, dezent rot teurer (analog Fallback save-neg). Detail-Text ergänzt: "grün günstiger, dezent rot teurer".

### 2.4 Detour Badge "lohnt sich nicht" – amber statt dezent rot

**Vorher:** `Badge warning={!worth}` → amber für lohnt-nicht (warn) vs emerald lohnt. Amber ist Warnung, nicht "lohnt nicht". Nutzer erwartet rot für lohnt-nicht.

**Nachher:**
```tsx
<span className={worth ? "border-emerald... text-emerald" : borderline ? "border-amber... text-amber" : "border-rose... text-rose"}>
  {worth ? "lohnenswert" : borderline ? "grenzwertig" : "lohnt sich nicht"}
</span>
```
- worth=emerald, borderline=amber, not-worth=rose (dezent rot, 25% opacity, 10% bg).

### 2.5 HeatmapGrid min-w-[760px] erzwingt Scroll

**Vorher:** `<table className="w-full min-w-[760px]">` + wrapper `overflow-x-auto` → immer Scrollbar, auch auf Desktop, auf Mobile sehr breit.

**Nachher:** `<div className="overflow-x-auto -mx-1 px-1"><table className="w-full text-center...">` – kein min-w, schrumpft natürlich, scroll nur wenn nötig. Stunden bleiben lesbar, 24 Spalten passen auf ≥768px ohne Scroll, auf Mobile scroll mit Touch.

### 2.6 Scoreboard & Ranking – sehr breite Listen

**Vorher:** Scoreboard `min-w-[960px]`, Ranking `min-w-[820px]` – auf Mobile 2x Bildschirmbreite, Nutzer muss horizontal scrollen, verliert Kontext.

**Nachher:**
- Scoreboard: `min-w-[640px]` + responsive hidden: `P behauptet`, `S>0 real` hidden sm, `Warten`/`Jetzt` hidden md, `Ø Regret` hidden lg. Auf Mobile nur Station + δ̂ + Regel-€ + Orakel-€.
- Ranking: `min-w-[560px]` + `95%-KI` hidden sm, `q`/`AV-Score` hidden md, Name `truncate max-w-[180px]`. Wrapper `-mx-1` für Touch-Scroll.
- Stations-Liste: bereits flex, kein Table, aber `station-cell` wrap via `truncate` + `flex-wrap` bleibt.

### 2.7 Doppelter Header "Jetzt tanken oder warten?" / "Jetzt tanken"

**Vorher:** Section H2 "Ein guter Stopp beginnt hier." + Compass Badge + Hero "Aktuell am günstigsten" + Decide Chip "JETZT TANKEN" + darunter `<span>Jetzt oder warten?</span>` als Erklärung – zwei "Jetzt"-Header direkt untereinander.

**Nachher:** Unterer Header umbenannt von "Jetzt oder warten?" → "Einordnung". Chip bleibt primärer Handlungs-Hinweis, Einordnung ist sekundäre Erklärung. Entfernt Redundanz.

### 2.8 ApiExplorer Endpunkt-Liste veraltet

**Vorher:** Nur 8 Endpunkte: health, decide, summary, episodes, stations, selection, collector, route/evaluate (deprecated). Fehlten: last_forecasts, day, fills (POST), etc. Hinweis "Aktuelle Endpunkte: decide, episodes, fills, stats/summary" aber Liste zeigte sie nicht.

**Nachher:**
```tsx
{ label: "Letzte Forecasts", path: "/api/v1/last_forecasts" },
{ label: "Day Series (Beispiel)", path: `/api/v1/day?station_id=...&day=...` },
{ label: "Route Evaluate (serverseitig, deprecated → decide)", path: ... },
{ label: "Fills (GET nicht erlaubt – POST /api/v1/fills)", path: "/api/v1/fills" },
...dynamic (series, forecast, heatmap)
```
- Vollständige Liste aus `app/server.py` abgeglichen, deprecated markiert, Fills als POST gekennzeichnet.

---

## 3. Noch offen (nicht V3 GUI, aber P1 aus Prüfstand)

- `feedback.py` Fill-Default 1.70€ (Backend) – GUI fixt nur Frontend, Backend braucht Range-Check + Nowcast statt Default.
- Episode resolve bei `compliance=unrelated` – sollte nur bei `followed/partial` schließen.
- Rate-Limit GUI Verbrauch 14.7k/Tag >10k anon – braucht LRU + Tagesbudget Hinweis.
- Store >10MB silent reset – `read_json` >10MB → default → leere Historie, danach `locked_store` überschreibt.
- `collect_prices` no-prices Alarm zählt Polls statt Tage (7 Polls =35min statt 7 Tage).

Diese sind Backend, nicht GUI, bleiben in `TIEFENANALYSE_V2.md` + `Prüfstand.md`.

---

## 4. Fazit V3

- **Fallback:** 5/5 grafische Bugs gefixt, skaliert jetzt 320px–1080px, Top1 vs Top2 sinnvoll, rot für teurer.
- **Haupt-GUI:** 8/8 V3 Punkte gefixt: kein erfundener Preis (0 + disabled + Preis unbekannt), error_code Handling in allen 4 Handlern, Unterschied farbcodiert rot/grün, Detour Badge rose für lohnt-nicht, Heatmap ohne forced min-w, Scoreboard/Ranking responsive hidden, Doppel-Header entschärft, ApiExplorer vollständig.
- **Konsistenz:** Beide GUIs nutzen jetzt gleiche Farb-Semantik: emerald=lohnenswert/günstig, amber=grenzwertig, rose=lohnt-nicht/teuer, amber Badge nur für unkalibriert.

**Empfehlung:** V3 GUI ist dicht. Nächster Schritt P1 Backend (Fill-Validierung, Episode-Schluss, Store-Retention).
