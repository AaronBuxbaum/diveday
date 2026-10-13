import { describe, expect, it } from "vitest";
import type { TodayAction } from "@/lib/today";
import { pushDepartureRows } from "./today-departure-rows";
import { rowsContext } from "./today-rows-test-fixtures";

const emptyWave = {
  missingFit: new Map(),
  ungatedNitrox: new Map(),
  missingContact: new Map(),
  waitlisted: new Map(),
  courseCrewCounts: new Map(),
  deliveryIssues: [],
  neverSentLastMinuteDeal: new Set(),
  lastMinuteWindows: [],
  boardedAnywhere: new Map(),
  sharedWelcomeSeats: new Map(),
};

describe("pushDepartureRows", () => {
  it("adds nothing for an empty window with no bounced email", () => {
    const actions: TodayAction[] = [];
    pushDepartureRows(actions, rowsContext(emptyWave));
    expect(actions).toEqual([]);
  });
});
