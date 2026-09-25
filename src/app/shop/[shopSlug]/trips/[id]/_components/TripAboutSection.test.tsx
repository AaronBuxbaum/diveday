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

  it("puts the rows' rules 8px past the column, and an editable row's square fill between them with the words inset 8px", () => {
    // The pixel probe (2026-09-25, trip-crew-clash and five more): the row's
    // summary is its hover fill, and with no room of its own the fill's edge
    // ran into "THE PLAN" (0px). The ledger's answer, not a rounded chip
    // hanging past square rules: the rules move out by 8px, the summary spans
    // them, and the room the words keep is the grid's — the same room a fact
    // row's grid keeps, so both kinds of row share one left edge.
    const { container } = render(<TripAboutSection {...props} open />);
    const editable = container.querySelector("details#details");
    const fact = container.querySelector("#conditions");
    const rules = editable?.parentElement;
    expect(rules).toBe(fact?.parentElement);
    expect(rules).toHaveClass("-mx-2", "divide-y", "border-y");

    const summary = editable?.querySelector(":scope > summary");
    expect(summary).toHaveClass("hover:bg-surface-sunken");
    // The fill is the row's whole width and square: no margin, padding or
    // corner of its own.
    expect(summary?.className).not.toMatch(/(?:^|\s)-?(?:m|p)[xse]-|rounded/);

    const summaryGrid = summary?.firstElementChild;
    expect(summaryGrid).toHaveClass("px-2");
    expect(fact).toHaveClass("px-2");
    // The editor opens on the same column.
    expect(screen.getByText("Details editor").parentElement).toHaveClass("px-2");
  });

  it("rings an editable row inside its own box", () => {
    // Three focus classes here compiled and did nothing: the global ring rule
    // beat them. The app's inset ring is one utility, not a width and offset
    // spelled at the call site.
    const { container } = render(<TripAboutSection {...props} open />);
    const summary = container.querySelector("details#details > summary");
    expect(summary).toHaveClass("focus-visible:focus-ring-inset");
    expect(summary?.className).not.toMatch(/focus-visible:outline-/);
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
   * ring inset, at the card's radius. The 'more' summary sits inside the
   * body's `px-4`, clear of the clip once the 5px ring is drawn, so it keeps
   * the global ring. A row's summary is a ledger row: its fill runs rule to
   * rule and its words sit 8px in, so it rings inside itself as a ledger row
   * does (the test above). Before the ledger geometry the label and caret sat
   * on the summary's own edges, where an inset ring landed on them (review,
   * 2026-09-25); they no longer do.
   */
  it("rings the card's own summary inset at the card's radius, and gives the 'more' summary no ring utility, so it keeps the global ring", () => {
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
    const more = container.querySelector("details#about-more > summary");
    expect(more).not.toBeNull();
    expect(more?.className).not.toMatch(/focus-ring|outline/);
  });
});
