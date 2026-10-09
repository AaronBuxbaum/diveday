import { describe, expect, it } from "vitest";
import { staffTranslator } from "./staff-messages";
import {
  crewClashDetailText,
  crewClashSailedDetailText,
  daySpineSummaryText,
  rollCallGapDetailText,
} from "./today-labels";

/**
 * **The two sentences the shop home is required to say, word for word.**
 *
 * Slice 6c of ADR 20260827-clearwater-surface-language ships three lines whose
 * exact wording the canvas SPEC pins rather than merely describes: the summary
 * sentence above the first station, and the quiet day's heading-and-sentence
 * pair. They are pinned because each one is load-bearing in a way a synonym
 * quietly breaks.
 *
 * The summary names four things in one breath — how many boats today, how many
 * things are still open, *which* departure the count is about, and that the
 * count expires when that boat leaves. Reword any one of them and the sentence
 * still reads fine while meaning something else: "2 things need you today"
 * drops the deadline, and "before the 7:00" drops what happens at it.
 *
 * The quiet-day pair is the whole-page-empty state (principles.md), and its
 * second half is the promise the desk group exists to keep honest — see
 * `spineIsQuiet` in `src/lib/today.ts`.
 *
 * Plural agreement in both locales is `count-agreement.test.ts`'s job; this
 * file asks only whether the English still says what it was written to say.
 */
describe("the shop home's pinned sentences", () => {
  const t = staffTranslator("en-US");

  it("names the boats, the open things, the next departure and the dock", () => {
    expect(daySpineSummaryText(t, { boats: 3, jobs: 2, nextDepartureTime: "7:00 AM" })).toBe(
      "3 boats today. 2 things need you before the 7:00 AM leaves the dock.",
    );
  });

  it("names the divers blocked today, the same figure the Today badge carries", () => {
    expect(
      daySpineSummaryText(t, { boats: 2, blocked: 4, jobs: 3, nextDepartureTime: "5:30 AM" }),
    ).toBe(
      "2 boats today, 4 people blocked. 3 things need you before the 5:30 AM leaves the dock.",
    );
    expect(daySpineSummaryText(t, { boats: 1, blocked: 1, jobs: 1, nextDepartureTime: null })).toBe(
      "1 boat today, 1 person blocked. 1 thing still needs you.",
    );
  });

  it("names tomorrow's blocked divers once today's boats are all away, as the badge counts them", () => {
    expect(
      daySpineSummaryText(t, { boats: 3, blockedTomorrow: 2, jobs: 0, nextDepartureTime: null }),
    ).toBe("3 boats today, 2 people blocked for tomorrow. Nothing is waiting on you.");
    expect(
      daySpineSummaryText(t, {
        boats: 3,
        blocked: 1,
        blockedTomorrow: 2,
        jobs: 1,
        nextDepartureTime: null,
      }),
    ).toBe("3 boats today, 1 person blocked aboard and 2 for tomorrow. 1 thing still needs you.");
  });

  it("keeps the deadline half even when nothing is open before that boat", () => {
    expect(daySpineSummaryText(t, { boats: 1, jobs: 0, nextDepartureTime: "7:00 AM" })).toBe(
      "1 boat today. Nothing needs you before the 7:00 AM leaves the dock.",
    );
  });

  it("stops naming a departure once every boat has gone", () => {
    // Past the last departure there is no "before" left to be before, so the
    // count switches to what is open across the day rather than inventing a
    // deadline that has passed.
    expect(daySpineSummaryText(t, { boats: 2, jobs: 1, nextDepartureTime: null })).toBe(
      "2 boats today. 1 thing still needs you.",
    );
    expect(daySpineSummaryText(t, { boats: 2, jobs: 0, nextDepartureTime: null })).toBe(
      "2 boats today. Nothing is waiting on you.",
    );
  });

  it("says nothing at all on a day with no boats — the quiet day owns that page", () => {
    expect(daySpineSummaryText(t, { boats: 0, jobs: 0, nextDepartureTime: null })).toBeNull();
    expect(daySpineSummaryText(t, { boats: 0, jobs: 3, nextDepartureTime: null })).toBeNull();
  });

  it("words the quiet day as one sentence, verbatim", () => {
    // One sentence, not a heading over it: under Tide the sky already names
    // the day, so "A quiet day at the dock." was mood captioning its own
    // picture and left with slice 23a.
    expect(t("shopHome.spine.quietSentence")).toBe(
      "No boats today, and nothing is waiting on you.",
    );
  });

  it("carries no emoji on the shop home's lines", () => {
    // Aaron, 2026-10-03: the shaka on the morning all-clear and on a new
    // departure's confirmation read as cute rather than useful, and went with
    // the turtle beside the all-clear.
    for (const key of [
      "shopHome.spine.quietSentence",
      "shopHome.firstBookable.heading",
      "shopHome.firstBookable.headingSeries",
      "shopHome.demoReset",
      "today.todayQueue.emptyHeading",
      "today.todayQueue.boatsClear",
      "shopHome.createdNotice.single",
      "shopHome.createdNotice.series",
    ] as const) {
      expect(t.raw(key), key).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("a crew clash, said once per other departure", () => {
  const t = staffTranslator("en-US");
  const clashes = [
    { fullName: "Keiko Tanaka", otherTitle: "Dawn Two-Tank" },
    { fullName: "Sal Moretti", otherTitle: "Dawn Two-Tank" },
    { fullName: "Keiko Tanaka", otherTitle: "Night Dive" },
  ];

  it("names everyone a departure shares in one sentence", () => {
    expect(crewClashDetailText(t, "en-US", clashes)).toBe(
      "Keiko Tanaka and Sal Moretti are also rostered on Dawn Two-Tank at these hours. Keiko Tanaka is also rostered on Night Dive at these hours.",
    );
  });

  it("says the same once the boat has left, then the one thing to do", () => {
    expect(crewClashSailedDetailText(t, "en-US", clashes.slice(0, 2))).toBe(
      "Keiko Tanaka and Sal Moretti are out aboard while also rostered on Dawn Two-Tank at these hours. Confirm who is aboard.",
    );
  });

  it("names a person once however many times the read lists them", () => {
    const [first] = clashes;
    if (!first) throw new Error("the fixture lists a clash");
    expect(crewClashDetailText(t, "en-US", [first, first])).toBe(
      "Keiko Tanaka is also rostered on Dawn Two-Tank at these hours.",
    );
  });
});

/**
 * **The missing-person row says the recaps are held** (domain review of
 * #2123). The recap waits while the word stands, and the staffer who sees the
 * row is the one who has to know that is why no "welcome back" went out.
 */
describe("a missing-person row", () => {
  const gap = { diveNumber: 2, uncounted: 1, total: 6, underway: false };
  it.each([
    ["missing_diver", false],
    ["missing_diver", true],
    ["missing_crew", false],
    ["missing_crew", true],
  ] as const)("%s (stale: %s) says the recaps are held", (reason, stale) => {
    for (const locale of ["en-US", "es-ES"] as const) {
      const text = rollCallGapDetailText(staffTranslator(locale), { ...gap, reason, stale });
      expect(text).toContain(
        locale === "en-US"
          ? "Recaps are held until the roll call is corrected."
          : "Los resúmenes quedan retenidos hasta que se corrija el pase de lista.",
      );
    }
  });
});
