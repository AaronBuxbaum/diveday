import { describe, expect, it } from "vitest";
import {
  isRefresherCourse,
  parseReEntryAsk,
  RE_ENTRY_ASKS,
  reEntryOffersFor,
  reEntryWindowOpen,
} from "./re-entry";

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

/**
 * **The rendered offers and the accepted ones are one list.** Both the
 * readiness page and `saveReEntryAskFromReady` read this, which is the point:
 * the action re-derived only the saved intent and the 24-hour window and took
 * `refresher_course` from anyone who posted it, so a shop with no refresher
 * course could have one asked of it (caught in review of PR #1416).
 */
describe("reEntryOffersFor", () => {
  it("makes all three where the shop publishes a refresher course", () => {
    expect(reEntryOffersFor(true)).toEqual([...RE_ENTRY_ASKS]);
  });

  it("drops the refresher ask where the shop runs no refresher", () => {
    const offers = reEntryOffersFor(false);
    expect(offers).not.toContain("refresher_course");
    // The other two are unconditional: a word on deck and an easy first dive
    // are things any crew can do, and neither names a course.
    expect(offers).toEqual(["deck_word", "easy_first_dive"]);
  });
});
