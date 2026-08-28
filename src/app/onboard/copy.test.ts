import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";

/**
 * **The door's reassurance is one sentence** (ADR 20260827-first-light,
 * decision 1; the sentence itself is the day-22 answer from
 * docs/product/marketing-review-20260827.md).
 *
 * The line under the primary used to be four strings joined with a space —
 * "Free for 3 weeks." plus no-card, your-records and real-support — which
 * reads as a vendor listing its virtues at the moment a buyer is deciding
 * whether to type a password. This file is the ratchet that keeps it from
 * growing back: the count is asserted, and the three retired keys are asserted
 * *gone* rather than merely unused, because an unused key is an invitation.
 *
 * Every assertion runs against both locales. A sentence that is one sentence
 * in English and three in Spanish is not this design.
 */
const LOCALES = Object.entries(DIVER_MESSAGES);

describe("the /onboard trial note", () => {
  it.each(LOCALES)("is exactly one sentence in %s", (_locale, messages) => {
    const note = messages.account.onboard.trialNote;
    expect(note.trim()).not.toBe("");
    // One terminator, and it is the last character — which is the difference
    // between one sentence and several joined into a paragraph. An em dash is
    // deliberately not a terminator: the English and the Spanish both use one
    // to hang the day-22 clause off the first half, and that is still one
    // sentence.
    expect(note.match(/[.!?]/g)).toHaveLength(1);
    expect(note.trimEnd().endsWith(".")).toBe(true);
  });

  it.each(LOCALES)("answers day 22 rather than stopping at the window in %s", (_l, messages) => {
    // The half the review found missing: "free for 3 weeks" with no word about
    // what happens on the 22nd day reads, to a burned buyer, as a card wall.
    // Soft expiry is real (src/lib/trial.ts switches nothing off), so the door
    // is allowed to say it.
    expect(messages.account.onboard.trialNote).toMatch(/3/);
    expect(messages.account.onboard.trialNote.length).toBeGreaterThan(40);
  });

  it.each(LOCALES)("carries no retired reassurance keys in %s", (_locale, messages) => {
    const onboard = messages.account.onboard as Record<string, unknown>;
    // The three claims and the old first clause, deleted at the call site and
    // in both bundles in the same change — never left behind for a later
    // surface to quietly re-list.
    expect(onboard).not.toHaveProperty("reassurance");
    expect(onboard).not.toHaveProperty("trialMeaning");
  });

  it.each(LOCALES)("says where the schedule will live, in %s", (_locale, messages) => {
    // The shop-link field's description is now the address itself, not a
    // sentence about what the field is for; `SuggestShopLink` supplies the
    // slug. The lead has to end where the URL begins — no trailing colon, no
    // period — or the line reads as two fragments.
    const lead = messages.account.onboard.shopLinkUrlHint;
    expect(lead.trim()).toBe(lead);
    expect(lead).not.toMatch(/[.:]$/);
    expect(messages.account.onboard as Record<string, unknown>).not.toHaveProperty("shopLinkHint");
  });
});
