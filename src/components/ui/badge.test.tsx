// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge, type BadgeSize, type BadgeTone } from "./badge";

/**
 * **One pill, one box, whatever it says.**
 *
 * The neutral tone drew its edge with `border border-border` and every other
 * tone was fill-only, so "Not here" stood 30px tall beside a 28px "Blocked" on
 * the same roll-call line, 26px against 24px at `sm`, and it was the one pill
 * that kept its outline on paper (pixel probe, `manifest-not-here`,
 * `schedule`; docs/design/pixel-craft.md's own class-12 example). The neutral
 * edge is an inset ring now, which paints the same line and takes no room.
 *
 * jsdom has no layout, so this pins the classes that decide the box: no tone
 * may add a border, and the neutral one keeps its edge as a ring.
 */
afterEach(cleanup);

const TONES: readonly BadgeTone[] = ["primary", "success", "warning", "danger", "neutral"];
const SIZES: readonly BadgeSize[] = ["sm", "md", "lg"];

const BORDER_WIDTH = /^(?:[a-z-]+:)*border(?:-[xytblrse])?(?:-\d+)?$/;

function pill(tone: BadgeTone, size: BadgeSize) {
  render(
    <Badge tone={tone} size={size}>
      {`${tone} ${size}`}
    </Badge>,
  );
  const element = screen.getByText(`${tone} ${size}`);
  cleanup();
  return element;
}

describe("Badge geometry", () => {
  it.each(TONES.flatMap((tone) => SIZES.map((size) => [tone, size] as const)))(
    "%s at %s adds no border width to the box",
    (tone, size) => {
      const classes = pill(tone, size).className.split(/\s+/);
      expect(classes.filter((token) => BORDER_WIDTH.test(token))).toEqual([]);
    },
  );

  it("draws the neutral edge as an inset ring, which takes no room", () => {
    const classes = pill("neutral", "md").className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["ring-1", "ring-inset", "ring-border"]));
  });

  it.each(SIZES)("gives every tone the same padding at %s", (size) => {
    const padding = (tone: BadgeTone) =>
      pill(tone, size)
        .className.split(/\s+/)
        .filter((token) => /^p[xy]?-/.test(token))
        .sort();
    const neutral = padding("neutral");
    for (const tone of TONES) expect(padding(tone), tone).toEqual(neutral);
  });
});
