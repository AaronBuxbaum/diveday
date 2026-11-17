import { describe, expect, it } from "vitest";
import { choiceGridClass } from "./choice-grid";

describe("choiceGridClass", () => {
  it("lets the box decide how many pills fit, never a fixed column count", () => {
    expect(choiceGridClass).toContain("auto-fit");
    expect(choiceGridClass).not.toMatch(/(^|\s)(sm:|md:|lg:)?grid-cols-\d/);
  });

  it("caps a column at the box's own width so a narrow phone is one column", () => {
    expect(choiceGridClass).toContain("min(100%,");
  });
});
