// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayStripGeometry } from "@/lib/day-strip";
import { DayHeader } from "./DayHeader";

afterEach(cleanup);

const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 7, 27, hour, minute));

const geometry = dayStripGeometry({
  from: at(6),
  to: at(21),
  now: at(10),
  daylight: [{ sunriseAt: at(7), sunsetAt: at(19, 45) }],
  daylightProgress: 0.24,
  marks: [{ id: "morning", at: at(7) }],
});

const BASE = {
  scheme: "day" as const,
  weekday: "Thursday",
  date: "August 27",
  summary: "2 boats today. Nothing is waiting on you.",
  almanac: "Sunrise 6:52 AM · sunset 7:45 PM",
  strip: { geometry, label: "The day at a glance." },
};

describe("DayHeader", () => {
  /**
   * The date is what the page is called. The greeting that stood here — "Good
   * morning, Dana" — said nothing the bar above it does not, and the eyebrow
   * under it named the tab the reader had just tapped.
   */
  it("calls the page by its date, with the weekday above it", () => {
    render(<DayHeader {...BASE} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("August 27");
    expect(screen.getByText("Thursday")).toBeTruthy();
    expect(screen.queryByText(/Good (morning|afternoon|evening|night)/)).toBeNull();
  });

  it("wears the hour the shop is reading at", () => {
    const { container } = render(<DayHeader {...BASE} scheme="dusk" />);
    expect(container.querySelector(".sky")?.getAttribute("data-scheme")).toBe("dusk");
  });

  /**
   * The home's `<main>` is a centred column, so a band that stopped at its
   * content box would be a panel of sky with the page's ground either side —
   * the one thing the boards do not do.
   */
  it("bleeds the sky to both edges of the viewport", () => {
    const { container } = render(<DayHeader {...BASE} />);
    const sky = container.querySelector(".sky");
    expect(sky?.className).toContain("w-screen");
    expect(sky?.className).toContain("mx-[calc(50%-50vw)]");
    // And the words inside it line up with the column under them.
    expect(sky?.querySelector(".max-w-5xl")).toBeTruthy();
  });

  it("says the day in one line and leaves the body to say the rest", () => {
    render(
      <DayHeader {...BASE}>
        <p>Next up is the 11:00 AM.</p>
      </DayHeader>,
    );
    expect(screen.getAllByText("2 boats today. Nothing is waiting on you.")).toHaveLength(1);
    expect(screen.getByText("Next up is the 11:00 AM.")).toBeTruthy();
  });

  /**
   * An empty arc over an empty horizon is a picture of nothing, and a shop with
   * no address has no sunrise to print — in both cases the band still says what
   * day it is, which is the whole of what it promises.
   */
  it("draws no picture and prints no almanac when there is neither", () => {
    render(<DayHeader {...BASE} strip={null} almanac={null} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Sunrise/)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("August 27");
  });

  it("puts the header's one action beside the date", () => {
    render(<DayHeader {...BASE} action={<a href="/shop/x/print">Print the day</a>} />);
    expect(screen.getByRole("link", { name: "Print the day" })).toBeTruthy();
  });
});
