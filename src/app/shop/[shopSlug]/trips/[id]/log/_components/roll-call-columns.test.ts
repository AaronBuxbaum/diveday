import { describe, expect, it } from "vitest";
import { rollCallCheckpoints } from "@/lib/manifests";
import { rollCallCheckpointClass } from "./roll-call-columns";

/**
 * The departure log's two roll-call tables are three text columns plus one per
 * checkpoint, and a checkpoint is a dive: `rollCallCheckpoints` allows two
 * to six of them, so these cover every table the log can print.
 */
const CHECKPOINT_COUNTS = [1, 2, 3, 4, 5].map((dives) => rollCallCheckpoints(dives).length);

/** The sheet's share one checkpoint column takes. */
function share(checkpointCount: number): number {
  const columnClass = rollCallCheckpointClass(checkpointCount);
  const pinned = columnClass.match(/^w-\[(\d+)%\]$/);
  if (pinned) return Number(pinned[1]) / 100;
  // Released: under fixed layout every column then takes an equal share.
  expect(columnClass).toBe("w-auto");
  return 1 / (checkpointCount + 3);
}

describe("the roll-call tables on the sheet", () => {
  /**
   * With no widths named, fixed layout printed six equal 125px columns, so a
   * checkpoint's "Awaiting roll call" had as much of the page as the buddy
   * cell beside it, which ran four and five lines (K-104, DEPARTURE-8-20).
   */
  it("gives the diver, contact and buddy columns more than an equal share wherever it can", () => {
    expect(CHECKPOINT_COUNTS).toEqual([2, 3, 4, 5, 6]);
    for (const count of CHECKPOINT_COUNTS) {
      const textShare = (1 - count * share(count)) / 3;
      const equalShare = 1 / (count + 3);
      if (count < 5) expect(textShare, `${count} checkpoints`).toBeGreaterThan(equalShare);
      else expect(textShare, `${count} checkpoints`).toBeCloseTo(equalShare);
    }
  });

  it("holds a checkpoint's header word, and pins nothing once an equal share is narrower", () => {
    // 13% of the sheet's table holds "DEPARTURE" (~71px in the header's
    // tracked 12px capitals) after the column's 16px of left padding. At five
    // checkpoints an equal share is already 12.5%, so a pin could only take
    // room from the names.
    for (const count of CHECKPOINT_COUNTS) {
      expect(share(count), `${count} checkpoints`).toBeGreaterThanOrEqual(
        Math.min(0.13, 1 / (count + 3)),
      );
    }
    expect(rollCallCheckpointClass(5)).toBe("w-auto");
  });
});
