import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";

/**
 * **The door's reassurance is one sentence** (ADR 20260827-first-light,
 * decision 1; the sentence itself is the day-15 answer from
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

describe("the /onboard price note", () => {
  it.each(LOCALES)("states the fee only as parameters in %s", (_locale, messages) => {
    // The price line (Aaron, 2026-11-24): free, no card, and a percent only of
    // payments taken in DiveDay. Its figures come from the pricing
    // configuration (ADR 20261124-free-shops-no-trial), so the bundle holds
    // `{percent}` and `{base}`, never a figure; rendering it for several
    // configurations, one sentence each, is `../(marketing)/pricing/price-note.test.ts`.
    const note = messages.account.onboard.priceNote;
    expect(note).toContain("{percent}");
    expect(note).toContain("{base}");
    expect(note).not.toMatch(/\d\s?%|\$\d/);
    expect(note).not.toMatch(/\b2\b|weeks?\b|semanas?\b|trial|prueba|plan/i);
  });

  it.each(LOCALES)("carries no retired reassurance keys in %s", (_locale, messages) => {
    const onboard = messages.account.onboard as Record<string, unknown>;
    // The three claims and the old first clause, deleted at the call site and
    // in both bundles in the same change — never left behind for a later
    // surface to quietly re-list.
    expect(onboard).not.toHaveProperty("reassurance");
    expect(onboard).not.toHaveProperty("trialMeaning");
    expect(onboard).not.toHaveProperty("trialNote");
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
