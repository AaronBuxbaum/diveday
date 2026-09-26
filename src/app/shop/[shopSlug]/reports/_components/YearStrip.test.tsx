// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeShopYear } from "@/lib/shop-year";
import { YearStrip } from "./YearStrip";

afterEach(cleanup);

/** A short year whose last day is today, so today's square is in the strip. */
const YEAR = summarizeShopYear({
  year: 2026,
  firstDay: "2026-01-01",
  lastDay: "2026-02-10",
  openedThisYear: false,
  today: "2026-02-10",
  days: [{ day: "2026-02-10", boats: 1, divers: 8, seats: 10 }],
  boats: [{ name: "Manta", days: 1 }],
  sites: [],
  entries: [],
});

function renderStrip() {
  return render(
    <YearStrip cells={YEAR.strip} months={[]} copy={{ day: (cell) => String(cell.day) }} />,
  );
}

describe("YearStrip", () => {
  /**
   * **Today's outline is drawn inside its square.** It was a 2px outline at a
   * 1px offset in a grid whose gutter is 3px, so the ring filled the whole
   * gutter, sat against the square above it and ran 2px past the grid's edge
   * at 1280 (K-572). Inset, it never leaves its own square; below `sm`, where
   * a square is under 4px wide, it thins to 1px so the day's fill still shows.
   */
  it("insets today's outline inside its own square, thinner on a phone", () => {
    const { container } = renderStrip();
    const outlined = [...container.querySelectorAll("span")].filter((cell) =>
      [...cell.classList].some((token) => token.includes("outline-offset")),
    );
    expect(outlined).toHaveLength(1);
    const [today] = outlined;
    expect(today).toHaveAttribute("title", "2026-02-10");
    expect(today).toHaveClass("outline-2", "-outline-offset-2");
    expect(today).toHaveClass("max-sm:outline-1", "max-sm:-outline-offset-1");
    // Never an offset that pushes the ring out into the gutter.
    expect([...today.classList].filter((token) => /(^|:)outline-offset-/.test(token))).toEqual([]);
  });
});
