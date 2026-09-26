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

/** How many lines a block draws below `sm` (`base`) and from it (`sm`). */
function lineCounts(block: Element | null | undefined) {
  const lines = Array.from(block?.children ?? []);
  const phoneOnly = lines.filter((line) => line.classList.contains("sm:hidden")).length;
  const deskOnly = lines.filter((line) => line.classList.contains("max-sm:hidden")).length;
  return { base: lines.length - deskOnly, sm: lines.length - phoneOnly };
}

/** Each term's line counts, for the term list that is a section's only block. */
function termCounts(section: Element | null | undefined) {
  const [, body] = Array.from(section?.children ?? []);
  return Array.from(body?.firstElementChild?.children ?? [], lineCounts);
}

/**
 * **The /privacy skeleton is the document's first screen, line for line** (K-407).
 *
 * It drew two title bars at every width for a title that is one line from
 * `sm`, three 20px intro bars with gaps for an intro of four 28px lines at 1280
 * and eight at 390, and 104px sections for sections of 224px and more. So at
 * 1280 the dateline and intro jumped up about 40px when the page landed and the
 * second section's heading 117px down, and on a phone the first heading
 * dropped 147px. It draws the document's own boxes now (`LegalDocumentSkeleton`,
 * the one skeleton `/terms` wears too), with as many line boxes as the en-US
 * words wrap to at 390 (`base`) and 1280 (`sm`), the widths the visual suite
 * captures, through both sections the fold reaches.
 */
describe("the /privacy skeleton", () => {
  it("draws one title line from sm and two below it", () => {
    expect(lineCounts(blocks().title)).toEqual({ base: 2, sm: 1 });
  });

  it("draws the intro's eight lines on a phone and four from sm", () => {
    expect(lineCounts(blocks().intro)).toEqual({ base: 8, sm: 4 });
  });

  it("draws 'Two different relationships' term by term, the divers' term at its eight phone lines", () => {
    const [roles] = Array.from(blocks().sections?.children ?? []);
    expect(termCounts(roles)).toEqual([
      { base: 3, sm: 2 },
      { base: 8, sm: 4 },
    ]);
  });

  it("draws 'What is stored' term by term", () => {
    const [, collect] = Array.from(blocks().sections?.children ?? []);
    expect(termCounts(collect)).toEqual([
      { base: 3, sm: 2 },
      { base: 4, sm: 2 },
      { base: 7, sm: 4 },
      { base: 6, sm: 3 },
      { base: 4, sm: 2 },
      { base: 14, sm: 7 },
    ]);
  });

  it("stops after the two sections the first screen reaches", () => {
    expect(blocks().sections?.children).toHaveLength(2);
  });
});
