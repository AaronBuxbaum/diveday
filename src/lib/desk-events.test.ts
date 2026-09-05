import { describe, expect, it } from "vitest";
import { DESK_EVENT_KINDS, type DeskEvent, groupCatchUp } from "./desk-events";

const AT = new Date("2026-07-21T13:30:00.000Z");

function event(kind: DeskEvent["kind"], subjectName: string | null, seq: number): DeskEvent {
  return { kind, subjectName, seq, occurredAt: AT };
}

describe("groupCatchUp", () => {
  it("says nothing when there is nothing new", () => {
    expect(groupCatchUp([])).toEqual([]);
  });

  it("contributes no group for a kind with no rows", () => {
    const groups = groupCatchUp([event("arrival", "Ada Lindqvist", 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("arrival");
  });

  it("orders the sentences by kind, not by when the desk acted", () => {
    // Written newest-first and out of vocabulary order on purpose: the reader
    // wants the roster changes together, not a chronology to re-sort.
    const groups = groupCatchUp([
      event("plan_changed", null, 1),
      event("help_request", "Ben Okafor", 2),
      event("arrival", "Ada Lindqvist", 3),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["arrival", "help_request", "plan_changed"]);
  });

  it("keeps the order DESK_EVENT_KINDS declares, whatever order the rows arrive in", () => {
    const shuffled = [...DESK_EVENT_KINDS].reverse();
    const groups = groupCatchUp(
      shuffled.map((kind, index) => event(kind, `Diver ${index}`, index + 1)),
    );
    expect(groups.map((group) => group.kind)).toEqual([...DESK_EVENT_KINDS]);
  });

  it("names a diver once inside a kind, in the order they were first seen", () => {
    const groups = groupCatchUp([
      event("arrival", "Ben Okafor", 1),
      event("arrival", "Ada Lindqvist", 2),
      event("arrival", "Ben Okafor", 3),
    ]);
    expect(groups[0]?.names).toEqual(["Ben Okafor", "Ada Lindqvist"]);
  });

  it("puts a diver in each kind they appear in, and twice in neither", () => {
    const groups = groupCatchUp([
      event("arrival", "Ben Okafor", 1),
      event("gear_changed", "Ben Okafor", 2),
    ]);
    expect(groups).toEqual([
      { kind: "arrival", names: ["Ben Okafor"] },
      { kind: "gear_changed", names: ["Ben Okafor"] },
    ]);
  });

  it("keeps a group for a trip-wide kind, which names nobody", () => {
    expect(groupCatchUp([event("meeting_point", null, 1)])).toEqual([
      { kind: "meeting_point", names: [] },
    ]);
  });

  it("drops an erased diver's name rather than rendering a hole", () => {
    // `subjectName` is joined live from `people`, so an erasure through
    // `anonymizeDiver` reaches this list as a null rather than a stale name.
    const groups = groupCatchUp([event("arrival", null, 1), event("arrival", "Ada Lindqvist", 2)]);
    expect(groups[0]?.names).toEqual(["Ada Lindqvist"]);
  });
});
