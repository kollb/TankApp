// B7: useResource-Policy — ein fehlgeschlagener Poll zwischen zwei
// erfolgreichen darf die Ansicht nicht in den Fehlerzustand reißen, und
// „Refresh“ darf ein laufendes Laden nicht abbrechen (sonst lädt eine
// langsame NAS endlos neu, statt fertig zu werden).

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resourceErrorVisible, useResource } from "./data";

describe("B7: Fehler-Policy (ein Poll-Fehler ≠ Ausfall)", () => {
  it("zeigt den ersten Fehlversuch, wenn nichts anzuzeigen wäre", () => {
    expect(resourceErrorVisible(1, false)).toBe(true);
  });

  it("lässt die Daten bei einem einzelnen fehlgeschlagenen Poll stehen", () => {
    expect(resourceErrorVisible(1, true)).toBe(false);
  });

  it("macht den Fehler erst nach zwei aufeinanderfolgenden Fehlern sichtbar", () => {
    expect(resourceErrorVisible(2, true)).toBe(true);
    expect(resourceErrorVisible(3, true)).toBe(true);
  });
});

describe("B7: useResource-Startzustand (ohne URL)", () => {
  it("startet leer und ohne Fehler — inaktive Ressourcen bleiben stumm", () => {
    function Probe() {
      const r = useResource<string | null>(null, 30000, 0);
      return (
        <span>
          {String(r.error)}|{r.data ?? "null"}|{String(r.pending)}
        </span>
      );
    }
    expect(renderToStaticMarkup(<Probe />)).toBe(
      "<span>false|null|false</span>",
    );
  });
});
