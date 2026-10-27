import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TideStationEcho } from "@/lib/tide-stations";
import { savedFitLines, savedForecastLines } from "./site-saved-paper-facts";

const t = staffTranslator("en-US");
const values = {
  forecastLatitude: 25,
  forecastLongitude: -80,
  tideStationId: "8723970",
  tideStationConfirmed: false,
  tidePreference: "ebb" as const,
};
const far: TideStationEcho = {
  id: "8723970",
  name: "Vaca Key",
  state: "FL",
  latitude: 24.7,
  longitude: -81,
  distanceKm: 80,
  far: true,
};
describe("saved paper forecast facts", () => {
  it("keeps station, preference and the unacknowledged distance consequence", () => {
    const lines = savedForecastLines(values, far, "meters", t);
    expect(lines.join("\n")).toContain("8723970");
    expect(lines.join("\n")).toContain("Vaca Key");
    expect(lines).toContain(
      `${t("diveSites.form.tidePreferenceLabel")}: ${t("diveSites.form.tidePreference.ebb")}`,
    );
    expect(lines).toContain(t("diveSites.form.tideStationFarKm", { distance: 80 }));
    expect(lines).toContain(t("diveSites.form.tideStationUnconfirmed"));
  });
  it("preserves stored acknowledgment when metadata is unavailable", () => {
    const lines = savedForecastLines({ ...values, tideStationConfirmed: true }, null, "feet", t);
    expect(lines.join("\n")).toContain("8723970");
    expect(lines).toContain(t("diveSites.form.tideStationConfirmedCheckbox"));
  });
  it("uses the chosen fit tone even without a fit note, in each locale", () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      const translator = staffTranslator(locale);
      expect(savedFitLines({ fitTone: "demanding", fitNote: null }, translator)).toContain(
        translator("diveSites.form.fitToneDemanding"),
      );
    }
  });
});
