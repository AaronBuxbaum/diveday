import { describe, expect, it } from "vitest";
import { staffTranslator } from "./staff-messages";
import { daySpineSummaryText } from "./today-labels";

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

  it("words the quiet day as a heading and one sentence, verbatim", () => {
    expect(t("shopHome.spine.quietHeading")).toBe("A quiet day at the dock.");
    expect(t("shopHome.spine.quietSentence")).toBe(
      "No boats today, and nothing is waiting on you.",
    );
  });

  it("keeps the shaka on the morning all-clear line, and no other emoji near it", () => {
    // The coral budget's one sanctioned word-mark (ADR
    // 20260827-clearwater-surface-language, decision 11): 🤙 stays where it
    // ships, and every other celebration emoji left this surface with the
    // recomposition.
    expect(t("today.todayQueue.boatsClear")).toBe("Today's boats are all clear 🤙");
    // `raw` rather than `t`, so a message carrying a placeholder is scanned as
    // it ships rather than as one rendering of it.
    for (const key of [
      "shopHome.spine.quietHeading",
      "shopHome.spine.quietSentence",
      "shopHome.firstBookable.heading",
      "shopHome.firstBookable.headingSeries",
      "shopHome.demoReset",
      "today.todayQueue.emptyHeading",
    ] as const) {
      expect(t.raw(key), key).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
