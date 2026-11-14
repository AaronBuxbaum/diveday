import { expect, it } from "vitest";
import { incidentMissingDiverFoundEmail } from "./incident-emails";

for (const locale of ["en-US", "es-ES"] as const) {
  it(`limits the found update to the reported person in ${locale}`, () => {
    const email = incidentMissingDiverFoundEmail({
      locale,
      recipientName: "Alex",
      shopName: "Shop",
      tripTitle: "Reef",
      foundAt: new Date("2026-11-14T12:00:00Z"),
      stillMissing: 0,
      timezone: "UTC",
      reportUrl: "https://example.test/report",
    });
    const expected =
      locale === "en-US"
        ? "only the person or people covered by this report"
        : "solo a la persona o las personas incluidas en este reporte";
    expect(email.text).toContain(expected);
    expect(email.html).toContain(expected);
    expect(email.text).not.toMatch(/everyone (is|was) safe/i);
  });
}
