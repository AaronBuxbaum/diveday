import { expect, it } from "vitest";
import { offlinePreviousGaps } from "./checkpoint-gap-inputs";
import { savedCopy } from "./section-fixtures";

it("carries an unattributed saved warning into the next-checkpoint prompt", () => {
  const copy = savedCopy();
  const base = copy.snapshot.manifests[0];
  if (!base) throw new Error("manifest missing");
  copy.snapshot.manifests = [
    { ...structuredClone(base), checkpoint: "after_dive_1", retainedSafetyUnresolved: true },
    { ...structuredClone(base), checkpoint: "after_dive_2", retainedSafetyUnresolved: true },
  ];
  expect(offlinePreviousGaps(copy).get("after_dive_2")).toMatchObject({
    kind: "unmarked",
    checkpoint: "after_dive_1",
    retainedSafetyUnresolved: true,
  });
});
