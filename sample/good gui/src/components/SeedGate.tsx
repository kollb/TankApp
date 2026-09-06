"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "checking" | "seeding" | "done" | "error";

export function SeedGate() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [msg, setMsg] = useState("Prüfe Datenbank …");
  const [err, setErr] = useState("");
  const started = useRef(false);

  const run = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setPhase("seeding");
    setMsg("Erzeuge 8 Wochen synthetischer E10-Preise im 5-Min-Raster (3 Städte, 12 Stationen, ≈ 145.000 Punkte) …");
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Seed fehlgeschlagen");
      setMsg(
        `Fertig: ${json.stations} Stationen, ${json.points.toLocaleString("de-DE")} 5-min-Punkte, ${json.decisions} Entscheidungs-Protokolle in ${(json.ms / 1000).toFixed(1)} s.`,
      );
      setPhase("done");
      setTimeout(() => router.refresh(), 600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
      started.current = false;
    }
  }, [router]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/status");
        const json = await res.json();
        if (alive && json.seeded) {
          router.refresh();
        } else if (alive) {
          setPhase("idle");
          setMsg("Bereit zum Erzeugen.");
        }
      } catch {
        if (alive) {
          setPhase("idle");
          setMsg("Bereit zum Erzeugen.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-500/15 text-xl">⛽</span>
          <div>
            <h1 className="text-2xl font-bold text-white">TankApp · Entscheidungs-Labor</h1>
            <p className="text-sm text-slate-400">Jetzt tanken, heute Abend warten oder woanders hinfahren — und hinterher messen, ob es richtig war.</p>
          </div>
        </div>

        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <p>
            Dieses Labor beantwortet die Frage <em className="text-emerald-300">„Liege ich mit meiner Entscheidung richtig?"</em> empirisch:
            Es erzeugt <strong>synthetische, aber realistisch modellierte</strong> 5-min-Preisserien nach dem Muster von Konzept v4
            (Tagesform mit Morgensprung & Abendtief, Wochenend-/Feiertagsmuster, Betreiber-Sprünge als Regime) für
            Frankfurt am Main (HE), München (BY) und Köln (NW).
          </p>
          <p>
            Aus den ersten <strong>6 Wochen (Training)</strong> lernt jede Station eine Entscheidungs-Regel
            („Warten bis zur billigsten Stunde lohnt — ja/nein, mit welcher Wahrscheinlichkeit?"). Die letzten{" "}
            <strong>2 Wochen (Out-of-Sample)</strong> sind der Prüfstand: Dort wird Tag für Tag protokolliert, ob die
            Empfehlung real Geld gespart hat — inklusive Entscheidungsverlust (Regret) in € und Kalibrierung der
            Wahrscheinlichkeiten. Keine Varianz-Fächer, sondern ein <strong>Entscheidungs-Scoreboard</strong>.
          </p>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          {phase === "idle" && (
            <button
              onClick={run}
              className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Demo-Daten erzeugen & Labor starten
            </button>
          )}
          {(phase === "checking" || phase === "seeding") && (
            <div className="flex w-full flex-col items-center gap-2 py-4">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              <p className="text-sm text-slate-300">{msg}</p>
              <p className="text-xs text-slate-500">Einmaliger Lauf (~10–30 s), danach liegen alle Daten in PostgreSQL.</p>
            </div>
          )}
          {phase === "error" && (
            <div className="w-full rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              <p className="font-semibold">Seed fehlgeschlagen:</p>
              <p className="mt-1 font-mono text-xs">{err}</p>
              <button onClick={run} className="mt-3 rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white">
                Erneut versuchen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
