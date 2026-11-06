// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PAPER_PASS_PAPER, PRINT_SHEET_BOX_MM } from "@/lib/print-sheets";
import { PaperSheet, SheetMark } from "./PaperSheet";

/**
 * What every sheet composes, whatever is printed on it (ADR 20260908-one-hand,
 * decision 6, lever X).
 */

afterEach(cleanup);

function renderSheet() {
  return render(
    <PaperSheet
      paper={PAPER_PASS_PAPER}
      band={<span>Blue Mantis</span>}
      foldLeft="Printed Aug 12, 2026"
      foldRight="dive.day/s/blue-mantis"
    >
      <p>the body</p>
    </PaperSheet>,
  );
}

describe("every sheet", () => {
  it("carries the day it was printed and where the shop lives", () => {
    // The fold line is the whole reason a sheet can be trusted: paper outlives
    // the morning it came out of the printer.
    const { container } = renderSheet();
    expect(screen.getByText("Printed Aug 12, 2026")).toBeTruthy();
    expect(screen.getByText("dive.day/s/blue-mantis")).toBeTruthy();
    expect(container.querySelector(".paper-sheet-fold")).not.toBeNull();
  });

  it("is drawn at the millimeters of its own paper", () => {
    const { container } = renderSheet();
    const sheet = container.querySelector<HTMLElement>(".paper-sheet");
    const box = PRINT_SHEET_BOX_MM[PAPER_PASS_PAPER];
    expect(sheet?.style.width).toBe(`${box.width}mm`);
    // A floor: a sheet that outgrows its paper takes a second page rather than
    // cutting the shop's own words off.
    expect(sheet?.style.minHeight).toBe(`${box.height}mm`);
    expect(sheet?.style.height).toBe("");
  });

  it("carries no colour of its own", () => {
    // The band is ruled, never filled or brand-coloured: paper spends no ink on it.
    const { container } = renderSheet();
    const sheet = container.querySelector<HTMLElement>(".paper-sheet");
    expect(sheet?.getAttribute("style")).not.toMatch(/--sheet-band/);
  });
});

describe("the mark in the band", () => {
  it("is the shop's initials, never a logo DiveDay has no right to draw", () => {
    render(<SheetMark name="Blue Mantis Divers" />);
    expect(screen.getByText("BM")).toBeTruthy();
  });

  it("survives a one-word name", () => {
    render(<SheetMark name="Reeflight" />);
    expect(screen.getByText("R")).toBeTruthy();
  });
});
