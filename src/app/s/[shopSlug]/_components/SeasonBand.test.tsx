// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass, tapTargetLineClass } from "@/components/ui/button";
import { SeasonBand, type SeasonBandEntry } from "./SeasonBand";

afterEach(cleanup);

const turtles: SeasonBandEntry = {
  id: "season-turtles",
  name: "Turtle nesting",
  note: "Loggerheads are on the beaches through October.",
  through: "Through Sep 27, 2026",
  lens: { href: "/s/blue-mantis?lens=after-dark", label: "See After dark departures" },
};

describe("SeasonBand", () => {
  it("renders nothing when no season is live", () => {
    const { container } = render(<SeasonBand eyebrow="In season" entries={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("says the shop's own words and DiveDay's frame around its dates", () => {
    render(<SeasonBand eyebrow="In season" entries={[turtles]} />);
    expect(screen.getByText("Turtle nesting")).toBeInTheDocument();
    expect(screen.getByText("Through Sep 27, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See After dark departures" })).toHaveAttribute(
      "href",
      "/s/blue-mantis?lens=after-dark",
    );
  });
});

/**
 * **The season's link starts on its note's column and ends the card at the
 * card's own padding** (pixel-craft K-194, K-185). It asked for `px-0`
 * through `className`, which loses to the `sm` size's `px-3`, so its words sat
 * 12px inside the note above them; and as a 44px box last in the card it put
 * 30px under its words against the card's 19px over its eyebrow.
 */
describe("the season's link", () => {
  it("is flush with the note above it, drawn as the band's Follow door is", () => {
    render(<SeasonBand eyebrow="In season" entries={[turtles]} />);
    const link = screen.getByRole("link", { name: "See After dark departures" });
    expect(link.className).toBe(buttonClass({ variant: "link", size: "sm", flush: true }));
  });

  it("stands on a line exactly its words' height, so its target adds nothing under the card", () => {
    render(<SeasonBand eyebrow="In season" entries={[turtles]} />);
    const link = screen.getByRole("link", { name: "See After dark departures" });
    const line = link.parentElement;
    expect(line?.tagName).toBe("P");
    expect(line).toHaveClass(...tapTargetLineClass.split(" "), "mt-2");
    expect(link.className).not.toMatch(/(?:^|\s)-?m[tby]-/);
  });
});
