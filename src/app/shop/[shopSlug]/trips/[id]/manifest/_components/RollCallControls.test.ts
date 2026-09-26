import { describe, expect, it } from "vitest";
import { ROLL_CALL_PANEL_HEIGHT_VAR } from "./PanelHeight";
import { ROW_DISCLOSURE_PANEL_CLASS, rollCallScrollMargin } from "./RollCallControls";

/**
 * **A jumped-to row lands below the pinned card, however tall it is**
 * (pixel-craft class 9, S1).
 *
 * The margin was the chrome bar plus a written-down panel height, 11rem or
 * 15rem. On a phone the card stacks and wraps its danger lines and grows the
 * chips naming who is missing: 342–426px at 390, against 240. A row the panel
 * chips jumped to landed at y 352, under a card reaching to y 482 — and a
 * buried name is what invites a tap on the next visible row's mark, for the
 * wrong person. The margin now reads the height the card publishes.
 */
describe("the roll-call rows' scroll margin", () => {
  it.each([true, false])(
    "reads the pinned card's published height (departure: %s)",
    (isDeparture) => {
      const margin = rollCallScrollMargin(isDeparture);
      expect(margin).toMatch(/^scroll-mt-\[calc\(.+\)\]$/);
      expect(margin).toContain(`var(${ROLL_CALL_PANEL_HEIGHT_VAR},`);
      // The bar is `html`'s scroll-padding-top already (globals.css), and the
      // card pins at that same line, so the margin is the card and a gap only.
      // Adding the bar again put every jump a whole bar's height lower.
      expect(margin).not.toContain("--chrome-h");
    },
  );

  /**
   * **Before the card has measured itself, a jump lands no higher than it did
   * when nothing was measured** (dive-domain review, K-142). The measurement
   * runs in an effect after hydration — mid-hydration on a slow boat
   * connection, exactly when the chips' plain `#diver-row-…` links still work.
   * The fallback used to sit on top of the bar twice: `html`'s scroll-padding
   * and `--chrome-h` in the margin, 56px each, so a row landed 112px plus
   * 11rem (15rem after a dive) from the top. Dropping the bar and zeroing it in
   * boat mode below `lg` took the fallback down to 192px and 256px on a phone,
   * against a card that is 342–426px there after a dive. A phone's fallback is
   * sized for the phone's card now, and `lg`'s gives back the bar it lost.
   */
  it("falls back, before the card has measured itself, to no less than the landing it replaced", () => {
    const REM = 16;
    const BAR = 56;
    /** Where a jumped-to row lands on the fallback: phone (boat mode, no bar) and `lg`. */
    const landing = (margin: string) => {
      const found = Object.fromEntries(
        [
          ...margin.matchAll(
            new RegExp(
              `(?:^|\\s)(lg:)?scroll-mt-\\[calc\\(var\\(${ROLL_CALL_PANEL_HEIGHT_VAR},([\\d.]+)rem\\)\\+1rem\\)\\]`,
              "g",
            ),
          ),
        ].map(([, lg, rems]) => [lg ? "desk" : "phone", Number(rems) * REM + REM]),
      );
      return { phone: found.phone ?? 0, desk: BAR + (found.desk ?? 0) };
    };
    for (const [isDeparture, written] of [
      [true, 11],
      [false, 15],
    ] as const) {
      const before = BAR + BAR + written * REM;
      const { phone, desk } = landing(rollCallScrollMargin(isDeparture));
      expect(phone, `phone, departure: ${isDeparture}`).toBeGreaterThanOrEqual(before);
      expect(desk, `lg, departure: ${isDeparture}`).toBeGreaterThanOrEqual(before);
    }
    // And after a dive a phone's clears the tallest card measured there: 426px
    // on manifest-buddy-divergence at 390, and a 16px gap.
    expect(landing(rollCallScrollMargin(false)).phone).toBeGreaterThanOrEqual(426 + REM);
  });
});

/**
 * **The person's details box shares the sheet's edges** (pixel-craft class 3).
 *
 * The box was a row disclosure's inset once, `mx-4 mb-4` inside a roll-call
 * row. It is rendered inside `PersonSheet` now, whose body already pads the
 * sheet (`px-5 sm:px-7`, and a 20px foot), so the inset stood the grey box
 * 16px inside the "Buddy team" box right above it: two box widths and three
 * left edges on one sheet, and 36px under it against the sheet's 20px.
 */
describe("the person's details box", () => {
  it("adds no margin of its own inside the sheet's padding", () => {
    const tokens = ROW_DISCLOSURE_PANEL_CLASS.split(/\s+/);
    expect(tokens.filter((token) => /^-?m[xytrblse]?-/.test(token))).toEqual([]);
    expect(tokens).toEqual(expect.arrayContaining(["rounded-inset", "border", "p-3"]));
  });
});
