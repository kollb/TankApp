// @vitest-environment happy-dom
// B10: Der Update-Hinweis nennt die laufende Version, bietet genau zwei Wege
// an und drängt sich nicht auf (kein Dauerbanner, „Später“ gilt für die Sitzung).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateBannerView } from "./UpdateBanner";
import { updateNotice } from "../service-worker";
import { APP_VERSION } from "../version";

function render(notice = updateNotice(APP_VERSION)) {
  return renderToStaticMarkup(
    <UpdateBannerView notice={notice} onReload={() => {}} onDismiss={() => {}} />,
  );
}

describe("UpdateBanner (B10)", () => {
  it("nennt die Version der laufenden Ansicht, nicht die des Servers", () => {
    const html = render(updateNotice("0.37.2"));
    expect(html).toContain("Neue Version verfügbar");
    expect(html).toContain("0.37.2");
  });

  it("ohne bekannte Version bleibt der Satz ehrlich allgemein", () => {
    const html = render(updateNotice("dev"));
    expect(html).not.toContain("dev");
    expect(html).toContain("alten Stand");
  });

  it("bietet „Jetzt neu laden“ und ein stilles „Später“", () => {
    const html = render();
    expect(html).toContain("Jetzt neu laden");
    expect(html).toContain('aria-label="Später"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Eingaben bleiben gespeichert");
  });
});
