// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

const unit = (id: string, label: string, size: string | null) => ({
  id,
  kind: "bcd" as const,
  label,
  size,
  serviceState: { state: "no_clock" } as GearServiceState,
  serviceConcern: false,
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
  });

  it("says none is free when the kind has no free unit", () => {
    renderPiece(prepWith([]));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(t("gear.prep.noneFree", { kindLabel: "BCD" }))).toBeTruthy();
  });
});
