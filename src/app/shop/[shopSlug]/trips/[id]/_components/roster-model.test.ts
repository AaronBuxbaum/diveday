import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { CountedAboardBlocked } from "@/lib/roll-call-readiness";
import {
  groupRoster,
  PAYMENT_STATUSES_ALL,
  PAYMENT_STATUSES_RECORDING_ONLY,
  type RosterArrival,
  rosterPaymentStatusCopy,
  seatMoveForRow,
  waiverControls,
} from "./roster-model";
import type { ReadinessByBooking, RosterEntry, WaiverByBooking } from "./types";

const t = staffTranslator("en-US");

type ReadinessRow = ReadinessByBooking extends Map<string, infer V> ? V : never;
type WaiverRow = WaiverByBooking extends Map<string, infer V> ? V : never;

function seat(
  id: string,
  over: { status?: string; emergencyContactPhone?: string | null } = {},
): RosterEntry {
  return {
    booking: {
      id,
      status: over.status ?? "booked",
      reEntryAsk: null,
      lastDivedBand: null,
      identityUnconfirmedAt: null,
    } as unknown as RosterEntry["booking"],
    person: {
      id: `p-${id}`,
      fullName: id,
      emergencyContactName: "Ada Contact",
      emergencyContactPhone:
        over.emergencyContactPhone === undefined ? "+1 555 0100" : over.emergencyContactPhone,
    } as unknown as RosterEntry["person"],
  };
}

function readiness(status: "ready" | "blocked", depthAdvisory: unknown = null): ReadinessRow {
  return {
    readiness: {
      status,
      blockers: status === "blocked" ? [{ code: "certification_missing", params: undefined }] : [],
    },
    paymentStatus: "paid",
    paymentProvider: null,
    depthAdvisory,
  } as unknown as ReadinessRow;
}

const signed = {
  waiver: {
    id: "w",
    status: "completed",
    completedAt: new Date("2026-08-20T15:00:00Z"),
    signatureMethod: "digital",
    expiresAt: new Date("2027-08-20T15:00:00Z"),
    medicalAnswers: null,
  },
} as unknown as WaiverRow;

const deep = {
  status: "exceeds",
  limitDepth: 18,
  siteDepth: 30,
  unit: "meters",
  basis: "certification",
  level: "open_water",
};

function rowsFor(roster: RosterEntry[], readinessById: Record<string, ReadinessRow>) {
  return {
    roster,
    readinessByBooking: new Map(Object.entries(readinessById)) as ReadinessByBooking,
    waiverByBooking: new Map(roster.map(({ booking }) => [booking.id, signed])) as WaiverByBooking,
  };
}

const ids = (entries: RosterEntry[]) => entries.map(({ booking }) => booking.id);

