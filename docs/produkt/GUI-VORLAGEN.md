# GUI-Vorlagen und Übernahme ins Produkt

> Stand: 28.09.2026 · App-Version 0.73.0
> `sample/good gui` bleibt die geschützte gestalterische und technische Basis.
> Das Konzept ist seit 0.73.0 **umgesetzt**: `/?konzept=1` ist die echte
> Ansicht (`web/src/v3/`), kein Prototyp mit Beispieldaten.

## Inhaltsverzeichnis

- [Vorlagen und Übernahme](#vorlagen-und-übernahme)
- [Visuelle Leitplanken](#visuelle-leitplanken)
- [Was live ist und was nicht](#was-live-ist-und-was-nicht)
- [Bereich für Bereich](#bereich-für-bereich)
- [Prüfung](#prüfung)

## Vorlagen und Übernahme

Die Dateien in [`sample/good gui`](../../sample/good%20gui) bleiben unverändert
im Checkout. Sie enthalten `App`, `PhoneApp`, `ConceptPanel`, Tokens,
Beispieldaten und Labor-Konzepttexte und sind ausdrücklich **Vorlage**, nicht
Laufzeitcode: Nichts in `web/` importiert daraus, und die Übernahme ist keine
Kopie, sondern eine Übersetzung in die echten Bausteine der App.

Die ältere Referenz `sample/good statistic gui` ist im aktuellen Checkout
nicht vorhanden. Vorhandene produktive Labor- und Statistikfunktionen werden
weder gelöscht noch durch Demo-Logik ersetzt.

Der frühere ausführbare Prototyp (`web/src/concept/`) ist mit dem
[Release 0.73.0](../releases/CHANGELOG.md#0730--2026-09-28) entfernt: Handy-Rahmen,
Steuerpanel und `tankapp-concept:*`-Beispieldaten hatten ihren Zweck erfüllt,
sobald die Gestaltung auf echten Daten stand. Was bleibt, ist die Gestaltung —
umgesetzt in `web/src/v3/`, geprüft von `web/src/v3/v3.test.tsx` und
`web/e2e/konzept.spec.ts`.

## Visuelle Leitplanken

- Material You in **zwei** Themen, dieselben Rollen: Primary `#6cdbac` auf
  `#00513a` (dunkel) bzw. `#006c4c` auf `#89f8c7` (hell), Tertiary
  `#a5cff0`/`#3d6373`, Warnung `#ffdea3` auf `#56430a`, Error `#ffb4ab` auf
  `#93000a`. Voreinstellung ist „System“ mit Rückfall **Dunkel**
  ([Darstellung](UI.md#darstellung-und-themen)).
- Desktop ist die Grundform: Kopfzeile, Seitenleiste links, Inhalt in zwei
  Spalten. Das Handy erbt dieselbe Reihenfolge in einer Spalte und bekommt die
  untere Leiste mit „Mehr“-Blatt statt der Seitenleiste — kein Bereich
  verschwindet in einem Raster.
- Karten tragen Tonflächen und Ränder, nicht Schatten. Elevation hat genau
  eine Karte je Seite: die Antwort.
- Vier Urteilstöne mit fester Bedeutung bleiben unangetastet: Grün = jetzt
  handeln, Blau = warten, Rot = Tankrest blockiert das Warten, Grau =
  ehrlich unentschieden.
- Diagramme und Karten bleiben ohne externe Chart-Runtime (SVG), reduzierte
  Bewegung wird respektiert.

## Was live ist und was nicht

Die Ansicht unter `/?konzept=1` liest **dieselben Endpunkte** wie die
klassische Oberfläche: `/api/v1/overview`, `/api/v1/decide`, Preise, Alarme,
Profile. Es gibt keine Beispieldaten, keine simulierten Empfehlungen und
keine eigenen Schreibwege. Konkret:

- Die Antwort auf „Soll ich jetzt tanken?“ kommt aus `now.ts`, der Tonschlüssel
  aus `guide.ts` — inklusive der drei Fallback-Stufen (volle Prognose, ohne
  Freigabe, offline) und der Gültigkeitsgrenze `valid_until`.
- Der Sperrzustand `decision_ready=false` bleibt sichtbar: Banner mit einer
  Handlung, kein erfundenes Urteil.
- Preise, Frische-Zeile, Abdeckung und Quellenangabe kommen aus den
  bestehenden Formattern (`data.ts`); die Ansicht formatiert nichts selbst.
- Die klassische Ansicht bleibt unter `/` vollständig erreichbar; beide
  Ansichten teilen sich Zustand, Adresse und Freigabegates.

## Bereich für Bereich

| Bereich | Stand 0.73.0 |
|---|---|
| Jetzt | im neuen Raster neu gebaut (`v3/Guide.tsx`) |
| Woche | im neuen Raster neu gebaut (`v3/Week.tsx`): Antwortkarte = gewähltes Fenster, Raster der sieben Tage, Wochenlinie, Liste nach Ersparnis; Tankstand in der Seitspalte |
| Stationen | im neuen Raster neu gebaut (`v3/Stations.tsx`): Steuerleiste, Karte und Liste zweispaltig mit der Referenz, Detail mit Verlauf und „A gegen B“ über die volle Breite |
| Labor, Ich, System, Glossar | voll bedienbar in der bisherigen Gestaltung, eingehängt über `views/Sections.tsx`; der Neubau sagt das sichtbar an |

`views/Sections.tsx` rendert diese sechs Bereiche für **beide** Hüllen
einmal. Eine zweite Verdrahtung der Props wäre eine zweite Wahrheit: Bei jeder
Änderung an `state/overview.tsx` würde eine der Oberflächen stillschweigend
auseinanderlaufen. Die Migration eines Bereichs heißt deshalb: eine neue Seite
in `web/src/v3/` bauen und ihren Block in `Sections.tsx` entfernen — nie
kopieren.

## Prüfung

- `web/src/v3/v3.test.tsx`: die drei Guide-Stufen, Urteilstöne, Herkunft,
  Annahmen und die Hülle (Bereiche in beiden Rastern) gegen injizierte
  Zustände.
- `web/e2e/konzept.spec.ts` (Browser, Desktop 1440 px + Mobil 390 px):
  echte Ansicht ohne Vorschau-Rahmen, Bereichswechsel über die Adresse,
  schmales Raster ohne Querlauf, System-Darstellung mit dunklem Rückfall.
- Die Ratchets aus `a11y.test.ts` (Kontrast aller M3-Paare in beiden Themen,
  44-px-Ziele, Grid-Spalten) und `format-convention.test.ts` gelten für `v3/`
  ohne Ausnahme.
- Ein bestandener Browserlauf ist ein Layout-Nachweis, keine Modell- oder
  Hardwareabnahme.
