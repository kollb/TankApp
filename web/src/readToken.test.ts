// @vitest-environment happy-dom
// O39 — Lese-Token für den persönlichen Datenbestand.
//
// Geprüft: ohne Token bleibt alles beim Alten (kein Header), mit Token geht
// derselbe Header raus, den der Server erwartet (`Authorization: Bearer …`),
// der Wert überlebt den Neuladen-Pfad (localStorage) und steht nie in einer
// URL. Dazu: eine Änderung meldet sich bei den Abonnenten, damit die
// persönlichen Ansichten neu laden.

import { beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  onReadTokenChange,
  readToken,
  setReadToken,
} from "./readToken";

describe("readToken (O39)", () => {
  beforeEach(() => {
    localStorage.clear();
    setReadToken("");
  });

  it("ist ohne Secret leer und schickt keinen Header", () => {
    expect(readToken()).toBe("");
    expect(authHeaders()).toEqual({});
  });

  it("setzt das Secret und den Bearer-Header, den der Server prüft", () => {
    expect(setReadToken("  geheim  ")).toBe(true);
    expect(readToken()).toBe("geheim");
    expect(authHeaders()).toEqual({ Authorization: "Bearer geheim" });
  });

  it("liegt gerätelokal im Speicher, nie in einer URL", () => {
    setReadToken("geheim");
    expect(localStorage.getItem("tankapp.readToken")).toBe("geheim");
  });

  it("löscht das Secret wieder", () => {
    setReadToken("geheim");
    expect(setReadToken("")).toBe(true);
    expect(readToken()).toBe("");
    expect(localStorage.getItem("tankapp.readToken")).toBeNull();
    expect(authHeaders()).toEqual({});
  });

  it("meldet nur echte Änderungen — kein Neuladen ohne Grund", () => {
    const calls: number[] = [];
    const off = onReadTokenChange(() => calls.push(1));
    expect(setReadToken("geheim")).toBe(true);
    expect(setReadToken("geheim")).toBe(false);
    expect(setReadToken(null)).toBe(true);
    off();
    setReadToken("nach dem Abmelden");
    expect(calls).toHaveLength(2);
  });
});
