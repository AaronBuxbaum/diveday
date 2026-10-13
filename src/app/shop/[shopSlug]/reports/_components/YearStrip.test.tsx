// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
});

const COPY = {
  day: (cell: { day: string | null }) => String(cell.day),
  monthsLabel: "Choose month",
};

function renderStrip(months: Parameters<typeof YearStrip>[0]["months"] = []) {
  return render(<YearStrip cells={YEAR.strip} months={months} copy={COPY} />);
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

  /**
   * **Every month is one tap away** (#2434). The month picker went, so last
   * March from October was seven taps on the arrow; each label above the strip
   * is a link to its own month, as wide as its weeks and 44px tall.
   */
  it("links each month to that month's report, spanning its own weeks", () => {
    renderStrip([
      { key: "2026-01", label: "Jan", column: 1, href: "/shop/blue-mantis/reports?month=2026-01" },
      { key: "2026-02", label: "Feb", column: 5, href: "/shop/blue-mantis/reports?month=2026-02" },
    ]);
    const nav = screen.getByRole("navigation", { name: "Choose month" });
    expect(nav).not.toHaveAttribute("aria-hidden");
    const jan = screen.getByRole("link", { name: "Jan" });
    expect(jan).toHaveAttribute("href", "/shop/blue-mantis/reports?month=2026-01");
    expect(jan.style.gridColumn).toBe("1 / 5");
    expect(jan).toHaveClass("min-h-11");
    const feb = screen.getByRole("link", { name: "Feb" });
    // The last month runs to the strip's edge.
    expect(feb.style.gridColumn).toBe(`5 / ${Math.ceil(YEAR.strip.length / 7) + 1}`);
  });
});
