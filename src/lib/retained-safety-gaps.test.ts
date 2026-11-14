import { expect, it } from "vitest";
import { checkpointGapLine } from "@/components/checkpoint-gap-words";
import { staffTranslator } from "@/i18n/staff-messages";
import { checkpointGap, homewardCheckpointGap, previousCheckpointGaps } from "./checkpoint-gaps";

it("warns before the next checkpoint and heading home without inventing a person count", () => {
  const after = {
    checkpoint: "after_dive_1" as const,
    summary: { boarded: 2, awaiting: 0, notBackAboard: 0 },
    crew: [],
    retainedSafetyUnresolved: true,
  };
  const next = { ...after, checkpoint: "after_dive_2" as const };
  const gap = checkpointGap([after], "after_dive_1");
  expect(gap).toEqual({
    kind: "unmarked",
    checkpoint: "after_dive_1",
    divers: 0,
    crew: 0,
    missing: 0,
    retainedSafetyUnresolved: true,
  });
  if (!gap) throw new Error("gap missing");
  expect(checkpointGapLine(staffTranslator("en-US"), gap)).toMatch(
    /Unresolved safety evidence needs review/,
  );
  expect(previousCheckpointGaps([after, next]).get("after_dive_2")).toEqual(gap);
  expect(homewardCheckpointGap([after])).toEqual(gap);
});
