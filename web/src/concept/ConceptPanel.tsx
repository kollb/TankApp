import { radius } from "../components/ui";
import { ArrowRight, Check, FlaskConical, Layers, ListOrdered, MessageSquareText, Minus, RefreshCw, ShieldCheck, Sparkles, Tag } from "lucide-react";
import { useState } from "react";
import { verdictCopy, type Level, type Verdict } from "./data";
import { labComponents, labCopy, labMatrix, labPrinciples, labRewrites, labStructure } from "./labConcept";
import type { Screen } from "./PhoneApp";

interface Props {
  level: Level; setLevel: (l: Level) => void;
  verdict: Verdict; setVerdict: (v: Verdict) => void;
  annotate: boolean; setAnnotate: (b: boolean) => void;
  screen: Screen; setScreen: (s: Screen) => void;
}

const guidePrinciples: [string, string][] = [
  ["Der Platz bleibt, der Inhalt wird einfacher", "Die Entscheidungskarte verschwindet nie. Sie sagt nur weniger: Empfehlung → günstigste Tankstelle → letzter Stand."],
  ["Banner statt Dialog", "Kein Modal, das den Nutzer blockiert. Der Hinweis sitzt dort, wo sonst die Empfehlung steht, und ist in einer Sekunde gelesen."],
  ["Immer mit Datum", "Jede nicht-live Zahl bekommt eine Uhrzeit. Gedämpfte Farbe = „nicht mehr ganz frisch“."],
  ["Nie leer", "Die Faustregel ist festes Wissen, das immer funktioniert. Sie ersetzt die Prognose mit einer ehrlichen Orientierung."],
  ["Automatisch zurück", "Kommen die Daten wieder, springt die App leise zurück zu Stufe 1 und bestätigt das per Snackbar."],
];

const levels: { id: Level; label: string; hint: string }[] = [
  { id: "full", label: "Stufe 1 · Voller Guide", hint: "Live-Preise + Prognose" },
  { id: "noForecast", label: "Stufe 2 · Ohne Prognose", hint: "Live-Preise, kein Modell" },
  { id: "offline", label: "Stufe 3 · Offline", hint: "Nur Cache auf dem Gerät" },
];
const verdicts: { id: Verdict; label: string; dot: string }[] = [
  { id: "now", label: "Jetzt tanken", dot: "bg-primary" },
  { id: "wait", label: "Besser warten", dot: "bg-error" },
  { id: "relaxed", label: "Kein Zeitdruck", dot: "bg-tertiary" },
];

