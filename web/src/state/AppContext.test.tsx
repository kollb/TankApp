// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppProvider, useAppContext } from "./AppContext";

function PreferencesProbe() {
  const { city, fuel, activeProfile, pollingInterval } = useAppContext();
  return <div>
    <span data-setting="city">{city}</span>
    <span data-setting="fuel">{fuel}</span>
    <span data-setting="profile">{activeProfile}</span>
    <span data-setting="polling">{pollingInterval}</span>
  </div>;
}

function renderedPreferences(): HTMLDivElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<AppProvider><PreferencesProbe /></AppProvider>);
  return host;
}

describe("Persistierte App-Einstellungen", () => {
  it("normalisiert fehlerhafte Typen und beschränkt das gespeicherte Poll-Intervall", () => {
    localStorage.clear();
    localStorage.setItem("tankapp.v2.city", JSON.stringify(17));
    localStorage.setItem("tankapp.v2.fuel", JSON.stringify("e85"));
    localStorage.setItem("tankapp.v2.profile", JSON.stringify({ id: "vehicle-1" }));
    localStorage.setItem("tankapp.v2.pollingInterval", JSON.stringify(1_000_000));

    const host = renderedPreferences();
    expect(host.querySelector('[data-setting="city"]')?.textContent).toBe("");
    expect(host.querySelector('[data-setting="fuel"]')?.textContent).toBe("e10");
    expect(host.querySelector('[data-setting="profile"]')?.textContent).toBe("");
    expect(host.querySelector('[data-setting="polling"]')?.textContent).toBe("300000");
  });

  it("begrenzt einen zu kurzen Poll-Abstand und bewahrt gültige Einstellungen", () => {
    localStorage.clear();
    localStorage.setItem("tankapp.v2.city", JSON.stringify("Frankfurt"));
    localStorage.setItem("tankapp.v2.fuel", JSON.stringify("diesel"));
    localStorage.setItem("tankapp.v2.profile", JSON.stringify("diesel-car"));
    localStorage.setItem("tankapp.v2.pollingInterval", JSON.stringify(500));

    const host = renderedPreferences();
    expect(host.querySelector('[data-setting="city"]')?.textContent).toBe("Frankfurt");
    expect(host.querySelector('[data-setting="fuel"]')?.textContent).toBe("diesel");
    expect(host.querySelector('[data-setting="profile"]')?.textContent).toBe("diesel-car");
    expect(host.querySelector('[data-setting="polling"]')?.textContent).toBe("5000");
  });
});
