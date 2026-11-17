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
      clearedLabel="Everyone’s checked in"
      {...overrides}
    />,
  );
}

describe("the counter instrument", () => {
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

  it("says the boat is clear in the success wash, with no coral or amber (visual review A07)", () => {
    const { container } = renderInstrument({
      here: 10,
      expected: 10,
      cantBoard: 0,
      cleared: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Everyone’s checked in");
    expect(screen.getByRole("status")).toHaveClass("bg-success-tint");
    expect(container.querySelectorAll("[class*='accent'], [class*='warning']")).toHaveLength(0);
  });

  it("plays no entrance on a page that loaded already cleared", () => {
    // The first-paint guard. `rise-in` is the motion of a moment that just
    // happened; a boat cleared an hour ago is a fact on arrival, and
    // re-celebrating it every visit is what makes it stop meaning anything.
    renderInstrument({ here: 4, expected: 4, cantBoard: 0, cleared: true });
    expect(screen.getByRole("status").className).not.toContain("rise-in");
  });

  it("keeps the figure out of the celebration — the meter is decorative", () => {
    const { container } = renderInstrument({
      here: 10,
      expected: 10,
      cantBoard: 0,
      cleared: true,
    });
    // No settle pulse on the count: one celebration per instant.
    expect(container.innerHTML).not.toContain("figure-settle");
    expect(container.innerHTML).not.toContain("settle-in");
    // Every number the meter draws is already in the sentence above it.
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