const structure: Record<Level, { name: string; comp: string; why: string }[]> = {
  full: [
    { name: "Kopfzeile", comp: "Top App Bar (small) + Filter Chips", why: "Ort, Live-Status und Kraftstoff: Der Kontext ist immer sichtbar und mit einem Tap änderbar." },
    { name: "Entscheidungskarte", comp: "Filled Card in Primary / Error / Tertiary Container", why: "Die Antwort in zwei Wörtern. Die Farbe zeigt die Handlung. Darunter stehen der beste Preis, eine Sicherheitsanzeige mit drei Stufen und genau eine Hauptaktion." },
    { name: "Heute im Überblick", comp: "Elevated Card mit Balken in Ampelfarben", why: "Die Prognose als Ampelbalken statt als Kurve. Niemand muss Achsen lesen, Farbe und Höhe reichen. Ein Tap auf einen Balken zeigt den Preis." },
    { name: "Was bringt Warten?", comp: "Filled Card (surface-container-low)", why: "Rechnet den Unterschied in Cent pro Liter in Euro pro Tankfüllung um. In dieser Einheit denken die Leute." },
    { name: "Tankstellen", comp: "Two-line List + Segmented Button", why: "Live-Preise, sortierbar nach Preis oder Nähe. Jede Zeile hat direkt eine Route, ohne Detailseite." },
    { name: "Karte & Navigation", comp: "Extended FAB + Navigation Bar", why: "Die Karte ist die zweitwichtigste Aufgabe. Der FAB klappt beim Scrollen ein und verdeckt so keinen Inhalt." },
  ],
  noForecast: [
    { name: "Kopfzeile", comp: "Top App Bar + Filter Chips", why: "Unverändert. Das grüne „Live“ zeigt: Preise sind aktuell." },
    { name: "Status-Banner", comp: "Inline Banner (keine Snackbar, kein Dialog)", why: "Sagt ruhig, was fehlt und was trotzdem geht. Neutrale Farbe statt Rot. „Erneut versuchen“ ist als Text-Button eingebaut." },
    { name: "Entscheidungskarte (neutral)", comp: "Outlined Card", why: "Gleicher Platz, andere Aussage: statt einer Empfehlung zur Uhrzeit die günstigste Tankstelle gerade. Die neutrale Fläche fordert zu nichts auf." },
    { name: "Faustregel", comp: "Elevated Card", why: "Ersetzt die Prognose durch festes Wissen über den typischen Tagesverlauf. Das ist immer verfügbar." },
    { name: "Tankstellen", comp: "Two-line List", why: "Unverändert live. Das ist der Kern, der auch ohne Prognose trägt." },
    { name: "Karte & Navigation", comp: "Extended FAB + Navigation Bar", why: "Unverändert." },
  ],
  offline: [
    { name: "Kopfzeile", comp: "Top App Bar + Filter Chips", why: "Die Statusanzeige wechselt auf ein graues „Offline“. Der Kraftstoff bleibt wählbar, weil die Preise im Cache liegen." },
    { name: "Offline-Banner", comp: "Inline Banner (Warn Container)", why: "Offline-Hinweis mit Uhrzeit des Datenstands und „Erneut versuchen“. Ehrlich, aber nicht dramatisch." },
    { name: "Letzter Stand", comp: "Outlined Card, Preise gedämpft", why: "Der zuletzt bekannte beste Preis, klar datiert („vor 38 Min.“), mit dem Hinweis „kann an der Säule abweichen“. Die Route bleibt nutzbar." },
    { name: "Faustregel", comp: "Elevated Card", why: "Funktioniert vollständig offline. Gibt eine Orientierung, obwohl kein Modell da ist." },
    { name: "Tankstellen (Cache)", comp: "Two-line List, gedämpfte Preise", why: "Uhrzeit statt „vor 2 Min.“. Die Preise sind in einem Grauton gesetzt, damit sie nicht als aktuell gelesen werden." },
    { name: "Karte & Navigation", comp: "Extended FAB + Navigation Bar", why: "Funktionen, die Netz brauchen, werden ausgeblendet statt als Fehler gezeigt." },
  ],
};

const rewrites = [
  ["Prognose-Konfidenz: 87 %", "Sehr sicher"],
  ["Erwartete Preisänderung: −0,08 €/l", "Gegen 19 Uhr ca. 8 Cent günstiger"],
  ["Kaufsignal: neutral", "Kein Zeitdruck"],
  ["Error 503: Forecast service unavailable", "Die Prognose macht gerade Pause"],
  ["Keine Netzwerkverbindung", "Du bist offline. Du siehst den Stand von 14:32 Uhr."],
  ["Daten veraltet", "Stand 14:32 · Preis an der Säule kann abweichen"],
  ["Ersparnispotenzial: 0,08 €/l", "Du sparst ca. 3,60 € pro Tankfüllung"],
  ["Retry", "Erneut versuchen"],
];

const components = [
  { c: "Filled Card (Container-Farben)", u: "Entscheidungskarte", n: "Elevation 0: Die Farbe trägt die Hierarchie, nicht der Schatten." },
  { c: "Filled / Tonal / Text Button", u: "Hauptaktion · „Warum?“ · Alternative", n: "Pro Karte genau ein Filled Button." },
  { c: "Filter Chips", u: "Kraftstoffwahl", n: "Häkchen bei der Auswahl, bleibt zwischen Sitzungen gespeichert." },
  { c: "Elevated Card (Level 1)", u: "Tagesverlauf, Faustregel, Tankstellen", n: "Trennt Inhalte von der Fläche, ohne dick aufzutragen." },
  { c: "Segmented Button", u: "Sortierung Preis / Nähe", n: "Zwei Optionen, genau eine aktiv." },
  { c: "Two-line List + Icon Button", u: "Tankstellen", n: "Trailing-Icon: Route mit einem Tap." },
  { c: "Banner (inline)", u: "Fallback-Stufe 2 und 3", n: "Der Zustand hält an, darum Banner statt Snackbar. Nie modal." },
  { c: "Snackbar", u: "Route, Erinnerung, „Wieder online“", n: "Kurz und vorübergehend, mit „Rückgängig“, wo sinnvoll." },
  { c: "Modal Bottom Sheet", u: "„Warum?“-Erklärung", n: "Erklärung in drei Gründen plus Sicherheit in „9 von 10 Fällen“. Zum Schließen nach unten wischen." },
  { c: "Extended FAB", u: "Karte öffnen", n: "Klappt beim Scrollen zum normalen FAB ein." },
  { c: "Navigation Bar", u: "Guide · Karte · Labor · Alarme", n: "Aktive Markierung als Pill in Secondary Container." },
  { c: "Progress Indicator", u: "„Verbinde …“ beim erneuten Versuch", n: "Direkt im Button, kein Vollbild-Spinner." },
];

