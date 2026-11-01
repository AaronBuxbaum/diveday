import { describe, expect, it } from "vitest";
import { sameTemplateValue } from "./template-value-comparison";

describe("template snapshot value comparison", () => {
  it("ignores object key order at every depth", () => {
    expect(
      sameTemplateValue(
        { outer: { zebra: 1, alpha: [{ third: true, first: false }] } },
        { outer: { alpha: [{ first: false, third: true }], zebra: 1 } },
      ),
    ).toBe(true);
  });

  it("keeps array order significant", () => {
    expect(sameTemplateValue([{ value: 1 }, { value: 2 }], [{ value: 2 }, { value: 1 }])).toBe(
      false,
    );
  });

  it("retains JSON serialization behavior for null and undefined", () => {
    expect(sameTemplateValue(undefined, undefined)).toBe(true);
    expect(sameTemplateValue(null, undefined)).toBe(false);
    expect(sameTemplateValue({ value: undefined }, {})).toBe(true);
  });
});
