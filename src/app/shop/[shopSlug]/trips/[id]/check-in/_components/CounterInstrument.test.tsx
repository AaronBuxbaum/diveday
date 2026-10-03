// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CounterInstrument } from "./CounterInstrument";

afterEach(() => {
  cleanup();
});

function renderInstrument(overrides: Partial<React.ComponentProps<typeof CounterInstrument>> = {}) {
  return render(
    <CounterInstrument
      here={7}
      expected={10}
      cantBoard={2}
      cleared={false}
      figure={<span>7 of 10 here</span>}
      remainder="3 to come · 2 can’t board yet"
      clearedLabel="Everyone’s checked in"
      {...overrides}
    />,
  );
}

describe("the counter instrument", () => {
  it("leads with the count and says the remainder beside it", () => {
    renderInstrument();
    expect(screen.getByText("7 of 10 here")).toBeInTheDocument();
    expect(screen.getByText("3 to come · 2 can’t board yet")).toBeInTheDocument();
  });

  /**
   * ADR 20260827-clearwater-surface-language, decision 3: every count sets
   * `tabular-nums`, and this is the number it says should lead. Only the
   * leading figure carried it, so "of 10" re-flowed as the count climbed past
   * a 1 — a jitter on the one figure a staffer watches all morning.
   */
  it("sets tabular figures on the whole count phrase, not only the figure", () => {
    const { container } = renderInstrument();
    const line = screen.getByText("7 of 10 here").closest("p");
    expect(line?.className).toContain("tabular-nums");
    expect(container.querySelector("p.tabular-nums")).not.toBeNull();
  });

  it("says nothing where there is no remainder to say", () => {
    renderInstrument({ here: 10, expected: 10, cantBoard: 0, cleared: true, remainder: null });
    expect(screen.queryByText(/to come/)).not.toBeInTheDocument();
  });

  /**
   * The coral budget (ADR 20260827-clearwater-surface-language, decision 11):
   * the counter has exactly one sanctioned moment and it is this line. It is
   * earned and transient — condition-derived, never stored — so a boat with
   * anyone still to come renders no accent ink at all.
   */
  it("renders no earned line until everyone expected is here", () => {
    const { container } = renderInstrument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("accent");
  });

  it("renders exactly one coral element when the boat is clear", () => {
    const { container } = renderInstrument({
      here: 10,
      expected: 10,
      cantBoard: 0,
      cleared: true,
      remainder: null,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Everyone’s checked in");
    expect(container.querySelectorAll("[class*='accent']")).toHaveLength(1);
  });

  it("plays no entrance on a page that loaded already cleared", () => {
    // The first-paint guard. `rise-in` is the motion of a moment that just
    // happened; a boat cleared an hour ago is a fact on arrival, and
    // re-celebrating it every visit is what makes it stop meaning anything.
    renderInstrument({ here: 4, expected: 4, cantBoard: 0, cleared: true, remainder: null });
    expect(screen.getByRole("status").className).not.toContain("rise-in");
  });

  it("keeps the figure out of the celebration — the meter is decorative", () => {
    const { container } = renderInstrument({
      here: 10,
      expected: 10,
      cantBoard: 0,
      cleared: true,
      remainder: null,
    });
    // No settle pulse on the count: one celebration per instant.
    expect(container.innerHTML).not.toContain("figure-settle");
    expect(container.innerHTML).not.toContain("settle-in");
    // Every number the meter draws is already in the words above it.
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
