// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_PHASES, featurePagesIn } from "@/lib/feature-pages";
import { hubOnlyCapabilityGroups } from "@/lib/marketing";
import ProductLoading from "./loading";

afterEach(cleanup);

/** The line boxes drawn in `type`'s line height, and which of them only a phone draws. */
function linesIn(scope: Element | null, type: string) {
  const lines = Array.from(scope?.querySelectorAll(".h-lh") ?? []).filter((line) =>
    type.split(" ").every((token) => line.classList.contains(token)),
  );
  return {
    count: lines.length,
    phoneOnly: lines.filter((line) => line.classList.contains("sm:hidden")).length,
  };
}

/**
 * **The /product skeleton is as tall as the hero it stands in for** (K-409),
 * and draws the list under it row for row.
 *
 * It drew 48px bars for 40px title lines (two, for three on a phone), two 20px
 * bars for a lede of 32px lines (four on a phone) and no bar at all for the
 * price line under the demo note, so what came after the hero landed 36px
 * lower at 1280 and 156px lower at 390. Each bar is now a line box of the text
 * it stands for. The counts are the English hub's as of the 2026-10-05 review,
 * measured at 390 and 1280.
 */
describe("the /product skeleton", () => {
  it("draws the title as three lines of its own type below sm and two from it", () => {
    const { container } = render(<ProductLoading />);
    const hero = container.querySelector("main > section");
    expect(linesIn(hero, "text-4xl sm:text-6xl")).toEqual({ count: 3, phoneOnly: 1 });
  });

  it("draws the lede as five 32px lines below sm and three from it", () => {
    const { container } = render(<ProductLoading />);
    const hero = container.querySelector("main > section");
    expect(linesIn(hero, "text-lg leading-8")).toEqual({ count: 5, phoneOnly: 2 });
  });

  it("draws the demo note and the price line under it, each a second line on a phone", () => {
    const { container } = render(<ProductLoading />);
    const hero = container.querySelector("main > section");
    // The eyebrow is one text-sm line; the note and the price line are two
    // more, each wrapping once below sm.
    expect(linesIn(hero, "text-sm")).toEqual({ count: 5, phoneOnly: 2 });
  });

  it("draws one row per feature page under each phase, then the hub-only groups", () => {
    const { container } = render(<ProductLoading />);
    const list = container.querySelectorAll("main > section")[1];
    const lists = Array.from(list?.querySelectorAll("ul") ?? []);
    expect(lists.map((rows) => rows.children.length)).toEqual([
      ...FEATURE_PHASES.map((phase) => featurePagesIn(phase).length),
      hubOnlyCapabilityGroups.length,
    ]);
  });

  // Each page's row on the hub carries the 44px disclosure that counts its
  // checklist, under the summary; a row drawn without it stood 44px short
  // per page, 528px on a phone, where the twelve stack.
  it("gives every feature page's row the row that counts its checklist", () => {
    const { container } = render(<ProductLoading />);
    const list = container.querySelectorAll("main > section")[1];
    const pageRows = FEATURE_PHASES.reduce(
      (total, phase) => total + featurePagesIn(phase).length,
      0,
    );
    expect(list?.querySelectorAll("li > .min-h-11")).toHaveLength(pageRows);
  });

  it("closes the list with the sentence that counts it, a second line on a phone", () => {
    const { container } = render(<ProductLoading />);
    const list = container.querySelectorAll("main > section")[1];
    expect(linesIn(list?.lastElementChild ?? null, "text-lg leading-8")).toEqual({
      count: 2,
      phoneOnly: 1,
    });
  });
});
