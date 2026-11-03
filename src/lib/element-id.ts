/**
 * **One departure's element ids, when a document holds several.**
 *
 * The trip manifest and the prep list carry fixed ids (`roll-call-list`,
 * `pre-departure-check-heading`, `tanks-heading`) that every
 * `aria-labelledby`, `aria-describedby` and fragment target inside them points
 * at. The paper day (`/shop/[shopSlug]/print`, N-54) renders both once per
 * departure of today, and duplicate ids do not fail loudly: every reference in
 * departures 2..N resolves to **departure 1's** element, so a screen-reader
 * user on the third boat hears the first boat's heading over the third boat's
 * diver list and `#roll-call-list` jumps to the wrong roster.
 *
 * A surface that repeats one of those blocks passes a prefix and every id
 * inside it goes through here. **No prefix leaves the id unchanged**, which
 * keeps the standalone routes, and the e2e selectors and visual baselines
 * pinned to them, as they were.
 */
export function scopedId(prefix: string | undefined, id: string): string {
  return prefix ? `${prefix}-${id}` : id;
}

/** The same id as a fragment/`href` target. */
export function scopedHash(prefix: string | undefined, id: string): string {
  return `#${scopedId(prefix, id)}`;
}

/**
 * **Where the morning packing list lives on a departure page.**
 *
 * Here rather than beside the component because `src/features/today/today-reader.ts` links at it
 * too, and the dependency direction is one way (`pnpm check:architecture`).
 * Unscoped and shared with Today: the paper day never renders it.
 */
export const PREP_SECTION_ID = "packing-list";

/**
 * **The live manifest's diver row, minted once.** The roll call renders the
 * row and the sticky summary panel links its name chips at it, in two files;
 * one spelling here keeps them agreeing (the offline manifest shipped with two
 * literals that disagreed, so every tap did nothing, #1675).
 *
 * **Unscoped, and safe that way permanently** (`dive-domain-expert` review,
 * issue #1773): a booking belongs to exactly one departure (`bookings.id` is
 * its own key and the row carries `trip_id`), so the paper day cannot produce
 * two diver rows with one id. Crew rows differ, see {@link crewRowId}.
 *
 * `e2e/manifest.spec.ts` pins this fragment in a URL, so the prefix is not
 * free to change.
 */
export function diverRowId(bookingId: string): string {
  return `diver-row-${bookingId}`;
}

/** The same id as a fragment/`href` target. */
export function diverRowHash(bookingId: string): string {
  return `#${diverRowId(bookingId)}`;
}

/**
 * **A crew member's row on the same manifest**, spelled in one place for the
 * same reason as the diver row; a crew member who did not come back outranks a
 * diver who did not (`dive-domain-expert` review, issue #1773).
 *
 * Unlike a diver row this one **must** be scoped: it keys on `people.id`, and a
 * crew member can be rostered on several of one day's departures, so the paper
 * day would otherwise print duplicate ids and send every reference to the
 * first boat's. Callers wrap it in {@link scopedId} or {@link scopedHash}.
 */
export function crewRowId(personId: string): string {
  return `crew-row-${personId}`;
}
