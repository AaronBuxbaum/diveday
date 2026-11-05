import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { CountedAboardBlocked } from "@/lib/roll-call-readiness";
import { isAfterTheDive, leftAtTheDock, readSeatLadder, type SeatRung } from "@/lib/seat-ladder";
import { groupRoster, waiverControls } from "./roster-model";
import type { ReadinessByBooking, RosterEntry, WaiverByBooking } from "./types";

/**
 * **The record, the seat ladder and the recap agree on every seat** (issue
 * #3823). For every combination of what the dock said, what an after-dive
 * checkpoint says, whether the desk released the seat and whether a roll call
 * was taken, the finished departure's band, the ladder's rung and the diver's
 * own page (left at the dock, or back from a day on the water) give one answer.
 */
const t = staffTranslator("en-US");

const DOCK = [null, "boarded", "not_boarded"] as const;
// After-dive words: none; counted back; said not back and never counted;
// counted back after one dive and said not back after the next.
const AFTER = ["none", "back", "missing", "backThenMissing"] as const;

function seat(id: string, noShow: boolean): RosterEntry {
  return {
    checkedIn: false,
    booking: {
      id,
      status: noShow ? "no_show" : "booked",
      reEntryAsk: null,
      lastDivedBand: null,
      identityUnconfirmedAt: null,
      turnedAwayAt: null,
    } as unknown as RosterEntry["booking"],
    person: {
      id: `p-${id}`,
      fullName: id,
      emergencyContactName: null,
      emergencyContactPhone: null,
    } as unknown as RosterEntry["person"],
  };
}

function bandOf(groups: ReturnType<typeof groupRoster>, id: string): string {
  for (const band of [
    "unaccounted",
    "sailed",
    "joinedAtSite",
    "didNotSail",
    "turnedAway",
    "uncounted",
    "unrecorded",
  ] as const) {
    if (groups[band].some((entry) => entry.booking.id === id)) return band;
  }
  return "none";
}

/** The band each rung may be filed under. */
const BANDS_BY_RUNG: Record<SeatRung, readonly string[]> = {
  missing: ["unaccounted"],
  out: ["sailed", "joinedAtSite"],
  ashore: ["didNotSail"],
  released: ["didNotSail"],
  arrived: ["uncounted", "unrecorded"],
  booked: ["uncounted", "unrecorded"],
};

describe("record, seat ladder and recap agree", () => {
  const cases = DOCK.flatMap(
    (dock) =>
      AFTER.flatMap((after) =>
        [false, true].flatMap((noShow) =>
          [false, true].map((rollCallTaken) => ({ dock, after, noShow, rollCallTaken })),
        ),
      ),
    // A dock word means the roll call was taken.
  ).filter(({ dock, rollCallTaken }) => dock === null || rollCallTaken);

  it.each(cases)("dock $dock, after-dive $after, released $noShow, taken $rollCallTaken", (c) => {
    const id = "s";
    const records = {
      noShow: c.noShow,
      arrived: false,
      dockResult: c.dock,
      afterDiveResultStands: c.after !== "none",
      missingAfterDive: c.after === "missing" || c.after === "backThenMissing",
    };
    const ladder = readSeatLadder(records);
    const groups = groupRoster({
      t,
      // The record reads the roster alone: readiness and waivers are the
      // open departure's.
      rows: {
        roster: [seat(id, c.noShow)],
        readinessByBooking: new Map() as ReadinessByBooking,
        waiverByBooking: new Map() as WaiverByBooking,
      },
      requiresPayment: true,
      arrival: undefined,
      controls: waiverControls(t),
      record: {
        dock: new Map(c.dock ? [[id, c.dock]] : []),
        afterDive: new Set(c.after === "none" ? [] : [id]),
        rollCallTaken: c.rollCallTaken,
        unaccounted: new Set(c.after === "missing" || c.after === "backThenMissing" ? [id] : []),
        countedAboardBlocked: new Map<string, CountedAboardBlocked>(),
      },
    });
    const band = bandOf(groups, id);

    // The record files the seat in a band its rung allows.
    expect(BANDS_BY_RUNG[ladder.rung]).toContain(band);
    // Sailed is the evening count's rule; Joined at a dive site is the one
    // band where the vessel did not leave with a diver who dived.
    if (band === "sailed") expect(ladder.countsAsSailed).toBe(true);
    if (band === "joinedAtSite") {
      expect(ladder.countsAsSailed).toBe(false);
      expect(c.dock).toBe("not_boarded");
    }

    // The recap and the diver's page: left at the dock exactly when the dock
    // said not_boarded and no after-dive count put them on a boat since.
    const countedAboardAfterDive = c.after === "back" || c.after === "backThenMissing";
    const left = leftAtTheDock({ dockResult: c.dock, countedAboardAfterDive });
    expect(left).toBe(c.dock === "not_boarded" && !countedAboardAfterDive);
    // A seat filed as dived (Sailed or Joined at a dive site) is never told it
    // stayed ashore, and one filed Didn't sail by the dock is never welcomed back.
    if (band === "sailed" || band === "joinedAtSite") expect(left).toBe(false);
    // A diver who was on the water and is now missing is never closed out as
    // a day on land: the recap waits on the missing word instead.
    if (band === "unaccounted" && c.after === "backThenMissing") expect(left).toBe(false);
    if (band === "didNotSail" && c.dock === "not_boarded") {
      expect(left).toBe(true);
      expect(
        isAfterTheDive({
          endsAt: new Date("2026-11-01T12:00:00Z"),
          boarded: "not_boarded",
          now: new Date("2026-11-02T12:00:00Z"),
        }),
      ).toBe(false);
    }
  });
});
