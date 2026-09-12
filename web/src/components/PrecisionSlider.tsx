// D1: Ausgelagerter Baustein aus Dashboard.tsx — Slider mit Begleit-Zahlenfeld.
// E6: Der Slider rastert grob (Verbrauch in 0,5er-Schritten, Tankmenge in
// Litern), das Feld daneben erlaubt den exakten Wert.

import { useState, type ReactNode } from "react";
import {
  commaToDot,
  deTrimmed,
  germanDecimalToNumber,
  sliderCommit,
} from "../data";

/**
 * E6: Slider mit Begleit-Zahlenfeld.
 *
 * Der Slider gibt die grobe Rasterung vor (Verbrauch in 0,5er-Schritten,
 * Tankmenge in Litern), das Feld daneben erlaubt den exakten Wert — 6,3
 * L/100 km ist mit einem 0,5er-Slider nicht erreichbar, beeinflusst aber
 * jede Umweg-Rechnung. Komma und Punkt werden akzeptiert (E2), außerhalb
 * des Bereichs wird geklemmt und offen gesagt.
 */
export function PrecisionSlider({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  valueText,
  valueSpeech,
  hint,
  icon,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  valueText?: string;
  valueSpeech?: string;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [clampedNote, setClampedNote] = useState<string | null>(null);
  const shown = draft ?? deTrimmed(value);
  // Kein Zahl-Wert, kein Fortschritt: das Feld behält den bisherigen Wert,
  // statt ihn zu löschen oder zu raten.
  const noNumber = draft !== null && draft.trim() !== "" && sliderCommit(draft, { min, max }) === null;

  const commit = (raw: string) => {
    const next = sliderCommit(raw, { min, max });
    if (next === null) return;
    const parsed = germanDecimalToNumber(raw);
    setClampedNote(
      parsed !== null && parsed !== next
        ? `außerhalb ${deTrimmed(min)}–${deTrimmed(max)} — auf ${deTrimmed(next)} geklemmt`
        : null,
    );
    onChange(next);
  };

  return (
    <div className="text-xs text-slate-400">
      <label
        htmlFor={id}
        className="flex items-center justify-between gap-2 text-xs text-slate-400"
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <span className="font-mono font-semibold text-emerald-400">
          {valueText ?? `${deTrimmed(value)} ${unit}`}
        </span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={valueSpeech ?? `${deTrimmed(value)} ${unit}`}
          onChange={(e) => {
            setClampedNote(null);
            onChange(Number(e.target.value));
          }}
          className="w-full"
        />
        <span className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${label} direkt eingeben (${unit}, ${deTrimmed(min)}–${deTrimmed(max)})`}
            aria-invalid={noNumber}
            value={shown}
            title={`${deTrimmed(min)}–${deTrimmed(max)} ${unit} — Komma oder Punkt, Enter übernimmt`}
            onChange={(e) => {
              const raw = commaToDot(e.target.value);
              setDraft(raw);
              commit(raw);
            }}
            onBlur={() => {
              setDraft(null);
              setClampedNote(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-white focus:border-emerald-500"
          />
          <span className="text-[10px] text-slate-500">{unit}</span>
        </span>
      </div>
      {clampedNote ? (
        <p className="mt-1 text-[10px] leading-snug text-amber-300">
          {clampedNote}
        </p>
      ) : noNumber ? (
        <p className="mt-1 text-[10px] leading-snug text-rose-300">
          Zahl erwartet (Komma oder Punkt) — {deTrimmed(min)}–{deTrimmed(max)}{" "}
          {unit}.
        </p>
      ) : (
        hint
      )}
    </div>
  );
}
