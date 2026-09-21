// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  EYEBROW_CLASS,
  EYEBROW_TAP_WRAPPER,
  EyebrowBackLink,
  ShopPageHeaderSkeleton,
} from "./ShopPageHeader";

afterEach(cleanup);

/**
 * **One number, in three places, that nothing else checks.**
 *
 * The header's eyebrow is 16px of line box. A page that links its eyebrow
 * somewhere renders `EyebrowBackLink` instead of a `<p>`, and that link has to
 * be 44px for WCAG 2.5.8 — so it is wrapped in a box the eyebrow's own height
 * and allowed to bleed out of it. `ShopPageHeaderSkeleton` stands a bar in for
 * whichever one the page uses, and it can only stand in for both while all
 * three agree.
 *
 * They did not agree, and nothing said so: the margin that was supposed to
 * reconcile them sat on an `inline-flex` box, whose vertical margins do not
 * move the line box it sits on, so the linked eyebrow occupied 28px against a
 * plain one's 16. Every sub-page with a back-link jumped its title 12px on
 * arrival (issue #1857). jsdom has no layout engine and cannot catch that by
 * measuring, so this pins the classes the measurement came down to — and pins
 * them *against each other*, because three constants that are equal by
 * coincidence go out of step the first time one of them moves.
 */
const heightOf = (classes: string, prefix: string) => {
  const match = classes.match(new RegExp(`(?:^|\\s)${prefix}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`));
  if (!match) throw new Error(`no \`${prefix}-*\` in "${classes}"`);
  // Tailwind's numeric scale is quarter-rem: `h-4` is 1rem is 16px.
  return Number(match[1]) * 4;
};

describe("the eyebrow's line box", () => {
  it("is the same height in the plain eyebrow, the linked one's wrapper, and the skeleton's bar", () => {
    const { container } = render(<ShopPageHeaderSkeleton />);
    // The eyebrow's bar is the first of the three the skeleton stands up.
    const bar = container.firstElementChild?.firstElementChild;
    if (!bar) throw new Error("the skeleton rendered no bars");

    const lineBox = heightOf(EYEBROW_CLASS, "leading");
    expect(lineBox, "EYEBROW_CLASS stopped pinning its line box").toBe(16);
    expect(heightOf(EYEBROW_TAP_WRAPPER, "h"), "the linked eyebrow's wrapper").toBe(lineBox);
    expect(heightOf(bar.className, "h"), "the skeleton's eyebrow bar").toBe(lineBox);
  });

  it("keeps the linked eyebrow's own box over the 24px WCAG floor, which is why it needs a wrapper", () => {
    render(<EyebrowBackLink href="/shop/blue-mantis/settings">Settings</EyebrowBackLink>);
    const link = screen.getByRole("link", { name: "Settings" });
    // `min-h-11` is 44px. Were it ever dropped to fit the line box, the link
    // would fit its wrapper and axe's `target-size` would start failing — the
    // opposite trade from the one this design makes.
    expect(heightOf(link.className, "min-h")).toBeGreaterThanOrEqual(24);
  });

  it("wraps the link rather than giving it a margin, because an inline box's margins do not move a line box", () => {
    const { container } = render(
      <EyebrowBackLink href="/shop/blue-mantis/settings">Settings</EyebrowBackLink>,
    );
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link.parentElement?.className).toBe(EYEBROW_TAP_WRAPPER);
    expect(container.firstElementChild).toBe(link.parentElement);
    // The paired negative: no vertical margin anywhere on the link. One left
    // behind would silently re-open the gap this closed, and would read as
    // deliberate to whoever found it next.
    expect(link.className).not.toMatch(/(?:^|\s)-?my-/);
  });
});
