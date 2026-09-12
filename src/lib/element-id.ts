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

/**
 * **The live manifest's diver row, minted once.** Its roll call renders the
 * row and its sticky summary panel links two lists of name chips at it, in two
 * files — three bare template literals until this existed, agreeing only
 * because nobody had edited one of them.
 *
 * That is the shape of the bug #1675 shipped on the offline manifest: the face
 * grid built `diver-row-<bookingId>` while the rows it jumped to answered to
 * `offline-roll-call-<bookingId>`, two literals one screen apart, on the
 * surface a crew member reads at the rail with no signal. Every tap did
 * nothing, silently. What made it shippable is that the tests could not catch
 * it — each side hard-coded its own string, so both suites stayed green with
 * the halves disagreeing.
 *
 * **Unscoped, and safe that way permanently** — which is not true of the crew
 * rows beside them, and the difference is in the key rather than in anyone's
 * preference (`dive-domain-expert` review, issue #1773). A booking belongs to
 * exactly one departure by construction: `bookings.id` is its own primary key
 * and the row carries `trip_id` (`src/db/schema.ts`). So the paper day, which
 * renders this block once per departure of today, cannot produce two diver
 * rows with one id however many boats it prints. A crew member can be rostered
 * on several of those departures and their row keys on `people.id`, which is
 * exactly why the crew half takes `idPrefix` and this half does not.
 *
 * `e2e/manifest.spec.ts` also pins this fragment in a URL, so the prefix
 * itself is not free to change.
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
 * same reason the diver row is: it was three bare literals across two files —
 * the roll call's `<li>` and both of the summary panel's chip lists — and the
 * half the glossary ranks graver, since a divemaster who did not come back
 * outranks a diver who did not (`dive-domain-expert` review, issue #1773).
 *
 * Unlike a diver row this one **must** be scoped: a crew member can be
 * rostered on several of one day's departures and this id keys on `people.id`,
 * so the paper day would otherwise print two rows answering to the same name
 * and send every reference to the first boat's. Callers wrap it in
 * {@link scopedId} or {@link scopedHash}, which is where that prefix lives.
 */
export function crewRowId(personId: string): string {
  return `crew-row-${personId}`;
}
