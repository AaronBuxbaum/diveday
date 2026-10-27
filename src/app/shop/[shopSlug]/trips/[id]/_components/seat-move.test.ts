import { describe, expect, it } from "vitest";
import { wordSeatMoveTargets } from "./seat-move";

describe("date-first move destinations", () => {
  it("orders real instants and groups equal titles by the shop’s local day across midnight UTC", () => {
    const targets = wordSeatMoveTargets(
      [
        { id: "later", title: "Reef", startsAt: new Date("2026-10-28T03:30:00Z"), seatsLeft: 0 },
        { id: "earlier", title: "Reef", startsAt: new Date("2026-10-27T23:30:00Z"), seatsLeft: 3 },
        { id: "tomorrow", title: "Reef", startsAt: new Date("2026-10-28T12:00:00Z"), seatsLeft: 2 },
      ],
      "en-US",
      "America/New_York",
    );
    expect(targets.map((target) => target.id)).toEqual(["earlier", "later", "tomorrow"]);
    expect(targets.map((target) => target.localDay)).toEqual([
      "2026-10-27",
      "2026-10-27",
      "2026-10-28",
    ]);
    expect(targets[0].timeLabel).toMatch(/7:30\sPM\sEDT/);
    expect(targets[1].timeLabel).toMatch(/11:30\sPM\sEDT/);
    expect(targets[1].seatsLeft).toBe(0);
  });
});
