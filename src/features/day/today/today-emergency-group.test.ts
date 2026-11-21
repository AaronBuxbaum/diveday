import { describe, expect, it } from "vitest";
import { groupByDeparture, sortStationRows, type TodayAction } from "./today";

const NOW = new Date("2026-07-20T14:00:00Z");
const boat = (tripId: string, label = "Reef") => ({ tripId, label });

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
    dueAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("groupByDeparture — the emergency reference", () => {
  it("files a blank emergency reference under the desk, not the boat it names", () => {
    const rows = sortStationRows([
      action({ id: "messages", kind: "unanswered_messages", subject: "3", departure: undefined }),
      action({ id: "prep", kind: "dive_prep", subject: "4 sizes", departure: boat("t1") }),
      action({
        id: "card",
        kind: "emergency_card_blank",
        subject: "No numbers",
        departure: undefined,
      }),
    ]);
    const groups = groupByDeparture(rows);
    expect(groups.map((group) => group.departure?.tripId ?? "desk")).toEqual(["t1", "desk"]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["prep"]);
    // The pressing card leads the desk, above the quieter messages row.
    expect(groups[1]?.rows.map((row) => row.id)).toEqual(["card", "messages"]);
  });
});

/**
 * **A missing emergency contact outranks prep and every money row** (visual
 * review 2026-10-24, A43). Ordering only: the row gates nothing, and tone and
 * time-to-departure still lead; inside a tie, the number somebody rings from
 * the dock comes before an unpaid order, so a fold never hides it behind one.
 */
describe("Needs you rank: contact gaps above money (A43)", () => {
  it("sorts a contact gap above prep, payment and the money chores at the same tone and time", () => {
    // One tone for all of them, so the rank table is what is read: the money
    // chores are warnings by kind, and tone leads the sort before rank does.
    const tone = "warning" as const;
    const sorted = sortStationRows([
      action({ id: "payment", kind: "payment", subject: "A", tone }),
      action({ id: "refund", kind: "owed_refund", subject: "B", tone }),
      action({ id: "dispute", kind: "payment_dispute", subject: "C", tone }),
      action({ id: "stuck", kind: "stuck_payment_operation", subject: "D", tone }),
      action({ id: "prep", kind: "dive_prep", subject: "E", tone }),
      action({ id: "help", kind: "help_request", subject: "F", tone }),
      action({ id: "contact", kind: "emergency_contact", subject: "Z", tone }),
    ]);
    const ids = sorted.map((row) => row.id);
    expect(ids.indexOf("contact")).toBeLessThan(ids.indexOf("prep"));
    for (const money of ["payment", "refund", "dispute", "stuck"]) {
      expect(ids.indexOf("contact")).toBeLessThan(ids.indexOf(money));
    }
  });

  it("sorts above an unpaid order as the two arrive, both quiet", () => {
    const sorted = sortStationRows([
      action({ id: "payment", kind: "payment", subject: "A" }),
      action({ id: "contact", kind: "emergency_contact", subject: "Z" }),
    ]);
    expect(sorted[0]?.id).toBe("contact");
  });

  it("still ranks under the boarding gates", () => {
    const sorted = sortStationRows([
      action({ id: "contact", kind: "emergency_contact", tone: "warning" }),
      action({ id: "waiver", kind: "waiver" }),
    ]);
    expect(sorted[0]?.id).toBe("waiver");
  });
});