describe("groupRoster", () => {
  it("files a blocked seat under Still to clear and a cleared one under Ready", () => {
    const rows = rowsFor([seat("a"), seat("b")], {
      a: readiness("blocked"),
      b: readiness("ready"),
    });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(ids(groups.stillToClear)).toEqual(["a"]);
    expect(ids(groups.ready)).toEqual(["b"]);
    expect(groups.here).toEqual([]);
    expect(groups.notHere).toEqual([]);
    expect(groups.blockedCount).toBe(1);
    expect(groups.deskWorkOpen).toBe(false);
  });

  it("keeps a seat with no emergency number in Still to clear, though it is cleared to dive", () => {
    const rows = rowsFor([seat("a", { emergencyContactPhone: null })], { a: readiness("ready") });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(ids(groups.stillToClear)).toEqual(["a"]);
    // Desk work, not dive clearance: the all-clear count does not wait on it.
    expect(groups.blockedCount).toBe(0);
  });

  it("holds a signed waiver under medical review in Still to clear, with no tap to offer", () => {
    // The medical answers flagged something a physician has not yet cleared:
    // the seat is cleared to dive by readiness, but the desk is not done with it.
    const rows = rowsFor([seat("a")], { a: readiness("ready") });
    rows.waiverByBooking = new Map([
      [
        "a",
        {
          ...signed,
          waiver: {
            ...(signed as { waiver: object }).waiver,
            status: "medical_review",
            medicalClearedAt: null,
            medicalClearanceDeclinedAt: null,
          },
        } as unknown as WaiverRow,
      ],
    ]) as WaiverByBooking;
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(ids(groups.stillToClear)).toEqual(["a"]);
    expect(ids(groups.ready)).toEqual([]);
    expect(groups.blockedCount).toBe(0);
  });

  it("with the desk open, sinks a cleared arrival into Checked in and a released seat into Not here", () => {
    const rows = rowsFor(
      [
        seat("here", { status: "checked_in" }),
        seat("owes", { status: "checked_in", emergencyContactPhone: null }),
        seat("gone", { status: "no_show" }),
      ],
      { here: readiness("ready"), owes: readiness("ready"), gone: readiness("ready") },
    );
    const arrival: RosterArrival = {
      controls: new Map(),
      below: new Map(),
      boarded: new Set(["here"]),
    };
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival,
      controls: waiverControls(t),
    });
    expect(ids(groups.here)).toEqual(["here"]);
    expect(ids(groups.stillToClear)).toEqual(["owes"]);
    expect(ids(groups.notHere)).toEqual(["gone"]);
    expect(groups.ready).toEqual([]);
    // An arrival still owing the desk keeps the desk open.
    expect(groups.deskWorkOpen).toBe(true);
    expect(groups.hereMeta).toBe(t("checkIn.settledAllBoarded"));
  });

  /**
   * **A finished departure's tab is its record** (UX review 2026-10-10, item
   * 10): who sailed and who did not, nothing to clear. Each seat is filed by
   * `seatSailed` (src/lib/closeout.ts), the evening count's own rule, so the
   * record and the close-out cannot disagree about one diver (dive-domain
   * review of UX batch 1).
   */
  function recordOf(
    dock: Record<string, "boarded" | "not_boarded">,
    afterDive: string[] = [],
    rollCallTaken = Object.keys(dock).length > 0,
    unaccounted: string[] = [],
  ) {
    return {
      dock: new Map(Object.entries(dock)),
      afterDive: new Set(afterDive),
      rollCallTaken,
      unaccounted: new Set(unaccounted),
      countedAboardBlocked: new Map<string, CountedAboardBlocked>(),
    };
  }

  function recordGroupsFor(seats: RosterEntry[], record: ReturnType<typeof recordOf>) {
    const rows = rowsFor(
      seats,
      Object.fromEntries(seats.map((entry) => [entry.booking.id, readiness("ready")])),
    );
    return groupRoster({
      t,
      rows,
      requiresPayment: true,
      arrival: undefined,
      controls: waiverControls(t),
      record,
    });
  }

  it("in the record, files only a dock not-boarded and a released seat as Didn't sail", () => {
    const groups = recordGroupsFor(
      [seat("aboard"), seat("ashore"), seat("gone", { status: "no_show" }), seat("unseen")],
      recordOf({ aboard: "boarded", ashore: "not_boarded" }),
    );
    expect(ids(groups.sailed)).toEqual(["aboard"]);
    expect(ids(groups.didNotSail)).toEqual(["ashore", "gone"]);
    // Nobody counted this seat at the dock: that is not "didn't sail".
    expect(ids(groups.uncounted)).toEqual(["unseen"]);
    expect(groups.unrecorded).toEqual([]);
    expect(groups.stillToClear).toEqual([]);
    expect(groups.ready).toEqual([]);
    expect(groups.blockedCount).toBe(0);
  });

  it("in the record, counts a diver picked up at a later site as sailed", () => {
    const groups = recordGroupsFor(
      [seat("aboard"), seat("pickedUp"), seat("chase", { status: "no_show" })],
      // `pickedUp` has no dock result; `chase` was released at the desk and
      // then counted aboard after dive one, which outranks the desk.
      recordOf({ aboard: "boarded" }, ["pickedUp", "chase"]),
    );
    expect(ids(groups.sailed)).toEqual(["aboard", "pickedUp", "chase"]);
    expect(groups.didNotSail).toEqual([]);
    expect(groups.uncounted).toEqual([]);
  });

  it("in the record, a seat said missing and not counted back is its own group, ahead of Sailed", () => {
    const groups = recordGroupsFor(
      [seat("aboard"), seat("missing"), seat("ashore")],
      // `missing` boarded at the dock and has a standing after-dive result
      // (the "not back" word itself), so only `unaccounted` keeps it out of Sailed.
      recordOf(
        { aboard: "boarded", missing: "boarded", ashore: "not_boarded" },
        ["missing"],
        true,
        ["missing"],
      ),
    );
    expect(ids(groups.unaccounted)).toEqual(["missing"]);
    expect(ids(groups.sailed)).toEqual(["aboard"]);
    expect(ids(groups.didNotSail)).toEqual(["ashore"]);
  });

  it("in the record, says once how many who sailed were counted aboard while blocked", () => {
    const record = {
      ...recordOf({ a: "boarded", b: "boarded", c: "not_boarded" }, ["a"]),
      countedAboardBlocked: new Map<string, CountedAboardBlocked>([
        ["a", { checkpoint: "after_dive_1", blockers: [{ code: "certification_missing" }] }],
        // Not a sailed seat: never counted in the sailed band's fact.
        ["c", { checkpoint: "after_dive_1", blockers: [{ code: "certification_missing" }] }],
      ]),
    };
    const groups = recordGroupsFor([seat("a"), seat("b"), seat("c")], record);
    expect(ids(groups.sailed)).toEqual(["a", "b"]);
    expect(groups.sailedMeta).toBe("1 counted aboard while blocked");
  });

  it("in the record, says nothing about blocking when nobody was counted aboard blocked", () => {
    const groups = recordGroupsFor([seat("a")], recordOf({ a: "boarded" }));
    expect(groups.sailedMeta).toBeUndefined();
  });

  it("in the record, a diver nobody has said missing is never unaccounted", () => {
    const groups = recordGroupsFor([seat("a")], recordOf({ a: "boarded" }));
    expect(groups.unaccounted).toEqual([]);
  });

  it("in the record, a dock not-boarded outranks a later count, as the evening's does", () => {
    const groups = recordGroupsFor([seat("left")], recordOf({ left: "not_boarded" }, ["left"]));
    expect(ids(groups.didNotSail)).toEqual(["left"]);
  });

  it("in the record with no roll call taken, guesses nothing", () => {
    const groups = recordGroupsFor([seat("a"), seat("gone", { status: "no_show" })], recordOf({}));
    expect(groups.sailed).toEqual([]);
    expect(ids(groups.didNotSail)).toEqual(["gone"]);
    expect(ids(groups.unrecorded)).toEqual(["a"]);
    expect(groups.uncounted).toEqual([]);
  });

  it("in the record, takes the roll call's existence from its events, not from a boarded seat", () => {
    // The whole roster marked not boarded, or the boarded seats since
    // cancelled: a roll call was taken either way.
    const notBoarded = recordGroupsFor(
      [seat("a"), seat("b")],
      recordOf({ a: "not_boarded", b: "not_boarded" }),
    );
    expect(ids(notBoarded.didNotSail)).toEqual(["a", "b"]);
    expect(notBoarded.unrecorded).toEqual([]);

    const cancelledBoarded = recordGroupsFor([seat("a")], recordOf({}, [], true));
    expect(ids(cancelledBoarded.uncounted)).toEqual(["a"]);
    expect(cancelledBoarded.unrecorded).toEqual([]);
  });

  it("files a released seat as an ordinary seat when the desk is not open", () => {
    const rows = rowsFor([seat("gone", { status: "no_show" })], { gone: readiness("ready") });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(groups.notHere).toEqual([]);
    expect(ids(groups.ready)).toEqual(["gone"]);
  });

  it("says a depth sentence much of the boat shares once, and counts it", () => {
    const roster = [seat("a"), seat("b"), seat("c")];
    const rows = rowsFor(roster, {
      a: readiness("ready", deep),
      b: readiness("ready", deep),
      c: readiness("ready", deep),
    });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(groups.sharedFacts).toHaveLength(1);
    expect(groups.sharedFacts[0]?.count).toBe(3);
    expect(groups.sharedAdvisoryTexts.has(groups.sharedFacts[0]?.sentence ?? "")).toBe(true);
    // A shared advisory no longer holds each row open.
    expect(ids(groups.ready)).toEqual(["a", "b", "c"]);
  });

  it("holds an unpaid seat open only when the departure takes payment", () => {
    const unpaid = { ...readiness("ready"), paymentStatus: "unpaid" } as ReadinessRow;
    const rows = rowsFor([seat("a")], { a: unpaid });
    const free = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    const paid = groupRoster({
      t,
      rows,
      requiresPayment: true,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(ids(free.ready)).toEqual(["a"]);
    expect(ids(paid.stillToClear)).toEqual(["a"]);
  });
});

