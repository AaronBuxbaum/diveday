/**
 * **What counts as "the page is not on screen yet".**
 *
 * Its own module so it can be tested without launching a browser:
 * `scripts/screenshot.mjs` runs Playwright at import time, so a test that
 * imported it would start Chromium to assert a string.
 */

/**
 * A skeleton still standing where the page's body belongs.
 *
 * **Both shapes, because `main .animate-pulse` cannot match `<main
 * class="animate-pulse">`.** That descendant combinator made the guard a no-op
 * on every marketing and legal page: six `loading.tsx` files put the class on
 * the `<main>` element itself — pricing, product, about, privacy, terms and
 * switching/spreadsheet — so the wait resolved on the first tick and the
 * shutter fired on a page of grey bars, exit code 0 (issue #783).
 *
 * The marketing idiom is not wrong: the whole body pulses as one there, where
 * the staff idiom wraps a `div` inside `<main>`. Neither change knew about the
 * other, and a *successful* run never pointed at it. So the guard covers both
 * rather than the six pages being rewritten to match the guard — that would fix
 * today's instance and leave the next one just as invisible.
 *
 * `animate-pulse` is not only a skeleton, which is the other trap: `RecapMap`'s
 * marker and `RollCallNote`'s save-status dot pulse for as long as they are on
 * screen, so a bare wait can never be satisfied on those pages. Both carry
 * `data-live-pulse`, and both halves of this exclude it.
 */
export const SKELETON_SELECTOR =
  "main.animate-pulse:not([data-live-pulse]), main .animate-pulse:not([data-live-pulse])";

/**
 * How little text in `<main>` means "this is a skeleton, whatever it wears".
 *
 * The class rule above is a convention, and a convention is the thing a new
 * route forgets — six `loading.tsx` files carry no `animate-pulse` at all (the
 * whole account-lifecycle flow), so for those the wait is satisfied instantly
 * whatever is on screen.
 *
 * So this asks what a skeleton *is* instead. Real pages have prose; a page of
 * grey bars has none. The bar is deliberately low: the job is to catch an empty
 * frame, not to grade a page's content, and a legitimately terse `<main>`
 * should not fail a screenshot.
 */
export const MIN_MAIN_TEXT = 40;

/**
 * **The offline manifest reads its page from this browser's own storage**
 * (issue #2235). `/offline-manifest` renders from an encrypted IndexedDB copy,
 * and until it has read the store it shows "Opening the manifest saved on this
 * device…", which passes every rule above. The page sets this marker on the
 * document once the store has been read; a capture waits for it.
 */
export const OFFLINE_SETTLED_SELECTOR = "html[data-offline-settled]";

/** The staff manifest's own line once it has saved this phone's copy. */
export const OFFLINE_COPY_SAVED = /(Fresh|Aging|Stale) copy/;

/** The demo shop the dev logins belong to (src/db/dev-credentials.ts). */
export const DEMO_SHOP_SLUG = "blue-mantis";

/**
 * What capturing one path needs before the shot, for the offline manifest; `null`
 * for every other path, which keeps them flag-free. A fresh browser context
 * holds no saved copy, so `?trip=<id>` first opens that trip's staff manifest,
 * which saves one the same way it does on a crew phone, and the capture then
 * shows the roll call rather than "Nothing saved on this phone yet".
 */
export function offlineManifestPlan(target, shopSlug = DEMO_SHOP_SLUG) {
  const url = new URL(target, "http://localhost");
  if (url.pathname !== "/offline-manifest") return null;
  const trip = url.searchParams.get("trip");
  return {
    seedPath: trip ? `/shop/${shopSlug}/trips/${encodeURIComponent(trip)}/manifest` : null,
  };
}
