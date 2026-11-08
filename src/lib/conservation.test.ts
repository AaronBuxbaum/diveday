import { describe, expect, it } from "vitest";
import { conservationFactSchema } from "./conservation";

describe("quantified conservation facts", () => {
  it("accepts measured quantities and trims the shop's context", () => {
    expect(
      conservationFactSchema.parse({
        kind: "litter_kg",
        quantity: "1.8",
        location: " Reef ",
        note: " Fishing gear ",
      }),
    ).toEqual({ kind: "litter_kg", quantity: 1.8, location: "Reef", note: "Fishing gear" });
  });
  it.each([0, -1, NaN, Infinity, 100001, "", "about two", 0.001])(
    "refuses non-factual quantity %s",
    (quantity) => {
      expect(
        conservationFactSchema.safeParse({ kind: "litter_kg", quantity, location: "", note: "" })
          .success,
      ).toBe(false);
    },
  );
  it("refuses fractional item counts, unsupported claims and unbounded prose", () => {
    for (const fact of [
      { kind: "litter_items", quantity: 1.2, location: "", note: "" },
      { kind: "reef_safe", quantity: 1, location: "", note: "" },
      { kind: "line_m", quantity: 2, location: "", note: "x".repeat(501) },
    ])
      expect(conservationFactSchema.safeParse(fact).success).toBe(false);
  });
});
