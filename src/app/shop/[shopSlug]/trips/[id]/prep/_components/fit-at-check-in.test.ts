import { describe, expect, it } from "vitest";
import type { PrepLine } from "@/lib/dive-prep";
import { foldFitAtCheckIn } from "./fit-at-check-in";

const line = (overrides: Partial<PrepLine>): PrepLine => ({
  kind: "bcd",
  size: null,
  count: 1,
  divers: ["Ana"],
  fitAtCheckIn: false,
  drysuitWeightCheck: false,
  drysuitFinFit: false,
  drysuitGloves: false,
  notOffered: false,
  ...overrides,
});

describe("foldFitAtCheckIn", () => {
  it("says Fit at check-in once per diver, carrying every piece they take", () => {
    const { lines, fits } = foldFitAtCheckIn([
      line({ kind: "bcd", size: "M", divers: ["Ana"] }),
      line({ kind: "bcd", fitAtCheckIn: true, count: 2, divers: ["Bo", "Cy"] }),
      line({ kind: "wetsuit", fitAtCheckIn: true, count: 1, divers: ["Bo"] }),
      line({ kind: "boots", fitAtCheckIn: true, count: 1, divers: ["Bo"] }),
    ]);
    expect(lines.map((l) => l.kind)).toEqual(["bcd"]);
    expect(fits.map((row) => [row.fullName, row.lines.map((l) => l.kind)])).toEqual([
      ["Bo", ["bcd", "wetsuit", "boots"]],
      ["Cy", ["bcd"]],
    ]);
  });

  it("drops no piece: the counts before and after add up", () => {
    const given = [
      line({ kind: "bcd", count: 3, divers: ["A", "B", "C"] }),
      line({ kind: "fins", fitAtCheckIn: true, count: 2, divers: ["D", "E"] }),
      line({ kind: "mask", fitAtCheckIn: true, count: 1, divers: ["D"] }),
    ];
    const { lines, fits } = foldFitAtCheckIn(given);
    const after =
      lines.reduce((sum, l) => sum + l.count, 0) +
      fits.reduce((sum, row) => sum + row.lines.length, 0);
    expect(after).toBe(given.reduce((sum, l) => sum + l.count, 0));
  });

  it("keeps a piece the catalog no longer offers on its diver's row", () => {
    const { fits } = foldFitAtCheckIn([
      line({ kind: "drysuit", fitAtCheckIn: true, notOffered: true, divers: ["Bo"] }),
    ]);
    expect(fits[0]?.lines[0]).toMatchObject({ kind: "drysuit", notOffered: true });
  });

  it("leaves a list with nobody to fit untouched", () => {
    const given = [line({ kind: "bcd", size: "L", count: 2, divers: ["A", "B"] })];
    expect(foldFitAtCheckIn(given)).toEqual({ lines: given, fits: [] });
  });
});
