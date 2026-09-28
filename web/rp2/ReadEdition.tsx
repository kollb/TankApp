import { useEffect, useState } from "react";
import { Fuel, RefreshCw } from "lucide-react";
import {
  ageLabel,
  clockLabel,
  countLabel,
  euroPerLiter,
} from "../src/data";
import { BottomSheet } from "../src/components/BottomSheet";
import {
  THEME_CHOICES,
  THEME_CHOICE_LABEL,
  useAppTheme,
} from "../src/theme";

// Deliberately a separate contract: no NAS decision hooks, writes or service
// worker. A Pi tab stays pi-v1 even after the NAS becomes ready again.
type Station = {
  station_id: string;
  name: string;
  price: number | null;
  status: string;
  fresh: boolean;
  observed_at: string | null;
  maps_url: string | null;
};
type Health = {
  nas: {
    online: boolean;
    configured?: boolean;
    base_url?: string;
    state: string;
  };
  city_options: { value: string; label: string }[];
  prices: { fetched_at: string | null };
};
type Forecast = {
  station_id: string;
  name: string;
  valid_for_display: boolean;
  points: { timestamp: string; q025?: number; q50?: number; q975?: number }[];
};
type Series = { hours: { hour: string; value: number | null }[] };
type FuelType = "e10" | "e5" | "diesel";
const card = "rounded-2xl border border-slate-800 bg-slate-900 p-5";
const button =
  "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm";
