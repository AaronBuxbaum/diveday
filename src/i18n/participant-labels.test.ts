import { describe, expect, it } from "vitest";
import {
  staffBookingsDetail,
  staffPassengerCount,
  staffSoulsOnBoardLine,
} from "./participant-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

describe("the passenger split on staff surfaces", () => {
  it("leaves out a type nobody is, on Reports as on the manifests", () => {
    const detail = staffBookingsDetail(
      t,
      { tripCount: 2, seatsByType: { diver: 5, snorkeler: 1, rider: 0 } },
      true,
    );
    expect(detail).toContain("5 divers · 1 snorkeler");
    expect(detail).not.toContain("rider");
  });

  it("says nothing extra when everyone aboard is diving", () => {
    const counts = { diver: 4, snorkeler: 0, rider: 0 };
    expect(staffPassengerCount(t, { totalDivers: 4, byType: counts })).toBe(4);
    expect(staffSoulsOnBoardLine(t, { totalDivers: 4, byType: counts }, 2)).toBe(
      "Passengers 4 · Crew 2 · Souls on board 6",
    );
  });
});
