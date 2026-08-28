import { describe, expect, it } from "vitest";
import type { ReadinessBlocker } from "./readiness";
import {
  anyBoatIsIn,
  assembleDaySpine,
  collapseDiverActions,
  diverBlockerAction,
  filterActionsForRoles,
  getSeasonalBriefing,
  getTimeOfDayGreeting,
  lastBoatIsIn,
  primaryBlocker,
  roleLensFor,
  rollCallGapUrgency,
  type SpineDeparture,
  sortActions,
  sortStationRows,
  spineIsQuiet,
  spineJobCount,
  type TodayAction,
  todaysBoatsAreClear,
  urgencyFor,
} from "./today";

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function blocker(code: ReadinessBlocker["code"]): ReadinessBlocker {
  return { code };
}

function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Do it",
    href: "/",
    dueAt: hoursFromNow(2),
    ...overrides,
  };
}

describe("urgencyFor", () => {
  it("flags the next boat out — inside three hours — as imminent", () => {
    expect(urgencyFor(hoursFromNow(0.5), NOW)).toBe("imminent");
    expect(urgencyFor(hoursFromNow(3), NOW)).toBe("imminent");
  });

  it("treats the rest of today, past the imminent window, as work for now", () => {
    expect(urgencyFor(hoursFromNow(3.5), NOW)).toBe("now");
    expect(urgencyFor(hoursFromNow(23), NOW)).toBe("now");
  });

  it("separates the next three days from the rest of the week", () => {
    expect(urgencyFor(hoursFromNow(30), NOW)).toBe("soon");
    expect(urgencyFor(hoursFromNow(71), NOW)).toBe("soon");
    expect(urgencyFor(hoursFromNow(80), NOW)).toBe("later");
  });

  it("puts undated work last rather than pretending it is urgent", () => {
    expect(urgencyFor(null, NOW)).toBe("later");
  });
});

describe("primaryBlocker", () => {
  it("returns null when a diver is clear", () => {
    expect(primaryBlocker([])).toBeNull();
  });

  it("ranks evidence that has to come from a physician above dock-side work", () => {
    const chosen = primaryBlocker([blocker("payment_due"), blocker("medical_review")]);
    expect(chosen?.code).toBe("medical_review");
  });

  it("ranks a missing card above an unsent waiver", () => {
    const chosen = primaryBlocker([blocker("waiver_not_sent"), blocker("certification_missing")]);
    expect(chosen?.code).toBe("certification_missing");
  });

  it("keeps the first blocker when severity ties", () => {
    const chosen = primaryBlocker([blocker("waiver_pending"), blocker("waiver_expired")]);
    expect(chosen?.code).toBe("waiver_pending");
  });
});

