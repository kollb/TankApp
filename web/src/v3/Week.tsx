// „Woche“ im Konzept-Neubau — wann in den nächsten Tagen, als Nachschlagewerk.
//
// Die Seite rendert, sie entscheidet nichts (D1): Tage, Sterne, Tank-Abgleich,
// Zusammenfassung, Wochenlinie und Begründung kommen aus `week.ts` — dieselben
// geprüften Funktionen wie in der bisherigen Ansicht. Neu ist allein die
// Anordnung für den Desktop:
//
//   Kopfzeile    die Frage („Wann tanken in den nächsten Tagen?“) + Herkunft
//   Antwort      die **eine** Karte mit Elevation: das gewählte Fenster —
//                Preis, Ersparnis, Sicherheit, Kalibrierung, Tank-Abgleich
//   Hauptspalte  die sieben Tage als Raster, darunter die Wochenlinie und die
//                Liste aller Fenster nach Ersparnis
//   Seitspalte   Tankstand (die Pflege lebt hier, wie bisher) + Datenstand
//
// Am Handy bleibt die Reihenfolge gleich: Antwort, Tage, Linie, Liste,
// Tankstand. Horizonte-Honesty bleibt ungeteilt — Tage 5–7 sind „noch
// unsicher“, Sterne gibt es nur mit messbarem P, und der Kalibrierhinweis
// steht an jedem Fenster.

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Gauge, Star } from "lucide-react";
import { FreshnessLine } from "../components/FreshnessLine";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { PrecisionSlider } from "../components/PrecisionSlider";
import { SkeletonPanel } from "../components/Skeleton";
import { Empty, radius } from "../components/ui";
import { berlinHour, deTrimmed, euro } from "../data";
import { learningNote, nowFreshness, TANK_QUICK } from "../now";
import { useOverview } from "../state/overview";
import {
  WEEK_CALIBRATION_24H,
  WEEK_CALIBRATION_SCENARIO,
  weekCalibrationNote,
  weekDays,
  weekExplanation,
  weekLine,
  weekTankLine,
  weekWindowList,
  weekWindowSummary,
  windowStars,
  type WeekDay,
} from "../week";
import { CardTitle, PageHeader, SectionCard } from "./parts";