describe("the roster's worded controls", () => {
  it("words every waiver state, and offers no tap on a settled one", () => {
    const controls = waiverControls(t);
    expect(controls.not_sent.action).toBe("send");
    expect(controls.complete.action).toBeNull();
    expect(controls.medical_not_cleared.action).toBeNull();
    for (const control of Object.values(controls)) expect(control.label).not.toBe("");
  });

  it("keeps the payment select's order and withholds the write-offs from recording", () => {
    expect(Object.keys(rosterPaymentStatusCopy(t).statuses)).toEqual([
      "unpaid",
      "deposit_paid",
      "paid",
      "waived",
      "partly_refunded",
      "refunded",
    ]);
    expect(PAYMENT_STATUSES_RECORDING_ONLY).not.toContain("waived");
    expect(PAYMENT_STATUSES_RECORDING_ONLY).not.toContain("refunded");
    expect(PAYMENT_STATUSES_ALL).not.toContain("partly_refunded");
  });
});

/**
 * **A rehearsal's waiver link was never sent** (#2395). Every message about a
 * rehearsal is held, and its waiver links are handed over in person, so the
 * roster never says "Waiver sent" for one; it says the link was held.
 */
describe("waiverControls on a rehearsal", () => {
  it("says an open link was held, not sent, and still offers it", () => {
    const control = waiverControls(t, { rehearsal: true }).awaiting_signature;
    expect(control.label).toBe("Held: rehearsal");
    expect(control.action).toBe("resend");
    expect(waiverControls(t).awaiting_signature.label).toBe("Waiver sent");
  });
});

