import { describe, expect, it } from "vitest";
import { SITE_MARKS, siteMarkFor } from "./site-mark";

describe("siteMarkFor", () => {
  it("reads a reef, a wreck, or nothing from the site's name", () => {
    expect(siteMarkFor({ siteName: "Molasses Reef" })).toBe("reef");
    expect(siteMarkFor({ siteName: "French Reef Ledges" })).toBe("reef");
    expect(siteMarkFor({ siteName: "Benwood Wreck" })).toBe("wreck");
    expect(siteMarkFor({ siteName: "USCGC Duane" })).toBe("wreck");
    expect(siteMarkFor({ siteName: "Spiegel Grove" })).toBe("open");
    expect(siteMarkFor({ siteName: null })).toBe("open");
    expect(siteMarkFor({ siteName: "   " })).toBe("open");
  });

  it("marks a course session as taught whatever the site says", () => {
    expect(siteMarkFor({ siteName: "Molasses Reef", isCourse: true })).toBe("course");
    expect(siteMarkFor({ siteName: null, isCourse: true })).toBe("course");
  });

  it("matches whole words, not fragments", () => {
    // "Shipwreck" has both; "Keystone" and "Rockledge" have neither as a word.
    expect(siteMarkFor({ siteName: "The Shipwreck" })).toBe("wreck");
    expect(siteMarkFor({ siteName: "Keystone Point" })).toBe("open");
  });

  it("only ever answers with a code the drawing set carries", () => {
    for (const name of ["Reef", "wreck", "", "Blue Hole", "Wall"]) {
      expect(SITE_MARKS).toContain(siteMarkFor({ siteName: name }));
    }
  });
});
