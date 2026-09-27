import { AnimatePresence, motion } from "framer-motion";
import {
  Bell, Check, ChevronDown, CircleCheck, Clock3, Coffee, Hourglass, Info, Lightbulb,
  Loader2, Map as MapIcon, MapPin, Navigation, PiggyBank, RefreshCw, Scale, TrendingUp,
  User, WifiOff, X, FlaskConical, Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  curves, fuelOffset, fuels, hours, levelOf, stations, verdictCopy,
  type Fuel, type Level, type Verdict,
} from "../data";
import { Anno, BrandAvatar, Confidence, Price, SectionTitle } from "./ui";
import LabScreen from "./LabScreen";

interface Props {
  level: Level;
  setLevel: (l: Level) => void;
  verdict: Verdict;
  fuel: Fuel;
  setFuel: (f: Fuel) => void;
  annotate: boolean;
  screen: Screen;
  setScreen: (s: Screen) => void;
}

export type Screen = "guide" | "lab";

const tones: Record<Verdict, { card: string; btn: string; chip: string; Icon: typeof CircleCheck }> = {
  now: { card: "bg-primary-container text-on-primary-container", btn: "bg-primary text-on-primary", chip: "bg-primary text-on-primary", Icon: CircleCheck },
  wait: { card: "bg-error-container text-on-error-container", btn: "bg-error text-white", chip: "bg-error text-white", Icon: Hourglass },
  relaxed: { card: "bg-tertiary-container text-on-tertiary-container", btn: "bg-tertiary text-white", chip: "bg-tertiary text-white", Icon: Coffee },
};

const levelColor = { low: "bg-primary", mid: "bg-[#d9a400]", high: "bg-error" };

