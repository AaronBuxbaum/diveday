import { describe, expect, it } from "vitest";
import { waiverLinkText } from "./waiver-text";

const base = { locale: "en-US", shopName: "Reef Divers", completionUrl: "https://x.test/w/abc" };

describe("waiverLinkText", () => {
  it("names the departure and carries the link when there is a trip", () => {
    const text = waiverLinkText({ ...base, tripTitle: "Morning two-tank" });
    expect(text).toContain("Morning two-tank");
    expect(text).toContain(base.completionUrl);
  });

  it("still carries the link with no trip", () => {
    const text = waiverLinkText(base);
    expect(text).toContain("Reef Divers");
    expect(text).toContain(base.completionUrl);
  });

  it("uses the course-forms words only when there is also a trip", () => {
    const course = waiverLinkText({ ...base, tripTitle: "Open Water", courseForms: true });
    expect(course).not.toBe(waiverLinkText({ ...base, tripTitle: "Open Water" }));
    expect(course).toContain(base.completionUrl);
    expect(waiverLinkText({ ...base, courseForms: true })).toBe(waiverLinkText(base));
  });

  it("words the text in the diver's language and falls back on an unknown one", () => {
    expect(waiverLinkText({ ...base, locale: "es-ES" })).not.toBe(waiverLinkText(base));
    expect(waiverLinkText({ ...base, locale: null })).toBe(waiverLinkText(base));
  });
});
