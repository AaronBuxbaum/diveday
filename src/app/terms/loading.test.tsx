// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TermsLoading from "./loading";

vi.mock("@/app/_components/MarketingNav", () => ({ MarketingNavFallback: () => null }));
vi.mock("@/components/MarketingFooter", () => ({ MarketingFooterFallback: () => null }));

afterEach(cleanup);

/** The skeleton's column blocks, in the document's order. */
function blocks() {
  const { container } = render(<TermsLoading />);
  const column = container.querySelector("main > div");
  const [eyebrow, title, dateline, intro, sections] = Array.from(column?.children ?? []);
  return { eyebrow, title, dateline, intro, sections };
}

/** Which side of `sm` each of a block's line boxes is drawn on. */
function sides(block: Element | null | undefined) {
  return Array.from(block?.children ?? []).map((line) =>
    line.classList.contains("sm:hidden")
      ? "phone"
      : line.classList.contains("max-sm:hidden")
        ? "desk"
        : "both",
  );
}

/**
 * **The /terms skeleton is /terms, not /privacy** (K-411).
 *
 * It was a line-for-line copy of `/privacy`'s: two title bars for a title
 * that is one line at every width, three intro bars for an intro of four
 * lines on a phone and two on a desk, and three bars per section. The
 * document moved 53px up when it landed on a desk, and on a phone the
 * skeleton's second and third sections stood where the first section's
 * nine-line paragraph lands. Line counts are the en-US copy's at 390 and
 * 1280, the two widths the visual suite captures.
 */
describe("the /terms skeleton", () => {
  it("draws one title line at every width, as the title renders", () => {
    expect(sides(blocks().title)).toEqual(["both"]);
  });

  it("draws the intro's four lines on a phone and two from sm", () => {
    expect(sides(blocks().intro)).toEqual(["both", "both", "phone", "phone"]);
  });

  it("draws the first section at its nine lines on a phone and five from sm, down to the fold", () => {
    const [heading, body] = Array.from(blocks().sections?.firstElementChild?.children ?? []);
    expect(sides(heading)).toEqual(["both"]);
    expect(sides(body?.firstElementChild)).toEqual([
      ...Array<string>(5).fill("both"),
      ...Array<string>(4).fill("phone"),
    ]);
  });

  it("draws a section for each of the document's nine", () => {
    expect(blocks().sections?.children).toHaveLength(9);
  });
});
