// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrintedDeckCount } from "./PrintedDeckCount";

afterEach(cleanup);

describe("PrintedDeckCount", () => {
  it("is print only and carries no control, only a line per checkpoint", () => {
    const { container } = render(
      <PrintedDeckCount
        heading="Count on deck"
        lines={[
          { checkpoint: "departure", text: "Before departure: Deck count ____ at ____" },
          { checkpoint: "after_dive_1", text: "After dive 1: Deck count 11 at 8:30 AM, Keiko" },
        ]}
      />,
    );
    const section = screen.getByRole("region", { name: "Count on deck", hidden: true });
    expect(section.className).toContain("hidden");
    expect(section.className).toContain("print:block");
    expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(2);
    expect(container.querySelector("input, button, form")).toBeNull();
  });
});
