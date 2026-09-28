// „Jetzt“ im Konzept-Neubau — eine Frage, eine Antwort, drei Fallback-Stufen.
//
// Die Seite rendert, sie entscheidet nichts (D1). Ausgänge, Fakten, Schritte,
// Frische und Begründung kommen aus `now.ts`/`guide.ts` — dieselben geprüften
// Funktionen wie in der bisherigen Ansicht. Was hier neu ist, ist die
// Anordnung für den Desktop:
//
//   Kopfzeile   die Frage („Soll ich jetzt tanken?“) + Datenstand
//   Stufe       Banner nur auf Stufe 2/3 (GuideBanner, kein Modal)
//   Hauptspalte eine Karte mit der Antwort, darunter drei Fakten und die
//               nächsten Schritte
//   Zeile 2     „Heute im Blick“ über die **ganze** Breite (Streifen,
//               Abdeckung, Stundenbalken) — 19 Zellen brauchen je rund 36 px
//   Seitspalte  Was-wäre-wenn, Tankstand-Schnellwahl, was Warten bringt
//
// Der Tagesverlauf steht bewusst über die volle Breite: `.daystrip-cells`
// staffelt seine Spalten nach der Viewport-Breite (5/10/19 in `styles.css`),
// nicht nach dem Container. In der 360 px breiten Seitspalte stünden 19
// Stundenspalten in rund 300 px, in der halben Zeile wären es 30 px je Zelle
// — die Zahlen liefen ineinander (Befund 28.09.2026: „sieht gequetscht aus“).
//
// Am Handy bleibt die Reihenfolge gleich, die Seitspalte rutscht unter die
// Antwort. Der Tagesstreifen liegt dort hinter einem Knopf („einen Tipp
// entfernt“, UI.md): Die Startseite trägt eine Antwort, keine Zahlenwand.
//
// Ehrlichkeit bleibt ungeteilt: Freigabe, Gültigkeit, Preisherkunft und
// Modellgüte stehen mit denselben Texten und Schwellen wie bisher. Ein
// hübscheres Layout darf keine Zahl aufwerten.

import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Equal,
  Fuel,
  ListChecks,
  MinusCircle,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { BenefitWidget } from "../components/BenefitWidget";
import { BottomSheet } from "../components/BottomSheet";
import { FreshnessLine } from "../components/FreshnessLine";
import { GuideBanner } from "../components/GuideBanner";
import { HourBars } from "../components/HourBars";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { PrecisionSlider } from "../components/PrecisionSlider";
import { SkeletonPanel } from "../components/Skeleton";
import { radius } from "../components/ui";
import {
  centPerLiter,
  deTrimmed,
  euro,
  euroPerLiter,
  PROFILE_BOUNDS,
} from "../data";
import {
  guideBenefit,
  guideLevel,
  guideTone,
  hourlyOutlook,
  type GuideTone,
} from "../guide";
import {
  assumptionHint,
  learningNote,
  nowBestNow,
  nowCoverage,
  nowDayPanel,
  nowExplanation,
  nowFacts,
  nowFreshness,
  nowNetBest,
  nowSteps,
  nowValidity,
  nowVerdict,
  savingPerLiterCt,
  TANK_QUICK,
  timeInputToBerlinIso,
  type NowStep,
  type NowTarget,
} from "../now";
import { useOverview } from "../state/overview";
import { stripBandNote, type StripCell } from "../strip";

/**
 * Farbrolle des Urteils — eine Bedeutung je Farbe (UI.md):
 * Grün = jetzt handeln, Blau = warten (die Geld sparende Handlung),
 * Rot = Tankrest blockiert das Warten, Grau = ehrlich unentschieden.
 */
const TONE: Record<
  GuideTone,
  {
    card: string;
    chip: string;
    Icon: LucideIcon;
    label: string;
  }
