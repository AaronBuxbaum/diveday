// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DayJumpStrip } from "./DayJumpStrip";
import { WeekLedger, type WeekLedgerRow } from "./WeekLedger";

afterEach(cleanup);

function row(id: string, dayKey: string, day: string, weekday: string): WeekLedgerRow {
  return {
    id,
    dayKey,
    dayParts: { day, weekday, month: "Oct" },
    href: `/s/reef/trips/${id}`,
    linkLabel: `Trip ${id}`,
    timeRange: "8:00 AM – 12:00 PM",
    title: `Trip ${id}`,
    lens: null,
    course: null,
    site: null,
    requirements: [],
    aboveLevel: null,
    capacityText: "5 seats left",
    capacityTone: "quiet",
    price: null,
  };
}

/** UX audit #18: a diver looking for Saturday jumps to it rather than scrolling past the week. */
describe("DayJumpStrip", () => {
  const rows = [
    row("a", "2026-10-07", "7", "Wed"),
    row("b", "2026-10-07", "7", "Wed"),
    row("c", "2026-10-10", "10", "Sat"),
  ];

  it("links each day on the page, once, to that day's first row in the list", () => {
    render(
      <>
        <DayJumpStrip rows={rows} label="Jump to a day" />
        <WeekLedger rows={rows} listLabel="Upcoming trips" stickyTop="top-0" />
      </>,
    );
    const strip = screen.getByRole("region", { name: "Jump to a day" });
    const links = strip.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual([
      "#day-2026-10-07",
      "#day-2026-10-10",
    ]);
    expect(screen.getByRole("link", { name: "Sat 10 Oct" })).toBeTruthy();
    // Each target exists, on the day's first departure and nowhere else.
    const saturday = document.getElementById("day-2026-10-10");
    expect(saturday?.tagName).toBe("LI");
    expect(saturday?.textContent).toContain("Trip c");
    expect(document.querySelectorAll('[id^="day-"]')).toHaveLength(2);
  });

  it("renders nothing when the page holds a single day", () => {
    const { container } = render(<DayJumpStrip rows={rows.slice(0, 2)} label="Jump to a day" />);
    expect(container.innerHTML).toBe("");
  });

  /**
   * Visual review 2026-10-24, B18: at 390 the strip ran past the edge and the
   * list's last day (Sat 31) was off screen, so the strip and the list named
   * different ranges. On a phone the days share the row equally, each at
   * least a 44px target, and the strip's last day is the list's last day.
   */
  it("ends on the list's last day, the days sharing a phone's row equally", () => {
    const week = ["24", "25", "26", "27", "28", "29", "30", "31"].map((day, i) =>
      row(`t${i}`, `2026-10-${day}`, day, "Day"),
    );
    render(<DayJumpStrip rows={week} label="Jump to a day" />);
    const strip = screen.getByRole("region", { name: "Jump to a day" });
    const list = strip.querySelector("ol");
    const items = strip.querySelectorAll("li");

    expect(items).toHaveLength(8);
    expect(items[7]?.querySelector("a")?.getAttribute("href")).toBe("#day-2026-10-31");
    expect(list).toHaveClass("grid", "grid-flow-col", "auto-cols-fr");
    for (const item of items) expect(item).toHaveClass("min-w-11");
  });
});
