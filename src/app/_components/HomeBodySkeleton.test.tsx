// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeBodySkeleton } from "./HomeBodySkeleton";

afterEach(cleanup);

/** The hero's two columns: the claim, then the captain's phone. */
function heroColumns(container: HTMLElement) {
  const grid = container.querySelector("section > div");
  const [claim, phone] = [...(grid?.children ?? [])];
  if (!claim || !phone) throw new Error("no hero columns");
  return { claim, phone };
}

/** The booking band under the hero, and its first step's two columns. */
function firstStep(container: HTMLElement) {
  const band = container.querySelectorAll("main > section")[1];
  const row = band?.children[1];
  const [copy, screen] = [...(row?.children ?? [])];
  if (!band || !copy || !screen) throw new Error("no first step");
  return { band, copy, screen };
}

/** How many of `lines` a reader sees below sm, across sm, and from lg. */
function shownAt(lines: Element[]) {
  const shown = (at: "base" | "sm" | "lg") =>
    lines.filter((line) => {
      const hiddenFromSm = line.classList.contains("sm:hidden");
      const backAtLg = line.classList.contains("lg:block");
      if (at === "base") return !line.classList.contains("max-sm:hidden");
      if (at === "sm") return !hiddenFromSm;
      return !hiddenFromSm || backAtLg;
    }).length;
  return [shown("base"), shown("sm"), shown("lg")];
}

/**
 * **The landing's skeleton is the hero it stands in for** (docs/design/
 * pixel-craft.md, class 11; K-393).
 *
 * It still drew the bordered three-field "try it" panel the hero lost when
 * shops began to be set up by hand, a guessed phone, and two title bars and
 * two description bars for a title of six lines on a phone. Deleting the panel
 * alone would have lifted the phone 390px on a phone, so the claim is drawn a
 * line box per line, as the page sets it. The 2026-10-05 rewrite (H-93) moved
 * every count: a four-line title on a phone (three from sm and at 1280), a
 * five-line lede, and a phone that renders 544px tall, not the 450 drawn here.
 */
describe("the landing's skeleton", () => {
  it("draws no try-it panel under the hero's doors", () => {
    const { container } = render(<HomeBodySkeleton />);
    expect(heroColumns(container).claim.querySelector(".rounded-panel")).toBeNull();
  });

  it("draws the phone at the 544px the frame renders at", () => {
    const { container } = render(<HomeBodySkeleton />);
    const phone = heroColumns(container).phone.firstElementChild;
    expect(phone).toHaveClass("h-[544px]");
    expect(phone).not.toHaveClass("h-[450px]");
  });

  it("draws a line box for each line the title wraps to: four on a phone, three from sm and at lg", () => {
    const { container } = render(<HomeBodySkeleton />);
    const lines = [...heroColumns(container).claim.querySelectorAll(".lg\\:h-18")];
    expect(lines).toHaveLength(4);
    expect(shownAt(lines)).toEqual([4, 3, 3]);
  });

  it("draws the description's five lines on a phone and four from sm", () => {
    const { container } = render(<HomeBodySkeleton />);
    const lines = [...heroColumns(container).claim.querySelectorAll(".h-8")];
    expect(lines).toHaveLength(5);
    expect(shownAt(lines)).toEqual([5, 4, 4]);
  });

  it("draws the dock card's detail as three lines in a phone's column and two from sm", () => {
    const { container } = render(<HomeBodySkeleton />);
    const card = heroColumns(container).phone.children[1];
    const lines = [...(card?.querySelectorAll(".h-5") ?? [])];
    expect(shownAt(lines)).toEqual([3, 2, 2]);
  });
});

/**
 * **The band under the hero is the booking's first step, at its height.** It
 * drew a two-line heading and one row of a marker, a 32px title, two 16px note
 * bars and a 320px screen with a shadow, for a three-line heading on a phone,
 * a step whose title, two notes and feature-page link run 288px, and a screen
 * that renders 323px with no shadow (Logbook frames a screen by its hairline).
 */
describe("the landing skeleton's first step", () => {
  it("draws the band's heading as three lines on a phone and two from sm", () => {
    const { container } = render(<HomeBodySkeleton />);
    const lines = [...firstStep(container).band.querySelectorAll(".text-3xl.h-lh")];
    expect(shownAt(lines)).toEqual([3, 2, 2]);
  });

  it("draws the step's title as two lines on a phone, one across sm and two in the lg column", () => {
    const { container } = render(<HomeBodySkeleton />);
    const title = firstStep(container).copy.querySelector(".text-2xl");
    const lines = [...(title?.children ?? [])];
    expect(shownAt(lines)).toEqual([2, 1, 2]);
  });

  it("draws two notes of two lines each, then the link to the feature page", () => {
    const { container } = render(<HomeBodySkeleton />);
    const { copy } = firstStep(container);
    const notes = copy.querySelector(".space-y-3");
    expect(notes?.querySelectorAll(".h-lh")).toHaveLength(4);
    expect(copy.lastElementChild).toHaveClass("h-12");
  });

  // The page dissolves the copy column below lg (`contents`) and orders its
  // parts around the screen, so a phone reads the title, the screen, then the
  // notes that caption it; a skeleton stacked copy-then-screen put the 323px
  // box where the notes land.
  it("stacks a phone's step as the page does: the title, the screen, the notes, the link", () => {
    const { container } = render(<HomeBodySkeleton />);
    const { copy, screen } = firstStep(container);
    expect(copy).toHaveClass("contents", "lg:flex");
    const orderOf = (part: Element) => Number(/(?:^|\s)order-(\d)/.exec(part.className)?.[1] ?? 0);
    const [title, notes, link] = [...copy.children];
    if (!title || !notes || !link) throw new Error("no step parts");
    const phoneOrder = [
      ["title", title],
      ["screen", screen],
      ["notes", notes],
      ["link", link],
    ] as const;
    expect(
      [...phoneOrder].sort(([, a], [, b]) => orderOf(a) - orderOf(b)).map(([name]) => name),
    ).toEqual(["title", "screen", "notes", "link"]);
    for (const part of [screen, notes, link]) expect(part).toHaveClass("lg:order-none");
  });

  it("draws the booking screen at the 323px it renders at, with a hairline and no shadow", () => {
    const { container } = render(<HomeBodySkeleton />);
    const screen = firstStep(container).screen.firstElementChild;
    expect(screen).toHaveClass("h-[323px]", "border");
    expect(screen?.className).not.toMatch(/shadow/);
  });
});
