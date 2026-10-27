import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { carryTargetLabel } from "./carry-target-label";

/**
 * "Carry the wait list" offered boats with no seat as though they could help
 * (dive-domain review r4-4, N9). Each target says what it has left, so a full
 * one reads as full before anyone picks it.
 */
describe("carryTargetLabel", () => {
  const target = {
    id: "t",
    label: "Two-Tank Reef · Sat, Oct 24, 8:00 AM EDT",
    startsAt: "2026-10-24T12:00:00.000Z",
    localDay: "2026-10-24",
    dayLabel: "Sat, Oct 24",
    timeLabel: "8:00 AM EDT",
  };

  it("says the seats a departure has left", () => {
    const t = staffTranslator("en-US");
    expect(carryTargetLabel({ ...target, seatsLeft: 1 }, t)).toBe(
      "Two-Tank Reef · Sat, Oct 24, 8:00 AM EDT · 1 seat left",
    );
    expect(carryTargetLabel({ ...target, seatsLeft: 4 }, t)).toBe(
      "Two-Tank Reef · Sat, Oct 24, 8:00 AM EDT · 4 seats left",
    );
  });

  it("calls a departure with none full, in both languages", () => {
    expect(carryTargetLabel({ ...target, seatsLeft: 0 }, staffTranslator("en-US"))).toBe(
      "Two-Tank Reef · Sat, Oct 24, 8:00 AM EDT · full",
    );
    expect(carryTargetLabel({ ...target, seatsLeft: 2 }, staffTranslator("es-ES"))).toBe(
      "Two-Tank Reef · Sat, Oct 24, 8:00 AM EDT · quedan 2 plazas",
    );
  });
});
