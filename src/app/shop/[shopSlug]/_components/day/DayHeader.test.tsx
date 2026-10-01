// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DayHeader } from "./DayHeader";

afterEach(cleanup);

const BASE = {
  weekday: "Thursday",
  date: "August 27",
  summary: "2 boats today. Nothing is waiting on you.",
};

describe("DayHeader", () => {
  /**
   * The date is what the page is called. The greeting that once stood here —
   * "Good morning, Dana" — said nothing the bar above it does not.
   */
  it("calls the page by its date, with the weekday above it", () => {
    render(<DayHeader {...BASE} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("August 27");
    expect(screen.getByText("Thursday")).toBeTruthy();
    expect(screen.queryByText(/Good (morning|afternoon|evening|night)/)).toBeNull();
  });

  /** The Logbook restart cut the sky band and its sun-arc picture (ADR 20261001-logbook). */
  it("draws no sky and no picture of the day", () => {
    const { container } = render(<DayHeader {...BASE} />);
    expect(container.querySelector(".sky")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
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

  it("puts the header's one action beside the date", () => {
    render(<DayHeader {...BASE} action={<a href="/shop/x/print">Print the day</a>} />);
    expect(screen.getByRole("link", { name: "Print the day" })).toBeTruthy();
  });

  /**
   * **The action shares the date's row, never the summary's** (pixel-craft
   * K-523): beside the action the summary wrapped three lines deep at 390.
   */
  it("runs the summary under the date's row, not beside the action", () => {
    render(<DayHeader {...BASE} action={<a href="/shop/x/print">Print the day</a>} />);
    const summary = screen.getByText(BASE.summary);
    const row = screen.getByRole("link", { name: "Print the day" }).parentElement?.parentElement;
    expect(row?.contains(screen.getByRole("heading", { level: 1 }))).toBe(true);
    expect(row?.contains(summary)).toBe(false);
  });
});
