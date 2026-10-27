import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { carryTargetLabel } from "./carry-target-label";
import { wordSeatMoveTargets } from "./seat-move";

/**
 * "Carry the wait list" offered boats with no seat as though they could help
 * (dive-domain review r4-4, N9). Each target says what it has left, so a full
 * one reads as full before anyone picks it.
 */
describe("carryTargetLabel", () => {
  const target = {
    id: "t",
    label: "Two-Tank Reef",
    startsAt: "2026-10-24T12:00:00.000Z",
    localDay: "2026-10-24",
    dayLabel: "Sat, Oct 24",
    timeLabel: "8:00 AM EDT",
  };

  it("says the seats a departure has left", () => {
    const t = staffTranslator("en-US");
    expect(carryTargetLabel({ ...target, seatsLeft: 1 }, t)).toBe(
      "Sat, Oct 24 · 8:00 AM EDT · Two-Tank Reef · 1 seat left",
    );
    expect(carryTargetLabel({ ...target, seatsLeft: 4 }, t)).toBe(
      "Sat, Oct 24 · 8:00 AM EDT · Two-Tank Reef · 4 seats left",
    );
  });

  it("calls a departure with none full, in both languages", () => {
    expect(carryTargetLabel({ ...target, seatsLeft: 0 }, staffTranslator("en-US"))).toBe(
      "Sat, Oct 24 · 8:00 AM EDT · Two-Tank Reef · full",
    );
    expect(carryTargetLabel({ ...target, seatsLeft: 2 }, staffTranslator("es-ES"))).toBe(
      "Sat, Oct 24 · 8:00 AM EDT · Two-Tank Reef · quedan 2 plazas",
    );
  });
});

for (const locale of ["en-US", "es-ES"] as const) {
  it(`keeps repeated departure titles distinct across the shop's midnight in ${locale}`, () => {
    const targets = wordSeatMoveTargets(
      [
        { id: "late", title: "Reef", startsAt: new Date("2026-10-25T03:30:00Z"), seatsLeft: 2 },
        { id: "early", title: "Reef", startsAt: new Date("2026-10-25T04:30:00Z"), seatsLeft: 2 },
      ],
      locale,
      "America/New_York",
    );
    expect(targets.map((t) => t.localDay)).toEqual(["2026-10-24", "2026-10-25"]);
    const labels = targets.map((target) => carryTargetLabel(target, staffTranslator(locale)));
    expect(labels[0]).not.toBe(labels[1]);
    for (const [i, target] of targets.entries()) {
      expect(labels[i]).toContain(target.dayLabel);
      expect(labels[i]).toContain(target.timeLabel);
    }
  });
}
