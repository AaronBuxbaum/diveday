import { describe, expect, it } from "vitest";
import { type TodayAction, weekCrewAway } from "./today";

function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "later",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Do it",
    href: "/",
    dueAt: null,
    ...overrides,
  };
}

/**
 * **Who is away this week, on the week line** (issue #2671, decided by Aaron
 * 2026-10-17): a count of the people the week's `crew_away` rows name.
 */
describe("weekCrewAway", () => {
  const away = (id: string, people: string[], dueAt: string) =>
    action({
      id,
      kind: "crew_away",
      crewAway: { people: people.map((personId) => ({ personId, fullName: personId })) },
      dueAt: new Date(dueAt),
    });

  it("counts each away person once", () => {
    const rows = [
      away("crew-away:sat", ["marcus"], "2026-07-25T14:00:00Z"),
      away("crew-away:fri", ["marcus", "keiko"], "2026-07-24T14:00:00Z"),
      action({ id: "waiver", kind: "waiver" }),
    ];
    expect(weekCrewAway(rows)).toBe(2);
  });

  it("is nothing when no row is about crew away", () => {
    expect(weekCrewAway([action({ id: "waiver", kind: "waiver" })])).toBe(0);
  });
});
