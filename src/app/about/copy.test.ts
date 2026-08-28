import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";

/**
 * **A band's heading states one of the facts the band publishes**, and says the
 * eyebrow's words once (slice 12f of docs/product/marketing-review-20260827.md,
 * plus its review pass).
 *
 * The "From day one" band holds the commercial facts a buyer scans for: where
 * a shop's records live, how the plan works, who answers an email, and the
 * export terms. Its heading read "Who you're actually buying from." — the
 * founder band's question, answered two sections higher — so a reader skimming
 * the h2s was told the page repeated itself, and given no reason to stop at the
 * one band holding the terms.
 *
 * Slice 12f replaced it with "What you're standing on." and traded one failure
 * for the other: the sentence claims nothing, and docs/product/marketing.md's
 * headline test — could a rival paste this onto their site truthfully? — is
 * stated to bind `/about` hardest, because a trust page's headings are the only
 * part of it a skimmer reads. Every incumbent could have pasted that one. So
 * the heading now states two facts this page can be checked on — the plan terms
 * printed directly beneath it, and the one-button export the rules band dares
 * the reader to go and try — and the tests below are the two halves of the
 * rule: the heading carries a clause the band's own sentences carry, and it
 * does not carry the eyebrow's words back.
 *
 * Both halves are arithmetic rather than taste, which is why the change is safe
 * to make in Spanish without a second review — the register differs, the
 * redundancy and the overlap do not.
 *
 * Every assertion runs against both locales, the way the `/onboard` door's
 * does: a heading that is one idea in English and two in Spanish is not this
 * design.
 */
const LOCALES = Object.entries(DIVER_MESSAGES);

describe("the /about 'from day one' band", () => {
  it.each(LOCALES)("says the eyebrow's words once in %s", (_locale, messages) => {
    const { leaveEyebrow, leaveTitle } = messages.marketing.about;
    expect(leaveEyebrow.trim()).not.toBe("");
    expect(leaveTitle.trim()).not.toBe("");
    // The failure this guards is the obvious edit: paste the review's sentence
    // whole and ship a band that says "from day one" twice, six pixels apart.
    expect(leaveTitle.toLowerCase()).not.toContain(leaveEyebrow.toLowerCase());
  });

  it.each(LOCALES)("still leads with a heading, not a fragment, in %s", (_l, messages) => {
    // One sentence, terminated — an h2 at this scale is the largest type in the
    // band and reads as a claim, so it has to end like one.
    const { leaveTitle } = messages.marketing.about;
    expect(leaveTitle.match(/[.!?]/g)).toHaveLength(1);
    expect(leaveTitle.trimEnd().endsWith(".")).toBe(true);
  });

  it.each(LOCALES)("no longer asks the founder band's question in %s", (_l, messages) => {
    // A ratchet, not a style note: both retired headings described *us* over a
    // band that describes the shop's own position, and each shipped as a
    // sentence someone thought was on-topic. Asserted by value rather than by
    // key, because the key is the one that stayed.
    const retired = [
      "Who you're actually buying from.",
      "Los registros y las personas detrás del producto.",
      // And the metaphor that briefly replaced it, 2026-08-28 — a headline
      // that made no claim over the band carrying the page's strongest ones.
      "What you're standing on.",
      "En qué te apoyas.",
    ];
    expect(retired).not.toContain(messages.marketing.about.leaveTitle);
  });

  it.each(LOCALES)("says one of the facts the band publishes in %s", (_l, messages) => {
    // The headline test, made mechanical. A rival can paste a metaphor; a
    // rival cannot paste "Month to month, and the export is one button."
    // truthfully, because the sentences printed directly beneath this heading
    // are what make it checkable — month to month, per location, no annual
    // contract; a download you can take at any time, with no fee, no ticket
    // and no minimum stay. So the rule is overlap: some clause has to appear
    // in the band's own published prose. A heading that shares nothing with
    // the band is either a claim the band cannot support or, as both retired
    // ones were, a sentence about something else entirely.
    const about = messages.marketing.about;
    const facts = [
      about.leaveP1,
      about.leaveP2,
      // `leaveP2` renders `{terms}` from the shared export claim, so the words
      // a reader actually sees include it (src/lib/marketing.ts,
      // `fullShopExport.termsKey`).
      messages.marketing.export.terms,
      about.whereLiveValue,
      about.committingValue,
      about.whoAnswersValue,
    ]
      .join(" ")
      .toLowerCase();

    // Eight characters, so "and", "y" or a stray connective can't satisfy it.
    const clauses = about.leaveTitle
      .toLowerCase()
      .split(/[,.;:—]/)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length >= 8);
    expect(clauses.length).toBeGreaterThan(0);
    expect(clauses.filter((clause) => facts.includes(clause))).not.toEqual([]);
  });
});
