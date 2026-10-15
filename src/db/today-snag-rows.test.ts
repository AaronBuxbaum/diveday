import { describe, expect, it } from "vitest";
import type { TodayAction } from "@/lib/today";
import { NOW, rowsContext } from "./today-rows-test-fixtures";
import { pushBoatSnagRows } from "./today-snag-rows";

function rows(boatSnags: readonly Record<string, unknown>[]): TodayAction[] {
  const actions: TodayAction[] = [];
  pushBoatSnagRows(actions, rowsContext({ boatSnags }));
  return actions;
}

const snag = {
  id: "s1",
  boatName: "Mantis I",
  itemLabel: "Radio check",
  note: "VHF crackles on 16.",
  notedByName: "Sal Moretti",
  notedAt: new Date(NOW.getTime() - 6 * 3_600_000),
  departuresSince: 2,
  notedOnTripId: "t-noted",
};

describe("pushBoatSnagRows", () => {
  it("adds nothing when no snag is open", () => {
    expect(rows([])).toEqual([]);
  });

  it("names the boat, the line, the note and who wrote it, and opens the next boat check", () => {
    const next = { tripId: "t-next", startsAt: new Date(NOW.getTime() + 3_600_000) };
    const [row] = rows([{ ...snag, next }]);
    expect(row).toMatchObject({
      id: "boat-snag:s1",
      kind: "boat_snag",
      subject: "Mantis I",
      href: "/shop/blue-mantis/trips/t-next/manifest",
      dueAt: next.startsAt,
    });
    // The crew's own full stop is not doubled.
    expect(row?.detail).toBe(
      "Radio check: VHF crackles on 16. Noted by Sal Moretti, 2 departures ago.",
    );
    expect(row?.urgency).not.toBe("later");
  });

  it("points at the departure it was written on when the boat has nothing ahead", () => {
    const [row] = rows([{ ...snag, departuresSince: 0, next: null }]);
    expect(row).toMatchObject({
      href: "/shop/blue-mantis/trips/t-noted/manifest",
      urgency: "later",
      dueAt: null,
    });
    expect(row?.detail).toBe("Radio check: VHF crackles on 16. Noted by Sal Moretti.");
  });
});