function saved<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem(`tankapp.${key}`) ?? "null") ?? fallback
    );
  } catch {
    return fallback;
  }
}
export async function piGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    headers: { "X-TankApp-UI": "pi-v1" },
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error("Lokale Daten sind gerade nicht erreichbar.");
  return response.json();
}
export function ReadEdition() {
  const [fuel, setFuel] = useState<FuelType>(() => {
    const value = saved<string>("fuel", "e10");
    return value === "e5" || value === "diesel" ? value : "e10";
  });
  const [city, setCity] = useState(() => saved("city", ""));
  const [liters, setLiters] = useState(() => String(saved("liters", 40)));
  const [tab, setTab] = useState("Jetzt");
  const [health, setHealth] = useState<Health | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [forecastAt, setForecastAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Station | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState(false);
  const [pending, setPending] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [switching, setSwitching] = useState(false);
  // Dieselben Regeln wie in der Hauptansicht (src/theme.ts): „System“ ist
  // die Voreinstellung, ohne Angabe des Geräts bleibt es dunkel. Die
  // Leseausgabe bringt dafür keine eigene Logik mit — sonst würden die
  // beiden Oberflächen bei der nächsten Änderung auseinanderlaufen.
  const { choice: themeChoice, setChoice: setThemeChoice } = useAppTheme();
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setStations([]);
    setForecasts([]);
    setSelected(null);
    async function load() {
      const query = new URLSearchParams({ fuel, city });
      try {
        const [h, s, f] = await Promise.all([
          piGet<Health>("health", controller.signal),
          piGet<{ stations: Station[] }>(
            `stations?${query}`,
            controller.signal,
          ),
          piGet<{ forecasts: Forecast[]; generated_at: string }>(
            `forecasts?${query}`,
            controller.signal,
          ).catch(() => null),
        ]);
        if (controller.signal.aborted) return;
        setHealth(h);
        setStations(s.stations);
        setForecasts(f?.forecasts ?? []);
        setForecastAt(f?.generated_at ?? null);
        setCacheError(!f);
        setError(null);
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Lokale Daten sind gerade nicht erreichbar — Neu laden versucht es erneut.",
          );
      } finally {
        if (!controller.signal.aborted) {
          setPending(false);
          setNow(Date.now());
        }
      }
    }
    void load();
    const timer = globalThis.setInterval(() => void load(), 30000);
    return () => {
      controller.abort();
      globalThis.clearInterval(timer);
    };
  }, [fuel, city, refresh]);
  useEffect(() => {
    setSeries(null);
    setDetailError(false);
    if (!selected) return;
    const controller = new AbortController();
    void piGet<Series>(
      `series?${new URLSearchParams({ station: selected.station_id, fuel })}`,
      controller.signal,
    )
      .then(setSeries)
      .catch(() => {
        if (!controller.signal.aborted) setDetailError(true);
      });
    return () => controller.abort();
  }, [selected, fuel]);
  async function switchToNas() {
    setSwitching(true);
    try {
      const result = await piGet<{ online: boolean; hint?: string }>(
        "nas-check",
      );
      if (!result.online) {
        setError(
          result.hint ?? "NAS nicht bereit — der Lesemodus bleibt aktiv.",
        );
        return;
      }
      const amount = Number(liters.replace(",", "."));
      if (!Number.isFinite(amount) || amount < 10 || amount > 100) {
        setError(
          "Tankmenge außerhalb des Bereichs — möglich sind 10 bis 100 L.",
        );
        return;
      }
      // Saving must succeed before navigation, including the currently typed value.
      localStorage.setItem("tankapp.liters", JSON.stringify(amount));
      localStorage.setItem("tankapp.fuel", JSON.stringify(fuel));
      localStorage.setItem(
        "tankapp.city",
        JSON.stringify(
          health?.city_options.find((c) => c.value === city)?.label ?? city,
        ),
      );
      window.location.assign("/");
    } catch {
      setError(
        "Ansichtswechsel nicht möglich — NAS-Prüfung oder lokale Sicherung fehlgeschlagen.",
      );
    } finally {
      setSwitching(false);
    }
  }
  const open = stations.filter((s) => s.status === "open" && s.price !== null);
  const fresh = open.filter((s) => s.fresh);
  const cheapest = [...(fresh.length ? fresh : open)].sort(
    (a, b) => a.price! - b.price!,
  )[0];
  const ready = health?.nas.online;
  const configured = health?.nas.configured ?? Boolean(health?.nas.base_url);
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 py-4">
        <a
          href="/?fallback=1"
          className="tap-44 flex items-center gap-2 text-xl font-black"
        >
          <Fuel className="text-emerald-400" />
          TankApp
        </a>
        <span className="rounded-full bg-slate-800 px-3 py-2 text-xs">
          Lesemodus · RP2
        </span>
        <button
          id="nas-pill"
          className={button}
          onClick={() => void switchToNas()}
          disabled={switching}
        >
          <span id="nas-text">
            {ready ? "NAS bereit — Vollversion öffnen" : "NAS prüfen"}
          </span>
        </button>
      </header>
      <p
        role="status"
        className="my-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
      >
        {!health
          ? "Lokaler Status wird geladen — noch keine Aussage zur NAS-Verbindung."
          : ready
            ? "Die vollständige Ansicht ist verfügbar — der Lesemodus bleibt bis zum Ansichtswechsel erhalten."
            : configured
              ? "NAS ist gerade nicht erreichbar — die Preise zeigen den letzten gemeldeten Stand. Zur Orientierung, nicht zur Entscheidung."
              : "NAS ist nicht konfiguriert — diese Ansicht zeigt lokale Preise. Zur Orientierung, nicht zur Entscheidung."}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="min-w-0 text-sm">
          Stadt{" "}
          <select
            id="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="max-w-full rounded-lg bg-slate-800 p-2"
          >
            <option value="">Alle Städte</option>
            {health?.city_options.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div
          id="fuel-tabs"
          role="group"
          aria-label="Kraftstoff"
          className="flex gap-1"
        >
          {(["e10", "e5", "diesel"] as const).map((f) => (
            <button
              key={f}
              data-fuel={f}
              aria-pressed={f === fuel}
              className={`${button} ${f === fuel ? "text-emerald-400" : ""}`}
              onClick={() => setFuel(f)}
            >
              {f === "diesel" ? "Diesel" : f.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="text-sm">
          Tankmenge{" "}
          <input
            id="liters"
            inputMode="decimal"
            value={liters}
            onChange={(e) => setLiters(e.target.value)}
            className="w-16 rounded-lg bg-slate-800 p-2"
          />{" "}
          L
        </label>
        <button
          id="refresh-btn"
          aria-label="Neu laden"
          className={button}
          onClick={() => setRefresh((n) => n + 1)}
          disabled={pending}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-500/40 p-3"
        >
          {error}
        </p>
      )}
      <nav aria-label="Lesemodus" className="mb-4 flex gap-2">
        {["Jetzt", "Stationen", "Mehr"].map((t) => (
          <button
            key={t}
            className={button}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Jetzt" && (
        <>
          <section className={`${card} shadow-lg`} aria-busy={pending}>
            <h1 id="answer-title" className="text-2xl font-black">
              Nur Preisvergleich — keine Empfehlung
            </h1>
            <p className="mt-3 text-3xl font-bold">
              {cheapest
                ? euroPerLiter(cheapest.price!)
                : pending
                  ? "Preise werden geladen …"
                  : "Kein offener Preis"}
            </p>
            <p className="mt-2">
              {cheapest?.name ??
                "Mit der nächsten offenen Preismeldung füllt sich der Vergleich."}
            </p>
            <p className="mt-3 text-sm text-slate-400">
              Tank- und Warteentscheidungen benötigen die geprüfte
              NAS-Entscheidung und das persönliche Profil.
            </p>
            {cheapest && (
              <p className="mt-2 text-sm text-amber-400">
                Preisstand {ageLabel(cheapest.observed_at, now)} — keine
                Freigabe
              </p>
            )}
          </section>
          <dl className={`${card} mt-4 grid gap-4 sm:grid-cols-3`}>
            <div>
              <dt className="text-slate-400">Jetzt hier</dt>
              <dd>{cheapest ? euroPerLiter(cheapest.price!) : "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Bestes Fenster</dt>
              <dd>Keine Freigabe im Lesemodus</dd>
            </div>
            <div>
              <dt className="text-slate-400">Tank reicht?</dt>
              <dd>Profilprüfung nur in der Vollversion</dd>
            </div>
          </dl>
          {cheapest && (
            <button
              className={`${button} mt-4`}
              onClick={() => setSelected(cheapest)}
            >
              Heute im Blick — Details
            </button>
          )}
        </>
      )}
      {tab === "Stationen" && (
        <section className={card}>
          <h1 className="text-xl font-bold">Stationen</h1>
          <p className="my-3 text-sm text-slate-400">
            {countLabel(stations.length)} Stationen · gemeldete Preise, kein
            Umwegurteil
          </p>
          {!stations.length && <p>Noch keine Preise in dieser Auswahl.</p>}
          <ul className="divide-y divide-slate-800">
            {stations.map((s) => (
              <li key={s.station_id} className="py-3">
                <button
                  className="flex w-full items-center justify-between gap-3 text-left"
                  onClick={() => setSelected(s)}
                >
                  <span className="min-w-0 break-words">{s.name}</span>
                  <strong className="shrink-0">
                    {s.status === "open" && s.price !== null
                      ? euroPerLiter(s.price)
                      : "Kein offener Preis"}
                  </strong>
                </button>
                <p className="mt-1 text-xs text-slate-400">
                  {s.status === "open"
                    ? "Als geöffnet gemeldet"
                    : "Nicht als geöffnet gemeldet"}{" "}
                  · {ageLabel(s.observed_at, now)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === "Mehr" && (
        <section className={`${card} space-y-4`}>
          <h1 className="text-xl font-bold">
            Mehr — Modellstand und Darstellung
          </h1>
          <div>
            <p className="mb-2 text-sm font-semibold">Darstellung</p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Darstellung (System, dunkel oder hell)"
            >
              {THEME_CHOICES.map((value) => (
                <button
                  key={value}
                  className={button}
                  aria-pressed={themeChoice === value}
                  onClick={() => setThemeChoice(value)}
                >
                  {THEME_CHOICE_LABEL[value]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-slate-400">
              „System“ folgt dem Gerät. Ohne Angabe des Geräts bleibt die
              Ansicht dunkel — auch hier.
            </p>
          </div>
          <h2 className="font-bold">
            Letzter Modellstand — seither keine neue Berechnung.
          </h2>
          <p className="text-sm text-slate-400">
            {forecastAt
              ? ageLabel(forecastAt, now)
              : "Kein Modellstand verfügbar"}
            . Beschreibende Quantile, keine Tankempfehlung und keine erwartete
            Nettoersparnis.
          </p>
          {cacheError && (
            <p>
              Kein Prognose-Cache verfügbar — nach einem Neustart füllt sich der
              RAM-Puffer mit dem nächsten erfolgreichen Abruf.
            </p>
          )}
          {forecasts
            .filter((f) => f.points?.length)
            .map((f) => (
              <div
                key={f.station_id}
                className="rounded-xl border border-slate-700 p-3"
              >
                <h3 className="font-bold">{f.name}</h3>
                {!f.valid_for_display ? (
                  <p>Modellstand veraltet — keine Kurve angezeigt.</p>
                ) : (
                  <div
                    className="overflow-x-auto"
                    role="region"
                    aria-label={`Modellstand ${f.name}`}
                    tabIndex={0}
                  >
                    <table className="w-full text-left text-sm">
                      <caption className="text-left">
                        Preisband des gespeicherten Modells
                      </caption>
                      <thead>
                        <tr>
                          <th>Zeit</th>
                          <th>Unteres Quantil</th>
                          <th>Median</th>
                          <th>Oberes Quantil</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.points.map((p, i) => (
                          <tr key={i}>
                            <td>{clockLabel(p.timestamp)}</td>
                            <td>
                              {p.q025 == null ? "—" : euroPerLiter(p.q025)}
                            </td>
                            <td>{p.q50 == null ? "—" : euroPerLiter(p.q50)}</td>
                            <td>
                              {p.q975 == null ? "—" : euroPerLiter(p.q975)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
        </section>
      )}
      <footer className="mt-6 text-xs leading-relaxed text-slate-400">
        Quelle: Tankerkönig · Lokaler Collector-Puffer. Es wird weitergesammelt
        — der Collector schreibt auch jetzt in den Puffer.
      </footer>
      <BottomSheet
        open={selected !== null}
        title={selected?.name ?? "Stationsdetails"}
        onClose={() => setSelected(null)}
      >
        <p className="mb-3 text-sm text-slate-400">
          Tagesverlauf aus dem lokalen Puffer — fehlende Meldungen bleiben leer.
        </p>
        {detailError ? (
          <p role="alert">Tagesverlauf gerade nicht erreichbar.</p>
        ) : !series ? (
          <p>Verlauf wird geladen …</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {series.hours.map((h) => (
              <div key={h.hour} className="rounded-lg bg-slate-800 p-2">
                <span>{countLabel(Number(h.hour))} Uhr</span>
                <p className="text-sm">
                  {h.value == null ? "—" : euroPerLiter(h.value)}
                </p>
              </div>
            ))}
          </div>
        )}
        {selected?.maps_url && /^https:\/\//.test(selected.maps_url) && (
          <a
            className={`${button} mt-4 inline-block`}
            href={selected.maps_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Route
          </a>
        )}
      </BottomSheet>
    </div>
  );
}
