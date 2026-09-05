import { and, desc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import type { AppDb } from "./client";
import { bookings, people, recapPulseCategory, recapPulses, trips } from "./schema";

/**
 * **The private pulse** — delight report D40 (issue #1200), slice 16i of ADR
 * 20260904-reef-all-the-way-down.
 *
 * The recap asks a diver for a review, and a review is public. So the diver
 * whose regulator was free-flowing has one door and it is the wrong one: they
 * either say nothing or say it in front of everybody, and either way the shop
 * does not learn the thing it could have fixed. This is the second door, and
 * what makes it work is that it is *narrow* — five categories and an optional
 * note, so a shop reads a list of things to fix rather than a paragraph.
 *
 * Three rules hold it apart from the review beside it:
 *
 * - **It is never public.** Nothing here is read by `listPublishedShopReviews`,
 *   the JSON-LD aggregate, or `countSuppressedReviews`; a pulse is not a review
 *   and does not move the shop's rating in either direction.
 * - **Whose it is comes from the booking.** `submitRecapPulse` takes a booking
 *   id and derives shop, trip and person from that row, so a crafted form
 *   cannot file a pulse against somebody else's day (the rule
 *   `submitTripReview` already keeps).
 * - **There is a way back.** Clearing every category withdraws it, which stamps
 *   `deleted_at` (ADR 20260820-every-delete-is-soft) and frees the partial
 *   unique index so the diver may write a new one.
 *
 * Codes out, never sentences: `src/i18n/next-dive-labels.ts` and
 * `staff/reviews.json` pick the words (ADR 20260731-domain-layer-copy-leaks).
 */

/**
 * How much of their own words one pulse carries. Two sentences, the length of
 * the thing a person types on a phone standing in a car park — long enough for
 * "the BCD inflator stuck twice", short enough that nobody writes an essay
 * nobody reads. Enforced server-side, because the textarea's `maxLength` is a
 * courtesy to the person typing and not a bound on what arrives.
 */
export const MAX_RECAP_PULSE_NOTE_LENGTH = 280;

export type RecapPulseCategory = (typeof recapPulseCategory.enumValues)[number];

/** Every category, in the order the form offers them and the panel words them. */
export const RECAP_PULSE_CATEGORIES = recapPulseCategory.enumValues;

/** What one diver said, for the form to open on. */
export type OwnRecapPulse = {
  categories: RecapPulseCategory[];
  note: string | null;
};

/** One open item on the shop's panel. */
export type OpenRecapPulse = {
  id: string;
  categories: RecapPulseCategory[];
  note: string | null;
  createdAt: Date;
  diverName: string;
  personId: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
};

export type SubmitRecapPulseResult =
  | { ok: true; withdrawn: boolean }
  | { ok: false; reason: "not_found" | "did_not_dive" | "empty" };

/** A posted list narrowed to real category codes, deduped, order preserved. */
export function parseRecapPulseCategories(values: readonly unknown[]): RecapPulseCategory[] {
  const seen = new Set<RecapPulseCategory>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    if (!RECAP_PULSE_CATEGORIES.includes(value as RecapPulseCategory)) continue;
    seen.add(value as RecapPulseCategory);
  }
  return RECAP_PULSE_CATEGORIES.filter((category) => seen.has(category));
}

/** The note as it is stored: trimmed, capped, and null rather than empty. */
function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? "").trim().slice(0, MAX_RECAP_PULSE_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * File, revise, or withdraw one booking's pulse.
 *
 * An **empty category list is a withdrawal**, not a refusal — it is the only
 * gesture the form offers for taking it back, and the check constraint refuses
 * to store a live row with nothing in it either way. Withdrawing when there is
 * nothing to withdraw is `empty`, because a diver who tapped Send having chosen
 * nothing meant to say something.
 */
export async function submitRecapPulse(
  db: AppDb,
  input: {
    bookingId: string;
    categories: readonly RecapPulseCategory[];
    note?: string | null;
  },
): Promise<SubmitRecapPulseResult> {
  if (!isUuid(input.bookingId)) return { ok: false, reason: "not_found" };
  const categories = parseRecapPulseCategories(input.categories);
  const note = normalizeNote(input.note);
  const now = nowDate();

  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        shopId: bookings.shopId,
        tripId: bookings.tripId,
        personId: bookings.personId,
        status: bookings.status,
      })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) return { ok: false, reason: "not_found" };
    // Neither was on the boat, so neither has a day to say anything about —
    // the same fail-closed answer the review and the photo upload give.
    if (booking.status === "cancelled" || booking.status === "no_show") {
      return { ok: false, reason: "did_not_dive" };
    }

    const [live] = await tx
      .select({ id: recapPulses.id })
      .from(recapPulses)
      .where(and(eq(recapPulses.bookingId, input.bookingId), isNull(recapPulses.deletedAt)))
      .limit(1);

    if (categories.length === 0) {
      if (!live) return { ok: false, reason: "empty" };
      await tx
        .update(recapPulses)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(recapPulses.id, live.id));
      return { ok: true, withdrawn: true };
    }

    // An upsert on the partial unique index rather than a read-then-write, so
    // two submits racing from one phone converge on one row instead of one of
    // them surfacing a constraint error. Revising also clears `addressed_at`:
    // the shop marked the *old* words dealt with, and these are new ones.
    await tx
      .insert(recapPulses)
      .values({
        shopId: booking.shopId,
        bookingId: input.bookingId,
        tripId: booking.tripId,
        personId: booking.personId,
        categories: [...categories],
        note,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: recapPulses.bookingId,
        targetWhere: isNull(recapPulses.deletedAt),
        set: {
          categories: [...categories],
          note,
          addressedAt: null,
          addressedByPersonId: null,
          updatedAt: now,
        },
      });
    return { ok: true, withdrawn: false };
  });
}

