import { describe, expect, it } from "vitest";
import { type DayMark, manifestRollCallView } from "./roll-call-days";

describe("a later positive cannot settle uncertain missing evidence", () => {
  it.each([
    { day: -1, evidenceConflict: false },
    { day: 0, evidenceConflict: true },
  ])("keeps the carried alarm with basis %j", (basis) => {
    const missing: DayMark = {
      subject: "seat-a",
      checkpoint: "after_dive_1",
      status: "not_boarded",
      id: "missing-original",
      ...basis,
    };
    const current: DayMark = {
      subject: "seat-a",
      checkpoint: "after_dive_1",
      status: "boarded",
      id: "unrelated-positive",
      day: 1,
    };
    const view = manifestRollCallView([missing, current], 1);
    expect([...view.values()]).toEqual([missing]);
  });
});
