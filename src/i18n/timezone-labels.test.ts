import { describe, expect, it } from "vitest";
import { timeZoneLabel } from "./timezone-labels";

// The same two Key Largo departures src/lib/format.test.ts uses: one either
// side of the daylight-saving boundary, both 07:30 on the shop's wall clock.
const summerDeparture = new Date("2026-07-15T11:30:00Z");
const winterDeparture = new Date("2026-01-15T12:30:00Z");

describe("timeZoneLabel", () => {
  it("names the zone as it stands on the day being labelled", () => {
    // Not "the shop's zone" as a constant — a schedule read in March listing
    // July boats must say EDT, and the same page in January must say EST.
    expect(timeZoneLabel(summerDeparture, "en-US", "America/New_York")).toBe("EDT");
    expect(timeZoneLabel(winterDeparture, "en-US", "America/New_York")).toBe("EST");
  });

  it("falls back to a GMT offset where a zone has no common abbreviation", () => {
    // Which is the honest answer for a cross-timezone booker anyway: an offset
    // needs no local knowledge to act on.
    expect(timeZoneLabel(summerDeparture, "en-US", "Asia/Singapore")).toBe("GMT+8");
  });

  it("labels UTC itself, for the zone-free values that name it deliberately", () => {
    expect(timeZoneLabel(summerDeparture, "en-US", "UTC")).toBe("UTC");
  });

  it("renders the label for the reader's own locale", () => {
    // The same Key Largo boat, two readers. English CLDR carries "EDT"; Spanish
    // does not, and answers with the offset — which is the better half of the
    // trade for the reader this finding is about, since an offset needs no
    // local knowledge to act on. Never a compiled-in "en-US" either way.
    expect(timeZoneLabel(summerDeparture, "es-ES", "America/New_York")).toBe("GMT-4");
    expect(timeZoneLabel(summerDeparture, "es-ES", "Europe/Madrid")).toBe("CEST");
  });
});
