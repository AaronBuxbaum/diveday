import { describe, expect, it } from "vitest";
import {
  ACTION_KIND_META,
  filterActionsForRoles,
  sortStationRows,
  type TodayAction,
} from "./today";

const NOW = new Date("2026-07-20T14:00:00Z");

function action(overrides: Partial<TodayAction>): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Mantis I",
    context: null,
    detail: "…",
    actionLabel: "Open boats",
    href: "/",
    dueAt: NOW,
    ...overrides,
  };
}

/**
 * **A lapsed boat paper is a loud owner row** (H-20261015-lapsed-boat-papers-loud): hull insurance,
 * registration or the safety inspection past its date reads in danger ink on
 * Today, above the desk's chores and every other boat errand. Kit that ran out
 * ashore stays a warning: kit is replaced, a lapsed paper is a claim uncovered.
 * The row gates nothing; it is an owner's and manager's, like the paper due.
 */
describe("a lapsed boat paper on Today (H-20261015-lapsed-boat-papers-loud)", () => {
  const due = action({ id: "due", kind: "boat_papers_due", urgency: "later" });
  const lapsed = action({ id: "lapsed", kind: "boat_papers_lapsed" });
  const kitAshore = action({ id: "kit-ashore", kind: "boat_safety_expired" });

  it("is danger, while a paper coming due stays quiet and kit ashore a warning", () => {
    expect(ACTION_KIND_META.boat_papers_lapsed.tone).toBe("danger");
    expect(ACTION_KIND_META.boat_papers_due.tone).toBe("neutral");
    expect(ACTION_KIND_META.boat_safety_expired.tone).toBe("warning");
  });

  it("is the owner's and manager's row, never the crew's", () => {
    expect(filterActionsForRoles([due, lapsed, kitAshore], ["crew"])).toEqual([]);
    expect(filterActionsForRoles([lapsed], ["owner"])).toEqual([lapsed]);
    expect(filterActionsForRoles([lapsed], ["manager"])).toEqual([lapsed]);
  });

  it("leads the desk's chores and the other boat errands", () => {
    const sorted = sortStationRows([
      action({ id: "reviews", kind: "reviews_pending" }),
      action({ id: "messages", kind: "unanswered_messages" }),
      kitAshore,
      lapsed,
    ]);
    expect(sorted.map((row) => row.id)[0]).toBe("lapsed");
  });
});
