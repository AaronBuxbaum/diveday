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
 * 2026-10-17): a count of the people the week's `crew_away` rows name, and the
 * day the board link opens on.
 */
describe("weekCrewAway", () => {
  const away = (id: string, people: string[], dueAt: string) =>
    action({
      id,
      kind: "crew_away",
      crewAway: { people: people.map((personId) => ({ personId, fullName: personId })) },
      dueAt: new Date(dueAt),
    });

  it("counts each away person once and names the soonest departure's day", () => {
    const rows = [
      away("crew-away:sat", ["marcus"], "2026-07-25T14:00:00Z"),
      away("crew-away:fri", ["marcus", "keiko"], "2026-07-24T14:00:00Z"),
      action({ id: "waiver", kind: "waiver" }),
    ];
    expect(weekCrewAway(rows, "America/New_York")).toEqual({ people: 2, firstDay: "2026-07-24" });
  });

  it("reads that day in the shop's zone", () => {
    // 14:00Z on the 24th is already the 25th in Auckland.
    expect(
      weekCrewAway([away("crew-away:fri", ["marcus"], "2026-07-24T14:00:00Z")], "Pacific/Auckland"),
    ).toEqual({ people: 1, firstDay: "2026-07-25" });
  });

  it("is nothing when no row is about crew away", () => {
    expect(weekCrewAway([action({ id: "waiver", kind: "waiver" })], "UTC")).toBeNull();
  });
});
