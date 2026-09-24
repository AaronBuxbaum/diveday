import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";

/**
 * **The exit band's heading is the owner's question, and the band answers it**
 * (docs/design/brand.md, "The spoken register on /about"; the decision is
 * H-89 in docs/product/human-decisions.md).
 *
 * The band holds the commercial facts a buyer scans for: where a shop's
 * records live, how the plan works, who answers an email, and the export
 * terms. Its heading has failed three ways. "Who you're actually buying from."
 * re-asked the founder band's question two sections down. "What you're
 * standing on." was a metaphor every incumbent could have pasted onto their own
 * site. "Month to month, and the export is one button." fixed both and then
 * read, beside the rest of the page, as the one heading that argued instead of
 * asked: from 2026-09-24 every h2 on `/about` is the shop owner's question,
 * repeated back the way a person repeats a question before answering it, and
 * the paragraphs under it are the answer.
 *
 * The three tests below are the mechanical half of that rule. The heading
 * says the eyebrow's words once; it is written as speech, with no mark at the
 * end (a question mark would make it the rhetorical-question heading
 * docs/design/brand.md lists as a tell, and a full stop would make it a claim);
 * and it names the thing the band is about, which is what stops a metaphor
 * coming back under a question's grammar. Each is arithmetic rather than
 * taste, which is why the same change is safe in Spanish without a second
 * review: the register differs, the redundancy and the overlap do not.
 *
 * Every assertion runs against both locales, the way the `/onboard` door's
 * does: a heading that is one idea in English and two in Spanish is not this
 * design.
 */
const LOCALES = Object.entries(DIVER_MESSAGES);

describe("the /about exit band", () => {
  it.each(LOCALES)("says the eyebrow's words once in %s", (_locale, messages) => {
    const { leaveEyebrow, leaveTitle } = messages.marketing.about;
    expect(leaveEyebrow.trim()).not.toBe("");
    expect(leaveTitle.trim()).not.toBe("");
    // The failure this guards is the obvious edit: paste the band's idea
    // whole and ship an eyebrow and a heading that say it twice, six pixels
    // apart.
    expect(leaveTitle.toLowerCase()).not.toContain(leaveEyebrow.toLowerCase());
  });

  it.each(LOCALES)("is the owner's question, spoken, in %s", (_l, messages) => {
    // One question, no mark at either end. The spoken register repeats the
    // question back rather than asking it, so neither `?` nor `¿` appears, and
    // it does not end like a claim either.
    const { leaveTitle } = messages.marketing.about;
    expect(leaveTitle).not.toMatch(/[?¿]/);
    expect(leaveTitle.trimEnd()).not.toMatch(/[.!]$/);
    // One line, not a paragraph: an h2 at this scale that runs past a dozen
    // words wraps to three lines on a phone and stops reading as a question.
    expect(leaveTitle.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it.each(LOCALES)("no longer carries a retired heading in %s", (_l, messages) => {
    // A ratchet, not a style note. Asserted by value rather than by key,
    // because the key is the one that stayed.
    const retired = [
      "Who you’re actually buying from.",
      "Los registros y las personas detrás del producto.",
      // The metaphor that briefly replaced it, 2026-08-28 — a headline that
      // made no claim over the band carrying the page's strongest ones.
      "What you’re standing on.",
      "En qué te apoyas.",
      // The claim that replaced the metaphor, 2026-08-28 to 2026-09-24 — true,
      // and the one heading on the page that argued instead of asked.
      "Month to month, and the export is one button.",
      "Mes a mes, y la exportación es un botón.",
    ];
    expect(retired).not.toContain(messages.marketing.about.leaveTitle);
  });

  it.each(LOCALES)("names the thing the band is about in %s", (_l, messages) => {
    // The headline test, made mechanical for a question. A rival can paste a
    // metaphor; a question that names the records the band's own sentences
    // then account for is answered right here, month to month, per location,
    // a download you can take at any time. So the rule is overlap: some word
    // of substance in the heading has to appear in the band's own published
    // prose. Both retired metaphors fail it ("standing", "buying" appear
    // nowhere below), and a question about something else entirely would too.
    const about = messages.marketing.about;
    const facts = new Set(
      [
        about.leaveP1,
        about.leaveP2,
        // `leaveP2` renders `{terms}` from the shared export claim, so the
        // words a reader actually sees include it (src/lib/marketing.ts,
        // `fullShopExport.termsKey`).
        messages.marketing.export.terms,
        about.whereLiveValue,
        about.committingValue,
        about.whoAnswersValue,
      ]
        .join(" ")
        .toLowerCase()
        .split(/[^\p{L}]+/u),
    );

    // Five letters, so "what", "if", "my" or a stray connective can't satisfy
    // it.
    const words = about.leaveTitle
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length >= 5);
    expect(words.length).toBeGreaterThan(0);
    expect(words.filter((word) => facts.has(word))).not.toEqual([]);
  });
});
