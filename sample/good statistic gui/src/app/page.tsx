import type { ReactNode } from "react";
import { getSeedState } from "@/lib/engine/seed";
import { loadLabData } from "@/lib/data";
import { SeedGate } from "@/components/SeedGate";
import { DecisionLab } from "@/components/DecisionLab";

export const dynamic = "force-dynamic";

export default async function Page() {
  const state = await getSeedState();
  const labData = state.seeded ? await loadLabData() : null;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6">
      {/* ---------- Hero ---------- */}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-500/15 text-lg">⛽</span>
          <div className="mr-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
              TankApp · Entscheidungs-Labor · Konzept v4
            </p>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">
              „Liege ich mit meiner Entscheidung richtig?“ — messbar gemacht
            </h1>
          </div>
          <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-300">
            Demo · synthetische Preise (MTS-K-Marktstruktur)
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <p className="text-sm leading-relaxed text-slate-300">
            Graphen mit Varianzbändern sind <strong className="text-white">keine Handlungsanweisung</strong>. Tanken ist eine
            Entscheidung zwischen konkreten Aktionen — <em>jetzt tanken</em>, <em>auf das Abendtief warten</em>,{" "}
            <em>zur anderen Station fahren</em> — mit einem Ergebnis in <strong className="text-white">€</strong>. Dieses Labor
            bildet die Kette ab, die aus Prognosen Entscheidungen macht, und prüft sie{" "}
            <strong className="text-white">out-of-sample</strong>: 6 Wochen Training, 2 Wochen Prüfstand, Tag für Tag protokolliert.
          </p>
          <div className="flex flex-wrap content-start gap-2 text-[11px] text-slate-400">
            <Tag>3 Kampagnen: Frankfurt (HE) · München (BY) · Köln (NW)</Tag>
            <Tag>E10 · 5-min-Raster · Fenster 06:00–23:55 (MEZ)</Tag>
            <Tag>Feiertage je Bundesland (06.01. nur BY)</Tag>
            <Tag>12 Stationen · Preissprung-Regime wie §3 Konzept</Tag>
            <Tag>Entscheidung 08:00 · 40 L · ε-Schwelle</Tag>
          </div>
        </div>

        {/* Die Antwort in vier Schritten */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Principle
            n="1"
            title="Aktionen statt Intervalle"
            text="Jede Aktion hat eine Verteilung möglicher €-Ergebnisse. Ein 95-%-Band sagt nicht, was du tun sollst — der Erwartungswert je Aktion und die Schwelle, ab der sich Handeln lohnt, schon."
          />
          <Principle
            n="2"
            title="Regel aus dem Training"
            text="Aus den letzten 6 Wochen lernt jede Station μ = E[Ersparnis „Warten bis zur billigsten Stunde“]. Regel: Warten, wenn μ ≥ ε (z. B. 1 ct/L). P(S>0) wird ausgewiesen, entschieden wird über μ."
          />
          <Principle
            n="3"
            title="Out-of-Sample-Protokoll"
            text="14 Tage Prüfstand: Jede Empfehlung wird mit der Realität abgeglichen (✓/✗) und in € bewertet — realisierte Ersparnis und Entscheidungsverlust (Regret) gegenüber perfekter Sicht."
          />
          <Principle
            n="4"
            title="Kalibrierung & Regret"
            text="„Mit 78 % ist der Abend billiger“ ist erst brauchbar, wenn behauptete und beobachtete Häufigkeit übereinstimmen (Reliability-Plot). Die Leit-Kennzahl ist der Regret in €/Füllung — nicht die Bandbreite."
          />
        </div>
      </header>

      {labData ? <DecisionLab data={labData} /> : <SeedGate />}

      {/* ---------- Footer ---------- */}
      <footer className="mt-14 border-t border-slate-800/80 pt-6 text-xs leading-relaxed text-slate-500">
        <p>
          <strong className="text-slate-400">Methodik-Hinweis:</strong> Dieses Labor verwendet synthetische Preisserien mit der
          Marktstruktur von Konzept v4 (Tagesform mit Morgensprung und Abendtief, Wochenend-/Feiertagsmuster, diskontinuierliche
          Betreiber-Sprünge). Die Modell-Schätzung nutzt ausschließlich das Trainingsfenster; alle Urteile sind out-of-sample.
          Die Stichprobe (14 Tage je Station) ist klein — die Richtung der Kennzahlen zählt, nicht die letzte Nachkommastelle.
        </p>
        <p className="mt-2">
          <strong className="text-slate-400">Datenquellen (produktiv):</strong> „Daten: MTS-K via tankerkoenig.de (CC BY 4.0)“ —
          im Demo-Datensatz sind keine echten Preise enthalten. Zeitwert-Profil und Umweg-Formel nach Konzept v4 §7 (z_used,
          peak/offpeak); Entscheidungs-Kalibrierung analog zu Rolling-PICP/Konfidenz-Badge in §3.3.
        </p>
        <p className="mt-2 text-slate-600">
          TankApp · Entscheidungs-Labor — die Frage „Richtig entschieden?“ wird beantwortet als: Trefferquote der Empfehlung +
          Entscheidungsverlust in € + Kalibrierung der Entscheidungs-Wahrscheinlichkeit. Kein Varianz-Fächer als Handlungsinput.
        </p>
      </footer>
    </main>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-slate-800 bg-slate-900/80 px-2.5 py-1">{children}</span>;
}

function Principle({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-300">
          {n}
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}
