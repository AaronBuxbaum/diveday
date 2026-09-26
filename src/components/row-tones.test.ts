import { describe, expect, it } from "vitest";
import { ROLL_CALL_ROW_TONE, rollCallRuleClass } from "./row-tones";

const tokens = (tone: string) => tone.split(/\s+/);
/** `ring-1`, `ring-2`, `ring`: a ring's width, as opposed to its colour or `ring-inset`. */
const ringWidth = (token: string) => /^ring(-\d+)?$/.test(token);

/**
 * **"Did not come back" is the loudest row on the roll call, and the only
 * ring** — and the ring never showed. `ring-1` is an outer box-shadow, and the
 * roll-call lists are `overflow-hidden` panels: three sides of the ring fell
 * outside the clip and the fourth was painted over by the next row, so the
 * alarmed row showed its fill and its red edge and nothing else (the pixel
 * audit, manifest-not-back-aboard). Inset, the ring paints inside the row,
 * where neither can reach it. The offline copy's crew roster wears these
 * same tones now (it had a map of its own while its rows were cards), so a
 * missing crew member's row is ringed the same way.
 */
describe("the roll-call row tones", () => {
  it("rings a row inside its own box, where a clipping list cannot cut it off", () => {
    for (const tone of Object.values(ROLL_CALL_ROW_TONE)) {
      if (tokens(tone).some(ringWidth)) expect(tokens(tone)).toContain("ring-inset");
    }
  });

  it("keeps the ring for the one row that means a person may be in the water", () => {
    const ringed = Object.entries(ROLL_CALL_ROW_TONE)
      .filter(([, tone]) => tokens(tone).some(ringWidth))
      .map(([state]) => state);
    expect(ringed).toEqual(["notBackAboard"]);
  });
});

/**
 * **The hairline between two roll-call rows is drawn inside the row, in the
 * rule colour** (pixel-craft class 12, K-165). A tone colours the row's whole
 * border for its 4px stripe, so a `divide-*` rule on the row itself took the
 * tone's colour: the crew list's rules read `border-strong`, and would read
 * green or red on a boarded or missing row. Both roll-call lists draw it off
 * this one helper, skipping it above whichever row each medium shows first.
 */
describe("the rule between two roll-call rows", () => {
  const classes = (value: string) => value.split(/\s+/);

  it("skips the rule above the first row on screen and on paper, separately", () => {
    expect(classes(rollCallRuleClass({ firstOnScreen: true, firstOnPaper: false }))).toEqual(
      expect.arrayContaining(["border-t-0", "print:border-t"]),
    );
    expect(classes(rollCallRuleClass({ firstOnScreen: false, firstOnPaper: true }))).toEqual(
      expect.arrayContaining(["border-t", "print:border-t-0"]),
    );
  });

  it("draws it in the rule colour and never a tone's", () => {
    const rule = classes(rollCallRuleClass({ firstOnScreen: false, firstOnPaper: false }));
    expect(rule).toContain("border-border");
    const toneColours = Object.values(ROLL_CALL_ROW_TONE)
      .flatMap(classes)
      .filter((name) => /^border-(?!l-|dashed)/.test(name));
    for (const colour of toneColours) expect(rule).not.toContain(colour);
  });
});
