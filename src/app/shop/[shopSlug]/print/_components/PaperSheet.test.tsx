// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { PAPER_PASS_PAPER, PRINT_SHEET_BOX_MM } from "@/lib/print-sheets";
import { PaperSheet, SheetMark } from "./PaperSheet";

/**
 * What every sheet composes, whatever is printed on it (ADR 20260908-one-hand,
 * decision 6, lever X).
 */

afterEach(cleanup);

// The pass page's own derivation, so the test carries no colour of its own.
const THEME = deriveBrandTheme(DIVEDAY_BRAND_COLOR);
const TONE = { band: THEME.primary, bandInk: THEME.primaryForeground };

function renderSheet() {
  return render(
    <PaperSheet
      paper={PAPER_PASS_PAPER}
      tone={TONE}
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

  it("is drawn at the millimetres of its own paper", () => {
    const { container } = renderSheet();
    const sheet = container.querySelector<HTMLElement>(".paper-sheet");
    const box = PRINT_SHEET_BOX_MM[PAPER_PASS_PAPER];
    expect(sheet?.style.width).toBe(`${box.width}mm`);
    // A floor: a sheet that outgrows its paper takes a second page rather than
    // cutting the shop's own words off.
    expect(sheet?.style.minHeight).toBe(`${box.height}mm`);
    expect(sheet?.style.height).toBe("");
  });

  it("takes its band colour as a value, not a token", () => {
    // `@media print` redefines `--primary` to repaint the app monochrome, so a
    // band drawn from the token would print grey. The caller resolves it.
    const { container } = renderSheet();
    const sheet = container.querySelector<HTMLElement>(".paper-sheet");
    expect(sheet?.style.getPropertyValue("--sheet-band")).toBe(TONE.band);
    expect(sheet?.style.getPropertyValue("--sheet-band-ink")).toBe(TONE.bandInk);
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
