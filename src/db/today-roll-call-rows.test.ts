import { describe, expect, it } from "vitest";
import type { TodayAction } from "@/lib/today";
import { pushRollCallRows } from "./today-roll-call-rows";
import { rowsContext } from "./today-rows-test-fixtures";

describe("pushRollCallRows", () => {
  it("adds nothing when every boat is home, counted and crewed once", () => {
    const actions: TodayAction[] = [];
    pushRollCallRows(
      actions,
      rowsContext({
        boatsOut: { out: [], blocked: [] },
        rollCallGaps: [],
        crewClashState: { departures: [], clashes: new Map(), crew: new Map(), divers: new Map() },
      }),
    );
    expect(actions).toEqual([]);
  });

  it("leaves an earlier row where it was: it only ever appends", () => {
    const earlier = { id: "earlier" } as TodayAction;
    const actions: TodayAction[] = [earlier];
    pushRollCallRows(
      actions,
      rowsContext({
        boatsOut: { out: [], blocked: [] },
        rollCallGaps: [],
        crewClashState: { departures: [], clashes: new Map(), crew: new Map(), divers: new Map() },
      }),
    );
    expect(actions).toEqual([earlier]);
  });
});
