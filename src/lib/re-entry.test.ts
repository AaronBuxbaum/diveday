import { describe, expect, it } from "vitest";
import { isRefresherCourse, parseReEntryAsk, RE_ENTRY_ASKS, reEntryWindowOpen } from "./re-entry";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const hoursOut = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

describe("reEntryWindowOpen", () => {
  it("is open while the shop still has a day to act", () => {
    expect(reEntryWindowOpen(hoursOut(72), NOW)).toBe(true);
    // 24h01m out: there is a day and a minute, so the ask is worth making.
    expect(reEntryWindowOpen(new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 60_000), NOW)).toBe(
      true,
    );
  });

  it("closes inside the last day, at the edge and past it", () => {
    // 23h59m: a deck-side word could still happen, an easy first dive and a
    // refresher course could not, and D18's rule is one window rather than
    // three — offering the two that cannot be answered is the shame the
    // boundary exists to avoid.
    expect(reEntryWindowOpen(new Date(NOW.getTime() + 24 * 60 * 60 * 1000 - 60_000), NOW)).toBe(
      false,
    );
    expect(reEntryWindowOpen(new Date(NOW.getTime() + 24 * 60 * 60 * 1000), NOW)).toBe(false);
    expect(reEntryWindowOpen(hoursOut(2), NOW)).toBe(false);
  });

  it("closes on a departure that has already left", () => {
    expect(reEntryWindowOpen(hoursOut(-1), NOW)).toBe(false);
  });
});

describe("isRefresherCourse", () => {
  it("recognises the three published refreshers a shop can copy", () => {
    expect(isRefresherCourse({ sourceTemplateSlug: "scuba-refresher", isActive: true })).toBe(true);
    expect(
      isRefresherCourse({ sourceTemplateSlug: "ssi-scuba-skills-update", isActive: true }),
    ).toBe(true);
  });

  it("refuses a course the shop has taken off its catalog", () => {
    // An ask about a course nobody can book is a question with no answer.
    expect(isRefresherCourse({ sourceTemplateSlug: "scuba-refresher", isActive: false })).toBe(
      false,
    );
  });

  it("refuses a shop-written course DiveDay cannot recognise", () => {
    // A shop that wrote its own refresher under its own name simply loses the
    // third offer. Guessing from its title would be the invented fact D18's
    // "no invented facts" line rules out.
    expect(isRefresherCourse({ sourceTemplateSlug: null, isActive: true })).toBe(false);
    expect(isRefresherCourse({ sourceTemplateSlug: "open-water-diver", isActive: true })).toBe(
      false,
    );
  });
});

describe("parseReEntryAsk", () => {
  it("takes the three and refuses everything else", () => {
    for (const ask of RE_ENTRY_ASKS) expect(parseReEntryAsk(ask)).toBe(ask);
    for (const junk of ["", "primer", 1, null, undefined]) {
      expect(parseReEntryAsk(junk)).toBeNull();
    }
  });
});
