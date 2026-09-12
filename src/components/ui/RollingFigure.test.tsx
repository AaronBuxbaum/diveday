// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RollingFigure } from "./RollingFigure";

/**
 * The rule is "a count that changes *in front of a person* rolls", and every
 * test here is one half of that sentence: what counts as changing in front of
 * someone, and what the roll must never claim.
 */

const reducedMotion = (matches: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
};

/** The digits on their way out: drawn, but hidden from anything that reads. */
const hidden = (container: HTMLElement) =>
  [...container.querySelectorAll("[aria-hidden='true']")].map((node) => node.textContent);

/**
 * What the figure *says* — the text with every leaving digit removed, which is
 * what a screen reader is handed and what the reader is left with once the roll
 * has finished. Raw `textContent` sees both digits in a rolling column at once
 * ("190" mid-roll from 9 to 10), which is the DOM being right rather than the
 * figure being wrong.
 */
const readable = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll("[aria-hidden='true']")) node.remove();
  return copy.textContent;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RollingFigure", () => {
  it("swaps on first paint, because nothing changed in front of the reader", () => {
    const { container } = render(<RollingFigure>7 of 10 here</RollingFigure>);
    expect(container.textContent).toBe("7 of 10 here");
    expect(container.querySelector(".rolling-digit-in")).toBeNull();
    expect(container.querySelector(".rolling-figure-slot")).toBeNull();
  });

  it("rolls only the digit that changed, and leaves the words alone", () => {
    reducedMotion(false);
    const { container, rerender } = render(<RollingFigure>6 of 10 here</RollingFigure>);
    rerender(<RollingFigure>7 of 10 here</RollingFigure>);

    // The reader is handed the new figure whole from the first frame.
    expect(readable(container)).toBe("7 of 10 here");
    const arriving = [...container.querySelectorAll(".rolling-digit-in")].map((n) => n.textContent);
    expect(arriving, "only the 6 became a 7").toEqual(["7"]);
    const leaving = [...container.querySelectorAll(".rolling-digit-out")].map((n) => n.textContent);
    expect(leaving).toEqual(["6"]);
    // "1" and "0" of the ten did not change, so they sit still.
    expect(container.querySelectorAll(".rolling-figure-slot")).toHaveLength(3);
  });

  it("rolls down when the count went down, which is what an undo looks like", () => {
    reducedMotion(false);
    const { container, rerender } = render(<RollingFigure>7 of 10 here</RollingFigure>);
    rerender(<RollingFigure>6 of 10 here</RollingFigure>);
    expect(container.querySelector(".rolling-digit-in-down")?.textContent).toBe("6");
    expect(container.querySelector(".rolling-digit-out-down")?.textContent).toBe("7");
  });

  /**
   * Right-anchored, or a figure gaining a column would call every column
   * changed and roll the whole number for a change of one.
   */
  it("keeps a settled column still when the figure gains a digit", () => {
    reducedMotion(false);
    const { container, rerender } = render(<RollingFigure>9 aboard</RollingFigure>);
    rerender(<RollingFigure>10 aboard</RollingFigure>);
    const arriving = [...container.querySelectorAll(".rolling-digit-in")].map((n) => n.textContent);
    expect(arriving, "the 9 became a 0; the 1 is a column that did not exist").toEqual(["1", "0"]);
    expect(readable(container)).toBe("10 aboard");
  });

  it("swaps when the sentence around the number changed, not just the number", () => {
    reducedMotion(false);
    const { container, rerender } = render(<RollingFigure>3 to come</RollingFigure>);
    rerender(<RollingFigure>1 to come · 2 can’t board yet</RollingFigure>);
    expect(container.textContent).toBe("1 to come · 2 can’t board yet");
    expect(container.querySelector(".rolling-digit-in")).toBeNull();
  });

  it("swaps for a reader who asked for reduced motion", () => {
    reducedMotion(true);
    const { container, rerender } = render(<RollingFigure>6 of 10 here</RollingFigure>);
    rerender(<RollingFigure>7 of 10 here</RollingFigure>);
    expect(container.textContent).toBe("7 of 10 here");
    expect(container.querySelector(".rolling-digit-in")).toBeNull();
  });

  /**
   * A digit on its way out is a visual artefact. If it reached the accessible
   * name, a screen reader on the counter would hear "67 of 10 here".
   */
  it("hides the leaving digit from anything that reads the figure", () => {
    reducedMotion(false);
    const { container, rerender } = render(<RollingFigure>6 of 10 here</RollingFigure>);
    rerender(<RollingFigure>7 of 10 here</RollingFigure>);
    expect(hidden(container)).toEqual(["6"]);
    expect(readable(container)).toBe("7 of 10 here");
  });

  it("draws a child it cannot read as text without taking it apart", () => {
    reducedMotion(false);
    const { container } = render(
      <RollingFigure>
        <strong>7</strong>
      </RollingFigure>,
    );
    expect(container.querySelector("strong")?.textContent).toBe("7");
    expect(container.querySelector(".rolling-figure-slot")).toBeNull();
  });
});
