import { describe, expect, it } from "vitest";
import { tripTagRefusalTarget } from "./notices";

const lens = "a1122334-5678-1234-1234-123456789abc";

describe("tripTagRefusalTarget", () => {
  it("opens only the validated tag named by a validation refusal", () => {
    expect(tripTagRefusalTarget({ notice: "lens-invalid", lens })).toBe(lens);
    expect(tripTagRefusalTarget({ notice: "lens-invalid", lens: lens.toUpperCase() })).toBe(lens);
    expect(tripTagRefusalTarget({ notice: "lens-invalid", lens: "new" })).toBe("new");
  });

  it.each(["lens-created", "lens-updated", "lens-deleted", undefined])(
    "does not open an editor for %s",
    (notice) => {
      expect(tripTagRefusalTarget({ notice, lens })).toBeNull();
      expect(tripTagRefusalTarget({ notice, lens: "new" })).toBeNull();
    },
  );

  it.each([
    { target: undefined },
    { target: "" },
    { target: "bad#tag-new" },
    { target: "not-a-uuid" },
    { target: [lens] },
    { target: ["new"] },
    { target: { lens } },
  ])("does not turn an invalid or missing target $target into Add", ({ target }) => {
    expect(tripTagRefusalTarget({ notice: "lens-invalid", lens: target })).toBeNull();
  });
});