describe("diverBlockerAction", () => {
  const input = {
    bookingId: "b1",
    personId: "p1",
    fullName: "Maya Alvarez",
    tripId: "t1",
    tripTitle: "Reef Drift · 8:00 AM",
    startsAt: hoursFromNow(3),
    blockers: [blocker("waiver_not_sent")],
  };

  it("sends waiver work in place, keeping the verb and the booking payload", () => {
    const result = diverBlockerAction(input, "blue-reef", NOW);
    // href stays the row's real destination, the roster row.
    expect(result?.href).toBe("/shop/blue-reef/trips/t1/guests#booking-b1");
    expect(result?.actionLabel).toBe("Send waiver");
    expect(result?.waiver).toEqual({ bookingIds: ["b1"] });
    expect(result?.subject).toBe("Maya Alvarez");
    expect(result?.urgency).toBe("imminent");
  });

  it("points card work at the person record instead of pretending to act", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("certification_pending")] },
      "blue-reef",
      NOW,
    );
    expect(result?.href).toBe("/shop/blue-reef/divers/p1");
    // The tap only opens the record, so the label points rather than commands.
    expect(result?.actionLabel).toBe("Open Maya’s record");
    expect(result?.waiver).toBeUndefined();
  });

  it("collapses a diver's other blockers into the detail instead of extra rows", () => {
    const result = diverBlockerAction(
      {
        ...input,
        blockers: [blocker("medical_review"), blocker("payment_due"), blocker("waiver_pending")],
      },
      "blue-reef",
      NOW,
    );
    expect(result?.detail).toBe(
      "A medical answer needs staff follow-up. 2 other blockers to clear too.",
    );
  });

  it("says 'blocker' in the singular when only one other remains", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("medical_review"), blocker("payment_due")] },
      "blue-reef",
      NOW,
    );
    expect(result?.detail).toBe(
      "A medical answer needs staff follow-up. 1 other blocker to clear too.",
    );
  });

  it("produces nothing for a diver with no blockers", () => {
    expect(diverBlockerAction({ ...input, blockers: [] }, "blue-reef", NOW)).toBeNull();
  });

  it("marks a payment_due row with the single booking it can act on in place", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_due")] },
      "blue-reef",
      NOW,
    );
    // Only the bookingId — src/db/today.ts fills in orderId/hostedInvoiceUrl
    // once it knows the booking was actually invoiced through Stripe.
    expect(result?.payment).toEqual({ bookingId: "b1" });
    expect(result?.payment?.orderId).toBeUndefined();
  });

  it("marks a payment_refunded row the same way", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_refunded")] },
      "blue-reef",
      NOW,
    );
    expect(result?.payment).toEqual({ bookingId: "b1" });
  });

  it("never marks a non-payment row for the inline payment control", () => {
    const result = diverBlockerAction(input, "blue-reef", NOW);
    expect(result?.payment).toBeUndefined();
  });
});

