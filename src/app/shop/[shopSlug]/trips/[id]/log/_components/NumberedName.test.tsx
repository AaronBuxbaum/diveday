// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NumberedName } from "./NumberedName";

afterEach(cleanup);

describe("a numbered name on the departure log's roster", () => {
  /**
   * The row number and the name were one inline string, "01 Theo Lindqvist",
   * so a name that wrapped in the 144px Diver column returned under its
   * number: "Lindqvist" at x = 169, 22px left of "Theo" (K-553,
   * DEPARTURE-4-49). The number is a box of its own that never shrinks, and
   * the name wraps inside the box beside it.
   */
  it("hangs the name in a column of its own beside the row number", () => {
    render(<NumberedName number={1} name="Theo Lindqvist" />);
    const number = screen.getByText("01");
    const name = screen.getByText("Theo Lindqvist");
    expect(number.parentElement).toBe(name.parentElement);
    expect(number.parentElement).toHaveClass("flex");
    expect(number).toHaveClass("shrink-0", "tabular-nums");
    expect(name).toHaveClass("min-w-0");
  });

  it("still reads as one string, number first", () => {
    // What a copy, a screen reader and the roster's e2e spec meet.
    const { container } = render(<NumberedName number={12} name="Ana Reyes" />);
    expect(container.textContent).toBe("12 Ana Reyes");
  });
});
