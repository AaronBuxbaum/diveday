import { describe, expect, it } from "vitest";
import type { ReadinessBlocker } from "./readiness";
import {
  collapseDiverActions,
  diverBlockerAction,
  getSeasonalBriefing,
  getTimeOfDayGreeting,
  groupActions,
  leadWithCrewed,
  primaryBlocker,
  roleLensFor,
  rollCallGapUrgency,
  sortActions,
  summarizeDay,
  type TodayAction,
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
    // href stays as the no-JS fallback to the roster row.
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

describe("groupActions", () => {
  it("drops empty groups so no heading sits over nothing", () => {
    const groups = groupActions([action({ urgency: "now" }), action({ id: "z", urgency: "now" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.urgency).toBe("now");
    expect(groups[0]?.actions).toHaveLength(2);
  });

  it("keeps groups in urgency order, imminent ahead of the rest of today", () => {
    const groups = groupActions([
      action({ id: "l", urgency: "later", dueAt: hoursFromNow(100) }),
      action({ id: "n", urgency: "now" }),
      action({ id: "i", urgency: "imminent", dueAt: hoursFromNow(1) }),
      action({ id: "s", urgency: "soon", dueAt: hoursFromNow(40) }),
    ]);
    expect(groups.map((group) => group.urgency)).toEqual(["imminent", "now", "soon", "later"]);
  });

  it("returns nothing at all for an empty queue", () => {
    expect(groupActions([])).toEqual([]);
  });
});

describe("summarizeDay", () => {
  it("celebrates a genuinely clear day", () => {
    expect(summarizeDay([], 2)).toEqual({ code: "clear", departures: 2 });
  });

  it("leads with the people who cannot board, not the number of rows", () => {
    // Nine divers collapsed into one row is still nine divers.
    const summary = summarizeDay([action({ urgency: "now" })], 1, 9);
    expect(summary).toEqual({ code: "blocked", departures: 1, blockedToday: 9 });
  });

  it("counts a single blocked diver in the singular", () => {
    expect(summarizeDay([action({ urgency: "now" })], 1, 1)).toEqual({
      code: "blocked",
      departures: 1,
      blockedToday: 1,
    });
  });

  it("falls back to jobs when today's boats are clear but work remains", () => {
    const summary = summarizeDay(
      [action({ urgency: "now" }), action({ id: "b", urgency: "later" })],
      1,
    );
    expect(summary).toEqual({ code: "urgent", departures: 1, urgent: 1 });
  });

  it("counts imminent work as urgent alongside the rest of today", () => {
    const summary = summarizeDay(
      [action({ id: "a", urgency: "imminent" }), action({ id: "b", urgency: "later" })],
      1,
    );
    expect(summary).toEqual({ code: "urgent", departures: 1, urgent: 1 });
  });

  it("stays calm when nothing is urgent", () => {
    const summary = summarizeDay([action({ urgency: "soon" })], 0);
    expect(summary).toEqual({ code: "ahead", departures: 0, jobs: 1 });
  });

  it("pluralises departures and jobs", () => {
    const summary = summarizeDay(
      [action({ id: "a", urgency: "soon" }), action({ id: "b", urgency: "later" })],
      3,
    );
    expect(summary).toEqual({ code: "ahead", departures: 3, jobs: 2 });
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

describe("leadWithCrewed", () => {
  it("moves crewed departures first without reordering within each half", () => {
    const departures = [{ tripId: "a" }, { tripId: "b" }, { tripId: "c" }];
    expect(leadWithCrewed(departures, new Set(["c"])).map((d) => d.tripId)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(leadWithCrewed(departures, new Set()).map((d) => d.tripId)).toEqual(["a", "b", "c"]);
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
