import { and, asc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { findOrCreatePerson } from "./people";
import { type LastMinuteListEntry, lastMinuteListEntries, type Person, people } from "./schema";

export type JoinLastMinuteListInput = {
  shopId: string;
  fullName: string;
  email: string;
  phone?: string;
  /** Date-only (YYYY-MM-DD); either bound omitted means "no preference" on that side. */
  availableFrom?: string;
  availableUntil?: string;
};

export type JoinLastMinuteListOutcome = { entryId: string; personName: string };

/**
 * Adds (or reactivates) a diver's shop-wide last-minute-deal opt-in. Unlike
 * `joinTripWaitlist`, this is not scoped to one trip and never checks
 * capacity — it's a standing preference, not a claim on a specific charter.
 * A re-submission (same shop+email) overwrites the stated date range and
 * clears any prior unsubscribe, so a diver can update "when I'm around" by
 * just filling the form out again.
 */
export async function joinLastMinuteList(
  db: AppDb,
  input: JoinLastMinuteListInput,
): Promise<JoinLastMinuteListOutcome> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const availableFrom = input.availableFrom || null;
  const availableUntil = input.availableUntil || null;

  return db.transaction(async (tx) => {
    const { person } = await findOrCreatePerson(tx, {
      shopId: input.shopId,
      fullName,
      email,
      phone: input.phone,
    });

    const [existing] = await tx
      .select()
      .from(lastMinuteListEntries)
      .where(
        and(
          eq(lastMinuteListEntries.shopId, input.shopId),
          eq(lastMinuteListEntries.personId, person.id),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(lastMinuteListEntries)
        .set({ availableFrom, availableUntil, unsubscribedAt: null })
        .where(eq(lastMinuteListEntries.id, existing.id))
        .returning({ id: lastMinuteListEntries.id });
      if (!updated) throw new Error("joinLastMinuteList: update returned no row");
      return { entryId: updated.id, personName: person.fullName };
    }

    const [inserted] = await tx
      .insert(lastMinuteListEntries)
      .values({ shopId: input.shopId, personId: person.id, availableFrom, availableUntil })
      .returning({ id: lastMinuteListEntries.id });
    if (!inserted) throw new Error("joinLastMinuteList: insert returned no row");
    return { entryId: inserted.id, personName: person.fullName };
  });
}

export type LastMinuteListRow = { entry: LastMinuteListEntry; person: Person };

/** Every active (not unsubscribed) entry for a shop, oldest first. */
export async function listLastMinuteList(
  db: DbExecutor,
  shopId: string,
): Promise<LastMinuteListRow[]> {
  const rows = await db
    .select({ entry: lastMinuteListEntries, person: people })
    .from(lastMinuteListEntries)
    .innerJoin(people, eq(people.id, lastMinuteListEntries.personId))
    .where(
      and(eq(lastMinuteListEntries.shopId, shopId), isNull(lastMinuteListEntries.unsubscribedAt)),
    )
    .orderBy(asc(lastMinuteListEntries.createdAt));
  return rows;
}

/** Staff-initiated removal — kept as history (unsubscribedAt), not deleted. */
export async function unsubscribeLastMinuteListEntry(
  db: AppDb,
  input: { shopId: string; entryId: string; now?: Date },
): Promise<boolean> {
  const [updated] = await db
    .update(lastMinuteListEntries)
    .set({ unsubscribedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(lastMinuteListEntries.id, input.entryId),
        eq(lastMinuteListEntries.shopId, input.shopId),
      ),
    )
    .returning({ id: lastMinuteListEntries.id });
  return Boolean(updated);
}
