/**
 * The one piece of sign-up the browser runs, kept away from the parser.
 *
 * `SuggestShopLink` is `"use client"` and calls `suggestShopSlug` on every
 * keystroke. While this lived in `src/lib/onboarding.ts` beside `onboardSchema`,
 * importing it pulled `zod` into `/onboard`'s browser bundle — 375,158 bytes
 * raw, 83.5 KB gzipped — so a shop owner downloaded a schema library to watch a
 * URL appear as they typed their shop's name.
 *
 * `onboarding.ts` re-exports both names, so every server-side call site and the
 * existing tests are unchanged.
 */

/** The slug field's own bound, shared with `suggestShopSlug` so a suggestion
 * can never overflow what `onboardSchema` accepts. */
export const MAX_SHOP_SLUG_LENGTH = 50;

/**
 * The shop link a shop's name implies — "Green Lagoon Divers" →
 * "green-lagoon-divers". Inventing a URL is the one moment in sign-up where a
 * shop owner has to stop and *decide* something; this turns it into watching
 * the link write itself (they can still edit it — a suggestion, never a
 * decision made for them, same posture as `DetectTimezone`).
 *
 * Diacritics fold to their base letter (Café → cafe) via NFKD so a shop named
 * in Spanish or French gets a readable link rather than one with letters
 * silently dropped. Anything else outside `[a-z0-9]` collapses to a single
 * hyphen, and the result always satisfies `onboardSchema`'s slug rule — or is
 * empty, for a name with no usable characters, which callers treat as "no
 * suggestion".
 */
export function suggestShopSlug(shopName: string): string {
  return shopName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SHOP_SLUG_LENGTH)
    .replace(/-+$/, "");
}
