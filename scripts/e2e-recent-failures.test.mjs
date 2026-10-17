import { describe, expect, it } from "vitest";

import { rankFailedSpecs } from "./e2e-recent-failures.mjs";

const failure = (path) => ({ path, annotation_level: "failure" });

describe("rankFailedSpecs", () => {
  it("ranks specs by how many failed jobs named them, once per job", () => {
    const jobs = [
      [failure("e2e/booking.spec.ts"), failure("e2e/booking.spec.ts")],
      [failure("e2e/staffing.spec.ts"), failure("e2e/booking.spec.ts")],
      [failure("e2e/staffing.spec.ts")],
      [failure("e2e/add-diver.spec.ts")],
    ];
    expect(rankFailedSpecs(jobs)).toEqual([
      "e2e/booking.spec.ts",
      "e2e/staffing.spec.ts",
      "e2e/add-diver.spec.ts",
    ]);
  });

  it("ignores warnings, non-spec paths and deleted specs, and caps the list", () => {
    const jobs = [
      [
        { path: "e2e/slow.spec.ts", annotation_level: "warning" },
        failure(".github"),
        failure("e2e/gone.spec.ts"),
        failure("e2e/a.spec.ts"),
        failure("e2e/b.spec.ts"),
      ],
    ];
    expect(
      rankFailedSpecs(jobs, { max: 1, exists: (spec) => spec !== "e2e/gone.spec.ts" }),
    ).toEqual(["e2e/a.spec.ts"]);
  });

  it("returns nothing when nothing failed", () => {
    expect(rankFailedSpecs([])).toEqual([]);
  });
});