> = {
  now: {
    card: "border-primary/40 bg-primary-container text-on-primary-container",
    chip: "bg-primary text-on-primary",
    Icon: CheckCircle2,
    label: "Jetzt handeln",
  },
  wait: {
    card: "border-tertiary/40 bg-tertiary-container text-on-tertiary-container",
    chip: "bg-tertiary text-on-tertiary",
    Icon: Clock,
    label: "Warten spart",
  },
  risk: {
    card: "border-error/40 bg-error-container text-on-error-container",
    chip: "bg-error text-on-error",
    Icon: TriangleAlert,
    label: "Tankrest im Blick",
  },
  relaxed: {
    card: "border-outline-variant bg-sc text-on-surface",
    chip: "bg-sc-highest text-on-surface",
    Icon: Equal,
    label: "Kein Zeitdruck",
  },
  neutral: {
    card: "border-outline-variant bg-sc text-on-surface",
    chip: "bg-sc-highest text-on-surface",
    Icon: MinusCircle,
    label: "Ohne Zeiturteil",
  },
};

function SectionCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border border-outline-variant bg-sc-lowest p-5 ${radius.card} ${className}`}
    >
      {children}
    </section>
  );
}

/** Überschrift einer Karte: klein, ruhig, nie lauter als die Antwort. */
function CardTitle({
  icon: Icon,
  children,
  right,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {Icon && <Icon size={15} aria-hidden="true" />}
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Die eine Antwort — die einzige Karte der Seite mit Elevation. */
function VerdictCard() {
  const ov = useOverview();
  const [whyOpen, setWhyOpen] = useState(false);
  const {
    decideRes,
    stations,
    selectedId,
    effLiters,
    effTimeValue,
    nowPricesAt,
    browserOnline,
    refreshNow,
  } = ov;
  const now = Date.now();
  const decide = decideRes.data ?? null;
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);
  const liters = decide?.quantity?.used_liters ?? effLiters;
  const input = {
    decide,
    stations,
    selectedId,
    liters,
    now,
    latestBy: ov.assumptions.latestBy,
    timeValue: effTimeValue,
  };
  const verdict = nowVerdict(input);
  const level = guideLevel({
    online: browserOnline,
    decisionReady: decide?.decision_ready ?? null,
  });
  const tone = guideTone({
    action: verdict?.action ?? null,
    tone: verdict?.tone ?? null,
    expired: verdict?.expired ?? false,
  });
  const validity = nowValidity(verdict, now);
  const explanation = nowExplanation({ ...input, pricesAt: nowPricesAt });
  const bestNow = nowBestNow(input);
  const coverage = nowCoverage(stations, nowPricesAt, now);
  const learning = learningNote(decide);

  if (decideRes.pending && !decideRes.data) {
    return <SkeletonPanel title lines={5} label="Antwort wird geladen" />;
  }
  if (problemCode) {
    return (
      <LoadError
        errorCode={problemCode}
        fallback="Die Empfehlung konnte nicht geladen werden."
        onRetry={refreshNow}
      />
    );
  }
  if (!verdict) {
    return (
      <SectionCard>
        {/* Die Frage steht einmal auf der Seite — als Seitenüberschrift.
            Die Karte antwortet; solange sie das nicht kann, sagt sie das
            statt die Frage zu wiederholen. */}
        <h2 className="text-lg font-bold tracking-tight">Noch keine Antwort</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-on-surface-variant">
          {stations.length === 0
            ? "Für eine Antwort fehlen noch Stationen: Stadt wählen, dann füllt der Collector die Preise. Alles Weitere zeigt dieser Bereich, sobald die erste Meldung da ist."
            : "Sobald ein bestätigter Preis vorliegt, steht hier die Antwort — mit Betrag auf deine Tankmenge, nicht als Cent-Spanne."}
        </p>
      </SectionCard>
    );
  }

  const palette = TONE[tone];
  const Icon = palette.Icon;

  return (
    <article
      className={`border p-5 sm:p-6 elev-1 ${radius.card} ${palette.card}`}
      aria-labelledby="v3-verdict"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span
          className={`flex items-center gap-1.5 px-2.5 py-1 ${radius.chip} ${palette.chip}`}
        >
          <Icon size={14} aria-hidden="true" />
          {palette.label}
        </span>
        {validity && (
          <span className="opacity-80">{validity.label}</span>
        )}
        <span className="opacity-80">
          {deTrimmed(liters, 0)} L · {euroPerLiter(bestNow.price)}
        </span>
      </div>

      <h1
        id="v3-verdict"
        className="mt-3 text-3xl font-black leading-tight tracking-tight sm:text-4xl"
      >
        {verdict.headline}
      </h1>
      {verdict.amount && (
        <p className="mt-3 text-lg font-semibold">{verdict.amount}</p>
      )}
      <p className="mt-2 max-w-prose text-sm leading-relaxed opacity-90">
        {verdict.detail}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {verdict.mapsUrl ? (
          <a
            href={verdict.mapsUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => ov.handleIntent("navigate", verdict.mapsUrl ?? undefined)}
            className={`tap-44 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold ${radius.chip} ${palette.chip}`}
          >
            Route zu {verdict.stationName ?? "Tankstelle"}
            <ArrowRight size={15} aria-hidden="true" />
          </a>
        ) : verdict.action === "wait" ? (
          <button
            type="button"
            onClick={() => ov.handleIntent("wait")}
            className={`tap-44 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold ${radius.chip} ${palette.chip}`}
          >
            Erinnere mich
            <CalendarClock size={15} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setWhyOpen(true)}
          className={`tap-44 inline-flex items-center gap-2 border border-current/30 px-4 py-2.5 text-sm font-bold ${radius.chip}`}
        >
          Warum?
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-current/20 pt-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="opacity-75">Günstigste Station gerade</dt>
          <dd className="mt-0.5 font-semibold">
            {bestNow.station
              ? `${bestNow.station.name} · ${euroPerLiter(bestNow.price)}`
              : "keine offene Meldung"}
          </dd>
        </div>
        <div>
          <dt className="opacity-75">Preise</dt>
          <dd className="mt-0.5 font-semibold">{coverage.line}</dd>
        </div>
        <div>
          <dt className="opacity-75">Modell</dt>
          <dd className="mt-0.5 font-semibold">
            {level === "full"
              ? `${learning ?? "Prognose aktiv"}`
              : level === "noForecast"
                ? "Prognose pausiert — Preise live"
                : "Keine Verbindung — letzter Stand"}
          </dd>
        </div>
      </dl>

      {explanation && (
        <Level1Sheet
          open={whyOpen}
          title="Warum diese Empfehlung?"
          sentences={explanation.sentences}
          source={explanation.source}
          labHint={explanation.labHint}
          onDeepen={(section) => {
            setWhyOpen(false);
            ov.openLabor(section);
          }}
          onClose={() => setWhyOpen(false)}
        />
      )}
    </article>
  );
}

/** Drei Fakten: Jetzt hier · Bestes Fenster heute · Tank reicht? */
function Facts() {
  const ov = useOverview();
  const input = {
    decide: ov.decideRes.data ?? null,
    stations: ov.stations,
    selectedId: ov.selectedId,
    liters: ov.decideRes.data?.quantity?.used_liters ?? ov.effLiters,
    now: Date.now(),
    latestBy: ov.assumptions.latestBy,
    timeValue: ov.effTimeValue,
  };
  const facts = nowFacts(input);
  if (facts.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className={`border border-outline-variant bg-sc-lowest p-4 ${radius.card}`}
        >
          <dt className="text-xs text-on-surface-variant">{fact.label}</dt>
          <dd className="mt-1 text-lg font-bold tabular-nums">{fact.value}</dd>
          <dd className="mt-1 text-xs leading-relaxed text-on-surface-variant">
            {fact.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Höchstens drei nächste Schritte — jeder führt an seinen Ort. */
function Steps({ onGo }: { onGo: (target: NowTarget) => void }) {
  const ov = useOverview();
  const steps: NowStep[] = nowSteps({
    decide: ov.decideRes.data ?? null,
    stations: ov.stations,
    selectedId: ov.selectedId,
    liters: ov.decideRes.data?.quantity?.used_liters ?? ov.effLiters,
    now: Date.now(),
    latestBy: ov.assumptions.latestBy,
    timeValue: ov.effTimeValue,
  });
  const netBest = nowNetBest({
    decide: ov.decideRes.data ?? null,
    stations: ov.stations,
    selectedId: ov.selectedId,
    liters: ov.decideRes.data?.quantity?.used_liters ?? ov.effLiters,
    now: Date.now(),
    timeValue: ov.effTimeValue,
  });
  const rows: Array<{ id: string; text: string; run?: () => void }> = [
    ...steps.map((step) => ({
      id: step.id,
      text: step.text,
      run: () => onGo(step.target),
    })),
  ];
  // Der Netto-Vergleich ist eine Aussage, keine Handlung: Er steht nur da,
  // wenn er der Karte widersprechen könnte („woanders ist es netto besser“).
  const netRow = netBest.text
    ? { id: "net", text: netBest.text, run: () => onGo("stations") }
    : null;
  if (rows.length === 0 && !netRow) return null;
  return (
    <SectionCard>
      <CardTitle icon={ListChecks}>Nächste Schritte</CardTitle>
      <ul className="divide-y divide-outline-variant">
        {[...(netRow ? [netRow] : []), ...rows].map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={row.run}
              className="flex w-full items-center gap-3 py-2.5 text-left text-sm leading-relaxed hover:text-primary"
            >
              <ArrowRight
                size={15}
                aria-hidden="true"
                className="shrink-0 text-on-surface-variant"
              />
              <span className="min-w-0">{row.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** Tagesstreifen: 19 Stunden als Zellen, Balkenhöhe = Lage im Tag. */
function DayStrip({ cells }: { cells: StripCell[] }) {
  const panel = nowDayPanel(cells);
  const span =
    panel.worst && panel.best ? panel.worst.value - panel.best.value : 0;
  return (
    <div className="daystrip-cells grid gap-1.5">
      {cells.map((cell) => {
        const ratio =
          cell.value !== null && span > 0
            ? (cell.value - (panel.best?.value ?? cell.value)) / span
            : 0;
        const title =
          cell.value === null
            ? `${String(cell.hour).padStart(2, "0")}:00 — keine offene Meldung`
            : `${String(cell.hour).padStart(2, "0")}:00 — ${euroPerLiter(cell.value)}`;
        return (
          <div
            key={cell.hour}
            title={title}
            role="img"
            aria-label={title}
            className={`flex flex-col items-center gap-0.5 border px-0.5 pb-0.5 pt-1 ${radius.chip} ${
              cell.current
                ? "border-primary bg-emerald-950/80"
                : cell.tone === "cheap"
                  ? "border-primary/30 bg-emerald-900/30"
                  : cell.tone === "pricey"
                    ? "border-error/30 bg-rose-950/30"
                    : "border-outline-variant bg-sc-low"
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-3 w-full items-end justify-center"
            >
              <span
                className={`w-full rounded-sm ${
                  cell.value === null
                    ? "h-0.5 bg-outline-variant/60"
                    : cell.tone === "cheap"
                      ? "bg-emerald-400/80"
                      : cell.tone === "pricey"
                        ? "bg-rose-400/80"
                        : "bg-slate-400/60"
                }`}
                style={{ height: `${2 + Math.round(ratio * 10)}px` }}
              />
            </span>
            <span className="whitespace-nowrap font-mono text-[0.625rem] text-on-surface-variant">
              {String(cell.hour).padStart(2, "0")}
            </span>
            <span className="whitespace-nowrap font-mono text-[0.625rem] leading-tight tabular-nums">
              {cell.value === null ? "—" : euro(cell.value, 3)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * „Heute im Blick“ — Tagesstreifen und Stundenbalken.
 *
 * Steht in der **Hauptspalte**, nicht in der Seitspalte: `.daystrip-cells`
 * staffelt seine Spalten nach der Viewport-Breite (5/10/19 in `styles.css`),
 * nicht nach dem Container — in 360 px liefen die Stundenzahlen ineinander.
 * Am Handy bleibt der Streifen hinter „Tag ansehen“ (Blatt: dort greift
 * `dialog .daystrip-cells` mit `auto-fit minmax(42px, 1fr)`); die drei
 * Kennzahlen stehen auch dort, verdichtet zu Zeilen.
 */
function DayPanel() {
  const ov = useOverview();
  const [dayOpen, setDayOpen] = useState(false);
  const { decideRes, stripCells, stripBand, browserOnline } = ov;
  const now = Date.now();
  const decide = decideRes.data ?? null;
  const level = guideLevel({
    online: browserOnline,
    decisionReady: decide?.decision_ready ?? null,
  });
  const panel = nowDayPanel(stripCells);
  const outlook =
    level === "full"
      ? hourlyOutlook({ windows: decide?.windows_today, now })
      : null;
  const noteClass = "hidden text-xs leading-snug text-on-surface-variant sm:mt-0.5 sm:block";

  return (
    <>
      <SectionCard>
        <CardTitle
          icon={Clock}
          right={
            <button
              type="button"
              onClick={() => setDayOpen(true)}
              aria-haspopup="dialog"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Tag ansehen
            </button>
          }
        >
          Heute im Blick
        </CardTitle>
        <p className="text-sm font-semibold">{panel.headline}</p>
        {/* Ein Block für beide Raster: am Handy je Zeile „Bezeichnung …
            Wert“ (die Karte bleibt so schmal wie ihre Antwort), ab sm die
            drei Spalten mit der Einordnung darunter. */}
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs leading-snug sm:grid-cols-3 sm:gap-3">
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-on-surface-variant">
              {panel.tied ? "Günstigste Stunden" : "Günstigste Stunde"}
            </dt>
            <dd className="font-mono font-semibold tabular-nums text-primary">
              {panel.best
                ? `${panel.bestLabel} · ${euroPerLiter(panel.best.value)}`
                : "—"}
            </dd>
            <span className={noteClass}>
              {panel.best
                ? euroPerLiter(panel.best.value)
                : "keine offene Meldung"}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-on-surface-variant">Tagesmedian</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {panel.median !== null ? euroPerLiter(panel.median) : "—"}
            </dd>
            <span className={noteClass}>
              {panel.spreadCt !== null
                ? `Spanne ${centPerLiter(panel.spreadCt)} zwischen bester und teuerster Stunde`
                : "noch kein Verlauf"}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-on-surface-variant">Jetzt</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {panel.nowValue !== null ? euroPerLiter(panel.nowValue) : "—"}
            </dd>
            <span className={noteClass}>
              {panel.nowVsMedianCt === null
                ? "noch kein Vergleich"
                : Math.abs(panel.nowVsMedianCt) < 0.05
                  ? "auf Höhe des Tagesmedians"
                  : panel.nowVsMedianCt < 0
                    ? `${centPerLiter(Math.abs(panel.nowVsMedianCt))} unter dem Tagesmedian`
                    : `${centPerLiter(panel.nowVsMedianCt)} über dem Tagesmedian`}
            </span>
          </div>
        </dl>
        <div className="mt-3 hidden lg:block">
          <DayStrip cells={stripCells} />
          <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
            {panel.coverage} Zahl = €/L (Stunden-Minimum) · Balken = Höhe im
            Tagesverlauf · Rahmen = jetzt. {stripBandNote(stripBand)}
          </p>
          <div className="mt-4 border-t border-outline-variant pt-3">
            <HourBars outlook={outlook} />
          </div>
        </div>
      </SectionCard>

      <BottomSheet
        open={dayOpen}
        title="Heute im Blick — Tagesstreifen"
        onClose={() => setDayOpen(false)}
      >
        <DayStrip cells={stripCells} />
        <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
          {panel.coverage} {stripBandNote(stripBand)}
        </p>
        <div className="mt-4 border-t border-outline-variant pt-3">
          <HourBars outlook={outlook} />
        </div>
      </BottomSheet>
    </>
  );
}

/** Seitspalte: Was-wäre-wenn, Tankstand, was Warten bringt. */
function SideColumn() {
  const ov = useOverview();
  const {
    decideRes,
    stations,
    nowPricesAt,
    nowForecastAt,
    effLiters,
    effTimeValue,
    autoZ,
    assumptions,
    setAssumptions,
    tankPercent,
    setTankPercent,
  } = ov;
  const now = Date.now();
  const decide = decideRes.data ?? null;
  const liters = decide?.quantity?.used_liters ?? effLiters;
  const input = {
    decide,
    stations,
    selectedId: ov.selectedId,
    liters,
    now,
    latestBy: assumptions.latestBy,
    timeValue: effTimeValue,
  };
  const freshness = nowFreshness({ pricesAt: nowPricesAt, forecastAt: nowForecastAt, now });
  const window =
    decide?.windows_today?.[0] ?? decide?.primary?.recommended_window ?? null;
  const priceNow = nowBestNow(input).price ?? decide?.primary?.station?.price_now ?? null;
  const benefit =
    decide && (decide.primary?.action === "wait" || decide.primary?.action === "refuel_now")
      ? guideBenefit({
          tone: guideTone({
            action: decide.primary.action,
            tone: decide.primary.action === "wait" ? "blue" : "green",
            expired: false,
          }),
          centDiff: savingPerLiterCt(priceNow, window?.expected_price ?? null),
          liters,
          atIso: window?.start ?? null,
        })
      : null;
  const hint = assumptionHint(input);
  const [litersDraft, setLitersDraft] = useState<number | null>(null);
  const [latestByDraft, setLatestByDraft] = useState("");
  const [timeValueDraft, setTimeValueDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const commitLiters = (value: number) => {
    const { min, max } = PROFILE_BOUNDS.liters;
    if (!Number.isFinite(value) || value < min || value > max) {
      setNote(`Tankmenge: Zahl zwischen ${deTrimmed(min, 0)} und ${deTrimmed(max, 0)} L.`);
      return;
    }
    setNote(null);
    setLitersDraft(null);
    setAssumptions((current) => ({ ...current, liters: Math.round(value) }));
  };
  const commitLatestBy = () => {
    if (!latestByDraft) {
      setAssumptions((current) => ({ ...current, latestBy: null }));
      return;
    }
    const iso = timeInputToBerlinIso(latestByDraft, now);
    if (!iso) {
      setNote("Zeitformat: HH:MM — z. B. 17:30.");
      return;
    }
    setNote(null);
    setAssumptions((current) => ({ ...current, latestBy: iso }));
  };
  const commitTimeValue = () => {
    const raw = timeValueDraft.trim();
    if (raw === "") {
      setAssumptions((current) => ({ ...current, timeValue: null }));
      return;
    }
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 30) {
      setNote("Zeitwert: Zahl zwischen 0 und 30 €/h (0 = Auto).");
      return;
    }
    setNote(null);
    setAssumptions((current) => ({ ...current, timeValue: value }));
  };

  return (
    <>
      <SectionCard>
        <CardTitle icon={Clock}>Was wäre wenn</CardTitle>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          Die Antwort rechnet mit {deTrimmed(liters, 0)} L und einem Zeitwert
          von {euroPerHourText(effTimeValue, autoZ)}. Ändere die Annahmen — die
          Empfehlung oben folgt sofort.
        </p>
        <div className="mt-3">
          <PrecisionSlider
            id="v3-liters"
            label="Tankmenge"
            value={litersDraft ?? Math.round(liters)}
            onChange={(value) => {
              setLitersDraft(value);
              commitLiters(value);
            }}
            min={PROFILE_BOUNDS.liters.min}
            max={PROFILE_BOUNDS.liters.max}
            step={1}
            unit="L"
            valueText={litersDraft !== null ? `${deTrimmed(litersDraft, 0)} L` : undefined}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-on-surface-variant">
            Spätestens tanken
            <input
              type="time"
              aria-label="Spätestens tanken (Uhrzeit)"
              value={latestByDraft}
              onChange={(event) => setLatestByDraft(event.target.value)}
              onBlur={commitLatestBy}
              className={`mt-1 w-full border border-outline-variant bg-sc-lowest p-2 text-sm text-on-surface ${radius.control}`}
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            Zeitwert (€/h, 0 = Auto)
            <input
              type="text"
              inputMode="decimal"
              aria-label="Zeitwert in Euro pro Stunde"
              value={timeValueDraft}
              placeholder={deTrimmed(effTimeValue, 0)}
              onChange={(event) => setTimeValueDraft(event.target.value)}
              onBlur={commitTimeValue}
              className={`mt-1 w-full border border-outline-variant bg-sc-lowest p-2 text-sm text-on-surface ${radius.control}`}
            />
          </label>
        </div>
        {note && (
          <p role="status" className="mt-2 text-xs text-warn">
            {note}
          </p>
        )}
        {hint && (
          <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
            {hint}
          </p>
        )}
        {(assumptions.liters !== null ||
          assumptions.latestBy !== null ||
          assumptions.timeValue !== null) && (
          <button
            type="button"
            onClick={() => {
              setLitersDraft(null);
              setLatestByDraft("");
              setTimeValueDraft("");
              setNote(null);
              setAssumptions({ liters: null, latestBy: null, timeValue: null });
            }}
            className={`tap-44 mt-3 inline-flex items-center gap-2 border border-outline-variant px-3 py-2 text-xs font-semibold hover:bg-sc-low ${radius.chip}`}
          >
            <RefreshCw size={13} aria-hidden="true" /> Auf Profilwerte zurück
          </button>
        )}
      </SectionCard>

      <SectionCard>
        <CardTitle icon={Fuel}>Tankstand</CardTitle>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          Der Tankstand entscheidet, ob Warten überhaupt geht: Reicht er nicht
          bis zum Fenster, wird „Jetzt tanken“ rot statt blau.
        </p>
        <div
          role="group"
          aria-label="Tankstand in Vierteln"
          className="mt-3 flex flex-wrap gap-2"
        >
          {TANK_QUICK.map((quick) => (
            <button
              key={quick.label}
              type="button"
              aria-pressed={tankPercent === quick.percent}
              onClick={() => setTankPercent(quick.percent)}
              className={`tap-44 px-3 py-2 text-xs font-semibold ${radius.chip} ${
                tankPercent === quick.percent
                  ? "bg-secondary-container text-on-secondary-container"
                  : "border border-outline-variant text-on-surface-variant hover:bg-sc-low"
              }`}
            >
              {quick.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-on-surface-variant">
          {tankPercent === null
            ? "Noch kein Tankstand gesetzt — die Empfehlung rechnet ohne Reserve-Grenze."
            : `Angenommen: ${tankPercent} % im Tank.`}
        </p>
      </SectionCard>

      {benefit && (
        <SectionCard>
          <CardTitle icon={Equal}>Was Warten bringt</CardTitle>
          <BenefitWidget benefit={benefit} />
        </SectionCard>
      )}

      <div className="hidden lg:block">
        <FreshnessLine
          text={freshness.text}
          tone={freshness.tone}
          place={ov.activeCity}
          className="mt-0"
        />
      </div>
    </>
  );
}

/** „€/h“ in Alltagssprache — die Automatik wird benannt, nicht verschwiegen. */
function euroPerHourText(value: number, autoZ: { z: number; isPeak: boolean }) {
  if (value === 0) return "0 €/h (Zeit zählt nicht)";
  const auto = Math.abs(value - autoZ.z) < 0.001;
  return `${deTrimmed(value, 0)} €/h${auto ? " (aus der Tageszeit)" : ""}`;
}

/** Die Seite: Kopfzeile, Stufen-Banner, Antwort, Belege, Seitspalte. */
export function V3Guide() {
  const ov = useOverview();
  const now = Date.now();
  const decide = ov.decideRes.data ?? null;
  const level = guideLevel({
    online: ov.browserOnline,
    decisionReady: decide?.decision_ready ?? null,
  });
  const freshness = nowFreshness({
    pricesAt: ov.nowPricesAt,
    forecastAt: ov.nowForecastAt,
    now,
  });

  return (
    <div className="v3-page">
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Tank-Guide
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
          Soll ich jetzt tanken?
        </h1>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-on-surface-variant">
          Eine Frage, eine Antwort — {ov.activeCity || "ohne Stadt"} ·{" "}
          {ov.fuel === "diesel" ? "Diesel" : ov.fuel.toUpperCase()}
        </p>
      </div>

      {level !== "full" && (
        <GuideBanner
          level={level}
          stand={freshness.text}
          hasPrices={ov.stations.some((station) => station.price != null)}
          blockingReasons={decide?.blocking_reasons ?? null}
          retrying={ov.decideRes.pending}
          onRetry={ov.refreshNow}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        {/* Zeile 1 links: die Antwort und ihre Belege. */}
        <div className="space-y-4">
          <VerdictCard />
          <Facts />
          <Steps onGo={ov.handleNowNavigate} />
          <div className="lg:hidden">
            <FreshnessLine
              text={freshness.text}
              tone={freshness.tone}
              place={ov.activeCity}
              className="mt-0"
            />
          </div>
        </div>
        {/* Zeile 2: der Tagesverlauf über die **ganze** Breite. 19 Zellen
            brauchen je rund 36 px (Ratchet U2b); in einer 360-px-Seitspalte
            oder in der halben Zeile wären es 30 — die Zahlen liefen
            ineinander („sieht gequetscht aus“, 28.09.2026). Am Handy bleibt
            die Reihenfolge: direkt nach den Schritten, vor den Annahmen. */}
        <div className="lg:order-3 lg:col-span-2">
          <DayPanel />
        </div>
        {/* Zeile 1 rechts: Annahmen und Werkzeuge. `lg:order-2` hält sie
            neben der Antwort, damit der Tagesverlauf darunter die volle
            Breite behält. */}
        <div className="space-y-4 lg:order-2">
          <SideColumn />
        </div>
      </div>
    </div>
  );
}

