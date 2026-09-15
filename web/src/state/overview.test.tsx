// @vitest-environment happy-dom
// OverviewContext (U8): Die geteilten Daten werden per Context gereicht.
// Der Test injiziert einen fertigen Zustand — so hängen auch die View-Tests
// am Provider, ohne einen einzigen echten Poll zu starten.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewProvider, useOverview, type OverviewState } from "./overview";

function Probe() {
  const ov = useOverview();
  return <p>{ov.activeCity}</p>;
}

describe("OverviewContext (U8)", () => {
  it("reicht den injizierten Zustand an die Bereiche durch", () => {
    const html = renderToStaticMarkup(
      <OverviewProvider
        value={{ activeCity: "Bad Kreuznach" } as unknown as OverviewState}
      >
        <Probe />
      </OverviewProvider>,
    );
    expect(html).toContain("Bad Kreuznach");
  });
});
