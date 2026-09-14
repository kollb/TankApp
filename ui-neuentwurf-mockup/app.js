/* TankApp Neuentwurf – Mockup-Logik. Alle Zahlen sind erfundene Beispielzahlen. */
"use strict";

/* ---------------- Helfer ---------------- */
const $ = (sel) => document.querySelector(sel);
const eur = (n) => n.toFixed(2).replace(".", ",") + " €";
const eurl = (n) => n.toFixed(3).replace(".", ",") + " €/L";
const ct = (n) => (n > 0 ? "+" : "") + n.toFixed(1).replace(".", ",") + " ct/L";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function toast(msg) {
  const root = $("#toast-root");
  root.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { root.innerHTML = ""; }, 2600);
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

/* ---------------- Beispieldaten ---------------- */
const CITY = "Gütersloh", FUEL = "E10";
const STATIONS = [
  { id: "shell", name: "Shell", street: "Musterstraße 12", dist: 1.2, price: 1.709, net: -0.80, trend: [1.749,1.739,1.729,1.719,1.729,1.709,1.709], open: "geöffnet bis 22 Uhr", haus: -2.4 },
  { id: "star", name: "Star", street: "Bahnhofstraße 4", dist: 2.1, price: 1.719, net: -0.45, trend: [1.749,1.749,1.739,1.729,1.729,1.719,1.719], open: "geöffnet bis 21 Uhr", haus: -1.6 },
  { id: "aral", name: "Aral", street: "Nebenan, Kirchweg 1", dist: 0.4, price: 1.749, net: 0.00, trend: [1.759,1.749,1.759,1.749,1.749,1.749,1.749], open: "geöffnet bis 23 Uhr", haus: 0.8, ref: true },
  { id: "esso", name: "Esso", street: "Umgehungsstraße 30", dist: 3.4, price: 1.739, net: 0.35, trend: [1.769,1.759,1.749,1.749,1.739,1.739,1.739], open: "geöffnet bis 20 Uhr", haus: -0.4 },
  { id: "jet", name: "JET", street: "Südring 88", dist: 4.0, price: 1.759, net: 0.90, trend: [1.769,1.769,1.759,1.759,1.759,1.759,1.759], open: "geöffnet bis 22 Uhr", haus: 1.9 },
  { id: "freie", name: "Freie Tankstelle", street: "Dorfstraße 2", dist: 5.2, price: 1.699, net: 1.40, trend: [1.719,1.709,1.709,1.699,1.699,1.699,1.699], open: "geöffnet bis 19 Uhr", haus: -3.1 },
];
const DAYS = [
  { d: "So", date: "heute", win: "18–20", stars: 2, eur: 1.60, sec: "eher sicher", pct: 64, dim: false },
  { d: "Mo", date: "15.9.", win: "19–21", stars: 3, eur: 2.10, sec: "ziemlich sicher", pct: 82, dim: false },
  { d: "Di", date: "16.9.", win: "—", stars: 0, eur: 0, sec: "", pct: 0, dim: false },
  { d: "Mi", date: "17.9.", win: "18–20", stars: 2, eur: 1.40, sec: "eher sicher", pct: 71, dim: false },
  { d: "Do", date: "18.9.", win: "—", stars: 0, eur: 0, sec: "", pct: 0, dim: true },
  { d: "Fr", date: "19.9.", win: "—", stars: 0, eur: 0, sec: "", pct: 0, dim: true },
  { d: "Sa", date: "20.9.", win: "—", stars: 0, eur: 0, sec: "", pct: 0, dim: true },
];
const DIARY = [
  { t: "Mo 19–21 Uhr", pred: 1.689, real: 1.679, ok: true, note: "Abend-Senkung kam wie erwartet." },
  { t: "So 18–20 Uhr", pred: 1.719, real: 1.739, ok: false, note: "Sonntag blieb teuer — Feiertags-Effekt unterschätzt." },
  { t: "Sa 18–20 Uhr", pred: 1.729, real: 1.719, ok: true, note: "Band traf, Mitte fast genau." },
  { t: "Fr 19–21 Uhr", pred: 1.699, real: 1.709, ok: true, note: "Knapp daneben, aber im dunklen Band." },
];

/* ---------------- Zustand ---------------- */
const S = {
  mockState: "voll", // voll | s1 | s0 — nur Mockup-Schalter, im Produkt automatisch
  liters: 40, latestBy: "egal", timeValue: 12,
  tankQ: 1, selDay: 1, sort: "netto", cmpA: "shell", cmpB: "aral",
  observed: new Set(["shell", "aral"]),
  ichTab: "fahrzeug", bilanz: "monat",
  labOpen: { k1: true }, labScroll: null,
  ch1step: 4, eps: 1.0, diaryFilter: "alle",
  labReturn: "#/jetzt",
  behave: { sort: true, ops: true },
  belege: [
    { id: 1, date: "12.9.", station: "Shell, Musterstraße", liters: 38.2, price: 1.709, void: false },
    { id: 2, date: "5.9.", station: "Aral, Kirchweg", liters: 41.0, price: 1.749, void: false },
  ],
};
const station = (id) => STATIONS.find((s) => s.id === id);

