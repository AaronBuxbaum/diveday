import { describe, expect, it } from "vitest";
import { observedWords, type SiteHistoryRecord, siteHistoryOf } from "./site-history";

const record = (iso: string, actualSiteName: string): SiteHistoryRecord => ({
  divedAt: new Date(iso),
  recordedByName: "Sal Moretti",
  visibility: "40 ft",
  current: "light, to the north",
  actualSiteName,
});

describe("siteHistoryOf", () => {
  it("says nothing for a site never dived", () => {
    expect(siteHistoryOf({ dived: null, movedAway: null })).toBeNull();
  });

  it("reads the last dive on the site", () => {
    expect(
      siteHistoryOf({ dived: record("2026-10-12T12:00:00Z", "Molasses"), movedAway: null }),
    ).toMatchObject({ kind: "dived", actualSiteName: "Molasses", visibility: "40 ft" });
  });

  it("says the boat moved when the newest planned visit went elsewhere", () => {
    expect(
      siteHistoryOf({
        dived: record("2026-10-10T12:00:00Z", "Molasses"),
        movedAway: record("2026-10-12T12:00:00Z", "French Reef"),
      }),
    ).toMatchObject({ kind: "moved", actualSiteName: "French Reef" });
  });

  it("keeps the dive when it is newer than the move, or on the same instant", () => {
    const sameDay = "2026-10-12T12:00:00Z";
    expect(
      siteHistoryOf({
        dived: record(sameDay, "Molasses"),
        movedAway: record(sameDay, "French Reef"),
      })?.kind,
    ).toBe("dived");
    expect(
      siteHistoryOf({
        dived: record("2026-10-13T12:00:00Z", "Molasses"),
        movedAway: record("2026-10-12T12:00:00Z", "French Reef"),
      })?.kind,
    ).toBe("dived");
  });
});

describe("observedWords", () => {
  it("keeps the crew's words and drops blanks and non-text", () => {
    expect(observedWords("  40 ft ")).toBe("40 ft");
    expect(observedWords("   ")).toBeNull();
    expect(observedWords(40)).toBeNull();
    expect(observedWords(null)).toBeNull();
  });
});
