import { and, eq, isNull, sql } from "drizzle-orm";
import { type DiverLocale, isDiverLocale } from "@/i18n/settings";
import { personNamesMatch } from "@/lib/person-name";
import { type DbExecutor, isUniqueConstraintViolation } from "./client";
import { bookings, people, personRoles } from "./schema";

export type FindOrCreatePersonInput = {
  shopId: string;
  fullName: string;
  /** Caller must have already trimmed and lower-cased this. */
  email: string;
  phone?: string;
};

export type FindOrCreatePersonResult = {
  person: typeof people.$inferSelect;
  created: boolean;
  /**
   * Whether the submitted `fullName` plausibly belongs to the returned person
   * (H-13). Always `true` when `created` (the person *is* the submitted name);
   * on a reuse it is the strict name comparison against the stored row, so a
   * caller can route a mismatch to staff identity confirmation rather than let
   * a different human inherit the matched person's evidence.
   */
  nameMatches: boolean;
};

/**
 * Look up an active person by (shop, email); insert one if none exists.
 * Every walk-in/import/wait-list identity path funnels through here so
 * "enter once, reuse everywhere" holds even under concurrency: two racing
 * calls for the same email (a booking and an import row landing at once, a
 * double-submitted form) both pass the initial read under READ COMMITTED,
 * but only one insert can win against `people_shop_email_unique`
 * (schema.ts) — the loser catches that as a unique-violation and re-reads
 * the winner's row instead of throwing, so callers always converge on one
 * person and one identity, never a split cert/waiver/rental history
 * (CR-008).
 *
 * The insert runs inside a *nested* transaction (a savepoint). `tx` is
 * always an already-open transaction here (booking, wait-list, and import
 * each call this from inside their own `db.transaction`), and on real
 * Postgres a failed statement aborts the whole enclosing transaction block
 * until an explicit rollback — a plain try/catch around the insert would
 * poison `tx` for the reread that follows, turning the loser's graceful
 * converge-on-one-person path into an unhandled `25P02` instead. The
 * savepoint rollback (drizzle's nested `tx.transaction()`) undoes only the
 * losing insert, leaving `tx` clean for the reread.
 */
