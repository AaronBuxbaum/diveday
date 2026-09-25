// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripAboutSection } from "./TripAboutSection";

afterEach(cleanup);

/**
 * Slice 5e's contract (ADR 20260827-the-departure-is-two-working-surfaces):
 * Overview's configuration is one compact About disclosure at rest, and its
 * label/value rows and their editors remain available on intent.
 *
 * Amended by the 2026-09-17 design review: a row *is* its own disclosure, so
 * the editors are no longer a second set of headed sections below the rows
 * restating them, and the rare and destructive acts are one closed list at the
 * foot rather than five standing buttons with captions.
 */
describe("Trip About panel", () => {
  const props = {
    heading: "About this departure",
    detailsLabel: "Details",
    closeLabel: "Close",
    summary: "Molasses Reef · Mantis II · Keiko",
    conditionsSummary: "Wind 10 kt SE · viz 60 ft",
    rows: [
      {
        id: "details",
        label: "The plan",
        value: "Molasses Reef + Winch Hole",
        editLabel: "Edit details",
        editor: <div>Details editor</div>,
      },
      { id: "conditions", label: "Conditions", value: "Wind 10 kt SE · viz 60 ft" },
    ],
  };

  it("keeps configuration compact and hidden at rest", () => {
    const { container } = render(<TripAboutSection {...props} />);

    const about = container.querySelector("#about");
    expect(about).not.toHaveAttribute("open");
    expect(screen.getByText(props.summary)).toBeVisible();
    const conditionLines = screen.getAllByText(props.conditionsSummary);
    // The strip's quieter second line, and the Conditions row's own value.
    expect(conditionLines).toHaveLength(2);
    // The desktop canvas keeps a second, quieter conditions line, while the
    // phone canvas keeps About to one line so the roster arrives sooner.
    expect(conditionLines[0]).toHaveClass("hidden", "sm:block");
    expect(screen.getByText("Details editor")).not.toBeVisible();
  });

  it("opens a row's editor beneath the row it belongs to, and nowhere else", () => {
    const { container } = render(<TripAboutSection {...props} open />);

    expect(screen.getByText("About this departure")).toBeVisible();
    expect(screen.getByText("Molasses Reef + Winch Hole")).toBeVisible();
    // The row's own control is its summary — no separate "Edit" link, and no
    // headed duplicate of the row below it.
    expect(screen.queryByRole("link", { name: "Edit details" })).toBeNull();
    const row = container.querySelector("details#details");
    expect(row).not.toBeNull();
    expect(row?.querySelector("summary")?.textContent).toContain("Edit details");
    expect(row?.textContent).toContain("Details editor");
    // Closed until asked, because nothing about the plan has gone wrong.
    expect(row).not.toHaveAttribute("open");
  });

  it("opens the row whose editor has an outcome to show", () => {
    const { container } = render(
      <TripAboutSection
        {...props}
        open
        rows={[{ ...props.rows[0], editorOpen: true }, props.rows[1]]}
      />,
    );

    expect(container.querySelector("details#details")).toHaveAttribute("open");
    expect(screen.getByText("Details editor")).toBeVisible();
  });

  it("keeps the rare and destructive acts behind one closed list", () => {
    render(
      <TripAboutSection
        {...props}
        open
        actions={<button type="button">View public page</button>}
        moreLabel="More for this departure"
        more={<button type="button">Cancel this departure</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "View public page" })).toBeVisible();
    expect(screen.getByText("More for this departure")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel this departure" })).not.toBeVisible();
  });

  /**
   * The card is `overflow-hidden`, and its own summary fills it edge to edge,
   * so the outset ring was cut on all four sides: that one summary draws its
   * ring inset, at the card's radius. A row's summary sits inside the body's
   * `px-4`, 11px clear of the clip once the 5px ring is drawn, so it keeps the
   * global ring — an inset ring there landed on the label's first letter and
   * the caret, which sit on the summary's own edges (review, 2026-09-25).
   */
  it("rings the card's own summary inset at the card's radius, and gives a row's summary and the 'more' summary no ring utility, so both keep the global ring", () => {
    const { container } = render(
      <TripAboutSection
        {...props}
        open
        moreLabel="More for this departure"
        more={<button type="button">Cancel this departure</button>}
      />,
    );

    const card = container.querySelector("details");
    expect(card).toHaveClass("overflow-hidden");
    expect(card?.querySelector(":scope > summary")).toHaveClass(
      "focus-visible:focus-ring-inset",
      "rounded-panel",
      "group-open/about:rounded-b-none",
    );
    for (const summary of [
      container.querySelector("details#details > summary"),
      container.querySelector("details#about-more > summary"),
    ]) {
      expect(summary).not.toBeNull();
      expect(summary?.className).not.toMatch(/focus-ring|outline/);
    }
  });
});
