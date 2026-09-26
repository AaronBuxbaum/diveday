// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  EYEBROW_CLASS,
  EYEBROW_TAP_WRAPPER,
  EyebrowBackLink,
  ShopPageHeader,
  ShopPageHeaderSkeleton,
} from "./ShopPageHeader";

afterEach(cleanup);

describe("ShopPageHeader's title", () => {
  it("keeps a trip title's em dash off the start of a line", () => {
    // The title rung balances its wrap, and balancing broke at the space
    // before the dash on the public trip page at 390 (K-117).
    render(<ShopPageHeader title="Two-Tank Reef — Benwood & Elbow" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Two-Tank Reef\u00A0— Benwood & Elbow",
    );
  });
});

/**
 * **The title never gives up a word to its doors** (pixel-craft class 2). The
 * row was a flex row with a `shrink-0` actions band, so the title column took
 * every pixel the doors did not: at 640 the schedule board's three doors left
 * "Board" 103.6px for a word that needs 106, and the word ran past its column.
 * With doors, the row is a grid whose title track is at least its longest word
 * (`minmax(min-content, 1fr)`) and whose doors' track is `auto`: the doors keep
 * their one row while there is room, the title wraps first as it always did,
 * and only then do the doors fold onto a second row. jsdom has no layout, so
 * the template is the assertion.
 */
describe("the header's row", () => {
  const row = (container: HTMLElement) =>
    container.querySelector("header")?.firstElementChild as HTMLElement;

  it("keeps the title's longest word whole, folding the doors first", () => {
    const { container } = render(
      <ShopPageHeader title="Board" actions={<a href="/shop/x/schedule">View public page</a>} />,
    );
    expect(row(container)).toHaveClass("sm:grid", "sm:grid-cols-[minmax(min-content,1fr)_auto]");
  });

  it("stays a flex row when there are no doors to leave a track for", () => {
    const { container } = render(<ShopPageHeader title="Board" />);
    expect(row(container)).toHaveClass("sm:flex-row");
    expect(row(container).className).not.toMatch(/grid-cols/);
  });
});

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

  /**
   * **The wrapper is the element the caller lays out.** `TripPageHeader` places
   * its back link with `col-start-1 row-start-1`, and the log and ticket pages
   * hide theirs with `print:hidden` so a print-only `<p>` can take the line.
   * Introducing the wrapper put those on the nested link, where grid placement
   * does nothing and `print:hidden` leaves a 16px band of nothing on paper
   * (`sourcery-ai` on #1943). Colour is the exception, and already has `onSky`.
   */
  it("gives the caller's layout classes to the wrapper, which is what the parent lays out", () => {
    render(
      <EyebrowBackLink
        href="/shop/blue-mantis/trips/1"
        className="col-start-1 row-start-1 print:hidden"
      >
        Board
      </EyebrowBackLink>,
    );
    const link = screen.getByRole("link", { name: "Board" });
    const wrapper = link.parentElement;
    for (const cls of ["col-start-1", "row-start-1", "print:hidden"]) {
      expect(wrapper?.className, `wrapper is missing ${cls}`).toContain(cls);
      expect(link.className, `link should not carry ${cls}`).not.toContain(cls);
    }
  });

  it("wraps the link rather than giving it a margin, because an inline box's margins do not move a line box", () => {
    const { container } = render(
      <EyebrowBackLink href="/shop/blue-mantis/settings">Settings</EyebrowBackLink>,
    );
    const link = screen.getByRole("link", { name: "Settings" });
    // No caller class here, so the wrapper is exactly the constant.
    expect(link.parentElement?.className).toBe(EYEBROW_TAP_WRAPPER);
    expect(container.firstElementChild).toBe(link.parentElement);
    // The paired negative: no vertical margin anywhere on the link. One left
    // behind would silently re-open the gap this closed, and would read as
    // deliberate to whoever found it next.
    expect(link.className).not.toMatch(/(?:^|\s)-?my-/);
  });
});
