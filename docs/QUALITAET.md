# Qualitäts-Gates (Lighthouse + Last)

> Stand: 13.09.2026 · App-Version **0.31.0** · Zuständig: `.github/workflows/quality.yml`

Zwei Dinge, die kein Unit-Test sieht, entscheiden im Alltag über „fühlt sich
gut an“ oder „hängt“: **wie schnell das GUI wirklich lädt** (M4-Kriterium
„Lighthouse > 90“) und **ob das Polling unter Last trägt** (B7: ein Aggregat
statt sechs Einzelabrufe). Beides wird seit D4 (0.31.0) gemessen — gegen
denselben Demo-Stack, damit die Zahlen vergleichbar bleiben.

- [Was gemessen wird](#was-gemessen-wird)
- [Der Demo-Stack](#der-demo-stack)
- [Lokal ausführen](#lokal-ausführen)
- [Budgets](#budgets)
- [Messwerte](#messwerte)
- [B7-Rest: `route/evaluate` bleibt ein eigener Abruf](#b7-rest-routeevaluate-bleibt-ein-eigener-abruf)
- [Offen](#offen)

---

## Was gemessen wird

| Gate | Werkzeug | Gegenstand | Wann |
|---|---|---|---|
| Lighthouse | `@lhci/cli` (Chrome aus dem Playwright-Cache) | Zwei GUI-Zustände: Alltag und Statistik, je 3 Läufe | eigener Workflow `quality.yml`: auf Abruf, sonntags 04:17 UTC, und bei PRs, die `web/`, `app/`, `engine/` oder `ops/quality/` anfassen |
| Lastpfad | `node web/load/overview.mjs` (keine Abhängigkeit) | `GET /api/v1/overview` — 8 Clients, 30 s, gemischt aus Volllesen und `If-None-Match`-Revalidierung | derselbe Workflow |

Warum ein **eigener** Workflow und nicht Teil von `tests.yml`: Der in
[AGENTS.md](../AGENTS.md) festgeschriebene CI-Spiegel muss lokal ohne
Chrome-Download lauffähig bleiben. Die Gates sind teuer (Minuten), der Spiegel
ist schnell (Sekunden) — beides vermischt man nicht.

---

## Der Demo-Stack

Lighthouse gegen ein leeres GUI messen hieße: leere Panels, `error_code`
statt Antwort, keine Zahlen. Und ein Lastpfad gegen einen Server ohne Daten
misst nur den Rahmen. Also gibt es `ops/quality/`:

| Datei | Aufgabe |
|---|---|
| `ops/quality/demo_data.py` | Baut einen synthetischen Datenbestand: Polling-Set mit sechs Demo-Stationen (Koordinaten + Anker), eine Engine-Publikation aus einem echten Fit (24 h/7 d inkl. Bootstrap-Draws) und Preiszeilen in InfluxDB-Form. Fester Samen, kein Netz, keine echten Preise. |
| `ops/quality/demo_server.py` | Startet die **echte** App (`app.server.make_server`) mit injizierter Preisabfrage statt InfluxDB. Kein zweiter Server, kein Nachbau des Decision Layers. |

Die Preise teilen einen gemeinsamen Tages-Marktfaktor — ohne Gleichlauf wäre
die gemeinsame Bootstrap-Ziehung (A11) im Lastpfad wirkungslos.

---

## Lokal ausführen

```bash
python -m pip install -r requirements-dev.txt   # bzw. in die venv
npm --prefix web ci && npm --prefix web run build

# 1) Demo-Stack (bleibt laufen, „bereit auf …“ erscheint nach ~10 s)
python3 ops/quality/demo_server.py --data-dir /tmp/tankapp-demo \
    --static web/dist --port 1355 --host 127.0.0.1

# 2) Lastpfad
node web/load/overview.mjs http://127.0.0.1:1355 20 8

# 3) Lighthouse (einmalig: npx playwright install chromium)
export CHROME_PATH="$(cd web && node -e "console.log(require('playwright').chromium.executablePath())")"
npx --yes @lhci/cli@0.15.x autorun --config=web/lighthouserc.json
```

Der Lastpfad bricht mit Exit-Code 1 ab, wenn ein Budget verletzt ist, und
schreibt seinen Bericht als JSON nach stdout.

---

## Budgets

| Größe | Budget | Ebene | Begründung |
|---|---|---|---|
| p95 Latenz `/overview` | ≤ 1000 ms | Fehler | Ab ~1 s wirkt ein Refresh im Alltag wie „hängt“. |
| p99 Latenz `/overview` | ≤ 2000 ms | Fehler | Einzelne Treffer nach einem Modell-Lauf oder Job-Start sind erklärbar — aber nicht doppelt so lang wie p95. |
| Fehlerhafte Antworten | 0 (alles 2xx/3xx) | Fehler | Die App hat kein API-Rate-Limit mehr (0.12.0); 429 darf es im Normalbetrieb nicht geben. |
| 304-Anteil der Revalidierungen | ≥ 20 % | Fehler | B7 trägt nur, wenn `If-None-Match` auch unter Last greift. Sonst zahlt jeder Refresh die volle Berechnung. |
| Lighthouse Barrierefreiheit | ≥ 0,90 | Fehler | C5-Runde (0.29.0) war die Abnahme; das Gate verhindert Rückfälle. |
| Lighthouse Best Practices | ≥ 0,90 | Fehler | Konsolen-Fehler, CSP-Löcher, veraltete APIs. |
| Lighthouse SEO | ≥ 0,80 | Fehler | LAN-App: Sichtbarkeit ist zweitrangig, kaputte Metadaten wären trotzdem ein Fehler. |
| Lighthouse Performance | ≥ 0,80 | **Warnung** | M4 verlangt > 0,90. Solange keine einzige Messung vorliegt, wäre ein hartes Budget ein erfundenes Gate — die erste CI-Messung entscheidet über das Nachziehen (siehe [Offen](#offen)). |
| Übertragungsvolumen | ≤ 1,5 MB | Warnung | Leaflet kommt erst beim Karten-Tab dazu. |
| LCP / CLS | ≤ 2500 ms / ≤ 0,1 | Warnung | Auf CI-Maschinen streuend; dient dem Trend, nicht dem Bestehen. |

---

## Messwerte

**Lastpfad** — 8 Clients, 20 s, Demo-Stack mit sechs Stationen (895 Abrufe):

| Kennzahl | Wert |
|---|---|
| Durchsatz | **≈ 45 Abrufe/s** (8 Clients × ~6,7/s — ein Vielfaches eines Haushalts) |
| p50 / p95 | **3 ms / 8 ms** |
| p99 / max | **≈ 1,4 s / 2,3 s** — das ist der planmäßige Neurechnen-Takt: der ETag hängt am 60-s-Datenstandfenster (B7), der erste Abruf nach dem Fensterwechsel rechnet Decide + Summary neu |
| Kalt (`/overview`, neue Parameter) | **≈ 230 ms** |
| 304-Anteil | **≈ 87 %** der Revalidierungen |
| HTTP-Fehler | keine |

Einordnung: Ein einzelnes GUI pollt im Minutentakt, ein Haushalt mit drei
Geräten also ~0,05 Abrufe/s. Der Lastpfad fährt das Tausendfache — die
Reserve ist groß, der Regler ist nicht die Last, sondern der 60-s-Takt.

**Lighthouse**: erste Messung steht aus (siehe [Offen](#offen)).

---

## B7-Rest: `route/evaluate` bleibt ein eigener Abruf

Entschieden mit der Messung von oben (D4 sagt ausdrücklich: erst messen, dann
entscheiden):

| Pfad | Dauer (Demo-Stack) |
|---|---|
| `/api/v1/overview`, kalt | ≈ 230 ms |
| `/api/v1/route/evaluate` | ≈ 1,5 ms — **0,6 %** eines kalten Overviews |

Bündeln würde ~1,5 ms je Refresh sparen und dafür die Routen-Parameter
(Fahrtmodus, Heimat-Koordinaten, Station) in den ETag-Schlüssel des Overviews
ziehen: Jede Änderung daran entwertet den Antwort-Cache für **alle** Geräte,
und der Overview wird von Panels bezahlt, die gar keine Route zeigen. Der
eigene Abruf kostet dagegen fast nichts und fällt nur an, wenn überhaupt eine
Route im Spiel ist. Deshalb: **lassen**, wie es ist. Das Last-Gate kann mit
`TANKAPP_LOAD_QUERY=/api/v1/route/evaluate?…` auf den Pfad gerichtet werden,
wenn sich die Rahmenbedingungen ändern.

---

## Offen

1. **Lighthouse-Erstdurchlauf.** Im Entwicklungssandbox dieser Änderung war
   kein Chrome-Download möglich, deshalb ist die Performance-Ebene
   **warnend** gesetzt. Erste echte Zahlen liefert der Workflow-Lauf; danach
   werden die Budgets nachgezogen und hier eingetragen.
2. **Nur zwei GUI-Zustände.** Gemessen werden Alltag und Statistik. Werkstatt,
   Einstellungen und System folgen, sobald das M4-Ziel (> 0,90) steht.
3. **Kein Docker-Stack.** Gegen `ops/nas/app/compose.yml` ist der Lastpfad
   noch nicht gelaufen — die Compose-Variante braucht eine InfluxDB mit
   Inhalt. Bis dahin gilt der Demo-Stack als Referenz.
