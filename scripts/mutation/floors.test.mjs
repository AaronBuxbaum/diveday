import { describe, expect, it } from "vitest";
import { checkFloor, nextFloors, score } from "./floors.mjs";

const floors = { "//": "note", "src/lib/a.ts": 70, "src/lib/b.ts": 50 };

describe("breakage-drill floors", () => {
  it("scores killed over killed plus survived, rounded down", () => {
    expect(score(2, 1)).toBe(66.66);
    expect(score(0, 0)).toBeNull();
  });
  it("fails a fall and passes a rise or a hold", () => {
    expect(checkFloor(floors, "src/lib/a.ts", 69.9).ok).toBe(false);
    expect(checkFloor(floors, "src/lib/a.ts", 70).ok).toBe(true);
    expect(checkFloor(floors, "src/lib/a.ts", 80).message).toMatch(/Bank it with --write/);
    expect(checkFloor(floors, "src/lib/c.ts", 80).ok).toBe(false);
  });
  it("banks a rise or a new file and leaves the others", () => {
    const next = nextFloors(floors, "src/lib/a.ts", 75, null).floors;
    expect(next).toMatchObject({ "src/lib/a.ts": 75, "src/lib/b.ts": 50 });
    expect(nextFloors(floors, "src/lib/c.ts", 10, null).floors["src/lib/c.ts"]).toBe(10);
  });
  it("refuses a fall without a reason and records one with it", () => {
    expect(nextFloors(floors, "src/lib/a.ts", 60, null).refused).toBe("src/lib/a.ts: 70% → 60%");
    const next = nextFloors(floors, "src/lib/a.ts", 60, "a test moved to the db layer").floors;
    expect(next["src/lib/a.ts"]).toBe(60);
    expect(next["//absorbed"]).toEqual([
      { why: "a test moved to the db layer", files: { "src/lib/a.ts": "70 -> 60" } },
    ]);
  });
});
