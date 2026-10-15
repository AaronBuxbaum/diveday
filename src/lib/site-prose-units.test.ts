import { describe, expect, it } from "vitest";
import { siteProseInUnit } from "./site-prose-units";

describe("siteProseInUnit", () => {
  it("says a metric measure in feet for a feet shop, rounded to the whole foot", () => {
    expect(siteProseInUnit("A ship's winch on the bottom in about 12 m.", "feet")).toBe(
      "A ship's winch on the bottom in about 39 ft.",
    );
    expect(siteProseInUnit("a 2.6 m bronze statue in about 8 m of water", "feet")).toBe(
      "a 9 ft bronze statue in about 26 ft of water",
    );
    expect(siteProseInUnit("Shallow, in 5–9 m.", "feet")).toBe("Shallow, in 16–30 ft.");
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
