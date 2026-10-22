import { describe, expect, it } from "vitest";
import { boundedText, fillFacts, hasNumberWord, numbersCameFrom, samePlaceholders } from "./facts";

describe("fillFacts", () => {
  it("fills each placeholder from the record", () => {
    expect(
      fillFacts("A wall to {maxDepth}, for {minCert}.", { maxDepth: "30 m", minCert: "Advanced" }),
    ).toBe("A wall to 30 m, for Advanced.");
  });

  it("refuses a digit the model wrote itself", () => {
    expect(fillFacts("A wall to 40 m.", { maxDepth: "30 m" })).toBeNull();
    expect(fillFacts("Depth {maxDepth}, 2 tanks.", { maxDepth: "30 m" })).toBeNull();
  });

  it("refuses a placeholder the caller did not offer", () => {
    expect(fillFacts("Costs {price}.", { maxDepth: "30 m" })).toBeNull();
    expect(fillFacts("{constructor}", {})).toBeNull();
  });
});

describe("numbersCameFrom", () => {
  it("allows dropping a number and refuses adding or changing one", () => {
    expect(numbersCameFrom("Serviced at 300 bar.", "Tested 300 bar, 2 o-rings")).toBe(true);
    expect(numbersCameFrom("Serviced at 200 bar.", "Tested 300 bar")).toBe(false);
    expect(numbersCameFrom("3 and 3", "3")).toBe(false);
  });
});

describe("hasNumberWord", () => {
  it("finds a count in words, in either language", () => {
    expect(hasNumberWord("Three seats left.")).toBe(true);
    expect(hasNumberWord("Quedan tres lugares.")).toBe(true);
    expect(hasNumberWord("Seats are open.")).toBe(false);
  });

  it("lets a word the given text says through, as often as it says it", () => {
    const given = "Sat 8:00 AM, Two-tank reef: 4 seats open";
    expect(hasNumberWord("The Two-tank reef has 4 seats.", given)).toBe(false);
    expect(hasNumberWord("Two-tank reef, two seats.", given)).toBe(true);
    expect(hasNumberWord("Two-tank reef has three seats.", given)).toBe(true);
  });
});

describe("samePlaceholders", () => {
  it("compares markers as a multiset", () => {
    expect(samePlaceholders("To {depth18} and {depth18}", "Hasta {depth18} y {depth18}")).toBe(
      true,
    );
    expect(samePlaceholders("To {depth18}", "Hasta {depth30}")).toBe(false);
  });
});

describe("boundedText", () => {
  it("drops blank and over-long text", () => {
    expect(boundedText("  hi ", 5)).toBe("hi");
    expect(boundedText("   ", 5)).toBeNull();
    expect(boundedText("toolong", 3)).toBeNull();
  });
});
