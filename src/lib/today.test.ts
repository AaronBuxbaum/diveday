import { describe, expect, it } from "vitest";
import type { ReadinessBlocker } from "./readiness";
import {
  collapseDiverActions,
  diverBlockerAction,
  groupActions,
  leadWithCrewed,
  primaryBlocker,
  roleLensFor,
  sortActions,
  summarizeDay,
  type TodayAction,
  urgencyFor,
} from "./today";

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function blocker(code: ReadinessBlocker["code"], message = "…"): ReadinessBlocker {
  return { code, message };
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
  it("treats anything inside a day as work for right now", () => {
    expect(urgencyFor(hoursFromNow(1), NOW)).toBe("now");
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
    blockers: [blocker("waiver_not_sent", "Waiver has not been sent.")],
  };

  it("sends waiver work in place, keeping the verb and the booking payload", () => {
    const result = diverBlockerAction(input, "blue-reef", NOW);
    // href stays as the no-JS fallback to the roster row.
    expect(result?.href).toBe("/shop/blue-reef/trips/t1/guests#booking-b1");
    expect(result?.actionLabel).toBe("Send waiver");
    expect(result?.waiver).toEqual({ bookingIds: ["b1"] });
    expect(result?.subject).toBe("Maya Alvarez");
    expect(result?.urgency).toBe("now");
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
        blockers: [
          blocker("medical_review", "A medical answer needs staff follow-up."),
          blocker("payment_due"),
          blocker("waiver_pending"),
        ],
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
      { ...input, blockers: [blocker("medical_review", "Flagged."), blocker("payment_due")] },
      "blue-reef",
      NOW,
    );
    expect(result?.detail).toBe("Flagged. 1 other blocker to clear too.");
  });

  it("produces nothing for a diver with no blockers", () => {
    expect(diverBlockerAction({ ...input, blockers: [] }, "blue-reef", NOW)).toBeNull();
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
    blockers: [blocker(code, "Waiver has not been sent.")],
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

  it("keeps groups in urgency order", () => {
    const groups = groupActions([
      action({ id: "l", urgency: "later", dueAt: hoursFromNow(100) }),
      action({ id: "n", urgency: "now" }),
      action({ id: "s", urgency: "soon", dueAt: hoursFromNow(40) }),
    ]);
    expect(groups.map((group) => group.urgency)).toEqual(["now", "soon", "later"]);
  });

  it("returns nothing at all for an empty queue", () => {
    expect(groupActions([])).toEqual([]);
  });
});

describe("summarizeDay", () => {
  it("celebrates a genuinely clear day", () => {
    expect(summarizeDay([], 2)).toBe("2 departures today — and nothing is waiting on you.");
  });

  it("leads with the people who cannot board, not the number of rows", () => {
    // Nine divers collapsed into one row is still nine divers.
    const summary = summarizeDay([action({ urgency: "now" })], 1, 9);
    expect(summary).toBe("1 departure today. 9 divers still can’t board.");
  });

  it("counts a single blocked diver in the singular", () => {
    expect(summarizeDay([action({ urgency: "now" })], 1, 1)).toBe(
      "1 departure today. 1 diver still can’t board.",
    );
  });

  it("falls back to jobs when today's boats are clear but work remains", () => {
    const summary = summarizeDay(
      [action({ urgency: "now" }), action({ id: "b", urgency: "later" })],
      1,
    );
    expect(summary).toBe("1 departure today. 1 job to clear before they sail.");
  });

  it("stays calm when nothing is urgent", () => {
    const summary = summarizeDay([action({ urgency: "soon" })], 0);
    expect(summary).toBe("No boats out today. Nothing is urgent; 1 job to work ahead.");
  });

  it("pluralises departures and jobs", () => {
    const summary = summarizeDay(
      [action({ id: "a", urgency: "soon" }), action({ id: "b", urgency: "later" })],
      3,
    );
    expect(summary).toBe("3 departures today. Nothing is urgent; 2 jobs to work ahead.");
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
