// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyLoading from "./loading";

afterEach(cleanup);

/** The bars one wrapper holds, and which of them a side of `sm` hides. */
function lines(wrapper: Element | null | undefined) {
  const boxes = Array.from(wrapper?.children ?? []);
  return {
    all: boxes,
    phoneOnly: boxes.filter((box) => box.classList.contains("sm:hidden")),
    deskOnly: boxes.filter((box) => box.classList.contains("max-sm:hidden")),
  };
}

/**
 * **The /privacy skeleton is the document's first screen, line for line** (K-407).
 *
 * It drew two title bars at every width for a title that is one line from
 * `sm`, three 20px intro bars with gaps for an intro of four 28px lines at 1280
 * and eight at 390, and 104px sections for sections of 224px and more. So at
 * 1280 the dateline and intro jumped up about 40px when the page landed and the
 * second section's heading 117px down, and on a phone the first heading
 * dropped 147px. Every bar is now the line box of the text it stands for, and
 * there are as many as the words wrap to.
 */
describe("the /privacy skeleton", () => {
  it("draws one title line from sm and two below it", () => {
    const { container } = render(<PrivacyLoading />);
    const title = lines(container.querySelector(".leading-tight")?.parentElement);
    expect(title.all).toHaveLength(2);
    expect(title.phoneOnly).toHaveLength(1);
    expect(title.all.every((line) => line.classList.contains("h-lh"))).toBe(true);
  });

  it("draws the intro as four 28px lines from sm and eight below it, with no gap between them", () => {
    const { container } = render(<PrivacyLoading />);
    const column = container.querySelector("main > div");
    const intro = column?.children[3];
    expect(intro).not.toHaveClass("gap-2");
    expect([...(intro?.classList ?? [])].some((token) => /(^|:)(gap|space-y)-/.test(token))).toBe(
      false,
    );
    const { all, phoneOnly } = lines(intro);
    expect(all).toHaveLength(8);
    expect(phoneOnly).toHaveLength(4);
    for (const line of all) expect(line).toHaveClass("h-lh", "leading-7");
  });

  it("draws the first section's two terms at the lines they wrap to", () => {
    const { container } = render(<PrivacyLoading />);
    const firstSection = container.querySelector("main > div > div:last-child > div");
    const terms = firstSection?.querySelectorAll(":scope > div:last-child > div > div") ?? [];
    expect(Array.from(terms, (term) => lines(term).all.length)).toEqual([3, 7]);
    expect(Array.from(terms, (term) => lines(term).phoneOnly.length)).toEqual([1, 3]);
  });
});
