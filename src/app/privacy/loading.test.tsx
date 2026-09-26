// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyLoading from "./loading";

vi.mock("@/app/_components/MarketingNav", () => ({ MarketingNavFallback: () => null }));
vi.mock("@/components/MarketingFooter", () => ({ MarketingFooterFallback: () => null }));

afterEach(cleanup);

/** The skeleton's column blocks, in the document's order. */
function blocks() {
  const { container } = render(<PrivacyLoading />);
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

/** `both` lines drawn at every width, then `phone` lines drawn only below `sm`. */
function lines(both: number, phone: number) {
  return [...Array<string>(both).fill("both"), ...Array<string>(phone).fill("phone")];
}

/**
 * **The /privacy skeleton is the document's first screen, line for line** (K-407).
 *
 * It drew two title bars at every width for a title that is one line from
 * `sm`, three 20px intro bars with gaps for an intro of four 28px lines at 1280
 * and eight at 390, and 104px sections for sections of 224px and more. So at
 * 1280 the dateline and intro jumped up about 40px when the page landed and the
 * second section's heading 117px down, and on a phone the first heading
 * dropped 147px. It draws through `LegalDocumentSkeleton`, the one skeleton
 * both legal pages share (K-411), with this page's own counts: the en-US
 * copy's lines at 390 and 1280, the widths the visual suite captures.
 */
describe("the /privacy skeleton", () => {
  it("draws one title line from sm and two below it", () => {
    expect(sides(blocks().title)).toEqual(lines(1, 1));
  });

  it("draws the intro's four lines from sm and eight below it", () => {
    expect(sides(blocks().intro)).toEqual(lines(4, 4));
  });

  it("draws the first section's two terms at the lines they wrap to", () => {
    const [heading, body] = Array.from(blocks().sections?.firstElementChild?.children ?? []);
    expect(sides(heading)).toEqual(["both"]);
    const terms = Array.from(body?.firstElementChild?.children ?? []);
    // "With a shop's divers" is eight lines at 390, not seven: it ends
    // "which can do both from inside DiveDay." on the eighth.
    expect(terms.map(sides)).toEqual([lines(2, 1), lines(4, 4)]);
  });

  it("reaches past the fold with the second section's six terms, so the footer never shows early", () => {
    const sections = Array.from(blocks().sections?.children ?? []);
    expect(sections).toHaveLength(2);
    const terms = Array.from(sections[1]?.lastElementChild?.firstElementChild?.children ?? []);
    expect(terms.map(sides)).toEqual([
      lines(2, 1),
      lines(2, 2),
      lines(4, 3),
      lines(3, 3),
      lines(2, 2),
      lines(7, 7),
    ]);
  });
});