/**
 * Layer 3 review (dde-2 #3): the desk sends staff to "Move" for a diver it
 * turned away, so the door is on that row, before and after the boat leaves;
 * a plain no-show or an arrived seat still has none.
 */
describe("seatMoveForRow", () => {
  const move = (departed: boolean, started = departed) => ({
    action: () => {},
    targets: [
      {
        id: "t",
        label: "T",
        seatsLeft: 1,
        startsAt: "2026-10-24T12:00:00Z",
        localDay: "2026-10-24",
        dayLabel: "Sat, Oct 24, 2026",
        timeLabel: "8:00 AM EDT",
      },
    ],
    departed,
    started,
  });
  const booking = (status: string, turnedAwayAt: Date | null = null) => ({ status, turnedAwayAt });

  it("moves a booked seat only while the boat is in", () => {
    expect(seatMoveForRow(booking("booked"), move(false))).toBeDefined();
    expect(seatMoveForRow(booking("booked"), move(true))).toBeUndefined();
  });

  /** dde-3 #4+#5: until the scheduled start, not the sailing buffer. */
  it("moves a turned-away seat only before the boat's scheduled start", () => {
    const turnedAway = booking("no_show", new Date("2026-10-16T07:00:00Z"));
    expect(seatMoveForRow(turnedAway, move(false))).toBeDefined();
    expect(seatMoveForRow(turnedAway, move(false, true))).toBeUndefined();
    expect(seatMoveForRow(turnedAway, move(true))).toBeUndefined();
  });

  it("never moves a plain no-show or an arrived seat", () => {
    expect(seatMoveForRow(booking("no_show"), move(false))).toBeUndefined();
    expect(seatMoveForRow(booking("checked_in"), move(false))).toBeUndefined();
    expect(seatMoveForRow(booking("booked"), undefined)).toBeUndefined();
  });
});