/* ---------------- Mini-Charts (SVG) ---------------- */
function spark(values, w = 120, h = 26) {
  const min = Math.min(...values), max = Math.max(...values), r = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - 3 - ((v - min) / r) * (h - 6)).toFixed(1)}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linecap="round"/></svg>`;
}
function stripChart() {
  const cls = ["mid","mid","mid","","","mid","mid","","mid","mid","","mid","cheap","cheap","cheap","cheap","mid","mid"];
  const segs = cls.map((c, i) => `<div class="seg ${c}${i === 2 ? " now" : ""}" title="${6 + i} Uhr"></div>`).join("");
  return `<div class="strip" role="img" aria-label="Tagesverlauf: morgens mittel, ab 18 Uhr günstig, jetzt markiert">${segs}</div>
  <div class="strip-labels"><span>06</span><span>10</span><span>14</span><span>18</span><span>22</span><span>24</span></div>`;
}
function verlaufChart() {
  const W = 640, H = 180, P = 8;
  const line = [60, 66, 58, 70, 62, 74, 68, 80, 72, 88, 78, 96, 84, 90, 76, 60, 48, 40, 44, 52, 58, 64, 70, 66];
  const X = (i) => P + (i / (line.length - 1)) * (W - 2 * P);
  const pts = line.map((v, i) => `${X(i).toFixed(0)},${v}`).join(" ");
  const band = line.map((v, i) => `${X(i).toFixed(0)},${v - 22}`).join(" ") + " " +
    line.map((v, i) => `${X(line.length - 1 - i).toFixed(0)},${line[line.length - 1 - i] + 26}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Preisverlauf 7 Tage mit Üblich-Band, aktuell fallend">
    <polygon points="${band}" fill="rgba(14,165,233,0.15)"/>
    <polyline points="${pts}" fill="none" stroke="var(--info)" stroke-width="2.5"/>
    <circle cx="${X(line.length - 1)}" cy="${line[line.length - 1]}" r="5" fill="var(--accent)"/>
  </svg>`;
}
function fanChart(step) {
  const W = 640, H = 220;
  const mid = [150, 148, 145, 140, 132, 122, 110, 100, 96, 100, 110, 120];
  const X = (i) => 20 + (i / (mid.length - 1)) * (W - 40);
  const band = (w0, w1) =>
    mid.map((v, i) => `${X(i).toFixed(0)},${v - (w0 + (w1 - w0) * i / (mid.length - 1))}`).join(" ") + " " +
    mid.map((v, i) => { const j = mid.length - 1 - i; return `${X(j).toFixed(0)},${mid[j] + (w0 + (w1 - w0) * j / (mid.length - 1))}`; }).join(" ");
  const pts = mid.map((v, i) => `${X(i).toFixed(0)},${v}`).join(" ");
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fächerdiagramm in ${step} von 4 Schritten">`;
  if (step >= 3) s += `<polygon points="${band(10, 46)}" fill="rgba(139,92,246,0.18)"/>`;
  if (step >= 2) s += `<polygon points="${band(6, 26)}" fill="rgba(139,92,246,0.35)"/>`;
  if (step >= 1) s += `<polyline points="${pts}" fill="none" stroke="var(--labor)" stroke-width="3"/>`;
  if (step >= 4) s += `<circle cx="${X(2)}" cy="138" r="5" fill="var(--accent)"/><circle cx="${X(5)}" cy="128" r="5" fill="var(--accent)"/><circle cx="${X(8)}" cy="92" r="5" fill="var(--warn)"/>`;
  return s + "</svg>";
}
const CH1_TEXT = [
  "",
  "<b>Schritt 1 — die Linie:</b> der wahrscheinlichste Preis je Stunde. Er fällt zum Abend — das ist das Tagesmuster.",
  "<b>Schritt 2 — das dunkle Band:</b> In etwa 8 von 10 Fällen lag der echte Preis hier drin. So breit ist das normale Schwanken.",
  "<b>Schritt 3 — das helle Band:</b> In fast allen Fällen (etwa 95 von 100) blieb der Preis innerhalb. Außerhalb wird es überraschend.",
  "<b>Schritt 4 — die Wirklichkeit:</b> Zwei echte Preise (grün) lagen im Band, einer (gelb) knapp daneben. Genau dieses Nachzählen ist das Tagebuch.",
];
function calibChart() {
  const W = 560, H = 300, P = 40;
  const X = (v) => P + v * (W - 2 * P), Y = (v) => H - P - v * (H - 2 * P);
  const pts = [[.55,.52],[.62,.66],[.68,.64],[.72,.75],[.78,.74],[.82,.83],[.87,.84],[.92,.90]];
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Versprechen gegen Wirklichkeit: Punkte nahe der Diagonalen, App gut kalibriert">`;
  s += `<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${P}" stroke="var(--faint)" stroke-dasharray="6 5" stroke-width="2"/>`;
  pts.forEach(([x, y], i) => { s += `<circle cx="${X(x)}" cy="${Y(y)}" r="${i === 5 ? 9 : 6}" fill="${i === 5 ? "var(--warn)" : "var(--labor)"}"/>`; });
  s += `<text x="${W - P}" y="${H - 8}" fill="var(--muted)" font-size="13" text-anchor="end">Versprechen →</text>`;
  s += `<text x="8" y="${P - 8}" fill="var(--muted)" font-size="13">Wirklichkeit</text></svg>`;
  return s;
}
function weekLine() {
  const W = 640, H = 120;
  const v = [40, 30, 70, 45, 75, 80, 78];
  const X = (i) => 20 + (i / 6) * (W - 40);
  const pts = v.map((y, i) => `${X(i)},${y}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tagesbestwerte der Woche: Montag am tiefsten">${["So","Mo","Di","Mi","Do","Fr","Sa"].map((d, i) => `<text x="${X(i)}" y="${H - 6}" fill="var(--muted)" font-size="12" text-anchor="middle">${d}</text>`).join("")}<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${v.map((y, i) => `<circle cx="${X(i)}" cy="${y}" r="5" fill="${i === 1 ? "var(--accent)" : "var(--faint)"}"/>`).join("")}</svg>`;
}
function monthBars() {
  const W = 640, H = 150, vals = [4.2, 6.8, 5.1, 8.4];
  const bw = 70;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ersparnis je Monat, steigend">${vals.map((v, i) => { const h = v * 13, x = 60 + i * 140; return `<rect x="${x}" y="${H - 24 - h}" width="${bw}" height="${h}" rx="8" fill="var(--accent)"/><text x="${x + bw / 2}" y="${H - 6}" fill="var(--muted)" font-size="13" text-anchor="middle">${["Jun","Jul","Aug","Sep"][i]}</text><text x="${x + bw / 2}" y="${H - 30 - h}" fill="var(--text)" font-size="13" font-weight="bold" text-anchor="middle">${v.toFixed(2).replace(".", ",")} €</text>`; }).join("")}</svg>`;
}
function compareChart() {
  const W = 640, H = 170;
  const a = [70, 68, 64, 60, 62, 56, 54], b = [78, 76, 78, 74, 74, 72, 72];
  const X = (i) => 20 + (i / 6) * (W - 40);
  const P = (arr) => arr.map((v, i) => `${X(i)},${v * 1.8}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf beider Stationen übereinander, A liegt tiefer"><polyline points="${P(a)}" fill="none" stroke="var(--accent)" stroke-width="3"/><polyline points="${P(b)}" fill="none" stroke="var(--faint)" stroke-width="2.5" stroke-dasharray="7 5"/></svg>`;
}

/* ---------------- Geteilte Bausteine ---------------- */
const readinessBanner = () => S.mockState === "s1"
  ? `<div class="banner warn">Demo-Stand S1: Preise sind live, das Modell lernt noch — Empfehlungen folgen automatisch.</div>`
  : S.mockState === "s0"
  ? `<div class="banner">Demo-Stand S0: Noch keine Daten — zuerst einrichten.</div>`
  : "";
const fresh = (p = "Preise 4 Min alt", m = "Prognose 35 Min alt") =>
  `<div class="foot"><span>${p}</span><span>${m}</span><span>Nächste Preise ca. 08:10</span></div>`;

const ICONS = {
  jetzt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 1 2-5z" fill="currentColor"/></svg>',
  stationen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  woche: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  ich: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5"/></svg>',
  labor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6M10 3v6l-5 9a2.5 2.5 0 002.2 3.6h9.6A2.5 2.5 0 0019 18l-5-9V3"/><path d="M7 15h10"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
};
const NAV = [
  { id: "jetzt", label: "Jetzt", hash: "#/jetzt" },
  { id: "stationen", label: "Stationen", hash: "#/stationen" },
  { id: "woche", label: "Woche", hash: "#/woche" },
  { id: "ich", label: "Ich", hash: "#/ich" },
  { id: "labor", label: "Labor", hash: "#/labor", labor: true },
  { id: "system", label: "System", hash: "#/system" },
];
function navHTML(active) {
  const items = NAV.map((n) => `<a href="${n.hash}" class="${n.id === active ? "on" : ""}${n.labor ? " labor" : ""}">${ICONS[n.id]}<span>${n.label}</span></a>`).join("");
  return `<nav class="bottomnav" aria-label="Hauptbereiche">${items}</nav>
  <nav class="sidenav" aria-label="Hauptbereiche"><div class="sbrand">TankApp</div>${items}<div class="slab foot">Entwurf · Beispielzahlen</div></nav>`;
}

/* ---------------- Sheet (Ebene 1) ---------------- */
const WHY = {
  noModel: {
    title: "Warum noch keine Empfehlung?",
    pts: ["Empfehlungen brauchen ein geprüftes Modell — und das braucht etwa 30 Tage Preisdaten.", "Heute ist Tag 12: Die Preise sind live, das Muster ist noch zu dünn.", "Sobald das Modell steht, erscheint hier die erste Empfehlung — automatisch."],
    visual: null, lab: "#/labor/k4", labLabel: "Abschnitt 4: Wie lernt die App?",
  },
  entscheidung: {
    title: "Warum „Warten bis 18–20 Uhr“?",
    pts: ["Um 18–20 Uhr ist es an deiner Station meist am billigsten (Muster der letzten 6 Wochen).", "Der aktuelle Preis liegt 3 ct über dem Üblichen — fallen ist wahrscheinlicher als steigen.", "Ähnliche Fälle trafen in 82 von 100 ein (ziemlich sicher)."],
    visual: "mini-strip", lab: "#/labor/k1", labLabel: "Abschnitt 1: Was sagt die App vorher?",
  },
  fenster: {
    title: "Warum Montag 19–21 Uhr?",
    pts: ["Montagabend ist in deiner Stadt meist das billigste Fenster der Woche.", "Die erwartete Ersparnis (2,10 €) übersteigt klar die Unsicherheit.", "Dein Tank reicht bis dahin — kein Risiko, liegen zu bleiben."],
    visual: "mini-strip", lab: "#/labor/k2", labLabel: "Abschnitt 2: Was heißt „ziemlich sicher“?",
  },
  bilanz: {
    title: "Warum −8,40 €?",
    pts: ["Jeder deiner Belege wird mit dem Stadt-Median desselben Tages verglichen.", "Die Unterschiede werden über den Monat addiert — Stornos zählen nicht mit.", "Der Maßstab ist neutral: Er bevorzugt keine Station und keine Strategie."],
    visual: null, lab: "#/labor/k4", labLabel: "Abschnitt 4: Wie lernt die App?",
  },
  station: {
    title: "Warum ist Shell meist günstig?",
    pts: ["Shell liegt seit 6 Wochen im Schnitt 2,4 ct unter dem Stadt-Üblichen.", "Das ist kein Zufall einer Woche, sondern ein stabiles Muster.", "Abends ist der Abstand am größten — morgens fast gleichauf."],
    visual: null, lab: "#/labor/k3", labLabel: "Abschnitt 3: Warum „meist günstig“?",
  },
};
function openWhy(key) {
  const w = WHY[key];
  S.labReturn = location.hash || "#/jetzt";
  $("#sheet-root").innerHTML = `<div class="sheet-back" onclick="if(event.target===this)closeSheet()">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(w.title)}">
      <h2>${esc(w.title)}</h2>
      <ol>${w.pts.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
      ${w.visual ? stripChart() : ""}
      <div class="btnrow" style="margin-top:12px">
        <button class="btn primary" onclick="closeSheet();go('${w.lab}')">Im Labor vertiefen</button>
        <button class="btn ghost" onclick="closeSheet()">Schließen</button>
      </div>
      <p class="legend">Führt zu: ${esc(w.labLabel)}</p>
    </div></div>`;
}
function closeSheet() { $("#sheet-root").innerHTML = ""; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

/* ================= ANSICHTEN ================= */
function vJetzt() {
  if (S.mockState === "s0") return `<h1>Jetzt</h1><p class="sub">Willkommen — richten wir die App in 3 Schritten ein.</p>
  <div class="card decide gray">
    <p class="action">◉ Noch keine Daten</p>
    <p class="amount">Schritt 1: Stadt + Kraftstoff · Schritt 2: Stationen wählen · Schritt 3: Collector prüfen.</p>
    <p class="secure">Danach: Preise in ~5 Minuten, erste Empfehlung in ~30 Tagen.</p>
    <div class="btnrow"><button class="btn primary" onclick="go('#/system')">Einrichtung starten</button></div>
  </div>
  <div class="facts">
    <div class="fact"><div class="v">—</div><div class="l">Jetzt hier</div></div>
    <div class="fact"><div class="v">—</div><div class="l">Bestes Fenster</div></div>
    <div class="fact"><div class="v">—</div><div class="l">Tank reicht?</div></div>
  </div>
  ${fresh("Noch keine Daten", "Einrichtung steht aus")}`;
  if (S.mockState === "s1") return `<h1>Jetzt</h1><p class="sub">Eine Entscheidung, drei Fakten, nächste Schritte.</p>
  <div class="card decide gray">
    <p class="action">◉ Noch keine Empfehlung</p>
    <p class="amount">Das Modell lernt noch — Tag 12 von etwa 30.</p>
    <p class="secure">Empfehlungen gibt es erst mit geprüftem Modell. Die Preise unten sind live.</p>
    <div class="btnrow"><button class="btn" onclick="openWhy('noModel')">Warum?</button>
    <button class="btn primary" onclick="go('#/station/shell')">Günstigste jetzt: Shell</button></div>
  </div>
  <div class="facts">
    <div class="fact"><div class="v num">1,749 €/L</div><div class="l">Jetzt hier (Aral)</div></div>
    <div class="fact"><div class="v">—</div><div class="l">Bestes Fenster</div></div>
    <div class="fact"><div class="v">Ja, bis Do</div><div class="l">Tank reicht?</div></div>
  </div>
  <h2>Nächste Schritte</h2>
  <div class="steps">
    <button class="step" onclick="go('#/stationen')"><span class="arr">→</span><span>Preise vergleichen: Shell jetzt 1,709 €/L</span></button>
    <button class="step" onclick="go('#/system')"><span class="arr">→</span><span>Was fehlt? Datenstand im System-Tab ansehen</span></button>
  </div>
  <h2>Heute im Blick</h2>
  <div class="card">${stripChart()}<p class="legend">Bisheriges Muster (12 Tage) — noch keine Prognose</p></div>
  ${fresh("Preise 4 Min alt", "Noch kein Modell — ca. Tag 12 von 30")}`;
  const blocked = S.latestBy === "17:00";
  const save = (4.0 * S.liters) / 100;
  const decide = blocked ? `
    <div class="card decide gray">
      <p class="action">◉ Jetzt tanken</p>
      <p class="amount">Das Fenster erreichst du nicht mehr.</p>
      <p class="secure">Du musst vor 17 Uhr tanken — das billige Fenster beginnt erst um 18 Uhr.</p>
      <div class="btnrow"><button class="btn" onclick="openWhy('entscheidung')">Warum?</button>
      <button class="btn primary" onclick="toast('Route zur Aral wird gestartet (Entwurf).')">Route</button></div>
    </div>` : `
    <div class="card decide">
      <p class="action">◉ Warten bis 18–20 Uhr</p>
      <p class="amount num">Erwartet ${ct(4.0)} günstiger ≈ ${eur(save)}</p>
      <p class="secure">bei ${S.liters} L · ziemlich sicher (82 %)</p>
      <div class="btnrow"><button class="btn" onclick="openWhy('entscheidung')">Warum?</button>
        <button class="btn primary" onclick="toast('Route zur Shell wird gestartet (Entwurf).')">Route</button></div>
      <details class="neugier" style="margin-top:12px"><summary style="color:var(--accent)">Annahmen: ${S.liters} L · ${S.latestBy === "egal" ? "kein Zeitlimit" : "spätestens " + S.latestBy} · ${S.timeValue} €/h</summary>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Liter</label><select onchange="S.liters=+this.value;render()" aria-label="Liter">
            ${[20, 30, 40, 50, 60].map((l) => `<option ${l === S.liters ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="field"><label>Spätestens tanken</label><select onchange="S.latestBy=this.value;render()" aria-label="Spätester Tankzeitpunkt">
            ${["17:00", "19:00", "22:00", "egal"].map((v) => `<option ${v === S.latestBy ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        </div>
        <p class="legend">Kippt zu „Jetzt“, wenn du vor 17 Uhr tanken musst — probiere es aus.</p>
      </details>
    </div>`;
  return `<h1>Jetzt</h1><p class="sub">Eine Entscheidung, drei Fakten, nächste Schritte.</p>
  ${decide}
  <div class="facts">
    <div class="fact"><div class="v num">1,749 €/L</div><div class="l">Jetzt hier (Aral)</div></div>
    <div class="fact"><div class="v">18–20</div><div class="l">Bestes Fenster heute</div></div>
    <div class="fact"><div class="v">Ja, bis Do</div><div class="l">Tank reicht?</div></div>
  </div>
  <h2>Nächste Schritte</h2>
  <div class="steps">
    <button class="step" onclick="go('#/station/shell')"><span class="arr">→</span><span>Günstigste Alternative: Shell, −0,80 € netto nach Umweg</span></button>
    <button class="step" onclick="go('#/woche')"><span class="arr">→</span><span>Morgen 19–21 Uhr wäre noch besser (−2,10 €)</span></button>
    <button class="step" onclick="go('#/woche')"><span class="arr">→</span><span>Tank nur noch ¼ — Warten über Donnerstag ist riskant</span></button>
  </div>
  <h2>Heute im Blick</h2>
  <div class="card">${stripChart()}<p class="legend">Farbig = eher günstig · Umrissen = jetzt (08:05)</p></div>
  ${fresh()}`;
}

function mapSVG() {
  const pins = [
    { id: "aral", x: 300, y: 200, t: "±0", c: "" },
    { id: "shell", x: 380, y: 140, t: "−0,80", c: "" },
    { id: "star", x: 210, y: 160, t: "−0,45", c: "mid" },
    { id: "esso", x: 460, y: 230, t: "+0,35", c: "mid" },
    { id: "jet", x: 150, y: 260, t: "+0,90", c: "bad" },
    { id: "freie", x: 520, y: 110, t: "+1,40", c: "bad" },
  ];
  return `<svg viewBox="0 0 640 320" role="img" aria-label="Karte mit 6 Stationen, Shell am günstigsten">
    <rect width="640" height="320" fill="transparent"/>
    <path d="M0 240 C150 220 250 260 400 230 S560 200 640 220" stroke="var(--line)" stroke-width="22" fill="none"/>
    <path d="M120 0 C140 100 100 200 130 320" stroke="var(--line)" stroke-width="14" fill="none"/>
    <path d="M420 0 C400 120 440 220 420 320" stroke="var(--line)" stroke-width="14" fill="none"/>
    <path d="M0 100 C200 120 400 80 640 110" stroke="var(--line)" stroke-width="8" fill="none"/>
    <circle cx="300" cy="200" r="7" fill="var(--text)"/><text x="300" y="228" fill="var(--muted)" font-size="12" text-anchor="middle">Du</text>
    ${pins.map((p) => `<g class="pin ${p.c}" onclick="go('#/station/${p.id}')" role="link" aria-label="${station(p.id).name}">
      <circle class="halo" cx="${p.x}" cy="${p.y}" r="26"/><circle cx="${p.x}" cy="${p.y}" r="15" fill="var(--card)" stroke="var(--accent)" stroke-width="2"/>
      <text x="${p.x}" y="${p.y + 4}">${p.t}</text></g>`).join("")}
  </svg>`;
}
function vStationen() {
  if (S.mockState === "s0") return `<h1>Stationen</h1><p class="sub">Preis-Atlas: Karte, Liste, Verlauf.</p>
  <div class="card"><p><b>Noch keine Preise.</b> Lege zuerst Stadt und Stationen fest — dann füllt sich diese Ansicht von selbst.</p>
  <div class="btnrow"><button class="btn primary" onclick="go('#/system')">Einrichtung starten</button></div></div>
  ${fresh("Noch keine Daten", "Einrichtung steht aus")}`;
  const by = (a, b) => S.sort === "preis" ? a.price - b.price : S.sort === "entf" ? a.dist - b.dist : a.net - b.net;
  const list = [...STATIONS].sort((a, b) => ((S.observed.has(b.id) ? 1 : 0) - (S.observed.has(a.id) ? 1 : 0)) || by(a, b));
  const rows = list.map((s) => {
    const cls = s.net <= -0.3 ? "good" : s.net >= 0.5 ? "bad" : "mid";
    const net = s.ref ? "Referenz" : `${s.net > 0 ? "+" : "−"}${eur(Math.abs(s.net)).replace(" €", "")} € netto`;
    return `<button class="prow" onclick="go('#/station/${s.id}')">
      <span><span class="nm">${S.observed.has(s.id) ? "★ " : ""}${s.name}</span> <span class="meta">· ${s.street} · ${s.dist.toFixed(1).replace(".", ",")} km</span></span>
      <span><span class="pr num">${eurl(s.price)}</span><br><span class="net ${cls}">${net}</span></span>
      <span class="spark">${spark(s.trend)}</span></button>`;
  }).join("");
  return `<h1>Stationen</h1><p class="sub">Preis-Atlas: Karte, Liste, Verlauf — angepinnte zuerst, dann Netto-€.</p>
  <div class="searchrow"><input class="search" placeholder="Suchen … (Entwurf)" aria-label="Stationen suchen"></div>
  <div class="chips"><button class="chip on">E10</button><button class="chip on">geöffnet</button><button class="chip" onclick="toast('Markenfilter (Entwurf).')">Marke ▾</button>
    <button class="chip" onclick="toast('Zeitwert: ${S.timeValue} €/h (Entwurf).')">Zeit: ${S.timeValue} €/h ▾</button></div>
  <div class="mapbox">${mapSVG()}</div>
  <p class="legend">Pin = Netto-€ gegenüber Aral (Referenz) · Tippen öffnet das Detail</p>
  <div class="sortrow">Sortierung:
    <button class="chip small ${S.sort === "netto" ? "on" : ""}" onclick="S.sort='netto';render()">Netto-€</button>
    <button class="chip small ${S.sort === "preis" ? "on" : ""}" onclick="S.sort='preis';render()">Preis</button>
    <button class="chip small ${S.sort === "entf" ? "on" : ""}" onclick="S.sort='entf';render()">Entfernung</button></div>
  ${rows}${fresh("6 Stationen · Stand 08:05", "Netto mit 12 €/h Zeitwert")}`;
}
function vStationDetail(id) {
  const s = station(id) || STATIONS[0];
  const pinned = S.observed.has(s.id);
  return `<button class="backlink" onclick="go('#/stationen')">← Stationen</button>
  <h1>${s.name} <button class="star" onclick="togglePin('${s.id}')" aria-label="Anpinnen umschalten" title="Oben anpinnen">${pinned ? "★" : "☆"}</button></h1>
  <p class="sub">${s.street} · ${s.dist.toFixed(1).replace(".", ",")} km · ${s.open}</p>
  <div class="card"><div style="font-size:30px;font-weight:800" class="num">${eurl(s.price)}</div><div class="sub">vor 4 Minuten</div></div>
  <h2>Verlauf · 7 Tage</h2><div class="card">${verlaufChart()}<p class="chart-cap">Linie = Preis · Band = in dieser Woche üblich · Punkt = jetzt</p></div>
  <h2>Tagesrhythmus</h2><div class="card"><p style="margin-top:0">Morgens meist teuer · abends meist günstig</p>${stripChart()}</div>
  <h2>Einordnung</h2><div class="card">
    <div class="steps">
      <div class="step" style="cursor:default"><span class="arr">·</span><span>${ct(-4.2).replace("+", "")} unter dem Stadt-Median heute</span></div>
      <div class="step" style="cursor:default"><span class="arr">·</span><span>Meist 2.-günstigste deiner 6 Stationen</span></div>
      <div class="step" style="cursor:default"><span class="arr">·</span><span>Umweg ab Route: +1,2 km ≈ +0,35 €</span></div>
    </div></div>
  <div class="btnrow"><button class="btn primary" onclick="toast('Route wird gestartet (Entwurf).')">Route</button>
    <button class="btn" onclick="S.cmpA='${s.id}';go('#/vergleich')">Vergleichen</button>
    <button class="btn" onclick="go('#/ich')">Beleg buchen</button></div>
  <p><a href="#/labor/k3" onclick="S.labReturn='#/station/${s.id}'">Warum ist sie meist günstig? → Labor, Abschnitt 3</a>
    · <button class="btn small ghost" onclick="openWhy('station')">Warum?</button></p>
  ${fresh()}`;
}
function vVergleich() {
  const a = station(S.cmpA), b = station(S.cmpB);
  return `<button class="backlink" onclick="go('#/stationen')">← Stationen</button>
  <h1>Vergleich</h1><p class="sub">Zwei Stationen, ein Urteil — bei 40 L.</p>
  <div class="grid2">
    <div class="field"><label>A</label><select onchange="S.cmpA=this.value;render()">${STATIONS.map((s) => `<option value="${s.id}" ${s.id === a.id ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
    <div class="field"><label>B</label><select onchange="S.cmpB=this.value;render()">${STATIONS.map((s) => `<option value="${s.id}" ${s.id === b.id ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
  </div>
  <div class="card">${compareChart()}<p class="chart-cap">Durchgezogen = ${a.name} · gestrichelt = ${b.name} (7 Tage)</p></div>
  <div class="card"><div class="steps">
    <div class="step" style="cursor:default"><span class="arr">·</span><span>Preis: ${eurl(a.price)} vs. ${eurl(b.price)}</span></div>
    <div class="step" style="cursor:default"><span class="arr">·</span><span>Umweg: ${a.dist.toFixed(1).replace(".", ",")} km vs. ${b.dist.toFixed(1).replace(".", ",")} km</span></div>
    <div class="step" style="cursor:default"><span class="arr">·</span><span><b>${a.name} spart netto ≈ ${eur(Math.abs(a.net - b.net))}</b></span></div>
  </div></div>
  <p><a href="#/labor/k3" onclick="S.labReturn='#/vergleich'">Sind die beiden wirklich verschieden? → Labor</a></p>${fresh()}`;
}
function togglePin(id) {
  if (S.observed.has(id)) { S.observed.delete(id); toast("Nicht mehr angepinnt."); }
  else { S.observed.add(id); toast("Oben angepinnt."); }
  render();
}

function tankReach() { return ["—", "Do", "So", "Mi+"][S.tankQ] || "Do"; }
function vWoche() {
  if (S.mockState === "s0") return `<h1>Woche</h1><p class="sub">Zeit-Planer: beste Fenster, Tank-Reichweite.</p>
  <div class="card"><p><b>Noch keine Woche.</b> Ohne Preise und Modell gibt es hier nichts zu planen.</p>
  <div class="btnrow"><button class="btn primary" onclick="go('#/system')">Einrichtung starten</button></div></div>
  ${fresh("Noch keine Daten", "Einrichtung steht aus")}`;
  if (S.mockState === "s1") return `<h1>Woche</h1><p class="sub">Zeit-Planer: beste Fenster, Tank-Reichweite — zum Nachschlagen.</p>
  <div class="card tight"><b>Tank: ${"▰".repeat(S.tankQ)}${"▱".repeat(4 - S.tankQ)} ${["", "¼", "½", "¾", "voll"][S.tankQ]}</b>
    <span class="meta"> · Reichtums-Schätzung folgt mit dem Modell.</span>
    <div class="chips" style="margin:8px 0 0">${[1, 2, 3, 4].map((q) => `<button class="chip${q === S.tankQ ? " on" : ""}" onclick="S.tankQ=${q};render()">${["", "¼", "½", "¾", "voll"][q]}</button>`).join("")}</div></div>
  <h2>Beste Fenster</h2>
  <div class="card"><p><b>Noch keine Fenster.</b> Das Modell lernt noch (Tag 12 von etwa 30). Abends war es bisher meist am billigsten — das ist ein Muster, noch keine Prognose.</p>
  <div class="btnrow"><button class="btn" onclick="openWhy('noModel')">Warum?</button></div></div>
  <h2>Wochenlinie</h2><div class="card"><p class="legend">Die Wochenlinie erscheint mit dem ersten Modell.</p></div>
  ${fresh("Preise 4 Min alt", "Noch kein Modell — ca. Tag 12 von 30")}`;
  const day = DAYS[S.selDay];
  const km = [0, 120, 300, 480][S.tankQ];
  const reachOK = S.selDay <= 3;
  const cal = DAYS.map((d, i) => `<button class="day${i === S.selDay ? " sel" : ""}${d.dim ? " dim" : ""}" onclick="S.selDay=${i};render()" aria-label="${d.d} ${d.win}">
    <div class="d">${d.d}</div><div class="t">${d.win}${d.win === "—" ? "" : " Uhr"}</div>
    <div class="s">${"★".repeat(d.stars)}${"☆".repeat(Math.max(0, 3 - d.stars))}</div></button>`).join("");
  return `<h1>Woche</h1><p class="sub">Zeit-Planer: beste Fenster, Tank-Reichweite — zum Nachschlagen.</p>
  <div class="card tight"><b>Tank: ${"▰".repeat(S.tankQ)}${"▱".repeat(4 - S.tankQ)} ${["", "¼", "½", "¾", "voll"][S.tankQ]}</b>
    <span class="meta"> · reicht ≈ ${km} km · bis ca. ${tankReach()}</span>
    <div class="chips" style="margin:8px 0 0">${[1, 2, 3, 4].map((q) => `<button class="chip${q === S.tankQ ? " on" : ""}" onclick="S.tankQ=${q};render()">${["", "¼", "½", "¾", "voll"][q]}</button>`).join("")}</div></div>
  <h2>Beste Fenster</h2>
  <div class="cal">${cal}</div>
  <p class="legend">★ = Sicherheit des Fensters · blasse Tage (Do–Sa): noch unsicher</p>
  <h2>Ausgewählt: ${day.d} ${day.win === "—" ? "— kein Fenster" : day.win + " Uhr"}</h2>
  <div class="card">${day.win === "—" ? `<p>An diesem Tag lohnt kein Warten — die Preise bleiben voraussichtlich flach.</p>`
    : `<p style="margin-top:0" class="num">Erwartet ≈ <b>${eur(day.eur)}</b> unter Jetzt · ${day.sec} (${day.pct} %)</p>
    <p>${reachOK ? "Tank reicht bis dahin ✓" : "<b style='color:var(--bad)'>Tank reicht nicht bis dahin — bestes erreichbares Fenster: Mi 18–20 Uhr.</b>"}</p>
    <div class="btnrow"><button class="btn" onclick="go('#/stationen')">Stationen ansehen</button>
    <button class="btn" onclick="openWhy('fenster')">Warum?</button></div>`}</div>
  <h2>Wochenlinie</h2><div class="card">${weekLine()}<p class="chart-cap">Punkte = Tagesbestwerte · Montag am tiefsten</p></div>
  ${fresh("Prognose 35 Min alt", "Ab Do unsicher — wird täglich schärfer")}`;
}

function vIch() {
  const t = S.ichTab;
  const seg = `<div class="seg" role="tablist">${[["fahrzeug", "Fahrzeug"], ["belege", "Belege"], ["bilanz", "Bilanz"], ["einst", "Einstellungen"]].map(([id, l]) => `<button role="tab" class="${t === id ? "on" : ""}" onclick="S.ichTab='${id}';render()">${l}</button>`).join("")}</div>`;
  let body = "";
  if (t === "fahrzeug") body = `<div class="card"><h2 style="margin-top:0">Fahrzeug</h2>
    <div class="grid2"><div class="field"><label>Modell</label><input value="Golf" aria-label="Modell"></div>
    <div class="field"><label>Kraftstoff</label><select><option>E10</option><option>Super E5</option><option>Diesel</option></select></div>
    <div class="field"><label>Tank (L)</label><input value="50" inputmode="numeric" aria-label="Tankgröße"></div>
    <div class="field"><label>Verbrauch (L/100 km)</label><input value="6,5" inputmode="decimal" aria-label="Verbrauch"></div>
    <div class="field"><label>Zeitwert (€/h)</label><input value="12" inputmode="numeric" aria-label="Zeitwert"></div>
    <div class="field"><label>Modus</label><select><option>Auf dem Weg</option><option>Extrafahrt</option></select></div></div>
    <h3>Profile</h3><div class="chips"><button class="chip on">Ich</button><button class="chip" onclick="toast('Profil Partner (Entwurf).')">Partner</button><button class="chip" onclick="toast('Neues Profil (Entwurf).')">+ Neu</button></div></div>`;
  if (t === "belege") {
    const rows = S.belege.map((b) => `<div class="dentry"><span class="num"><b>${b.date}</b></span>
      <span>${esc(b.station)} · ${b.liters.toFixed(1).replace(".", ",")} L · ${eurl(b.price)}${b.void ? " <small>storniert</small>" : `<br><b class="num">${eur(b.liters * b.price)}</b> <small>3,1 ct/L unter Tagesmedian ✓</small>`}</span>
      ${b.void ? "<span></span>" : `<button class="btn small ghost" onclick="storno(${b.id})">Stornieren</button>`}</div>`).join("");
    body = `<div class="card"><h2 style="margin-top:0">Beleg buchen</h2>
      <div class="grid2"><div class="field"><label>Station</label><select id="b-st">${STATIONS.map((s) => `<option>${s.name}, ${s.street}</option>`).join("")}</select></div>
      <div class="field"><label>Liter</label><input id="b-l" value="40" inputmode="decimal"></div>
      <div class="field"><label>Preis (€/L)</label><input id="b-p" value="1,709" inputmode="decimal"></div>
      <div class="field"><label>&nbsp;</label><button class="btn primary" style="width:100%" onclick="addBeleg()">Beleg buchen</button></div></div></div>
      <h2>Verlauf</h2><div class="diary">${rows}</div>
      <div class="btnrow" style="margin-top:10px"><button class="btn" onclick="toast('CSV exportiert (Entwurf).')">Export (CSV)</button></div>`;
  }
  if (t === "bilanz" && S.mockState === "s0") body = `<div class="card"><p><b>Noch keine Bilanz.</b> Buche den ersten Beleg — oder warte auf Preise für den Vergleich.</p></div>`;
  if (t === "bilanz" && S.mockState !== "s0") body = `<div class="seg"><button class="${S.bilanz === "monat" ? "on" : ""}" onclick="S.bilanz='monat';render()">Monat</button><button class="${S.bilanz === "jahr" ? "on" : ""}" onclick="S.bilanz='jahr';render()">Jahr</button></div>
    <div class="facts"><div class="fact"><div class="v num">245,60 €</div><div class="l">Getankt (Sep)</div></div>
    <div class="fact"><div class="v num">1,729 €/L</div><div class="l">Ø-Preis</div></div>
    <div class="fact"><div class="v num" style="color:var(--accent)">−8,40 €</div><div class="l">ggü. Stadt-Median</div></div></div>
    <div class="card"><div class="steps">
      <div class="step" style="cursor:default"><span class="arr">·</span><span><b class="num">−8,40 €</b> gegenüber Stadt-Median (Standard, neutral)</span></div>
      <div class="step" style="cursor:default"><span class="arr">·</span><span><b class="num">−12,10 €</b> gegenüber Aral, deiner meistgenutzten Station</span></div>
    </div></div>
    <div class="card">${monthBars()}<p class="chart-cap">Ersparnis ggü. Stadt-Median je Monat</p>
    <div class="btnrow"><button class="btn" onclick="openWhy('bilanz')">Warum −8,40 €?</button></div></div>`;
  if (t === "einst") body = `<div class="card"><h2 style="margin-top:0">Darstellung</h2>
      <div class="toggle"><span>Dunkel / Hell</span><button class="btn small" onclick="toggleTheme()">${document.body.classList.contains("light") ? "Dunkel" : "Hell"}</button></div>
      <div class="toggle"><span>Bequeme Lesegröße</span><input type="checkbox" ${document.body.classList.contains("comfy") ? "checked" : ""} onchange="document.body.classList.toggle('comfy')" aria-label="Bequeme Lesegröße"></div></div>
    <div class="card"><h2 style="margin-top:0">Verhalten</h2>
      <div class="toggle"><span>Tankzeit-Sortierung (Lern-Gewohnheit)</span><input type="checkbox" ${S.behave.sort ? "checked" : ""} onchange="S.behave.sort=this.checked" aria-label="Tankzeit-Sortierung"></div>
      <div class="toggle"><span>Störungs-Anzeige im System-Tab</span><input type="checkbox" ${S.behave.ops ? "checked" : ""} onchange="S.behave.ops=this.checked" aria-label="Störungs-Anzeige"></div>
      <p class="legend">Keine Mitteilungen, kein Push — die App pingt nicht.</p></div>
    <div class="card"><h2 style="margin-top:0">Daten & System</h2>
      <div class="btnrow"><button class="btn" onclick="toast('Export gestartet (Entwurf).')">Alles exportieren</button>
      <button class="btn" onclick="go('#/system')">System ansehen</button></div></div>
    <div class="card"><h2 style="margin-top:0">Über</h2><p class="sub">TankApp Neuentwurf (Mockup) · Preisdaten: MTS-K via tankerkoenig.de, CC BY 4.0</p></div>`;
  return `<h1>Ich</h1><p class="sub">Fahrzeug, Belege, Bilanz, Einstellungen — an einem Ort.</p>${seg}${body}${fresh()}`;
}
function addBeleg() {
  const st = $("#b-st").value, l = parseFloat($("#b-l").value.replace(",", ".")) || 0, p = parseFloat($("#b-p").value.replace(",", ".")) || 0;
  if (!l || !p) { toast("Bitte Liter und Preis prüfen."); return; }
  S.belege.unshift({ id: Date.now(), date: "14.9.", station: st, liters: l, price: p, void: false });
  S.ichTab = "belege"; render(); toast("Beleg gespeichert.");
}
function storno(id) { const b = S.belege.find((x) => x.id === id); if (b) { b.void = true; render(); toast("Beleg storniert (bleibt sichtbar)."); } }
function toggleTheme() { document.body.classList.toggle("light"); render(); }

/* ---------------- System (Haupttab) ---------------- */
function sysReadiness() {
  if (S.mockState === "s0") return `<div class="card"><h2 style="margin-top:0">Bereitschaft: S0 von S3</h2><p>Noch keine Daten. <b>Nächster Schritt:</b> Stadt, Stationen und Collector einrichten — dann kommen Preise in ~5 Minuten.</p><div class="btnrow"><button class="btn primary" onclick="toast('Einrichtung (Entwurf).')">Einrichtung starten</button></div></div>`;
  if (S.mockState === "s1") return `<div class="card"><h2 style="margin-top:0">Bereitschaft: S1 von S3</h2><p>Preise sind live, das Modell lernt (Tag 12 von ~30). Erste Empfehlung <b>voraussichtlich in ~18 Tagen</b> — automatisch, ohne dass du etwas tun musst.</p></div>`;
  return "";
}
function sysZustand() {
  if (S.mockState === "s0") return `
    <div class="zrow"><span class="zdot r"></span><span><b>Collector (Pi)</b><br><small class="meta">noch nicht eingerichtet</small></span><span></span></div>
    <div class="zrow"><span class="zdot r"></span><span><b>Datenbank (NAS)</b><br><small class="meta">leer</small></span><span></span></div>
    <div class="zrow"><span class="zdot r"></span><span><b>Modelle</b><br><small class="meta">noch kein Modell</small></span><span></span></div>
    <div class="zrow"><span class="zdot g"></span><span><b>App</b><br><small class="meta">Version 0.31.0 (Entwurf)</small></span><span></span></div>`;
  const model = S.mockState === "s1"
    ? `<div class="zrow"><span class="zdot y"></span><span><b>Modelle</b><br><small class="meta">lernt noch — Tag 12 von ~30</small></span><span></span></div>`
    : `<div class="zrow"><span class="zdot g"></span><span><b>Modelle</b><br><small class="meta">Lauf heute 06:12, ok</small></span><span></span></div>`;
  return `
    <div class="zrow"><span class="zdot g"></span><span><b>Collector (Pi)</b><br><small class="meta">Preise 4 Min alt</small></span><span class="meta">08:05</span></div>
    <div class="zrow"><span class="zdot g"></span><span><b>Datenbank (NAS)</b><br><small class="meta">12.345 Preise · 6 Stationen</small></span><span></span></div>
    ${model}
    <div class="zrow"><span class="zdot g"></span><span><b>App</b><br><small class="meta">Version 0.31.0 (Entwurf)</small></span><span></span></div>`;
}
function vSystem() {
  return `<h1>System</h1><p class="sub">Anlage & Daten: Zustand, Läufe, Störungen.</p>${sysReadiness()}
  <div class="card"><h2 style="margin-top:0">Zustand</h2>
    ${sysZustand()}</div>
  <div class="card"><h2 style="margin-top:0">Daten-Abdeckung</h2>
    ${S.mockState === "voll" ? `<div><b>Gütersloh · E10</b><div class="cover"><i style="width:98%"></i></div><small class="meta">98 % · Lücke: 2.9.</small></div>` : S.mockState === "s1" ? `<div><b>Gütersloh · E10</b><div class="cover"><i style="width:34%"></i></div><small class="meta">34 % · wächst täglich</small></div>` : `<div><b>Gütersloh · E10</b><div class="cover"><i style="width:0%"></i></div><small class="meta">0 % · noch nichts da</small></div>`}</div>
  <div class="card"><h2 style="margin-top:0">Läufe</h2>
    ${S.mockState === "voll" ? `<div class="zrow"><span class="zdot g"></span><span><b>Modell-Update</b><br><small class="meta">heute 06:12 · 4 Min · ok</small></span><button class="btn small" onclick="toast('Protokoll (Entwurf).')">Protokoll</button></div>
    <div class="zrow"><span class="zdot g"></span><span><b>Archiv-Sync</b><br><small class="meta">gestern · ok</small></span><button class="btn small" onclick="toast('Job gestartet (Entwurf).')">Jetzt starten</button></div>` : S.mockState === "s1" ? `<div class="zrow"><span class="zdot y"></span><span><b>Modell-Update</b><br><small class="meta">noch kein Lauf — erster Lauf nach ~30 Tagen Daten</small></span><span></span></div>
    <div class="zrow"><span class="zdot g"></span><span><b>Archiv-Sync</b><br><small class="meta">läuft — 34 %, wächst täglich</small></span><span></span></div>` : `<div class="zrow"><span class="zdot r"></span><span><b>Modell-Update</b><br><small class="meta">steht aus — zuerst einrichten</small></span><span></span></div>
    <div class="zrow"><span class="zdot r"></span><span><b>Archiv-Sync</b><br><small class="meta">steht aus</small></span><span></span></div>`}</div>
  ${S.mockState === "s0" ? `<div class="card"><h2 style="margin-top:0">Störungen</h2><p>Einrichtung offen — kein Fehler, nur noch nichts da.</p>` : `<div class="card"><h2 style="margin-top:0">Störungen</h2><p>Keine aktiven Störungen.</p>`}
  <div class="btnrow"><button class="btn" onclick="toast('Diagnose-Bündel erstellt (Entwurf).')">Diagnose-Export</button></div></div>${fresh()}`;
}

/* ---------------- Labor: eine Seite, Aufklapp-Abschnitte ---------------- */
function dEntry(d) {
  return `<div class="dentry"><span class="${d.ok ? "ok" : "no"}">${d.ok ? "✓" : "✗"}</span>
    <span><b>${d.t}</b><br><span class="num">${eurl(d.pred)} vorhergesagt → ${eurl(d.real)}</span><small>${d.note}</small></span><span></span></div>`;
}
function labSection(id, num, title, inner) {
  const open = S.labOpen[id] ? " open" : "";
  return `<details class="chapter" id="lab-${id}"${open} ontoggle="S.labOpen['${id}']=this.open">
    <summary><span class="n">${num}</span><span><b>${title}</b></span><span class="chev" aria-hidden="true">▾</span></summary>
    <div class="chapter-body">${inner}</div></details>`;
}
function openLab(sec) {
  S.labOpen[sec] = true;
  S.labScroll = sec;
  closeSheet();
  if (location.hash === "#/labor") render();
  else location.hash = "#/labor";
}
function labK1() {
  return `<p class="sub">„Woher weiß sie, was Benzin morgen kostet?“</p>
    <div class="card"><p><b>In drei Sätzen:</b> Die App kennt das Muster deiner Stadt (morgens teuer, abends billig, Sonntag anders). Sie schaut, wo der Preis gerade steht. Und sie sagt ehrlich dazu, wie breit die Unsicherheit ist — als Band, nicht als Punkt.</p></div>
    <div class="card">${S.mockState === "voll" ? "" : '<p class="legend" style="margin-top:0">Prinzip-Skizze — nicht deine Daten.</p>'}${fanChart(S.ch1step)}<div class="read">${CH1_TEXT[S.ch1step]}</div>
      <div class="btnrow" style="margin-top:10px">${[1, 2, 3, 4].map((i) => `<button class="chip${S.ch1step === i ? " on" : ""}" onclick="S.ch1step=${i};render()">Schritt ${i}</button>`).join("")}</div></div>
    <details class="neugier"><summary>Für Neugierige: die Methode</summary>
      <p>Je Station schätzt ein Strukturmodell (Tages-/Wochenform) plus AR(2)-Rest die Verteilung der nächsten Stunden. Zwei Modellfamilien werden als Ensemble gemittelt; die Bänder sind Quantile der Bootstrap-Verteilung.</p>
      <div class="formula">q̂(τ, h) mit τ ∈ {.025, .10, …} · Band₈₀ = [q̂.₁₀, q̂.₉₀]</div></details>
    <div class="task"><b>Selbst prüfen:</b> Auf Schritt 4 — welcher echte Preis lag außerhalb des dunklen Bands?<br>
      <button class="btn small" onclick="this.nextElementSibling.style.display='block';this.remove()">Auflösung zeigen</button>
      <p style="display:none;margin-bottom:0">Der gelbe Punkt rechts: knapp außerhalb des dunklen, aber innerhalb des hellen Bands — ein normaler, kein alarmierender Fall.</p></div>`;
}
function labK2() {
  return `<p class="sub">„Warum 82 % — und stimmt das?“</p>
    <div class="card"><p><b>In drei Sätzen:</b> Das Prozent heißt: In so vielen von 100 ähnlichen Fällen traf es bisher ein. Die App zählt das an echten Ergebnissen nach — das ist die Trefferquote. Worte sind nur Stufen davon: „ziemlich sicher“ heißt 75–85 von 100.</p></div>
    <div class="card">${S.mockState === "voll" ? "" : '<p class="legend" style="margin-top:0">Prinzip-Skizze — nicht deine Daten.</p>'}${calibChart()}
      <div class="read"><b>So liest du das:</b> Waagerecht das Versprechen, senkrecht das Eingetroffene. Punkte auf der Diagonalen = ehrlich versprochen. Der <b style="color:var(--warn)">gelbe Punkt</b>: Bei „82-%-Fällen“ trafen 83 von 100 ein — fast ideal.</div></div>
    <details class="neugier"><summary>Für Neugierige: Brier & M7</summary>
      <p>Der Brier-Score ist der mittlere quadratische Fehler der Wahrscheinlichkeit — 0 ist perfekt. Prozente zeigt die App erst ab Stufe A (≥ 100 gezählte Fälle, Score &lt; 0,25); darunter heißt sie „lernend“ und zeigt nur Worte und Sterne.</p>
      <div class="formula">Brier = mean((p − o)²), o ∈ {0,1}</div></details>
    <div class="task"><b>Selbst prüfen:</b> Was wäre ein schlechtes Zeichen in diesem Diagramm?<br>
      <button class="btn small" onclick="this.nextElementSibling.style.display='block';this.remove()">Auflösung zeigen</button>
      <p style="display:none;margin-bottom:0">Punkte deutlich unter der Diagonalen: Die App verspricht mehr, als eintrifft — sie wäre übermütig.</p></div>`;
}
function labK3() {
  const bars = STATIONS.map((s) => { const w = Math.min(50, Math.abs(s.haus) * 12); const left = s.haus < 0 ? 50 - w : 50;
    return `<div class="hbar"><span>${s.name}</span><span class="track"><span class="mid"></span><span class="fill${s.haus > 0 ? " neg" : ""}" style="left:${left}%;width:${w}%"></span></span><span class="num">${ct(s.haus)}</span></div>`; }).join("");
  const heat = [["So", 3, 4, 3, 2, 1, 2], ["Mo", 3, 3, 2, 2, 0, 1], ["Di", 3, 3, 2, 2, 1, 1], ["Mi", 3, 3, 2, 2, 0, 1], ["Do", 3, 3, 3, 2, 1, 1], ["Fr", 4, 3, 3, 2, 1, 2], ["Sa", 3, 3, 3, 3, 2, 2]];
  return `<p class="sub">„Zufall oder System?“</p>
    <div class="card"><p><b>In drei Sätzen:</b> Jede Station wird mit dem Stadt-Üblichen verglichen (dem Median). Der Abstand wird über 6 Wochen gemittelt — Zufall mittelt sich heraus. Was übrig bleibt, ist der Hauspreis-Abstand der Station.</p></div>
    <h2>Hauspreis-Vergleich · ${CITY}</h2><div class="card">${S.mockState === "voll" ? "" : '<p class="legend" style="margin-top:0">Prinzip-Skizze — nicht deine Daten.</p>'}${bars}<p class="chart-cap">Balken links = meist unter dem Üblichen (grün) · rechts = darüber · Strich = Stadt-Median</p></div>
    <h2>Wochenrhythmus · Shell</h2><div class="card">${S.mockState === "voll" ? "" : '<p class="legend" style="margin-top:0">Prinzip-Skizze — nicht deine Daten.</p>'}<table class="heatmap"><tr><th></th><th>6–9</th><th>9–12</th><th>12–15</th><th>15–18</th><th>18–21</th><th>21–24</th></tr>
      ${heat.map((r) => `<tr><th>${r[0]}</th>${r.slice(1).map((g) => `<td class="g${g}"></td>`).join("")}</tr>`).join("")}</table>
      <p class="chart-cap">Grün = oft billig · rot = oft teuer · Lies wie einen Stundenplan: 18–21 Uhr fast immer grün.</p></div>
    <details class="neugier"><summary>Für Neugierige: δ̂ und ε</summary>
      <p>δ̂ (Delta-Dach) ist der geschätzte mittlere Abstand einer Station zum Zellen-Median. ε (Epsilon) ist die Vorsicht-Schwelle: Erst ab |δ̂| ≥ ε nennen wir einen Unterschied „wichtig“ — einstellbar in Abschnitt 4.</p>
      <div class="formula">δ̂(s) = mean(p(s,t) − median(t)) über 6 Wochen</div></details>
    <div class="task"><b>Selbst prüfen:</b> Shell gegen JET — wirklich verschieden oder Zufall?<br>
      <button class="btn small" onclick="this.nextElementSibling.style.display='block';this.remove()">Auflösung zeigen</button>
      <p style="display:none;margin-bottom:0">Wirklich verschieden: 4,3 ct Abstand, beide über Wochen stabil — weit jenseits der Zufalls-Schwankung.</p></div>`;
}
function labK4() {
  const eps = S.eps;
  const hits = Math.round(78 - (eps - 1.0) * 22), count = Math.round(100 - (eps - 1.0) * 30);
  const list = S.mockState === "voll" ? (DIARY.filter((d) => S.diaryFilter === "alle" || (S.diaryFilter === "treffer") === d.ok).map(dEntry).join("") || "<p>Keine Einträge.</p>") : "<p><b>Noch keine Einträge.</b> Das Tagebuch beginnt mit der ersten Empfehlung.</p>";
  return `<p class="sub">„Was passiert, wenn sie danebenlag?“</p>
    <div class="card"><p><b>In drei Sätzen:</b> Jede Empfehlung wird aufgeschrieben — mit oder ohne deine Tankung. Nach Fensterende vergleicht die App Vorhersage mit Realität. Aus allen Vergleichen entstehen Trefferquote und Schwellen: Die App eicht sich an sich selbst.</p></div>
    <h2>Prognose-Tagebuch</h2>
    <div class="chips"><button class="chip${S.diaryFilter === "alle" ? " on" : ""}" onclick="S.diaryFilter='alle';render()">Alle</button>
    <button class="chip${S.diaryFilter === "treffer" ? " on" : ""}" onclick="S.diaryFilter='treffer';render()">Treffer</button>
    <button class="chip${S.diaryFilter === "fehler" ? "on" : ""}" onclick="S.diaryFilter='fehler';render()">Fehler</button></div>
    <div class="diary">${list}</div>
    <h2>Vorsicht-Regler: Was wäre gewesen, wenn …?</h2><div class="card">
      <label for="eps"><b>ε = ${eps.toFixed(1)} ct/L</b> — ab diesem Unterschied wird eine Empfehlung ausgesprochen.</label>
      <input id="eps" type="range" min="0.5" max="2" step="0.1" value="${eps}" oninput="S.eps=+this.value;render()" aria-label="Vorsicht-Schwelle"${S.mockState === "voll" ? "" : " disabled"}>
      ${S.mockState === "voll" ? `<p>Bei ε = ${eps.toFixed(1)}: <b class="num">${hits} von ${count}</b> Empfehlungen hätten getroffen.</p>` : `<p class="legend">Der Regler rechnet, sobald gezählte Empfehlungen vorliegen.</p>`}
      <p class="legend">Mutig (kleines ε) = mehr Ratschläge, mehr Fehler · vorsichtig (großes ε) = weniger, aber sicherere.</p></div>
    <details class="neugier"><summary>Für Neugierige: zwei Ledgers</summary>
      <p>Das <b>Advice-Ledger</b> zählt Ratschläge gegen Realität (braucht keine Tankung). Das <b>Wallet-Ledger</b> zählt deine Euro gegen den Median (braucht Belege). Beide zusammen: Können der App und Nutzen für dich — getrennt ehrlich.</p></details>`;
}
function labK5() {
  const G = [
    ["Trefferquote (Brier-Score)", "Bei wie vielen von 100 Ratschlägen die App recht hatte.", "„82 %“ heißt: In 82 von 100 ähnlichen Fällen traf die Empfehlung ein. Gezählt im Tagebuch.", "Brier = mean((p−o)²); 0 = perfekt. Angezeigt ab 100 Fällen und Score < 0,25."],
    ["Band-Treffer (PICP)", "Wie oft der echte Preis im vorhergesagten Band lag.", "Band verspricht 80 von 100: Zählen wir 82, passt es; zählen wir 60, ist das Band zu eng.", "PICP = Anteil y ∈ [q_lo, q_hi]; nominal 80 % bzw. 95 %."],
    ["Band-Breite (MPIW)", "Wie breit das Unsicherheits-Band im Schnitt ist.", "Schmales Band + viele Treffer = gut. Breites Band = ehrlich unsicher, z. B. vor Feiertagen.", "MPIW = mean(q_hi − q_lo) in ct/L."],
    ["Hauspreis-Abstand (δ̂)", "Wie weit eine Station meist über/unter dem Stadt-Üblichen liegt.", "Shell δ̂ = −2,4 ct: über 6 Wochen im Schnitt 2,4 ct unter dem Median.", "δ̂(s) = mean(p(s,t) − median(t))."],
    ["Vorsicht-Schwelle (ε)", "Ab wann uns ein Unterschied wichtig genug für einen Ratschlag ist.", "ε = 1 ct: Erst ab 1 ct erwartetem Unterschied sagt die App „Warten“. Spielbar in Abschnitt 4.", "Entscheidungs-Schwelle der €-Tabelle; Stellschraube Mut/Vorsicht."],
    ["Median", "Der mittlere Wert: die Hälfte liegt darunter, die Hälfte darüber.", "Stadt-Median 1,739: robust gegen einzelne Ausreißer — anders als der Durchschnitt.", "50-%-Quantil je Zelle (Stunde × Stadt × Kraftstoff)."],
  ];
  return `<p class="sub">Jeder Begriff in drei Stufen: Satz, Beispiel, exakt.</p>
    <div class="card"><dl class="gloss">${G.map(([t, s, b, e]) => `<dt>${t}</dt><dd>${s}
      <details class="neugier"><summary>Beispiel + exakt</summary><p>${b}</p><div class="formula exakt">${e}</div></details></dd>`).join("")}</dl></div>`;
}
function labSpiel() {
  return `<p class="sub">Freies Prüfen: Was hätte welche Strategie im letzten Quartal gebracht?</p>
  <div class="card"><div class="field"><label>Strategie</label><select id="sp-s"><option>App-Empfehlung folgen</option><option>Immer billigste Station heute</option><option>Immer Aral nebenan</option><option>Immer Sonntag tanken</option></select></div>
  ${S.mockState === "voll" ? `<button class="btn primary" onclick="toast(\'Nachgerechnet: App-Strategie −24,10 € ggü. Median (Entwurf).\')">Nachrechnen</button>` : `<p class="legend">Nachrechnen braucht Preisdaten — in S0/S1 noch nicht möglich.</p>`}
  <p class="legend">Rechnet auf echten Vergangenheits-Preisen, nicht auf Prognosen — deshalb ehrlich vergleichbar.</p></div>
  <div class="card"><h2 style="margin-top:0">Export</h2><div class="btnrow"><button class="btn" onclick="toast('CSV exportiert (Entwurf).')">Tagebuch (CSV)</button><button class="btn" onclick="toast('PNG exportiert (Entwurf).')">Diagramm (PNG)</button></div></div>`;
}
function vLabor() {
  const jump = [["k1", "1 Prognose"], ["k2", "2 Sicherheit"], ["k3", "3 Stationen"], ["k4", "4 Lernen"], ["k5", "5 Glossar"], ["spiel", "Spielplatz"]]
    .map(([id, l]) => `<button class="chip" onclick="openLab('${id}')">${l}</button>`).join("");
  const teaser = DIARY.slice(0, 2).map(dEntry).join("");
  return `<div style="margin-bottom:8px"><button class="backlink" onclick="go(S.labReturn||'#/jetzt')">← Zurück zum Alltag</button></div>
  <h1><span style="color:var(--labor)">◈</span> Labor</h1>
  <p class="sub">Verstehen, prüfen, spielen — in deinem Tempo. Nichts hier muss man wissen, um zu tanken. Einfach aufklappen, was interessiert.</p>
  ${S.mockState === "voll" ? `<div class="card"><h2 style="margin-top:0">Vertrauens-Konto · ${CITY}, ${FUEL}</h2>
    <p class="sub">Trefferquote der Empfehlungen (6 Wochen)</p>
    <div class="konto-bar"><i style="width:78%"></i></div>
    <p><b class="num">78 von 100 ✓</b><br>Versprochen waren bei „ziemlich sicher“ ≈ 75–85 von 100 — passt.</p>
    <div class="btnrow"><button class="btn" onclick="openLab('k2')">Wie wird das gezählt?</button></div></div>` : `<div class="card"><h2 style="margin-top:0">Vertrauens-Konto · ${CITY}, ${FUEL}</h2>
    <p class="sub">Trefferquote der Empfehlungen</p>
    <div class="konto-bar"><i style="width:2%"></i></div>
    <p><b class="num">Noch nichts zu zählen — 0 von 100.</b><br>Das Konto füllt sich mit der ersten Empfehlung, sobald das Modell steht.</p>
    <div class="btnrow"><button class="btn" onclick="openLab('k2')">Wie wird gezählt?</button></div></div>`}
  <div class="chips">${jump}</div>
  ${S.mockState === "voll" ? `<h2>Zuletzt im Tagebuch</h2><div class="diary">${teaser}</div>
  <div class="btnrow" style="margin-top:10px"><button class="btn" onclick="openLab('k4')">Im Abschnitt 4 ansehen</button></div>` : ``}
  <h2>Abschnitte</h2>
  ${labSection("k1", "1", "Was sagt die App eigentlich vorher?", labK1())}
  ${labSection("k2", "2", "Was heißt „ziemlich sicher“?", labK2())}
  ${labSection("k3", "3", "Warum ist eine Station „meist günstig“?", labK3())}
  ${labSection("k4", "4", "Wie lernt die App aus Fehlern?", labK4())}
  ${labSection("k5", "5", "Alle Begriffe von A–Z (Glossar)", labK5())}
  ${labSection("spiel", "◈", "Spielplatz: Was wäre gewesen, wenn …?", labSpiel())}
  ${fresh("Tagebuch 35 Min alt", "Aufklapp-Stand nur für diese Sitzung")}`;
}

/* ---------------- Router ---------------- */
function headerHTML(isLabor) {
  if (isLabor) return `<div class="topbar"><div class="topbar-inner"><span class="brand"><span class="flask">◈</span> Labor</span>
    <span class="mockbadge">Entwurf · Beispielzahlen</span>
    <select class="mocksel" onchange="S.mockState=this.value;render()" aria-label="Datenstand simulieren" title="Datenstand simulieren (nur Entwurf)">
      <option value="voll"${S.mockState === "voll" ? " selected" : ""}>Modell aktiv</option>
      <option value="s1"${S.mockState === "s1" ? " selected" : ""}>S1: ohne Modell</option>
      <option value="s0"${S.mockState === "s0" ? " selected" : ""}>S0: leer</option>
    </select>
    <button class="statusdot" onclick="go('#/system')"><span class="dot"></span>System ok</button></div></div>`;
  return `<div class="topbar"><div class="topbar-inner"><span class="brand">TankApp <small>· ${CITY} · ${FUEL}</small></span>
    <span class="mockbadge">Entwurf · Beispielzahlen</span>
    <select class="mocksel" onchange="S.mockState=this.value;render()" aria-label="Datenstand simulieren" title="Datenstand simulieren (nur Entwurf)">
      <option value="voll"${S.mockState === "voll" ? " selected" : ""}>Modell aktiv</option>
      <option value="s1"${S.mockState === "s1" ? " selected" : ""}>S1: ohne Modell</option>
      <option value="s0"${S.mockState === "s0" ? " selected" : ""}>S0: leer</option>
    </select>
    <button class="statusdot" onclick="go('#/system')"><span class="dot"></span><span>ok</span></button></div></div>`;
}
function render() {
  const h = location.hash || "#/jetzt";
  let active = "jetzt", isLabor = false, html = "";
  const laborSec = (sec) => { S.labOpen[sec] = true; S.labScroll = sec; active = "labor"; isLabor = true; html = vLabor(); };
  if (h.startsWith("#/labor/kapitel/")) laborSec("k" + (h.split("/")[3] || "1"));
  else if (h === "#/labor/spielplatz") laborSec("spiel");
  else if (h.startsWith("#/labor/")) {
    const sec = h.split("/")[2];
    if (["k1", "k2", "k3", "k4", "k5", "spiel"].includes(sec)) laborSec(sec);
    else { active = "labor"; isLabor = true; html = vLabor(); }
  }
  else if (h === "#/labor") { active = "labor"; isLabor = true; html = vLabor(); }
  else if (h.startsWith("#/station/")) { active = "stationen"; html = vStationDetail(h.split("/")[2]); }
  else if (h === "#/vergleich") { active = "stationen"; html = vVergleich(); }
  else if (h === "#/stationen") { active = "stationen"; html = vStationen(); }
  else if (h === "#/woche") { active = "woche"; html = vWoche(); }
  else if (h === "#/ich") { active = "ich"; html = vIch(); }
  else if (h === "#/system" || h === "#/anlage") { active = "system"; html = vSystem(); }
  else { active = "jetzt"; html = vJetzt(); }
  document.body.classList.toggle("labor", isLabor);
  if (S.mockState !== "voll") html = readinessBanner() + html;
  $("#app").innerHTML = `${headerHTML(isLabor)}<main class="wrap" id="main">${html}</main>${navHTML(active)}`;
  if (S.labScroll && !h.startsWith("#/labor/")) { /* Sprung aus openLab nach Hashwechsel */ }
  if (S.labScroll) {
    const el = document.getElementById("lab-" + S.labScroll);
    S.labScroll = null;
    if (el && el.scrollIntoView) el.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}
window.addEventListener("hashchange", render);
render();