export async function findOrCreatePerson(
  tx: DbExecutor,
  input: FindOrCreatePersonInput,
): Promise<FindOrCreatePersonResult> {
  const existing = await selectActivePersonByEmail(tx, input.shopId, input.email);
  if (existing) {
    return {
      person: existing,
      created: false,
      nameMatches: personNamesMatch(existing.fullName, input.fullName),
    };
  }

  try {
    return await tx.transaction(async (tx2) => {
      const [inserted] = await tx2
        .insert(people)
        .values({
          shopId: input.shopId,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
        })
        .returning();
      if (!inserted) throw new Error("findOrCreatePerson: insert returned no row");
      await tx2.insert(personRoles).values({ personId: inserted.id, role: "diver" });
      return { person: inserted, created: true, nameMatches: true };
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const winner = await selectActivePersonByEmail(tx, input.shopId, input.email);
    if (!winner) throw error; // the constraint violation proves a row exists; this would be a bug
    // The racing insert won with *its* name; compare ours to what landed so a
    // concurrent shared-inbox submission is flagged the same as the serial one.
    return {
      person: winner,
      created: false,
      nameMatches: personNamesMatch(winner.fullName, input.fullName),
    };
  }
}

/**
 * Remember the language this diver reads, so DiveDay writes to them in it
 * (docs ADR 20260731-per-person-notification-locale).
 *
 * **Only ever call this from a request the diver made themselves** — a public
 * booking, a waiver signature at `/waivers/[token]`, a readiness submission at
 * `/ready/[token]`, a recap action at `/recap/[token]`. Those are the requests
 * whose `Accept-Language` belongs to the diver's own device.
 *
 * A staff-triggered action carries the *staff* member's header. A front-desk
 * agent in Cozumel booking a German walk-in would otherwise stamp `es-ES` onto
 * that diver and every future email to them, which is worse than the shop
 * default it replaced: the shop default is at least an honest guess, while a
 * staff header is a confident wrong answer. That is the whole reason this is a
 * separate, awkwardly-specific function instead of an optional `locale` on
 * `findOrCreatePerson` — a parameter is something any caller can reach for, and
 * `findOrCreatePerson` is called from staff surfaces and the CSV importer too.
 *
 * `locale` is `DiverLocale | null` rather than a raw header string on purpose:
 * the caller must have already validated through `firstHandLocale`
 * (src/i18n/negotiate.ts), so an attacker-supplied `Accept-Language` can never
 * reach the column. Null is a no-op, not a clear — null means "the header told
 * us nothing we speak", and falling back to the shop's locale for *rendering*
 * is not a signal about the diver, so it must never erase a real one recorded
 * earlier.
 *
 * A later first-hand signal overwrites an earlier one: people change devices
 * and phone languages, and the most recent request they made themselves is the
 * best evidence available. Writes are narrowed by `shopId` as well as
 * `personId` so a caller holding a foreign id cannot touch another shop's row.
 *
 * Failure is swallowed (logged, not thrown). Every call site sits on the
 * critical path of something that actually matters — a committed booking, a
 * signed waiver, a cancellation — and remembering a language preference must
 * never be the reason one of those turns into an error page.
 */
export async function recordDiverOwnLocale(
  db: DbExecutor,
  input: { shopId: string; personId: string; locale: DiverLocale | null },
): Promise<void> {
  if (!isDiverLocale(input.locale)) return;
  try {
    await db
      .update(people)
      .set({ locale: input.locale })
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      );
  } catch {
    console.error("Diver locale could not be recorded", { personId: input.personId });
  }
}

/**
 * {@link recordDiverOwnLocale} for a caller that holds a booking rather than a
 * person — the recap link (`/recap/[token]`) verifies to a booking id and
 * nothing else, and resolving the person from it here keeps the "only from the
 * diver's own request" rule in one place instead of spread across route code.
 *
 * Every constraint of `recordDiverOwnLocale` applies unchanged; read its doc
 * comment before calling this.
 */
export async function recordDiverOwnLocaleForBooking(
  db: DbExecutor,
  input: { bookingId: string; locale: DiverLocale | null },
): Promise<void> {
  if (!isDiverLocale(input.locale)) return;
  let booking: { shopId: string; personId: string; identityUnconfirmedAt: Date | null } | undefined;
  try {
    [booking] = await db
      .select({
        shopId: bookings.shopId,
        personId: bookings.personId,
        identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
  } catch {
    // Same contract as `recordDiverOwnLocale`: never the reason a photo upload
    // or a review submission turns into an error page.
    console.error("Diver locale could not be recorded", { bookingId: input.bookingId });
    return;
  }
  if (!booking) return;
  // An identity-unconfirmed booking is not evidence about the person it was
  // attached to. `findOrCreatePerson` reuses an existing diver by email and
  // only *flags* a name mismatch rather than refusing it (H-13), so without
  // this an unauthenticated party who knows a diver's address could book any
  // open seat and permanently switch that diver's confirmations, waiver
  // requests, and night-before brief into a language they don't read — a
  // confident wrong answer, which is worse than the shop default it would
  // replace (security-reviewer finding). Enforced here rather than in each
  // route so the rule cannot be forgotten by the next caller.
  if (booking.identityUnconfirmedAt !== null) return;
  await recordDiverOwnLocale(db, {
    shopId: booking.shopId,
    personId: booking.personId,
    locale: input.locale,
  });
}

/** Case-insensitive to mirror the `lower(email)` index this is meant to reflect. */
async function selectActivePersonByEmail(tx: DbExecutor, shopId: string, email: string) {
  const [row] = await tx
    .select()
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        sql`lower(${people.email}) = lower(${email})`,
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
