// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StarRating } from "./StarRating";

/**
 * The coral budget's one data-ink row (ADR
 * 20260827-clearwater-surface-language, decision 11): the accent star belongs
 * to public pages and the diver's own rating input, and staff keep the amber.
 * The default is what enforces that — a new caller has to ask for the accent.
 */
afterEach(cleanup);

describe("the fill's ink", () => {
  it("is warning-amber unless the caller asks otherwise", () => {
    const { container } = render(<StarRating rating={4} label="4 out of 5 stars" />);

    expect(container.querySelector(".text-warning")).not.toBeNull();
    expect(container.querySelector(".text-accent")).toBeNull();
  });

  it("is the accent only where the budget grants it", () => {
    const { container } = render(<StarRating rating={4} label="4 out of 5 stars" tone="accent" />);

    expect(container.querySelector(".text-accent")).not.toBeNull();
    expect(container.querySelector(".text-warning")).toBeNull();
  });
});

describe("the mark", () => {
  it("is drawn, never a glyph, and never announced", () => {
    const { container } = render(<StarRating rating={3} label="3 out of 5 stars" />);

    expect(container.querySelectorAll("svg")).toHaveLength(5);
    expect(container.textContent).toBe("3 out of 5 stars");
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("fades the unfilled stars rather than drawing a second shape", () => {
    const { container } = render(<StarRating rating={3} label="3 out of 5 stars" />);

    expect(container.querySelectorAll("svg.opacity-25")).toHaveLength(2);
  });
});
