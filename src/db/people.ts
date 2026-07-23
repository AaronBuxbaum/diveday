import { and, eq, isNull, sql } from "drizzle-orm";
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
  if (existing) return { person: existing, created: false };

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
      return { person: inserted, created: true };
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const winner = await selectActivePersonByEmail(tx, input.shopId, input.email);
    if (!winner) throw error; // the constraint violation proves a row exists; this would be a bug
    return { person: winner, created: false };
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
