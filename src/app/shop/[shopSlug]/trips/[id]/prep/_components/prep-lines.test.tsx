// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PrepPiece } from "@/lib/dive-prep";
import {
  careLine,
  diveRecencyLine,
  diverNames,
  kitCell,
  pieceSize,
  sizeCell,
  suitMismatchLine,
  unitLine,
} from "./prep-lines";
import { t } from "./prep-test-fixtures";

/**
 * The words every section of the packing list shares, pinned where they are
 * made. The sections' own tests pin where each one stands on the page.
 */

afterEach(cleanup);

const piece = (rest: Partial<PrepPiece>): PrepPiece =>
  ({ kind: "bcd", size: null, ...rest }) as PrepPiece;

describe("unitLine", () => {
  it("says a unit's label and size, then its care, in the picker's order", () => {
    expect(unitLine(t, { label: "BCD #3", size: "L", serviceState: { state: "no_clock" } })).toBe(
      "BCD #3 · L",
    );
    expect(
      unitLine(t, {
        label: "Reg #1",
        size: null,
        serviceState: { state: "overdue" },
        serviceConcern: true,
      }),
    ).toBe(
      `Reg #1 · ${t("gear.prep.optionServiceOverdue")} · ${t("gear.prep.optionServiceConcern")}`,
    );
  });
});

describe("careLine", () => {
  it("leads with the register's status word and the technician's note on a pulled unit", () => {
    expect(
      careLine(t, {
        status: "needs_service",
        serviceNote: "  Inflator sticks ",
        serviceState: { state: "no_clock" },
      }),
    ).toBe(`${t("gear.status.needsService")} · Inflator sticks`);
  });

  it("says nothing about a unit that needs nothing", () => {
    expect(
      careLine(t, { status: "in_service", serviceNote: null, serviceState: { state: "no_clock" } }),
    ).toBe("");
  });
});

describe("pieceSize and sizeCell", () => {
  it("says the size to pull, or that it is missing", () => {
    expect(pieceSize(t, piece({ size: "L" }))).toBe("L");
    const { container } = render(pieceSize(t, piece({})));
    expect(container.textContent).toBe(t("tripPrep.sizeMissing"));
  });

  it("says a piece the shop no longer rents beside its size", () => {
    const { container } = render(pieceSize(t, piece({ size: "L", notOffered: true })));
    expect(container.textContent).toBe(`L · ${t("tripPrep.noLongerRented")}`);
  });

  it("owes an unsized piece's Size cell a dash", () => {
    const { container } = render(sizeCell(t, piece({ kind: "regulator" })));
    expect(container.textContent).toBe("—");
  });
});

describe("diverNames", () => {
  it("keeps each comma with the name before it, with a bare space between", () => {
    const { container } = render(<p>{diverNames(["Carmen Ruiz", "Grace Mensah"])}</p>);
    const cell = container.firstElementChild as HTMLElement;
    expect([...cell.children].map((name) => name.textContent)).toEqual([
      "Carmen Ruiz,",
      "Grace Mensah",
    ]);
  });
});

describe("diveRecencyLine", () => {
  it("draws only a notable band", () => {
    expect(diveRecencyLine(t, null)).toBeNull();
    const { container } = render(diveRecencyLine(t, "over_five_years"));
    expect(container.textContent).not.toBe("");
  });
});

/** Domain review F3: an assigned wetsuit that is not the day's thickness says so. */
describe("suitMismatchLine", () => {
  const suit = (thicknessMm: number | null) => ({ kind: "wetsuit" as const, thicknessMm });

  it("names the day's thickness on a wetsuit of another one", () => {
    expect(suitMismatchLine(t, suit(3), 7)).toBe(t("gear.prep.notDaysThickness", { mm: 7 }));
    expect(suitMismatchLine(t, suit(null), 7)).toBe(t("gear.prep.notDaysThickness", { mm: 7 }));
  });

  it("says nothing on a match, with no day's thickness, or on another kind", () => {
    expect(suitMismatchLine(t, suit(7), 7)).toBeNull();
    expect(suitMismatchLine(t, suit(3), null)).toBeNull();
    expect(suitMismatchLine(t, { kind: "bcd", thicknessMm: null }, 7)).toBeNull();
  });
});

describe("kitCell", () => {
  const piece = (overrides: Partial<PrepPiece>): PrepPiece => ({
    kind: "bcd",
    size: null,
    fitAtCheckIn: false,
    drysuitWeightCheck: false,
    drysuitFinFit: false,
    drysuitGloves: false,
    notOffered: false,
    ...overrides,
  });

  it("says Fit at check-in once per diver, not once per piece (B54)", () => {
    const { container } = render(
      kitCell(t, {
        items: [
          piece({ kind: "bcd", fitAtCheckIn: true }),
          piece({ kind: "wetsuit", fitAtCheckIn: true }),
          piece({ kind: "boots", fitAtCheckIn: true, notOffered: true }),
        ],
      } as unknown as Parameters<typeof kitCell>[1]),
    );
    const text = container.textContent ?? "";
    expect(text.split(t("tripPrep.fitAtCheckIn")).length - 1).toBe(1);
    // Every piece is still named, and a dropped one still says so.
    expect(container.querySelectorAll("li")).toHaveLength(4);
    expect(text).toContain(t("tripPrep.noLongerRented"));
  });
});
