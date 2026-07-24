import { and, eq, isNull, sql } from "drizzle-orm";
import { personNamesMatch } from "@/lib/person-name";
import { type DbExecutor, isUniqueConstraintViolation } from "./client";
import { people, personRoles } from "./schema";

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
