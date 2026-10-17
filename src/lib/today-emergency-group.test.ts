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
  it("files a blank emergency reference under the boat it names, above the desk", () => {
    const rows = sortStationRows([
      action({ id: "messages", kind: "unanswered_messages", subject: "3", departure: undefined }),
      action({ id: "prep", kind: "dive_prep", subject: "4 sizes", departure: boat("t1") }),
      action({
        id: "card",
        kind: "emergency_card_blank",
        subject: "No numbers",
        departure: boat("t1"),
      }),
    ]);
    const groups = groupByDeparture(rows);
    expect(groups.map((group) => group.departure?.tripId ?? "desk")).toEqual(["t1", "desk"]);
    expect(groups[0]?.rows.map((row) => row.id).sort()).toEqual(["card", "prep"]);
  });
});
