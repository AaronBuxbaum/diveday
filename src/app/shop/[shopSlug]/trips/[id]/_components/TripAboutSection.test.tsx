// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripAboutSection, TripMoreDisclosure } from "./TripAboutSection";

afterEach(cleanup);

/**
 * The Details tab's contract: the departure's rows are the whole tab, laid
 * flat and never folded behind a card-level disclosure (owner, 2026-10-05).
 * A row *is* its own disclosure, so the editors are not a second set of
 * headed sections below the rows restating them, and the rare and destructive
 * acts are one closed list at the foot (design review 2026-09-17).
 */
describe("Trip About panel", () => {
  const props = {
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

  it("lays every row out flat, with no disclosure around the panel", () => {
    const { container } = render(<TripAboutSection {...props} />);

    const about = container.querySelector("#about");
    expect(about?.tagName).toBe("SECTION");
    expect(about?.closest("details")).toBeNull();
    expect(screen.getByText("Molasses Reef + Winch Hole")).toBeVisible();
    expect(screen.getByText("Wind 10 kt SE · viz 60 ft")).toBeVisible();
    // A row's editor still waits behind its own row.
    expect(screen.getByText("Details editor")).not.toBeVisible();
  });

  it("opens a row's editor beneath the row it belongs to, and nowhere else", () => {
    const { container } = render(<TripAboutSection {...props} />);

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
    const { container } = render(<TripAboutSection {...props} />);
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

  it("sets a row's label, value and 'Edit …' on one baseline from sm", () => {
    // K-180: the grid was `sm:items-start` and the action `self-start`, so
    // its 20px line centred in its 44px box while the label and value sat at
    // the box's top: "Edit details ▾" 12px under the value it edits, and the
    // label 3px off the value. The 44px box stays (the whole summary is the
    // target); the three share the first baseline.
    const { container } = render(<TripAboutSection {...props} />);
    const summaryGrid = container.querySelector("details#details > summary")?.firstElementChild;
    const fact = container.querySelector("#conditions");

    for (const grid of [summaryGrid, fact]) {
      expect(grid).toHaveClass("sm:items-baseline");
      expect(grid).not.toHaveClass("sm:items-start");
    }
    const action = screen.getByText("Edit details");
    expect(action).toHaveClass("min-h-11");
    expect(action).not.toHaveClass("self-start");
  });

  it("rings an editable row inside its own box", () => {
    // Three focus classes here compiled and did nothing: the global ring rule
    // beat them. The app's inset ring is one utility, not a width and offset
    // spelled at the call site.
    const { container } = render(<TripAboutSection {...props} />);
    const summary = container.querySelector("details#details > summary");
    expect(summary).toHaveClass("focus-visible:focus-ring-inset");
    expect(summary?.className).not.toMatch(/focus-visible:outline-/);
  });

  it("opens the row whose editor has an outcome to show", () => {
    const { container } = render(
      <TripAboutSection
        {...props}
        rows={[{ ...props.rows[0], editorOpen: true }, props.rows[1]]}
      />,
    );

    expect(container.querySelector("details#details")).toHaveAttribute("open");
    expect(screen.getByText("Details editor")).toBeVisible();
  });
});

describe("TripMoreDisclosure", () => {
  it("keeps the rare and destructive acts behind one closed row", () => {
    render(
      <TripMoreDisclosure label="More for this departure">
        <button type="button">Cancel this departure</button>
      </TripMoreDisclosure>,
    );

    expect(screen.getByText("More for this departure")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel this departure" })).not.toBeVisible();
  });

  it("opens itself when one of its acts has an outcome to show", () => {
    const { container } = render(
      <TripMoreDisclosure label="More for this departure" open>
        <button type="button">Cancel this departure</button>
      </TripMoreDisclosure>,
    );

    expect(container.querySelector("details#about-more")).toHaveAttribute("open");
  });

  it("gives the summary no ring utility, so it keeps the global ring", () => {
    const { container } = render(
      <TripMoreDisclosure label="More for this departure">
        <button type="button">Cancel this departure</button>
      </TripMoreDisclosure>,
    );

    const more = container.querySelector("details#about-more > summary");
    expect(more).not.toBeNull();
    expect(more?.className).not.toMatch(/focus-ring|outline/);
  });
});