/** 0–3 Sterne als Symbole **und** Wort (nie Farbe/Symbol allein). */
function Stars({ value, withWord = false }: { value: number; withWord?: boolean }) {
  const word =
    value >= 3
      ? "ziemlich sicher"
      : value === 2
        ? "eher sicher"
        : value === 1
          ? "unsicher"
          : "noch nicht messbar";
  if (value === 0)
    return withWord ? (
      <span className="text-xs text-on-surface-variant">{word}</span>
    ) : (
      <span className="text-xs text-on-surface-variant" aria-label={word}>
        ···
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${value} von 3 Sternen — ${word}`}
    >
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          size={11}
          fill={i < value ? "currentColor" : "none"}
          className={i < value ? "text-warn" : "text-outline-variant"}
          aria-hidden="true"
        />
      ))}
      {withWord && (
        <span className="ml-1 text-xs text-on-surface-variant">{word}</span>
      )}
    </span>
  );
}

/**
 * Wochenlinie: Tagesbestwerte als Mini-Balken (leer = kein Fenster).
 *
 * Richtung (TEXT-BEFUND T1): Der **höchste** Balken ist der **günstigste**
 * Tag — Legende, `aria-label` und `title` sagen dieselbe Richtung.
 */
function WeekLine({ days }: { days: WeekDay[] }) {
  const values = days
    .map((day) => day.window?.expected_price ?? null)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return (
    <div
      className="flex items-end gap-1.5"
      role="img"
      aria-label="Wochenlinie: erwartete Tagesbestpreise — höherer Balken ist der günstigere Tag"
    >
      {days.map((day) => {
        const value = day.window?.expected_price ?? null;
        const height = value === null ? 4 : 10 + ((max - value) / span) * 34;
        return (
          <div key={day.index} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full rounded-t ${
                value === null
                  ? "bg-sc-low"
                  : day.uncertain
                    ? "bg-outline-variant"
                    : "bg-primary/70"
              }`}
              style={{ height: `${height}px` }}
              title={
                value === null
                  ? `${day.shortDay} ${day.date} — kein Fenster`
                  : `${day.shortDay} ${day.date} — erwartet ${deTrimmed(value, 3)} €/L${
                      value === min ? " (günstigster Tag der Woche)" : ""
                    }`
              }
            />
            <span className="text-xs font-semibold text-on-surface-variant">
              {day.shortDay}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatWindowRange(window: { start: string; end: string }): string {
  const from = berlinHour(new Date(window.start));
  const to = berlinHour(new Date(window.end));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "—";
  return `${String(from).padStart(2, "0")}–${String(to).padStart(2, "0")} Uhr`;
}

function dayShort(day: WeekDay): string {
  return `${day.shortDay}${day.isToday ? " (heute)" : ""}`;
}

export function V3Week() {
  const ov = useOverview();
  const {
    activeCity,
    stations,
    decideRes,
    price,
    selected,
    tankPercent,
    setTankPercent,
    tankCapacity,
    consumption,
    nowPricesAt,
    nowForecastAt,
    refreshNow,
    handleNowNavigate,
    openLabor,
    fuel,
  } = ov;
  const now = Date.now();
  const decide = decideRes.data ?? null;
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);
  const [tankOpen, setTankOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const days = useMemo(
    () => weekDays(decide?.windows_week ?? null, now),
    [decide?.windows_week, now],
  );
  const defaultIdx = useMemo(() => {
    const withWindow = days.find((day) => day.window);
    return withWindow ? withWindow.index : 0;
  }, [days]);
  const current: WeekDay =
    days[selectedIdx !== null && days[selectedIdx] ? selectedIdx : defaultIdx] ??
    days[0];
  const summary = weekWindowSummary(current, decide, price(selected), now);
  const list = weekWindowList(days);
  const line = weekLine(days);
  const tankLine = weekTankLine(decide?.tank ?? null, tankPercent, tankCapacity);
  const freshness = nowFreshness({ pricesAt: nowPricesAt, forecastAt: nowForecastAt, now });
  const explanation = current?.window
    ? weekExplanation(current, decide, price(selected), now)
    : null;
  const learning = learningNote(decide);
  const setup = stations.length === 0 && !decideRes.error;

  // Auswahl zurücksetzen, wenn der gewählte Tag kein Fenster mehr hat —
  // sonst zeigt das Detail eine Leere.
  useEffect(() => {
    if (selectedIdx !== null && !days[selectedIdx]?.window) {
      setSelectedIdx(null);
    }
  }, [selectedIdx, days]);

  return (
    <div className="v3-page">
      <PageHeader
        kicker="Woche"
        title="Wann tanken in den nächsten Tagen?"
        subtitle={
          <>
            Nachschlagewerk, kein Wecker — {activeCity || "ohne Stadt"} ·{" "}
            {fuel === "diesel" ? "Diesel" : fuel.toUpperCase()}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        {/* Zeile 1 links: die Antwort — das gewählte Fenster. */}
        <div className="space-y-4">
          {setup ? (
            <SectionCard>
              <CardTitle icon={CalendarDays}>Noch keine Fenster</CardTitle>
              <p className="text-sm leading-relaxed text-on-surface-variant">
                Noch keine Stationen — erst das Polling-Set, dann die Fenster.
                Die Wochenplanung rechnet aus denselben Messwerten wie die
                Startseite; sie erfindet keinen Preis, um den Plan zu füllen.
              </p>
              <button
                type="button"
                onClick={() => handleNowNavigate("system")}
                className={`tap-44 m3-btn-now mt-3 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold ${radius.chip}`}
              >
                Einrichtung ansehen
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </SectionCard>
          ) : decideRes.pending && !decide ? (
            <SkeletonPanel lines={3} label="Fenster werden berechnet" />
          ) : problemCode ? (
            <LoadError
              errorCode={problemCode}
              detail={decide?.detail ?? null}
              fallback="Die Wochen-Fenster sind derzeit nicht erreichbar."
              onRetry={refreshNow}
            />
          ) : current?.window && summary && list.length > 0 ? (
            <article
              className={`border p-5 sm:p-6 elev-1 ${radius.card} border-primary/40 bg-primary-container`}
              aria-labelledby="v3-week-summary"
            >
              <p className="text-xs font-bold uppercase tracking-wider opacity-80">
                Ausgewählt · {dayShort(current)} {current.date}
              </p>
              <h2
                id="v3-week-summary"
                className="mt-2 text-2xl font-black leading-tight tracking-tight sm:text-3xl"
              >
                {summary.headline}
              </h2>
              <p className="mt-3 text-lg font-semibold">
                {formatWindowRange(current.window)} · erwartet{" "}
                {deTrimmed(current.window.expected_price, 3)} €/L
              </p>
              {summary.savingLine && (
                <p className="mt-1 text-sm leading-relaxed opacity-90">
                  {summary.savingLine}
                </p>
              )}
              <p className="mt-2 max-w-prose text-sm leading-relaxed opacity-90">
                {summary.security}
              </p>
              <p className="mt-1 text-xs leading-relaxed opacity-80">
                {weekCalibrationNote(current.index)}
                {current.uncertain ? " · noch unsicher" : ""}
              </p>
              {summary.tank && (
                <p
                  className={`mt-2 text-sm font-semibold ${
                    summary.tank.tone === "bad"
                      ? "text-error"
                      : summary.tank.tone === "warn"
                        ? "text-warn"
                        : ""
                  }`}
                >
                  Tank: {summary.tank.text}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleNowNavigate("stations")}
                  className={`tap-44 inline-flex items-center gap-2 bg-on-primary-container/90 px-4 py-2.5 text-sm font-bold ${radius.chip}`}
                >
                  Stationen ansehen
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  aria-haspopup="dialog"
                  className={`tap-44 inline-flex items-center gap-2 border border-current/30 px-4 py-2.5 text-sm font-bold ${radius.chip}`}
                >
                  Warum?
                </button>
              </div>
            </article>
          ) : (
            <SectionCard>
              <CardTitle icon={CalendarDays}>Kein Fenster mit Vorsprung</CardTitle>
              <Empty>
                {learning ??
                  "Keine Fenster mit Vorsprung in den nächsten 7 Tagen — die App rät nicht. Die aktuellen Preise stehen in „Stationen“."}
              </Empty>
            </SectionCard>
          )}

          {/* Die sieben Tage: Auswahl und Sicherheit an einem Ort. */}
          {list.length > 0 && (
            <SectionCard>
              <CardTitle icon={CalendarDays}>Beste Fenster (7 Tage)</CardTitle>
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
                role="listbox"
                aria-label="Beste Fenster je Tag der nächsten 7 Tage"
              >
                {days.map((day) => {
                  const isSelected = current?.index === day.index;
                  const hasWindow = !!day.window;
                  return (
                    <button
                      key={day.index}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setSelectedIdx(day.index)}
                      disabled={!hasWindow}
                      className={`tap-44 flex min-h-24 flex-col items-start gap-1 border p-2.5 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary-container text-on-primary-container"
                          : hasWindow
                            ? "border-outline-variant bg-sc-low hover:bg-sc-lowest"
                            : "cursor-default border-outline-variant/60 bg-sc-low opacity-70"
                      } ${radius.chip} ${day.uncertain && hasWindow ? "opacity-80" : ""}`}
                    >
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {day.shortDay}
                        {day.isToday ? " · heute" : ""}{" "}
                        <span className="font-normal normal-case opacity-80">
                          {day.date}
                        </span>
                      </span>
                      {hasWindow && day.window ? (
                        <>
                          <span className="font-mono text-xs font-bold text-primary">
                            {formatWindowRange(day.window)}
                          </span>
                          <Stars value={day.stars} />
                          {day.uncertain && (
                            <span className="text-xs opacity-80">
                              noch unsicher
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs opacity-70">—</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                Sicherheit zeigen die Sterne unter jedem Fenster (bis drei —
                die Bedeutung im Detail, Schwellen im Labor). Leere Tage: kein
                Fenster mit Vorsprung — keine Erfindung. Tage 5–7 sind „noch
                unsicher“: {WEEK_CALIBRATION_24H}, Folgetage{" "}
                {WEEK_CALIBRATION_SCENARIO}.
              </p>
            </SectionCard>
          )}

          {/* Wochenlinie — über die volle Breite: sie braucht sieben Spalten. */}
          {list.length > 0 && (
            <SectionCard>
              <CardTitle icon={Gauge}>Wochenlinie (Tagesbestwerte)</CardTitle>
              <WeekLine days={days} />
              <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                Balken = günstigster erwarteter Preis des Tages: höher =
                günstiger · grau = kein Fenster.
              </p>
            </SectionCard>
          )}
        </div>

        {/* Zeile 2 (Desktop: darunter, über die ganze Breite): die Liste. */}
        {list.length > 0 && (
          <div className="lg:order-3 lg:col-span-2">
            <SectionCard className="overflow-hidden p-0">
              <p className="border-b border-outline-variant px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Alle Fenster nach Ersparnis
              </p>
              <div className="divide-y divide-outline-variant">
                {list.map((entry) => (
                  <button
                    key={entry.window.start}
                    type="button"
                    onClick={() => setSelectedIdx(entry.day.index)}
                    className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-left text-xs transition-colors hover:bg-sc-low"
                  >
                    <span>
                      {dayShort(entry.day)} {formatWindowRange(entry.window)}
                      {entry.day.uncertain ? " · noch unsicher" : ""}
                    </span>
                    <span className="flex items-center gap-3">
                      <span
                        title={
                          entry.window.p_raw != null &&
                          entry.window.p_competitors != null
                            ? `Sterne: gegen die Zufallsbasis von ${
                                entry.window.p_competitors + 1
                              } vergleichbaren Fenstern normalisiert (Rohwert ${Math.round(
                                entry.window.p_raw * 100,
                              )} %).`
                            : "Sterne: Sicherheit des Fensters"
                        }
                      >
                        <Stars value={windowStars(entry.window.p)} />
                      </span>
                      <span className="font-mono text-on-surface-variant">
                        {deTrimmed(entry.window.expected_price, 3)} €/L
                      </span>
                      <span
                        className={`font-mono font-bold ${
                          entry.savingEur != null && entry.savingEur > 0
                            ? "text-primary"
                            : "text-on-surface-variant"
                        }`}
                      >
                        {entry.savingEur != null && entry.savingEur > 0
                          ? `${euro(entry.savingEur)} € günstiger`
                          : "—"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {/* Zeile 1 rechts: Tankstand — die Pflege lebt hier, wie bisher. */}
        <div className="space-y-4 lg:order-2">
          <SectionCard>
            <CardTitle
              icon={Gauge}
              right={
                <button
                  type="button"
                  onClick={() => setTankOpen((value) => !value)}
                  aria-expanded={tankOpen}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Ändern
                </button>
              }
            >
              Tankstand
            </CardTitle>
            <p className="text-sm font-semibold">{tankLine.text}</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              {tankLine.detail}
            </p>
            {tankOpen && (
              <div className="mt-3 border-t border-outline-variant pt-3">
                <div
                  role="group"
                  aria-label="Tankstand in Vierteln"
                  className="flex flex-wrap items-center gap-2"
                >
                  {TANK_QUICK.map((item) => (
                    <button
                      key={item.percent}
                      type="button"
                      onClick={() => setTankPercent(item.percent)}
                      aria-pressed={tankPercent === item.percent}
                      className={`tap-44 px-3 py-2 text-xs font-semibold ${radius.chip} ${
                        tankPercent === item.percent
                          ? "bg-secondary-container text-on-secondary-container"
                          : "border border-outline-variant text-on-surface-variant hover:bg-sc-low"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  {tankPercent !== null && (
                    <button
                      type="button"
                      onClick={() => setTankPercent(null)}
                      className={`tap-44 border border-outline-variant px-3 py-2 text-xs text-on-surface-variant hover:bg-sc-low ${radius.chip}`}
                    >
                      Keine Angabe
                    </button>
                  )}
                </div>
                {tankPercent !== null && (
                  <div className="mt-3">
                    <PrecisionSlider
                      id="v3-week-tankPercent"
                      label="Füllstand"
                      icon={<Gauge size={14} />}
                      value={tankPercent}
                      onChange={(value) => setTankPercent(value)}
                      min={0}
                      max={100}
                      step={5}
                      unit="%"
                      valueText={`${deTrimmed(tankPercent, 0)} % Füllstand`}
                      valueSpeech={`${deTrimmed(tankPercent, 0)} Prozent Füllstand`}
                    />
                    <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                      Tankgröße {deTrimmed(tankCapacity, 0)} L · Verbrauch{" "}
                      {deTrimmed(consumption, 1)} L/100 km — geändert wird beides
                      unter „Ich“.
                    </p>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <FreshnessLine
            text={freshness.text}
            tone={freshness.tone}
            place={activeCity}
            extra={
              line.length > 0
                ? ` · ${WEEK_CALIBRATION_24H}, Folgetage: ${WEEK_CALIBRATION_SCENARIO}`
                : ""
            }
          />
        </div>
      </div>

      {explanation && (
        <Level1Sheet
          open={sheetOpen}
          title={`Warum ${summary?.headline ?? "dieses Fenster"}?`}
          sentences={explanation.sentences}
          source={explanation.source}
          labHint={explanation.labHint}
          onDeepen={(section) => {
            setSheetOpen(false);
            openLabor(section);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