export default function PhoneApp({ level, setLevel, verdict, fuel, setFuel, annotate, screen, setScreen }: Props) {
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: boolean } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [sort, setSort] = useState<"price" | "near">("price");
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const copy = verdictCopy[verdict];
  const tone = tones[verdict];
  const off = fuelOffset[fuel];
  const curve = useMemo(() => curves[verdict].map(p => p + off), [verdict, off]);
  const min = Math.min(...curve);
  const [selected, setSelected] = useState(copy.bestIndex);
  useEffect(() => setSelected(copy.bestIndex), [copy.bestIndex]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); setSheet(false); }, [level, screen]);

  const list = useMemo(() => {
    const l = stations.map(s => ({ ...s, price: s.base + off + (verdict === "wait" ? 0.07 : verdict === "relaxed" ? 0.02 : 0) }));
    return sort === "price" ? l.sort((a, b) => a.price - b.price) : l.sort((a, b) => parseFloat(a.km.replace(",", ".")) - parseFloat(b.km.replace(",", ".")));
  }, [off, verdict, sort]);
  const best = [...list].sort((a, b) => a.price - b.price)[0];

  const retry = () => {
    setRetrying(true);
    setTimeout(() => {
      setRetrying(false);
      setLevel("full");
      setToast({ text: level === "offline" ? "Wieder online. Alles ist aktuell." : "Prognose ist zurück." });
    }, 1400);
  };

  const primaryAction = () => {
    if (verdict === "wait" && level === "full") setToast({ text: copy.snackbar, undo: true });
    else setToast({ text: `Route zu ${best.brand} wird geöffnet …` });
  };

  const offline = level === "offline";
  const n = (full: number, fb: number) => (level === "full" ? full : fb);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-surface text-on-surface">
      {/* Status bar (nur im Mockup) */}
      <div className="hidden h-9 shrink-0 items-center justify-between px-7 text-[13px] font-semibold lg:flex">
        <span>14:32</span>
        <span className="flex items-center gap-1.5">
          {offline ? <WifiOff size={14} /> : <span className="flex items-end gap-[2px]">{[5, 7, 9, 11].map(h => <span key={h} className="w-[3px] rounded-sm bg-on-surface" style={{ height: h }} />)}</span>}
          <span className="ml-1 h-[11px] w-[22px] rounded-[3px] border border-on-surface p-[1px]"><span className="block h-full w-3/4 rounded-[1px] bg-on-surface" /></span>
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={e => setCollapsed((e.target as HTMLDivElement).scrollTop > 60)}
        className="no-scrollbar flex-1 overflow-y-auto pb-28"
      >
        {screen === "lab" ? (
          <LabScreen level={level} verdict={verdict} fuel={fuel} annotate={annotate} onToast={setToast} retry={retry} retrying={retrying} />
        ) : (
        <>
        {/* 1 · Top App Bar */}
        <header className="sticky top-0 z-10 bg-surface/95 px-4 pb-3 pt-2 backdrop-blur">
          <Anno n={1} show={annotate} />
          <div className="flex items-center gap-2">
            <button className="flex min-w-0 items-center gap-1.5 rounded-full py-2 pl-1 pr-2 text-left hover:bg-sc">
              <MapPin size={20} className="shrink-0 text-primary" />
              <span className="truncate text-[17px] font-semibold">München-Schwabing</span>
              <ChevronDown size={18} className="shrink-0 text-on-surface-variant" />
            </button>
            <span
              className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${offline ? "bg-sc-highest text-on-surface-variant" : "bg-secondary-container text-on-secondary-container"}`}
              title={offline ? "Keine Verbindung" : "Preise sind live"}
            >
              <span className={`h-2 w-2 rounded-full ${offline ? "bg-outline" : "animate-pulse bg-primary"}`} />
              {offline ? "Offline" : "Live"}
            </span>
            <button aria-label="Profil" className="grid h-9 w-9 place-items-center rounded-full bg-sc-high text-on-surface-variant"><User size={18} /></button>
          </div>
          <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Kraftstoff">
            {fuels.map(f => (
              <button
                key={f}
                role="radio"
                aria-checked={fuel === f}
                onClick={() => setFuel(f)}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${fuel === f ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline-variant text-on-surface-variant hover:bg-sc-low"}`}
              >
                {fuel === f && <Check size={16} />}
                {f === "E10" ? "Super E10" : f === "E5" ? "Super E5" : "Diesel"}
              </button>
            ))}
          </div>
        </header>

        <div className="space-y-3 px-4">
          {/* 2 · Banner (nur Fallback) */}
          <AnimatePresence initial={false}>
            {level !== "full" && (
              <motion.section
                key={level}
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="relative"
              >
                <Anno n={2} show={annotate} />
                <div className={`rounded-2xl p-4 ${offline ? "bg-warn-container text-on-warn-container" : "bg-sc-high text-on-surface"}`}>
                  <div className="flex gap-3">
                    {offline ? <WifiOff size={20} className="mt-0.5 shrink-0 text-warn" /> : <Info size={20} className="mt-0.5 shrink-0 text-tertiary" />}
                    <div className="text-sm leading-5">
                      <p className="font-semibold">{offline ? "Du bist offline" : "Die Prognose macht gerade Pause"}</p>
                      <p className="opacity-80">{offline ? "Du siehst den letzten Stand von 14:32 Uhr. Route und Faustregel funktionieren trotzdem." : "Alle Preise sind trotzdem live. Eine Zeit-Empfehlung gibt’s, sobald sie zurück ist."}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end gap-1">
                    <button onClick={retry} disabled={retrying} className={`flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium ${offline ? "text-warn hover:bg-warn/10" : "text-primary hover:bg-primary/10"}`}>
                      {retrying ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      {retrying ? "Verbinde …" : "Erneut versuchen"}
                    </button>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* 2/3 · Entscheidungskarte */}
          <section className="relative">
            <Anno n={n(2, 3)} show={annotate} />
            {level === "full" ? (
              <motion.div key={verdict + fuel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-[28px] p-5 ${tone.card}`}>
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.chip}`}>
                    <tone.Icon size={14} /> {copy.label}
                  </span>
                  <Confidence level={copy.confidence} text={copy.confidenceText} />
                </div>
                <h1 className="mt-4 text-[38px] font-semibold leading-[42px] tracking-[-0.02em]">{copy.title}</h1>
                <p className="mt-1.5 text-[15px] leading-[21px] opacity-80">{copy.sub}</p>

                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/55 p-3">
                  <BrandAvatar brand={best.brand} bg={best.bg} fg={best.fg} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{best.brand} · {best.km}</p>
                    <p className="truncate text-xs opacity-70">{verdict === "wait" ? "um 19 Uhr erwartet" : "günstigste in deiner Nähe"}</p>
                  </div>
                  <Price value={verdict === "wait" ? min : best.price} className="text-[26px] font-semibold" />
                </div>

                <div className="mt-4 flex gap-2">
                  <button onClick={primaryAction} className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold ${tone.btn}`}>
                    {verdict === "wait" ? <Bell size={18} /> : <Navigation size={18} />} {copy.cta}
                  </button>
                  <button onClick={() => setSheet(true)} className="h-12 rounded-full bg-white/55 px-5 text-sm font-semibold hover:bg-white/75">{copy.secondary}</button>
                </div>
                {verdict === "wait" && (
                  <button onClick={() => setToast({ text: `Route zu ${best.brand} wird geöffnet …` })} className="mt-2 w-full rounded-full py-2 text-sm font-medium underline-offset-2 hover:underline">
                    Muss jetzt los? Trotzdem günstigste Route
                  </button>
                )}
              </motion.div>
            ) : (
              <motion.div key={level} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[28px] border border-outline-variant bg-sc-lowest p-5">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant">
                  {offline ? <Clock3 size={14} /> : <span className="h-2 w-2 rounded-full bg-primary" />}
                  {offline ? "Letzter Stand · vor 38 Min." : "Live-Preise"}
                </span>
                <h1 className="mt-2 text-[26px] font-semibold leading-8 tracking-[-0.01em]">
                  {offline ? "Zuletzt am günstigsten" : "Günstigste Tankstelle gerade"}
                </h1>
                <div className="mt-4 flex items-center gap-3">
                  <BrandAvatar brand={best.brand} bg={best.bg} fg={best.fg} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{best.brand}</p>
                    <p className="truncate text-sm text-on-surface-variant">{best.street} · {best.km}</p>
                  </div>
                  <Price value={best.price} className={`text-[30px] font-semibold ${offline ? "text-on-surface-variant" : ""}`} />
                </div>
                {offline && <p className="mt-3 flex items-center gap-1.5 text-xs text-on-surface-variant"><Info size={14} /> Preis an der Säule kann abweichen.</p>}
                <button
                  onClick={primaryAction}
                  className={`mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold ${offline ? "border border-outline text-primary hover:bg-primary/5" : "bg-primary text-on-primary"}`}
                >
                  <Navigation size={18} /> Route starten
                </button>
              </motion.div>
            )}
          </section>

          {level === "full" ? (
            <>
              {/* 3 · Tagesverlauf */}
              <section className="relative rounded-3xl bg-sc-lowest p-4 elev-1">
                <Anno n={3} show={annotate} />
                <SectionTitle title="Heute im Überblick" sub={copy.stripTitle} />
                <div className="relative">
                  <div className="flex h-28 items-end gap-1.5">
                    {curve.map((p, i) => {
                      const lv = levelOf(p, min);
                      const h = 30 + ((p - min) / 0.08) * 70;
                      const active = i === selected;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelected(i)}
                          aria-label={`${hours[i] === "Jetzt" ? "Jetzt" : hours[i] + " Uhr"}: ${p.toFixed(3).replace(".", ",")} Euro`}
                          className="group relative flex h-full flex-1 flex-col items-center justify-end"
                        >
                          {active && (
                            <motion.span layoutId="tip" className="absolute -top-1 z-10 whitespace-nowrap rounded-md bg-inverse-surface px-1.5 py-0.5 text-[11px] font-semibold text-inverse-on-surface">
                              {p.toFixed(3).replace(".", ",")}
                            </motion.span>
                          )}
                          <motion.span
                            initial={{ height: 0 }} animate={{ height: `${Math.min(h, 78)}%` }} transition={{ delay: i * 0.03, type: "spring", damping: 20 }}
                            className={`w-full rounded-t-lg rounded-b-sm ${levelColor[lv]} ${active ? "opacity-100 ring-2 ring-on-surface ring-offset-2" : "opacity-80 group-hover:opacity-100"}`}
                          />
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    {hours.map((h, i) => (
                      <span key={h} className={`flex-1 text-center text-[11px] ${i === 0 ? "font-bold text-on-surface" : i === copy.bestIndex ? "font-semibold text-primary" : "text-on-surface-variant"}`}>{h}</span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> günstig</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#d9a400]" /> mittel</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-error" /> teuer</span>
                </div>
              </section>

              {/* 4 · Was bringt Warten? */}
              <section className="relative flex items-center gap-4 rounded-3xl bg-sc-low p-4">
                <Anno n={4} show={annotate} />
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${copy.waitTone === "good" ? "bg-primary-container text-on-primary-container" : copy.waitTone === "bad" ? "bg-error-container text-error" : "bg-tertiary-container text-tertiary"}`}>
                  {copy.waitTone === "good" ? <PiggyBank size={24} /> : copy.waitTone === "bad" ? <TrendingUp size={24} /> : <Scale size={24} />}
                </span>
                <div>
                  <p className="text-sm font-semibold">{copy.waitTitle}</p>
                  <p className="text-sm leading-5 text-on-surface-variant">{copy.waitText}</p>
                  <p className="mt-0.5 text-[11px] text-outline">Gerechnet mit 45 Litern</p>
                </div>
              </section>
            </>
          ) : (
            /* 4 · Faustregel (Fallback) */
            <section className="relative rounded-3xl bg-sc-lowest p-4 elev-1">
              <Anno n={4} show={annotate} />
              <div className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tertiary-container text-tertiary"><Lightbulb size={20} /></span>
                <div>
                  <p className="text-sm font-semibold">Faustregel für heute</p>
                  <p className="text-sm leading-5 text-on-surface-variant">Abends zwischen 18 und 22 Uhr ist Tanken meist am günstigsten. Morgens am teuersten.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-1.5">
                {[
                  { t: "Morgens", c: "bg-error/70", h: "h-10" },
                  { t: "Mittags", c: "bg-[#d9a400]/70", h: "h-7" },
                  { t: "Nachmittags", c: "bg-[#d9a400]/70", h: "h-8" },
                  { t: "Abends", c: "bg-primary", h: "h-4" },
                ].map(x => (
                  <div key={x.t} className="flex flex-col items-center gap-1">
                    <div className="flex h-10 w-full items-end"><span className={`w-full rounded-md ${x.c} ${x.h}`} /></div>
                    <span className={`text-[11px] ${x.t === "Abends" ? "font-semibold text-primary" : "text-on-surface-variant"}`}>{x.t}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-outline">Typischer Tagesverlauf. Funktioniert auch ohne Verbindung.</p>
            </section>
          )}

          {/* 5 · Tankstellen */}
          <section className="relative rounded-3xl bg-sc-lowest p-4 elev-1">
            <Anno n={5} show={annotate} />
            <SectionTitle
              title="Tankstellen in der Nähe"
              sub={offline ? "Stand 14:32 Uhr" : "Live · vor 2 Min. aktualisiert"}
              action={
                <div className="flex rounded-full border border-outline" role="radiogroup" aria-label="Sortierung">
                  {(["price", "near"] as const).map(s => (
                    <button key={s} role="radio" aria-checked={sort === s} onClick={() => setSort(s)}
                      className={`flex h-8 items-center gap-1 px-3 text-xs font-medium first:rounded-l-full last:rounded-r-full ${sort === s ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"}`}>
                      {sort === s && <Check size={14} />}{s === "price" ? "Preis" : "Nähe"}
                    </button>
                  ))}
                </div>
              }
            />
            <ul className="-mx-1">
              {list.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-2xl px-1 py-2.5 hover:bg-sc-low">
                  <BrandAvatar brand={s.brand} bg={s.bg} fg={s.fg} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {s.brand}
                      {s.id === best.id && <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${offline ? "bg-sc-highest text-on-surface-variant" : "bg-primary-container text-on-primary-container"}`}>Günstigste</span>}
                    </p>
                    <p className="truncate text-xs text-on-surface-variant">{s.km} · {offline ? "Stand 14:32" : s.open}</p>
                  </div>
                  <Price value={s.price} className={`text-lg font-semibold ${offline ? "text-on-surface-variant" : ""}`} />
                  <button onClick={() => setToast({ text: `Route zu ${s.brand} wird geöffnet …` })} aria-label={`Route zu ${s.brand}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-primary hover:bg-primary/10">
                    <Navigation size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <p className="px-2 pb-2 text-center text-[11px] text-outline">
            {offline ? "Preise vom Stand 14:32 Uhr, zwischengespeichert auf deinem Gerät." : "Preise: Markttransparenzstelle für Kraftstoffe. Alle Angaben ohne Gewähr."}
          </p>
        </div>
        </>
        )}
      </div>

      {/* 6 · Extended FAB */}
      {screen === "guide" && <div className="absolute bottom-[92px] right-4 z-20">
        <div className="relative">
          <Anno n={6} show={annotate} />
          <motion.button
            layout
            onClick={() => setToast({ text: "Kartenansicht folgt im nächsten Schritt." })}
            className="flex h-14 items-center gap-2 overflow-hidden rounded-2xl bg-primary-container px-4 text-on-primary-container elev-3"
            aria-label="Auf Karte zeigen"
          >
            <MapIcon size={22} />
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} className="whitespace-nowrap text-sm font-semibold">
                  Karte
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>}

      {/* Navigation Bar */}
      <nav className="absolute inset-x-0 bottom-0 z-20 grid h-20 grid-cols-4 bg-sc pb-2" aria-label="Hauptnavigation">
        {[
          { l: "Guide", I: Sparkles, a: screen === "guide", go: () => setScreen("guide") },
          { l: "Karte", I: MapIcon, a: false, go: () => setToast({ text: "Kartenansicht folgt im nächsten Schritt." }) },
          { l: "Labor", I: FlaskConical, a: screen === "lab", go: () => setScreen("lab") },
          { l: "Alarme", I: Bell, a: false, go: () => setToast({ text: "Preisalarme folgen im nächsten Schritt." }) },
        ].map(({ l, I, a, go }) => (
          <button key={l} onClick={go} aria-current={a ? "page" : undefined} className="flex flex-col items-center justify-center gap-1 text-xs font-medium">
            <span className={`grid h-8 w-16 place-items-center rounded-full ${a ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant"}`}><I size={22} /></span>
            <span className={a ? "font-semibold text-on-surface" : "text-on-surface-variant"}>{l}</span>
          </button>
        ))}
      </nav>

      {/* Snackbar */}
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className="absolute inset-x-3 bottom-[164px] z-40 flex min-h-12 items-center gap-2 rounded-lg bg-inverse-surface py-2 pl-4 pr-2 text-sm text-inverse-on-surface elev-3"
          >
            <span className="flex-1">{toast.text}</span>
            {toast.undo && <button onClick={() => setToast({ text: "Rückgängig gemacht." })} className="rounded-full px-3 py-2 font-semibold text-inverse-primary">Rückgängig</button>}
            <button onClick={() => setToast(null)} aria-label="Schließen" className="grid h-9 w-9 place-items-center rounded-full"><X size={18} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Bottom Sheet */}
      <AnimatePresence>
        {sheet && (
          <>
            <motion.button aria-label="Schließen" onClick={() => setSheet(false)} className="absolute inset-0 z-40 bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              role="dialog" aria-modal="true" aria-labelledby="why-title"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 320 }}
              drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, i) => i.offset.y > 100 && setSheet(false)}
              className="absolute inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-sc-low px-5 pb-8 pt-3"
            >
              <div className="mx-auto mb-4 h-1 w-8 rounded-full bg-outline" />
              <h3 id="why-title" className="text-[22px] font-semibold leading-7">Warum „{copy.title}“?</h3>
              <p className="mt-1 text-sm text-on-surface-variant">Kurz erklärt, ohne Statistik-Kauderwelsch.</p>
              <ol className="mt-4 space-y-2">
                {copy.reasons.map((r, i) => (
                  <li key={r.title} className="flex gap-3 rounded-2xl bg-sc-lowest p-3">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${tone.chip}`}>{i + 1}</span>
                    <span><span className="block text-sm font-semibold">{r.title}</span><span className="text-sm text-on-surface-variant">{r.text}</span></span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 rounded-2xl border border-outline-variant p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold"><Confidence level={copy.confidence} text={copy.confidenceText} /></p>
                <p className="mt-1 text-on-surface-variant">
                  {copy.confidence === 3 ? "An ähnlichen Tagen lag diese Empfehlung in 9 von 10 Fällen richtig." : "An ähnlichen Tagen lag diese Empfehlung in 7 von 10 Fällen richtig."}
                </p>
              </div>
              <button onClick={() => { setSheet(false); primaryAction(); }} className={`mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold ${tone.btn}`}>
                {verdict === "wait" ? <Bell size={18} /> : <Navigation size={18} />} {copy.cta}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
