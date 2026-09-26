// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BOAT_CARD_DAY, BOAT_CARD_NIGHT, PRINT_SHEET_BOX_MM } from "@/lib/print-sheets";
import { declarations, readGlobalsCss, unlayeredRules } from "@/test/stylesheet";
import { PaperSheet, SheetMark, SheetValue } from "./PaperSheet";

/**
 * What every sheet composes, whatever is printed on it (ADR 20260908-one-hand,
 * decision 6, lever X).
 */

afterEach(cleanup);

function renderSheet(overrides: Partial<Parameters<typeof PaperSheet>[0]> = {}) {
  return render(
    <PaperSheet
      paper="A5 landscape"
      tone={BOAT_CARD_DAY}
      band={<span>Mantis II</span>}
      foldLeft="Printed Aug 12, 2026"
      foldRight="dive.day/s/blue-mantis"
      {...overrides}
    >
      <p>the body</p>
    </PaperSheet>,
  );
}

describe("every sheet", () => {
  it("carries the day it was printed and where the shop lives", () => {
    // The fold line is the whole reason a sheet can be trusted: paper outlives
    // the morning it came out of the printer, and this is how a skipper reading
    // a card taped to a console can tell how old it is.
    const { container } = renderSheet();
    expect(screen.getByText("Printed Aug 12, 2026")).toBeTruthy();
    expect(screen.getByText("dive.day/s/blue-mantis")).toBeTruthy();
    expect(container.querySelector(".paper-sheet-fold")).not.toBeNull();
  });

  it("is drawn at the millimetres of its own paper", () => {
    const { container } = renderSheet({ paper: "A3 portrait" });
    const sheet = container.querySelector<HTMLElement>(".paper-sheet");
    const box = PRINT_SHEET_BOX_MM["A3 portrait"];
    expect(sheet?.style.width).toBe(`${box.width}mm`);
    // A floor by default: a sheet that outgrows its paper takes a second page
    // rather than cutting the shop's own words off.
    expect(sheet?.style.minHeight).toBe(`${box.height}mm`);
    expect(sheet?.style.height).toBe("");
    expect(container.querySelector(".paper-sheet-fit")).toBeNull();
  });

  it("holds a laminated card to exactly one page a side", () => {
    // The boat card is two faces of one lamination, so a face that grew would
    // be laminated across two cards. It is the one sheet with a ceiling, and
    // its caller bounds the one unbounded thing on it (`boatCardPlan`).
    const { container } = renderSheet({ fit: true });
    const sheet = container.querySelector<HTMLElement>(".paper-sheet");
    const box = PRINT_SHEET_BOX_MM["A5 landscape"];
    expect(sheet?.style.height).toBe(`${box.height}mm`);
    expect(sheet?.style.minHeight).toBe("");
    expect(container.querySelector(".paper-sheet-fit")).not.toBeNull();
  });

  it("takes its band colour as a value, not a token", () => {
    // `@media print` redefines `--primary` to repaint the app monochrome, so a
    // band drawn from the token would print grey. The caller resolves it.
    const { container } = renderSheet();
    const sheet = container.querySelector<HTMLElement>(".paper-sheet");
    expect(sheet?.style.getPropertyValue("--sheet-band")).toBe(BOAT_CARD_DAY.band);
    expect(sheet?.style.getPropertyValue("--sheet-band-ink")).toBe(BOAT_CARD_DAY.bandInk);
  });

  it("wears the night ground only when the sheet asks for it", () => {
    const { container: day } = renderSheet();
    expect(day.querySelector(".paper-sheet-night")).toBeNull();
    cleanup();
    const { container: night } = renderSheet({ tone: BOAT_CARD_NIGHT });
    expect(night.querySelector(".paper-sheet-night")).not.toBeNull();
  });
});

describe("a value the shop has not recorded", () => {
  it("prints a rule to fill in by hand, never a number", () => {
    // The rule the boat card exists under: a number DiveDay invented costs the
    // crew dialling it the minute it takes to find out it rings nowhere.
    const { container } = render(<SheetValue value={null} />);
    expect(container.querySelector(".paper-sheet-blank")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("prints the shop's own value when there is one", () => {
    const { container } = render(<SheetValue value="(305) 555-0142" />);
    expect(container.textContent).toBe("(305) 555-0142");
    expect(container.querySelector(".paper-sheet-blank")).toBeNull();
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

/**
 * **A blank is a rule under the line, from its label to the column's edge.**
 *
 * It was an 8ch inline block, so each rule was about 13mm long and ended
 * wherever its label happened to end: the boat card's three oxygen and
 * first-aid blanks stopped at three x positions 25px apart, in a column that
 * ran on to its edge (pixel probe, `boat-card-print`). A skipper writing a
 * location needs the width, and one right edge is what makes three rules read
 * as a form.
 *
 * And it lies on the baseline its label's words stand on, as the 8ch one did. An
 * empty inline block's bottom edge *is* its line's baseline, so an inline-level
 * blank puts its rule there. As a one-line `block` it ran to the edge but its
 * rule fell to the foot of the line box, 3.4px under the label in print.
 *
 * This half reads the stylesheet and can only say what the rule asks for;
 * `e2e/shop-on-paper.spec.ts` measures both edges on the printed card.
 */
describe("the ruled blank", () => {
  const style = declarations(
    unlayeredRules(readGlobalsCss()).find((rule) => rule.prelude === ".paper-sheet-blank")?.body ??
      "",
  );

  it("lies on its label's baseline", () => {
    expect(style.display, "inline-level, so the line sets it on its baseline").toBe("inline-block");
    expect(style["vertical-align"] ?? "baseline").toBe("baseline");
  });

  it("runs to its column's edge", () => {
    expect(style.width).toBe("100%");
    expect(style).not.toHaveProperty("min-width");
  });

  it("is ruled in the sheet's ink", () => {
    expect(style["border-bottom"]).toBe("1px solid var(--sheet-rule)");
  });
});
