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
    expect(line).toHaveClass(...tapTargetLineClass.split(" "));
    expect(link.className).not.toMatch(/(?:^|\s)-?m[tby]-/);
  });

  /**
   * **Its ring clears the note above it.** Centred on its 20px line, the 44px
   * box reaches 12px above the words and the focus ring 17px, so after `mt-2`
   * the ring's top band ran 6 to 9px up inside the note's last line, through
   * "low after sunset.", and the target covered that line's bottom 4px. After
   * `mt-4` the ring ends in the note's empty bottom pixel, under its
   * descenders. Below, the next season opens 16px down (`space-y-4`), and its
   * 28px title line starts with 5px of leading over its ink.
   */
  it("opens 16px under the note, so the ring stays out of the note's words", () => {
    render(<SeasonBand eyebrow="In season" entries={[turtles]} />);
    const line = screen.getByRole("link", { name: "See After dark departures" }).parentElement;
    expect(line?.className.match(/(?:^|\s)mt-\S+/g)?.map((token) => token.trim())).toEqual([
      "mt-4",
    ]);
  });

  /**
   * **And the card's border below it.** On a phone the card's padding is
   * 16px, so a ring reaching 17px under the link's words lay 1px on the
   * border. The card takes 20px there, as it does from `sm`, when the last
   * season ends in a link, and keeps its 16px when it ends in words.
   */
  it("gives the card the ring's room under it on a phone when the last season ends in the link", () => {
    const quiet: SeasonBandEntry = { ...turtles, id: "season-derby", name: "Derby", lens: null };

    const endsInLink = render(<SeasonBand eyebrow="In season" entries={[quiet, turtles]} />);
    expect(endsInLink.container.firstElementChild).toHaveClass("max-sm:pb-5");
    endsInLink.unmount();

    const endsInWords = render(<SeasonBand eyebrow="In season" entries={[turtles, quiet]} />);
    expect(endsInWords.container.firstElementChild).not.toHaveClass("max-sm:pb-5");
  });
});
