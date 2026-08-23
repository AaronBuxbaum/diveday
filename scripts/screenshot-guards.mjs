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
