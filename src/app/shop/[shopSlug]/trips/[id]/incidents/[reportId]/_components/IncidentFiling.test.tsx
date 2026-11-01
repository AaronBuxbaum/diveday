import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { IncidentFiling } from "./IncidentRecord";

/** H-20261016-missing-diver-report-alerts: filing a report of a missing diver pages the owners, so the File card says so first. */
describe("IncidentFiling", () => {
  const render = (missingDiver: boolean, locale: string) =>
    renderToStaticMarkup(
      IncidentFiling({
        gaps: [],
        missingDiver,
        action: async () => {},
        notice: undefined,
        t: staffTranslator(locale),
      }),
    );

  it("warns that filing tells the owners now, only for a missing diver", () => {
    expect(render(true, "en-US")).toContain(
      "Filing tells the owners now. Is the diver still missing?",
    );
    expect(render(false, "en-US")).not.toContain("tells the owners");
  });

  it("warns in Spanish too", () => {
    expect(render(true, "es-ES")).toContain("¿Sigue desaparecido el buceador?");
  });
});
