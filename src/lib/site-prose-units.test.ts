import { describe, expect, it } from "vitest";
import { siteProseInUnit } from "./site-prose-units";

describe("siteProseInUnit", () => {
  it("says a standard depth as the agency pair a crew says, never a conversion", () => {
    expect(siteProseInUnit("A ship's winch on the bottom in about 12 m.", "feet")).toBe(
      "A ship's winch on the bottom in about 40 ft.",
    );
    expect(siteProseInUnit("The shallowest point at about 18 m.", "feet")).toBe(
      "The shallowest point at about 60 ft.",
    );
    expect(siteProseInUnit("The sand at about 40 m.", "feet")).toBe("The sand at about 130 ft.");
    expect(siteProseInUnit("Between 21–30 m.", "feet")).toBe("Between 70–100 ft.");
  });

  it("rounds any other depth to the nearest 5 ft", () => {
    expect(siteProseInUnit("Shallow, in 5–9 m.", "feet")).toBe("Shallow, in 15–30 ft.");
    expect(siteProseInUnit("in about 8 m of water", "feet")).toBe("in about 25 ft of water");
    expect(siteProseInUnit("The sand at 44 m.", "feet")).toBe("The sand at 145 ft.");
  });

  it("rounds a length to the nearest 10 ft", () => {
    expect(siteProseInUnit("A 155 m Navy landing ship.", "feet")).toBe(
      "A 510 ft Navy landing ship.",
    );
    expect(siteProseInUnit("more than 120 m long", "feet")).toBe("more than 390 ft long");
    expect(siteProseInUnit("A 159 m missile-tracking ship.", "feet")).toBe(
      "A 520 ft missile-tracking ship.",
    );
  });

  it("keeps a small measure to the whole foot", () => {
    expect(siteProseInUnit("a 2.6 m bronze statue", "feet")).toBe("a 9 ft bronze statue");
  });

  it("takes the authored half of a pair rather than converting it", () => {
    expect(siteProseInUnit("18–40 m (60–130 ft)", "feet")).toBe("60–130 ft");
    expect(siteProseInUnit("18–40 m (60–130 ft)", "meters")).toBe("18–40 m");
  });

  it("says an imperial measure in metres for a metres shop", () => {
    expect(siteProseInUnit("The deck at 80 ft.", "meters")).toBe("The deck at 24 m.");
  });

  it("leaves everything that is not a number and its symbol alone", () => {
    const prose = "A 10 min swim at 3 mph from the mooring; the M/V Wreck is 4 miles out.";
    expect(siteProseInUnit(prose, "feet")).toBe(prose);
    expect(siteProseInUnit("Already 25 ft.", "feet")).toBe("Already 25 ft.");
    expect(siteProseInUnit("Already 12 m.", "meters")).toBe("Already 12 m.");
  });
});