/** The diver's own live pulse, so the recap's form opens on what they already said. */
export async function getRecapPulseForBooking(
  db: AppDb,
  bookingId: string,
): Promise<OwnRecapPulse | null> {
  if (!isUuid(bookingId)) return null;
  const [row] = await db
    .select({ categories: recapPulses.categories, note: recapPulses.note })
    .from(recapPulses)
    .where(and(eq(recapPulses.bookingId, bookingId), isNull(recapPulses.deletedAt)))
    .limit(1);
  // Re-narrowed on the way out, not trusted on the way in. `categories` is
  // jsonb and drizzle's `$type<>` is a compile-time assertion only — the check
  // constraint guards the array's *length*, never its membership. Every writer
  // parses today, so nothing off-enum can be in there; parsing here is what
  // makes that structural rather than a property of the current writers, and
  // it is the difference between a surface rendering one fewer chip and
  // `t(undefined)` reaching a reader.
  return row ? { categories: parseRecapPulseCategories(row.categories), note: row.note } : null;
}

/**
 * What this shop has been asked to fix and has not yet marked dealt with —
 * newest first, which is the `recap_pulses_shop_open_idx` query verbatim.
 *
 * Bounded rather than paged: the panel renders nothing when this is empty and a
 * short list when it is not, and a shop with more open items than fit on one
 * screen has a different problem than pagination.
 */
export async function listOpenRecapPulses(
  db: AppDb,
  shopId: string,
  options: { limit?: number } = {},
): Promise<OpenRecapPulse[]> {
  const rows = await db
    .select({
      id: recapPulses.id,
      categories: recapPulses.categories,
      note: recapPulses.note,
      createdAt: recapPulses.createdAt,
      personId: recapPulses.personId,
      diverName: people.fullName,
      tripId: recapPulses.tripId,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(recapPulses)
    // The tenant condition stated in the query rather than three files away:
    // `recapPulses.personId` is copied off an already-shop-scoped booking, so
    // this is unreachable today, but the invariant lives in `bookings.ts` and
    // the join is what a reader looks at.
    .innerJoin(people, and(eq(people.id, recapPulses.personId), eq(people.shopId, shopId)))
    // diveday:allow-deleted-trips: a pulse about a departure the shop later took
    // off the board is still a thing the shop was asked to fix, and dropping it
    // here would silently empty the panel rather than answer it.
    .innerJoin(trips, eq(trips.id, recapPulses.tripId))
    .where(
      and(
        eq(recapPulses.shopId, shopId),
        isNull(recapPulses.addressedAt),
        isNull(recapPulses.deletedAt),
      ),
    )
    .orderBy(desc(recapPulses.createdAt))
    .limit(options.limit ?? 20);
  // Same re-narrowing as the reader above, for the same reason: this list is
  // what the staff panel keys its category words off.
  return rows.map((row) => ({ ...row, categories: parseRecapPulseCategories(row.categories) }));
}

/**
 * A staffer says this one is dealt with. Idempotent: marking an item already
 * addressed changes nothing and still answers `true`, so a double tap on a
 * phone is not a refusal.
 *
 * Shop ownership is proven on the update rather than inherited from the id, so
 * a replayed form naming another shop's pulse moves nothing (the CR-007 house
 * rule).
 */
export async function markRecapPulseAddressed(
  db: AppDb,
  shopId: string,
  pulseId: string,
  actorPersonId: string,
): Promise<boolean> {
  if (!isUuid(pulseId) || !isUuid(actorPersonId)) return false;
  const updated = await db
    .update(recapPulses)
    .set({
      addressedAt: nowDate(),
      addressedByPersonId: actorPersonId,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(recapPulses.id, pulseId),
        eq(recapPulses.shopId, shopId),
        isNull(recapPulses.addressedAt),
        isNull(recapPulses.deletedAt),
      ),
    )
    .returning({ id: recapPulses.id });
  if (updated.length > 0) return true;
  // Nothing moved: either it was already addressed (fine, say so) or it is not
  // this shop's to touch (not fine, and the two must not be conflated).
  const [existing] = await db
    .select({ id: recapPulses.id })
    .from(recapPulses)
    .where(
      and(
        eq(recapPulses.id, pulseId),
        eq(recapPulses.shopId, shopId),
        isNull(recapPulses.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(existing);
}