describe("collapseDiverActions", () => {
  const diver = (fullName: string, code: ReadinessBlocker["code"], tripId = "t1") => ({
    bookingId: `b-${fullName}`,
    personId: `p-${fullName}`,
    fullName,
    tripId,
    tripTitle: "Reef Drift · 8:00 AM",
    startsAt: hoursFromNow(3),
    blockers: [blocker(code)],
  });

  it("turns a boatload of identical blockers into one job", () => {
    const result = collapseDiverActions(
      ["Ana Ruiz", "Ben Cole", "Cara Diaz"].map((name) => diver(name, "waiver_not_sent")),
      "blue-reef",
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.subject).toBe("3 divers");
    expect(result[0]?.actionLabel).toBe("Send waivers");
    // A batch send carries every diver's booking, so one tap sends all three.
    expect(result[0]?.waiver).toEqual({
      bookingIds: ["b-Ana Ruiz", "b-Ben Cole", "b-Cara Diaz"],
    });
    expect(result[0]?.detail).toBe("Waiver has not been sent. Ana Ruiz, Ben Cole and Cara Diaz.");
    // The roster is the only screen that shows all of them at once.
    expect(result[0]?.href).toBe("/shop/blue-reef/trips/t1");
  });

  it("does not turn a grouped non-waiver blocker into a batch send", () => {
    const result = collapseDiverActions(
      ["Ana Ruiz", "Ben Cole"].map((name) => diver(name, "payment_due")),
      "blue-reef",
      NOW,
    );
    expect(result[0]?.actionLabel).toBe("Open roster");
    expect(result[0]?.waiver).toBeUndefined();
    // A collapsed row stands for several bookings, so there is no single one
    // for the inline payment control to act on — it keeps the roster link.
    expect(result[0]?.payment).toBeUndefined();
  });

  it("abbreviates a long roster instead of listing everyone", () => {
    const names = ["Ana", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hal", "Ivy"];
    const result = collapseDiverActions(
      names.map((name) => diver(name, "waiver_not_sent")),
      "blue-reef",
      NOW,
    );

    expect(result[0]?.subject).toBe("9 divers");
    expect(result[0]?.detail).toBe("Waiver has not been sent. Ana, Ben and 7 others.");
  });

  it("keeps a lone diver named, and pointed at their own record", () => {
    const result = collapseDiverActions(
      [diver("Ana Ruiz", "certification_pending")],
      "blue-reef",
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.subject).toBe("Ana Ruiz");
    expect(result[0]?.href).toBe("/shop/blue-reef/divers/p-Ana Ruiz");
  });

  it("never merges different blockers, or different boats", () => {
    const result = collapseDiverActions(
      [
        diver("Ana", "waiver_not_sent"),
        diver("Ben", "waiver_not_sent"),
        diver("Cara", "payment_due"),
        diver("Dev", "waiver_not_sent", "t2"),
        diver("Eli", "waiver_not_sent", "t2"),
      ],
      "blue-reef",
      NOW,
    );

    expect(result).toHaveLength(3);
    expect(result.filter((entry) => entry.subject === "2 divers")).toHaveLength(2);
    expect(result.filter((entry) => entry.subject === "Cara")).toHaveLength(1);
  });

  it("ignores divers who are already clear", () => {
    expect(
      collapseDiverActions(
        [{ ...diver("Ana", "waiver_not_sent"), blockers: [] }],
        "blue-reef",
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("sortActions", () => {
  it("puts the earlier boat's problems first, whatever they are", () => {
    const sorted = sortActions([
      action({ id: "late", kind: "medical_review", dueAt: hoursFromNow(6) }),
      action({ id: "early", kind: "payment", dueAt: hoursFromNow(2) }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["early", "late"]);
  });

  it("falls back to severity inside a single departure", () => {
    const at = hoursFromNow(2);
    const sorted = sortActions([
      action({ id: "pay", kind: "payment", dueAt: at }),
      action({ id: "med", kind: "medical_review", dueAt: at }),
      action({ id: "card", kind: "certification", dueAt: at }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["med", "card", "pay"]);
  });

  it("orders urgent work ahead of everything else even when it is later in the day", () => {
    const sorted = sortActions([
      action({ id: "week", urgency: "later", dueAt: hoursFromNow(100) }),
      action({ id: "today", urgency: "now", dueAt: hoursFromNow(20) }),
    ]);
    expect(sorted[0]?.id).toBe("today");
  });

  it("leads the whole queue with an unfinished after-dive roll call (DOM-H3)", () => {
    // The boat is back; `dueAt` is when it tied up, so it is always earlier
    // than any departure still ahead of the shop. Both halves of the sort have
    // to agree for this to lead — the top urgency band, then the earliest
    // `dueAt` — and a medical review on the very next boat is the strongest
    // thing it has to beat.
    const sorted = sortActions([
      action({
        id: "medical",
        kind: "medical_review",
        urgency: "imminent",
        dueAt: hoursFromNow(1),
      }),
      action({ id: "waiver", kind: "waiver", urgency: "imminent", dueAt: hoursFromNow(0.5) }),
      action({
        id: "roll-call",
        kind: "roll_call_unfinished",
        urgency: "imminent",
        dueAt: hoursFromNow(-2),
      }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["roll-call", "waiver", "medical"]);
  });

  it("puts an unfinished roll call ahead of a medical review on the same boat", () => {
    // Severity is what breaks the tie once two rows share a `dueAt`, and
    // nothing outranks the count that says whether everyone came back.
    const at = hoursFromNow(-1);
    const sorted = sortActions([
      action({ id: "med", kind: "medical_review", urgency: "imminent", dueAt: at }),
      action({ id: "roll", kind: "roll_call_unfinished", urgency: "imminent", dueAt: at }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["roll", "med"]);
  });

  it("sorts undated work last within its group", () => {
    const sorted = sortActions([
      action({ id: "undated", urgency: "now", dueAt: null }),
      action({ id: "dated", urgency: "now", dueAt: hoursFromNow(5) }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["dated", "undated"]);
  });

  it("does not mutate its input", () => {
    const input = [action({ id: "b", dueAt: hoursFromNow(9) }), action({ id: "a" })];
    sortActions(input);
    expect(input.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("roleLensFor", () => {
  it("gives owners and managers no lens, whatever else they hold", () => {
    expect(roleLensFor(["owner"])).toBeNull();
    expect(roleLensFor(["manager", "instructor", "captain"])).toBeNull();
  });

  it("leads instructors with sessions, boat crew with their boat", () => {
    expect(roleLensFor(["instructor"])).toBe("sessions");
    expect(roleLensFor(["captain"])).toBe("boat");
    expect(roleLensFor(["divemaster"])).toBe("boat");
    // Instructor wins for someone holding both, matching switcher precedence.
    expect(roleLensFor(["captain", "instructor"])).toBe("sessions");
    expect(roleLensFor(["diver"])).toBeNull();
    expect(roleLensFor([])).toBeNull();
  });
});

describe("getSeasonalBriefing", () => {
  it("returns summer for June, July, August", () => {
    expect(getSeasonalBriefing(new Date("2026-07-15"), "UTC")).toBe("summer");
  });

  it("returns autumn for September, October, November", () => {
    expect(getSeasonalBriefing(new Date("2026-10-15"), "UTC")).toBe("autumn");
  });

  it("returns winter for December, January, February", () => {
    expect(getSeasonalBriefing(new Date("2026-01-15"), "UTC")).toBe("winter");
  });

  it("returns spring for March, April, May", () => {
    expect(getSeasonalBriefing(new Date("2026-04-15"), "UTC")).toBe("spring");
  });

  it("reads the month in the shop's timezone, not the runtime's (regression)", () => {
    // 2026-08-31 23:30Z is already September 1 in Auckland (UTC+12), but
    // still August 31 in Honolulu (UTC-10): the same instant is a different
    // season depending on whose calendar you read. It must be the shop's.
    const instant = new Date("2026-08-31T23:30:00Z");
    expect(getSeasonalBriefing(instant, "Pacific/Auckland")).toBe("autumn");
    expect(getSeasonalBriefing(instant, "Pacific/Honolulu")).toBe("summer");
  });
});

describe("getTimeOfDayGreeting", () => {
  it("returns morning for 8 AM local time", () => {
    const date = new Date("2026-11-15T13:00:00Z"); // 13:00 UTC -> 8:00 AM America/New_York
    expect(getTimeOfDayGreeting(date, "America/New_York")).toBe("morning");
  });

  it("returns afternoon for 2 PM local time", () => {
    const date = new Date("2026-11-15T19:00:00Z"); // 19:00 UTC -> 2:00 PM America/New_York
    expect(getTimeOfDayGreeting(date, "America/New_York")).toBe("afternoon");
  });

  it("returns evening for 7 PM local time", () => {
    const date = new Date("2026-11-15T24:00:00Z"); // 00:00 UTC next day -> 7:00 PM America/New_York
    expect(getTimeOfDayGreeting(date, "America/New_York")).toBe("evening");
  });

  it("returns night for 11 PM local time", () => {
    const dateNight = new Date("2026-11-16T04:00:00Z"); // 04:00 UTC -> 11:00 PM America/New_York
    expect(getTimeOfDayGreeting(dateNight, "America/New_York")).toBe("night");
  });
});

describe("anyBoatIsIn", () => {
  // The trigger for Today's evening handoff to the close-out. It reads the
  // departures `getTodayWork` already returned — no second detector, no
  // wall-clock band.
  const departure = (hoursFromNowEnd: number) => ({ endsAt: hoursFromNow(hoursFromNowEnd) });

  it("is true once one of today's departures is home, with another still out", () => {
    // The case the card used to miss entirely: an evening with a night dive
    // still on the board is exactly when a shop starts writing the day up
    // (FU-20260811-close-out-has-one-conditional-door).
    expect(anyBoatIsIn([departure(-4), departure(2)], NOW)).toBe(true);
  });

  it("is true once every boat is in", () => {
    expect(anyBoatIsIn([departure(-4), departure(-1)], NOW)).toBe(true);
  });

  it("is false while every boat is still out — there is nothing to write up yet", () => {
    expect(anyBoatIsIn([departure(1), departure(4)], NOW)).toBe(false);
  });

  it("counts a boat due back exactly now as in", () => {
    expect(anyBoatIsIn([departure(0)], NOW)).toBe(true);
  });

  it("is false on a day with no departures — nothing sailed, so nothing to hand over", () => {
    // The close-out is still one palette search away; this is a handoff, not
    // the door.
    expect(anyBoatIsIn([], NOW)).toBe(false);
  });
});

describe("lastBoatIsIn", () => {
  // No longer gates the handoff card — it picks the card's words, so that "the
  // last boat is in" is never said over a boat still at sea.
  const departure = (hoursFromNowEnd: number) => ({ endsAt: hoursFromNow(hoursFromNowEnd) });

  it("is true once every one of today's departures is back at the dock", () => {
    expect(lastBoatIsIn([departure(-4), departure(-1)], NOW)).toBe(true);
  });

  it("is false while any boat is still out — one late return keeps the day open", () => {
    expect(lastBoatIsIn([departure(-4), departure(2)], NOW)).toBe(false);
  });

  it("counts a boat due back exactly now as in", () => {
    expect(lastBoatIsIn([departure(0)], NOW)).toBe(true);
  });

  it("is false on a day with no departures — nothing sailed, so no last boat", () => {
    expect(lastBoatIsIn([], NOW)).toBe(false);
  });
});

describe("roll-call gap ranking (DOM-H3)", () => {
  it("ranks a diver who did not come back above every other row on the boat", () => {
    // Severity is what breaks the tie once two rows share a `dueAt`. A crew
    // member said a diver is not back aboard; nothing on this queue outranks
    // that, and the unfinished-count row is the strongest thing it has to beat.
    const at = hoursFromNow(-1);
    const sorted = sortActions([
      action({ id: "dock", kind: "roll_call_departure_open", urgency: "imminent", dueAt: at }),
      action({ id: "none", kind: "roll_call_not_started", urgency: "imminent", dueAt: at }),
      action({ id: "open", kind: "roll_call_unfinished", urgency: "imminent", dueAt: at }),
      action({ id: "missing", kind: "roll_call_missing_diver", urgency: "imminent", dueAt: at }),
      action({ id: "crewOpen", kind: "roll_call_crew_unfinished", urgency: "imminent", dueAt: at }),
      action({ id: "crewMissing", kind: "roll_call_missing_crew", urgency: "imminent", dueAt: at }),
      action({ id: "med", kind: "medical_review", urgency: "imminent", dueAt: at }),
    ]);
    // The four after-dive kinds lead — a crew member who did not come back sits
    // beside the diver row, not below the clerical ones (review 20260803, D1) —
    // then the diver blocker, and the two dock-count kinds ride last.
    expect(sorted.map((entry) => entry.id)).toEqual([
      "missing",
      "crewMissing",
      "open",
      "crewOpen",
      "med",
      "dock",
      "none",
    ]);
  });

  it("pins the after-dive gaps to the top band and drops the dock counts a band", () => {
    // An unfinished dock count is real work, but it is not "a person may be in
    // the water" — putting both in the same band is what turns the red row into
    // wallpaper.
    expect(rollCallGapUrgency("missing_diver", false)).toBe("imminent");
    expect(rollCallGapUrgency("after_dive_uncounted", false)).toBe("imminent");
    // Crew ride the identical schedule: a crew member is not less findable
    // than a customer (review 20260803, D1).
    expect(rollCallGapUrgency("missing_crew", false)).toBe("imminent");
    expect(rollCallGapUrgency("crew_uncounted", false)).toBe("imminent");
    expect(rollCallGapUrgency("departure_uncounted", false)).toBe("now");
    expect(rollCallGapUrgency("no_roll_call", false)).toBe("now");
  });

  it("ages an unclosed after-dive count down a band instead of to nothing", () => {
    // Past the dock-work window the row used to vanish outright, with nothing
    // anywhere recording that a count had never closed. It degrades instead.
    expect(rollCallGapUrgency("missing_diver", true)).toBe("soon");
    expect(rollCallGapUrgency("after_dive_uncounted", true)).toBe("soon");
    expect(rollCallGapUrgency("missing_crew", true)).toBe("soon");
    expect(rollCallGapUrgency("crew_uncounted", true)).toBe("soon");
  });
});

describe("filterActionsForRoles", () => {
  const sampleActions = [
    action({ id: "1", kind: "roll_call_missing_diver" }),
    action({ id: "2", kind: "dive_prep" }),
    action({ id: "3", kind: "nitrox_gate" }),
    action({ id: "4", kind: "certification" }),
    action({ id: "5", kind: "waiver" }),
    action({ id: "6", kind: "payment" }),
    action({ id: "7", kind: "last_minute_fill" }),
    action({ id: "8", kind: "gear_due_back" }),
  ];

  it("shows all actions to an owner with zero withheld", () => {
    const result = filterActionsForRoles(sampleActions, ["owner"]);
    expect(result.visibleActions).toHaveLength(8);
    expect(result.withheldCount).toBe(0);
  });

  it("shows all actions to a manager with zero withheld", () => {
    const result = filterActionsForRoles(sampleActions, ["manager"]);
    expect(result.visibleActions).toHaveLength(8);
    expect(result.withheldCount).toBe(0);
  });

  it("filters out clerical and commercial rows for a captain", () => {
    const result = filterActionsForRoles(sampleActions, ["captain"]);
    expect(result.visibleActions.map((a) => a.id)).toEqual(["1", "2", "3", "8"]);
    expect(result.withheldCount).toBe(4);
  });

  it("filters out clerical and commercial rows for a divemaster", () => {
    const result = filterActionsForRoles(sampleActions, ["divemaster"]);
    expect(result.visibleActions.map((a) => a.id)).toEqual(["1", "2", "3", "8"]);
    expect(result.withheldCount).toBe(4);
  });

  it("shows certs and waivers to an instructor but withholds payment and deals", () => {
    const result = filterActionsForRoles(sampleActions, ["instructor"]);
    expect(result.visibleActions.map((a) => a.id)).toEqual(["1", "2", "3", "4", "5", "8"]);
    expect(result.withheldCount).toBe(2);
  });

  it("shows the union for a person holding multiple roles", () => {
    const result = filterActionsForRoles(sampleActions, ["captain", "instructor"]);
    expect(result.visibleActions.map((a) => a.id)).toEqual(["1", "2", "3", "4", "5", "8"]);
    expect(result.withheldCount).toBe(2);
  });
});

/**
 * **The day spine files work; it never re-detects it** (ADR
 * 20260827-clearwater-surface-language, decision 4). Everything below asks the
 * same question: given a queue `getTodayWork` already produced and ranked, does
 * every row land where the design says, and does nothing appear twice?
 */
function departure(overrides: Partial<SpineDeparture> = {}): SpineDeparture {
  return {
    tripId: "t1",
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(2),
    endsAt: hoursFromNow(5),
    siteName: "Molasses Reef",
    boatName: "Mantis II",
    priceCents: 9500,
    capacity: 12,
    booked: 10,
    boarded: 0,
    blocked: 0,
    crew: [{ fullName: "Keiko Tanaka" }],
    blockedAboardGroups: [],
    crewAccountedFor: true,
    crewReason: null,
    ...overrides,
  };
}

const boat = (tripId: string, label = "Reef") => ({ tripId, label });

describe("assembleDaySpine", () => {
  it("files a row under the station of the trip it names, and a row with no trip at the desk", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "on-boat", departure: boat("t1") }),
          action({ id: "at-desk", kind: "reviews_pending", departure: undefined }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations.map((station) => station.rows.map((row) => row.id))).toEqual([
      ["on-boat"],
    ]);
    expect(spine.desk.map((row) => row.id)).toEqual(["at-desk"]);
  });

  it("orders stations by the clock, whoever is reading", () => {
    // The departure board led with the boat the signed-in staffer crewed. The
    // spine does not: a clock that puts 1:00 PM above 7:00 AM for one reader is
    // no longer a clock (a deliberate change, decision 4).
    const spine = assembleDaySpine(
      {
        departures: [
          departure({ tripId: "afternoon", startsAt: hoursFromNow(6), endsAt: hoursFromNow(9) }),
          departure({ tripId: "morning", startsAt: hoursFromNow(1), endsAt: hoursFromNow(4) }),
        ],
        actions: [],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations.map((station) => station.tripId)).toEqual(["morning", "afternoon"]);
  });

  it("ranks a station's rows danger, then warning, then quiet", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
          action({ id: "danger", kind: "medical_review", departure: boat("t1") }),
          action({ id: "warning", kind: "waiver", departure: boat("t1") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations[0]?.rows.map((row) => row.id)).toEqual(["danger", "warning", "quiet"]);
  });

  it("flattens the crew to names and carries the station's own site, boat and price", () => {
    const spine = assembleDaySpine(
      {
        departures: [
          departure({ crew: [{ fullName: "Keiko Tanaka" }, { fullName: "Sal Moretti" }] }),
        ],
        actions: [],
      },
      { departures: [], actions: [] },
    );
    expect(spine.stations[0]?.crewNames).toEqual(["Keiko Tanaka", "Sal Moretti"]);
    expect(spine.stations[0]?.siteName).toBe("Molasses Reef");
    expect(spine.stations[0]?.boatName).toBe("Mantis II");
    expect(spine.stations[0]?.priceCents).toBe(9500);
  });

  it("hangs tomorrow's rows off tomorrow's own departures, and counts the rest as the week", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "today", departure: boat("t1") }),
          action({ id: "tomorrow", departure: boat("t2") }),
          action({ id: "friday", departure: boat("t9") }),
        ],
      },
      { departures: [departure({ tripId: "t2", startsAt: hoursFromNow(26) })], actions: [] },
    );
    expect(spine.tomorrow.stations.map((station) => station.tripId)).toEqual(["t2"]);
    expect(spine.tomorrow.stations[0]?.rows.map((row) => row.id)).toEqual(["tomorrow"]);
    expect(spine.tomorrow.jobs).toBe(1);
    expect(spine.week.jobs).toBe(1);
  });

  it("counts every row exactly once, wherever its boat sails", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "today", departure: boat("t1") }),
          action({ id: "tomorrow", departure: boat("t2") }),
          action({ id: "friday", departure: boat("t9") }),
          action({ id: "desk", departure: undefined }),
        ],
      },
      { departures: [departure({ tripId: "t2" })], actions: [] },
    );
    expect(spineJobCount(spine)).toBe(4);
  });

  it("renders no station for a day with no departures", () => {
    const spine = assembleDaySpine(
      { departures: [], actions: [action({ id: "desk", departure: undefined })] },
      { departures: [], actions: [] },
    );
    expect(spine.stations).toEqual([]);
    expect(spine.tomorrow.stations).toEqual([]);
    expect(spine.desk).toHaveLength(1);
  });
});

describe("sortStationRows", () => {
  it("does not mutate its input", () => {
    const input = [
      action({ id: "quiet", kind: "dive_prep" }),
      action({ id: "danger", kind: "medical_review" }),
    ];
    sortStationRows(input);
    expect(input.map((row) => row.id)).toEqual(["quiet", "danger"]);
  });
});

/**
 * **The quiet day** — the composition's other silence, and the one that decides
 * whether the spine renders at all (SPEC 6c's pinned pair, "A quiet day at the
 * dock." over "No boats today, and nothing is waiting on you.").
 */
describe("spineIsQuiet", () => {
  const empty = () =>
    assembleDaySpine({ departures: [], actions: [] }, { departures: [], actions: [] });

  it("collapses a day with no boat and nothing waiting anywhere", () => {
    expect(spineIsQuiet(empty(), false)).toBe(true);
  });

  it("is not quiet while a boat is on the spine, however clear it is", () => {
    const spine = assembleDaySpine(
      { departures: [departure()], actions: [] },
      { departures: [], actions: [] },
    );
    expect(spineIsQuiet(spine, false)).toBe(false);
  });

  it("is not quiet while a job waits at the desk, on tomorrow, or later in the week", () => {
    const desk = assembleDaySpine(
      {
        departures: [],
        actions: [action({ id: "stuck", kind: "stuck_payment_operation", departure: undefined })],
      },
      { departures: [], actions: [] },
    );
    expect(spineIsQuiet(desk, false)).toBe(false);

    const week = assembleDaySpine(
      { departures: [], actions: [action({ id: "later", kind: "waiver", departure: boat("t9") })] },
      { departures: [], actions: [] },
    );
    expect(spineIsQuiet(week, false)).toBe(false);

    const tomorrow = assembleDaySpine(
      {
        departures: [],
        actions: [action({ id: "tmw", kind: "waiver", departure: boat("t2") })],
      },
      { departures: [departure({ tripId: "t2" })], actions: [] },
    );
    expect(spineIsQuiet(tomorrow, false)).toBe(false);
  });

  it("is not quiet while a presence-derived desk row stands, which no job count can see", () => {
    // "Nothing is waiting on you" over a payments row the reader can see on the
    // same screen is a lie (ADR 20260827-first-light, decision 6).
    expect(spineIsQuiet(empty(), true)).toBe(false);
  });
});

/**
 * The morning good-news moment (principles.md §3, and the coral budget's "The
 * home, morning" row). Every case here is a **silence** as much as a sentence:
 * this line renders nothing at all when it is not true, which is the whole
 * discipline the ADR's coral table is enforcing.
 */
describe("todaysBoatsAreClear", () => {
  const spineWith = (rows: TodayAction[], desk: TodayAction[] = []) =>
    assembleDaySpine(
      {
        departures: [departure()],
        actions: [...rows, ...desk],
      },
      { departures: [], actions: [] },
    );

  it("fires once today's boats carry nothing pressing but work remains elsewhere", () => {
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
          action({ id: "later", kind: "waiver", departure: boat("t9") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(todaysBoatsAreClear(spine)).toBe(true);
  });

  it("stays silent while a station still carries a warning or a danger row", () => {
    expect(
      todaysBoatsAreClear(spineWith([action({ id: "w", kind: "waiver", departure: boat("t1") })])),
    ).toBe(false);
    expect(
      todaysBoatsAreClear(
        spineWith([action({ id: "d", kind: "medical_review", departure: boat("t1") })]),
      ),
    ).toBe(false);
  });

  it("stays silent while the desk group carries one", () => {
    // The desk is today's work too — a stuck payment operation is not "the
    // boats are clear" just because it has no boat.
    const spine = assembleDaySpine(
      {
        departures: [departure()],
        actions: [
          action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
          action({ id: "stuck", kind: "stuck_payment_operation", departure: undefined }),
          action({ id: "later", kind: "waiver", departure: boat("t9") }),
        ],
      },
      { departures: [], actions: [] },
    );
    expect(todaysBoatsAreClear(spine)).toBe(false);
  });

  it("renders nothing on a day with no boats at all", () => {
    const spine = assembleDaySpine(
      { departures: [], actions: [action({ id: "later", kind: "waiver", departure: boat("t9") })] },
      { departures: [], actions: [] },
    );
    expect(todaysBoatsAreClear(spine)).toBe(false);
  });

  it("yields to the other good-news moment when nothing is waiting anywhere", () => {
    // "Nothing is waiting on you" is the whole-week moment; the two have never
    // both rendered at once, and this is what keeps that true.
    const spine = assembleDaySpine(
      { departures: [departure()], actions: [] },
      { departures: [], actions: [] },
    );
    expect(spineJobCount(spine)).toBe(0);
    expect(todaysBoatsAreClear(spine)).toBe(false);
  });
});
