/**
 * **One departure's element ids, when a document holds several.**
 *
 * The trip manifest and the prep list each carry fixed ids —
 * `roll-call-list`, `pre-departure-check-heading`, `tanks-heading` — and every
 * `aria-labelledby`, `aria-describedby` and fragment target inside them points
 * at one. That is correct on their own routes, where exactly one departure is
 * on the page.
 *
 * The paper day (`/shop/[shopSlug]/print`, N-54) renders both once per
 * departure of today, and duplicate ids do not fail loudly: every reference in
 * departures 2..N silently resolves to **departure 1's** element. On the two
 * sections that say whether a boat is safe to leave, that means a divemaster
 * running roll call on the third boat hears the first boat's heading read over
 * the third boat's diver list, and `#roll-call-list` jumps them to a different
 * departure's roster without saying so. A sighted reader has the page in their
 * hand to disambiguate; a screen-reader user has nothing.
 *
 * So a surface that repeats one of those blocks passes a prefix, and every id
 * inside it goes through here. **No prefix means the id is unchanged**, which
 * is what keeps the standalone routes — and the e2e selectors and visual
 * baselines pinned to them — exactly as they were.
 */
export function scopedId(prefix: string | undefined, id: string): string {
  return prefix ? `${prefix}-${id}` : id;
}

/** The same id as a fragment/`href` target. */
export function scopedHash(prefix: string | undefined, id: string): string {
  return `#${scopedId(prefix, id)}`;
}
