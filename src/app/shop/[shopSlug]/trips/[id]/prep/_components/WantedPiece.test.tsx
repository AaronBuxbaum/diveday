// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import type { GearServiceState } from "@/lib/gear";
import { prepFor, t, viewOf } from "./prep-test-fixtures";
import { WantedPiece } from "./WantedPiece";

/**
 * One piece a renting diver still wants, drawn alone. The section's cases
 * (proposals, staff fits) sit in `PrepAssignments.test.tsx`; these pin the
 * piece's own three answers: a picker, a proposal, or nothing free.
 */

afterEach(cleanup);

/** Opens a row with no proposal: its picker sits behind one Pick text button. */
function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: t("gear.prep.proposal.pick") }));
}

const unit = (id: string, label: string, size: string | null) => ({
  id,
  kind: "bcd" as const,
  label,
  size,
  serviceState: { state: "no_clock" } as GearServiceState,
  serviceConcern: false,
  nitroxDesignated: null as boolean | null,
  thicknessMm: null as number | null,
  o2Clean: null,
});

function prepWith(free: ReturnType<typeof unit>[], proposed?: ReturnType<typeof unit>): TripPrep {
  return {
    ...prepFor(),
    freeByKind: new Map([["bcd", free]]),
    proposals: proposed ? new Map([["b1:bcd", proposed]]) : new Map(),
  };
}

function renderPiece(prep: TripPrep, size: string | null = "L") {
  return render(
    <dl>
      <WantedPiece view={viewOf(prep)} bookingId="b1" item={{ kind: "bcd", size }} />
    </dl>,
  );
}

describe("WantedPiece", () => {
  it("bands the picker by the diver's own size, and opens it on the placeholder", () => {
    renderPiece(prepWith([unit("u1", "BCD #1", "L"), unit("u2", "BCD #2", "S")]));
    // At rest the row is a line and a text button, never a bare select.
    expect(screen.getByText(t("gear.prep.proposal.none"))).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    openPicker();
    const picker = screen.getByRole("combobox") as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(
      screen.getByRole("group", { name: t("gear.prep.groupExactSize", { size: "L" }) }),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: t("gear.prep.groupOtherSizes") })).toBeTruthy();
  });

  it("says the proposed unit in words when there is one", () => {
    const proposed = unit("u1", "BCD #1", "L");
    renderPiece(prepWith([proposed], proposed));
    expect(screen.getByText("Proposed: BCD #1 · L")).toBeTruthy();
    expect(screen.queryByText(t("gear.prep.proposal.none"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("gear.prep.proposal.pick") })).toBeNull();
  });

  /**
   * Issue #2207: a regulator the shop keeps for enriched air says so in the
   * picker on every row: plainly on a nitrox diver's, as a caution on an air
   * diver's. Every regulator stays in the picker either way: the label
   * informs, it never filters.
   */
  describe("a nitrox-designated regulator", () => {
    const reg = (id: string, label: string, nitroxDesignated: boolean | null) => ({
      ...unit(id, label, null),
      kind: "regulator" as const,
      nitroxDesignated,
    });
    const regPrep = (): TripPrep => ({
      ...prepFor(),
      freeByKind: new Map([["regulator", [reg("r1", "Reg #1", null), reg("r9", "Reg #9", true)]]]),
      proposals: new Map(),
    });
    const renderReg = (wantsNitrox: boolean) =>
      render(
        <dl>
          <WantedPiece
            view={viewOf(regPrep())}
            bookingId="b1"
            wantsNitrox={wantsNitrox}
            item={{ kind: "regulator", size: null }}
          />
        </dl>,
      );

    it("is labelled on a nitrox diver's row, beside every other free regulator", () => {
      renderReg(true);
      openPicker();
      expect(
        screen.getByRole("option", { name: `Reg #9 · ${t("gear.prep.optionNitroxDesignated")}` }),
      ).toBeTruthy();
      expect(screen.getByRole("option", { name: "Reg #1" })).toBeTruthy();
    });

    it("is labelled as a caution on an air diver's row, and sorted last", () => {
      // Domain review A2/F7: the word is never hidden, so a designated set
      // cannot go out on air unnoticed; on an air row it is a caution, and the
      // air sets come first. It still never refuses.
      renderReg(false);
      openPicker();
      const options = screen.getAllByRole("option").map((option) => option.textContent);
      expect(options.at(-1)).toBe(`Reg #9 · ${t("gear.prep.optionNitroxDesignatedOnAir")}`);
      expect(options).toContain("Reg #1");
    });
  });

  it("says none is free when the kind has no free unit", () => {
    renderPiece(prepWith([]));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(t("gear.prep.noneFree", { kindLabel: "BCD" }))).toBeTruthy();
  });
});
