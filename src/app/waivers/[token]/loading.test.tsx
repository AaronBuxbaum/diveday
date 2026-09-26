// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import WaiverLoading from "./loading";

afterEach(cleanup);

/** A skeleton block's height in px, from its `h-*` class or its column of children. */
function heightOf(block: Element): number {
  const step = (prefix: string) =>
    Number(new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`).exec(block.className)?.[1] ?? 0) * 4;
  const own = step("h");
  if (own > 0) return own;
  const children = [...block.children];
  return (
    children.reduce((sum, child) => sum + heightOf(child), 0) + step("gap") * (children.length - 1)
  );
}

/**
 * **The waiver skeleton holds the header the page draws** (K-226).
 *
 * The rail and the whole release jumped down the page when the waiver
 * streamed in: the skeleton drew the description as a 20px bar where the
 * text line is 24px, and nothing at all for the trip line a booked waiver
 * prints under it — the rail landed 4px high without a trip line and 64px
 * high with the two-line one a real trip's title, date and zoned time range
 * wrap to.
 */
describe("the waiver skeleton's header", () => {
  const header = () => {
    const { container } = render(<WaiverLoading />);
    const blocks = [...(container.querySelector(".animate-pulse")?.children ?? [])];
    const rail = blocks.findIndex((block) => block.classList.contains("border-y"));
    expect(rail).toBeGreaterThan(0);
    return blocks.slice(0, rail);
  };

  it("draws the description a full 24px text line tall", () => {
    const [, , description] = header();
    expect(description).toHaveClass("mt-2");
    expect(heightOf(description as Element)).toBe(24);
  });

  it("holds two 24px lines for the trip line, 12px under the description", () => {
    const blocks = header();
    expect(blocks).toHaveLength(4);
    const trip = blocks[3] as Element;
    expect(trip).toHaveClass("mt-3");
    expect(heightOf(trip)).toBe(48);
  });
});