type Row = { m: string; s: ("y" | "r" | "n")[] };
const matrix: Row[] = [
  { m: "Ort & Kraftstoff", s: ["y", "y", "y"] },
  { m: "Entscheidungskarte", s: ["y", "r", "r"] },
  { m: "Tagesverlauf (Prognose)", s: ["y", "r", "r"] },
  { m: "Was bringt Warten?", s: ["y", "n", "n"] },
  { m: "Tankstellen-Liste", s: ["y", "y", "r"] },
  { m: "Route starten", s: ["y", "y", "y"] },
  { m: "Erinnerung / Alarm", s: ["y", "y", "n"] },
];

export default function ConceptPanel({ level, setLevel, verdict, setVerdict, annotate, setAnnotate, screen, setScreen }: Props) {
  const [tab, setTab] = useState<"structure" | "copy" | "components" | "fallback">("structure");
  const c = verdictCopy[verdict];
  const lab = screen === "lab";
  const activeStructure = (lab ? labStructure : structure)[level];
  const activeRewrites = lab ? labRewrites : rewrites;
  const activeComponents = lab ? labComponents : components;
  const activeMatrix = lab ? labMatrix : matrix;
  const activePrinciples = lab ? labPrinciples : guidePrinciples;

  const screenCopy: [string, string][] = lab ? labCopy[level] :
    level === "full"
      ? [
          ["Status-Chip", c.label],
          ["Überschrift", c.title],
          ["Unterzeile", c.sub],
          ["Sicherheit", c.confidenceText],
          ["Hauptaktion", c.cta],
          ["Nebenaktion", c.secondary],
          ["Warten-Karte", `${c.waitTitle}: ${c.waitText}`],
          ["Snackbar", c.snackbar],
        ]
      : level === "noForecast"
        ? [
            ["Banner-Titel", "Die Prognose macht gerade Pause"],
            ["Banner-Text", "Alle Preise sind trotzdem live. Eine Zeit-Empfehlung gibt’s, sobald sie zurück ist."],
            ["Banner-Aktion", "Erneut versuchen"],
            ["Karten-Label", "Live-Preise"],
            ["Überschrift", "Günstigste Tankstelle gerade"],
            ["Faustregel", "Abends zwischen 18 und 22 Uhr ist Tanken meist am günstigsten."],
            ["Snackbar (Rückkehr)", "Prognose ist zurück."],
          ]
        : [
            ["Banner-Titel", "Du bist offline"],
            ["Banner-Text", "Du siehst den letzten Stand von 14:32 Uhr. Route und Faustregel funktionieren trotzdem."],
            ["Banner-Aktion", "Erneut versuchen → Verbinde …"],
            ["Karten-Label", "Letzter Stand · vor 38 Min."],
            ["Überschrift", "Zuletzt am günstigsten"],
            ["Hinweis", "Preis an der Säule kann abweichen."],
            ["Snackbar (Rückkehr)", "Wieder online. Alles ist aktuell."],
          ];

  const tabs = [
    { id: "structure", label: "Aufbau", I: ListOrdered },
    { id: "copy", label: "Texte", I: MessageSquareText },
    { id: "components", label: "Komponenten", I: Layers },
    { id: "fallback", label: "Fallback-Logik", I: ShieldCheck },
  ] as const;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">DAS KONZEPT · INTERAKTIV ERLEBEN</p>
      <h1 className="mt-2 text-[32px] font-semibold leading-10 tracking-[-0.02em] text-on-surface lg:text-[40px] lg:leading-[48px]">
        Eine Frage. Eine Antwort.<br />Auch wenn Daten fehlen.
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-6 text-on-surface-variant">
        Die App beantwortet zuerst nur eine Frage: <strong className="text-on-surface">„Soll ich jetzt tanken?“</strong> Alles andere ordnet sich darunter.
        Fehlen Daten, bleibt der Aufbau gleich. Nur der Inhalt wird Stufe für Stufe einfacher.
      </p>
      {lab && (
        <p className={`mt-3 max-w-xl ${radius.card} bg-tertiary-container p-3 text-sm leading-5 text-on-tertiary-container`}>
          <strong>Labor:</strong> Der freiwillige Blick unter die Haube. Hier wird die Statistik hinter der Empfehlung sichtbar, aber als Bild und Alltagssprache statt als Formel.
        </p>
      )}

      {/* Szenario-Steuerung */}
      <div className="mt-6 space-y-4 rounded-3xl bg-sc-lowest p-5 elev-1">
        <div>
          <p className="mb-2 text-xs font-semibold text-on-surface-variant">Screen</p>
          <div className="flex rounded-full border border-outline" role="radiogroup" aria-label="Screen">
            {([
              { id: "guide", label: "Guide", I: Sparkles },
              { id: "lab", label: "Labor", I: FlaskConical },
            ] as const).map(({ id, label, I }) => (
              <button key={id} role="radio" aria-checked={screen === id} onClick={() => setScreen(id)}
                className={`flex h-10 flex-1 items-center justify-center gap-2 text-sm font-medium first:rounded-l-full last:rounded-r-full first:border-r first:border-outline ${screen === id ? "bg-secondary-container text-on-secondary-container" : "hover:bg-sc-low"}`}>
                {screen === id ? <Check size={16} /> : <I size={16} />} {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-on-surface-variant">Datenlage</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {levels.map(l => (
              <button key={l.id} aria-pressed={level === l.id} onClick={() => setLevel(l.id)}
                className={`${radius.card} border p-3 text-left transition-colors ${level === l.id ? "border-primary bg-primary-container/40" : "border-outline-variant hover:bg-sc-low"}`}>
                <span className="block text-sm font-semibold">{l.label}</span>
                <span className="text-xs text-on-surface-variant">{l.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-on-surface-variant">Empfehlung {level !== "full" && <span className="font-normal">(nur in Stufe 1)</span>}</p>
          <div className="flex flex-wrap gap-2">
            {verdicts.map(v => (
              <button key={v.id} aria-pressed={verdict === v.id} disabled={level !== "full"} onClick={() => setVerdict(v.id)}
                className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium disabled:opacity-40 ${verdict === v.id ? "border-transparent bg-secondary-container" : "border-outline-variant hover:bg-sc-low"}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${v.dot}`} /> {v.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-outline-variant pt-4">
          <span className="text-sm"><span className="font-semibold">Bereiche im Mockup nummerieren</span><span className="block text-xs text-on-surface-variant">Nummern passen zum Reiter „Aufbau“</span></span>
          <button role="switch" aria-label="Bereiche im Mockup nummerieren" aria-checked={annotate} onClick={() => setAnnotate(!annotate)}
            className={`relative h-8 w-[52px] shrink-0 rounded-full border-2 transition-colors ${annotate ? "border-primary bg-primary" : "border-outline bg-sc-highest"}`}>
            <span className={`absolute top-1/2 grid grid-cols-1 -translate-y-1/2 place-items-center rounded-full transition-all ${annotate ? "left-[22px] h-6 w-6 bg-white text-primary" : "left-1 h-4 w-4 bg-outline"}`}>
              {annotate && <Check size={14} />}
            </span>
          </button>
        </label>
      </div>

      {/* Tabs */}
      <div className="no-scrollbar mt-8 flex overflow-x-auto border-b border-outline-variant" role="tablist">
        {tabs.map(({ id, label, I }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`relative flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-medium ${tab === id ? "text-primary" : "text-on-surface-variant hover:text-on-surface"}`}>
            <I size={18} /> {label}
            {tab === id && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-primary" />}
          </button>
        ))}
      </div>

      <div className="py-6">
        {tab === "structure" && (
          <ol className="space-y-3">
            {activeStructure.map((s, i) => (
              <li key={s.name} className={`flex gap-4 ${radius.card} bg-sc-lowest p-4`}>
                <span className="grid grid-cols-1 h-7 w-7 shrink-0 place-items-center rounded-full bg-[#7d2ae8] text-xs font-bold text-white">{i + 1}</span>
                <div>
                  <p className="font-semibold">{s.name}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 rounded bg-sc px-1.5 py-0.5 text-xs font-medium text-on-surface-variant"><Tag size={11} /> {s.comp}</p>
                  <p className="mt-1.5 text-sm leading-5 text-on-surface-variant">{s.why}</p>
                </div>
              </li>
            ))}
            <li className={`${radius.card} border border-dashed border-outline p-4 text-sm text-on-surface-variant`}>
              {lab ? (
                <><strong className="text-on-surface">Prinzip Labor:</strong> Von einfach nach komplex. Oben Bilder statt Zahlen, unten eingeklappt die Fachbegriffe. Wer nach Karte 2 aufhört, hat trotzdem verstanden, wie sicher die Prognose ist.</>
              ) : (
                <><strong className="text-on-surface">Lesereihenfolge (1 Sekunde):</strong> Farbe der Karte → Überschrift → Preis → Button. Alles weitere ist optional.</>
              )}
            </li>
          </ol>
        )}

        {tab === "copy" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Texte für diesen Screen</h3>
              <dl className={`divide-y divide-outline-variant overflow-hidden ${radius.card} bg-sc-lowest`}>
                {screenCopy.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-[140px_1fr]">
                    <dt className="text-xs font-medium text-on-surface-variant">{k}</dt>
                    <dd className="text-sm font-medium">„{v}“</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Aus Technik wird Sprache</h3>
              <ul className="space-y-2">
                {activeRewrites.map(([a, b]) => (
                  <li key={a} className={`grid grid-cols-1 items-center gap-2 ${radius.card} bg-sc-lowest p-3 text-sm sm:grid-cols-[1fr_auto_1fr]`}>
                    <span className="text-on-surface-variant line-through decoration-error/60">{a}</span>
                    <ArrowRight size={16} className="hidden text-outline sm:block" />
                    <span className="font-medium text-primary">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${radius.card} bg-tertiary-container p-4 text-sm text-on-tertiary-container`}>
              <p className="font-semibold">Tonalität</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Du-Form, aktive Verben, ein Gedanke pro Satz.</li>
                <li>Geld in Euro pro Tankfüllung, Zeit als Uhrzeit, nie als Wahrscheinlichkeit.</li>
                <li>Unsicherheit ehrlich benennen („voraussichtlich“, „ca.“), aber nicht verstecken.</li>
                <li>Fehlt etwas, erst sagen, was geht, dann was fehlt.</li>
              </ul>
            </div>
          </div>
        )}

        {tab === "components" && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {activeComponents.map(x => (
              <li key={x.c} className={`${radius.card} bg-sc-lowest p-4`}>
                <p className="text-sm font-semibold">{x.c}</p>
                <p className="text-xs font-medium text-primary">{x.u}</p>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">{x.n}</p>
              </li>
            ))}
          </ul>
        )}

        {tab === "fallback" && (
          <div className="space-y-6">
            <div className={`overflow-x-auto ${radius.card} bg-sc-lowest`}>
              <table className="w-full min-w-[440px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-on-surface-variant">
                    <th className="p-3 font-medium">Baustein</th>
                    {levels.map(l => <th key={l.id} className={`p-3 text-center font-medium ${level === l.id ? "text-primary" : ""}`}>{l.label.split(" · ")[0]}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {activeMatrix.map(r => (
                    <tr key={r.m}>
                      <td className="p-3 font-medium">{r.m}</td>
                      {r.s.map((s, i) => (
                        <td key={i} className={`p-3 text-center ${levels[i].id === level ? "bg-primary-container/25" : ""}`}>
                          {s === "y" && <Check size={18} className="mx-auto text-primary" aria-label="voll" />}
                          {s === "r" && <RefreshCw size={16} className="mx-auto text-warn" aria-label="ersetzt" />}
                          {s === "n" && <Minus size={18} className="mx-auto text-outline" aria-label="ausgeblendet" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="flex flex-wrap gap-4 border-t border-outline-variant p-3 text-xs text-on-surface-variant">
                <span className="flex items-center gap-1"><Check size={14} className="text-primary" /> voll verfügbar</span>
                <span className="flex items-center gap-1"><RefreshCw size={12} className="text-warn" /> wird ersetzt</span>
                <span className="flex items-center gap-1"><Minus size={14} className="text-outline" /> leise ausgeblendet</span>
              </p>
            </div>
            <ol className="space-y-2">
              {activePrinciples.map(([t, d], i) => (
                <li key={t} className={`flex gap-3 ${radius.card} bg-sc-lowest p-4`}>
                  <span className="grid grid-cols-1 h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary-container text-xs font-bold">{i + 1}</span>
                  <span><span className="block text-sm font-semibold">{t}</span><span className="text-sm text-on-surface-variant">{d}</span></span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
