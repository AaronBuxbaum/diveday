import { and, eq, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { bookkeeperMonthOnSet } from "@/lib/bookkeeper";
import type { DbExecutor } from "./client";
import { shops } from "./schema";

/**
 * **The bookkeeper's address and the month-end claim** (fifth loop, item 35;
 * ADR 20261016-bookkeeper-month-end-email). The address lives on the shop with
 * who set it and when; `bookkeeper_sent_month` is the claim the daily pass
 * moves forward before it sends.
 */

export type BookkeeperSetting = { email: string; setAt: Date };

/** The shop's bookkeeper address, or null while the email is off. */
export async function readBookkeeper(
  db: DbExecutor,
  shopId: string,
): Promise<BookkeeperSetting | null> {
  const [row] = await db
    .select({ email: shops.bookkeeperEmail, setAt: shops.bookkeeperEmailSetAt })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return row?.email && row.setAt ? { email: row.email, setAt: row.setAt } : null;
}

/**
 * Sets the address (normalized by the caller) with who set it and when, or
 * clears all of it with null. A new address counts the month already due as
 * sent (`bookkeeperMonthOnSet`), so its first email is the next 2nd's.
 * Saving the address already on file changes nothing, so a second save does
 * not move the claim or the provenance.
 */
export async function setBookkeeper(
  db: DbExecutor,
  input: { shopId: string; timeZone: string; email: string | null; personId: string; now: Date },
): Promise<void> {
  if (input.email === null) {
    await db
      .update(shops)
      .set({
        bookkeeperEmail: null,
        bookkeeperEmailSetAt: null,
        bookkeeperEmailSetByPersonId: null,
        bookkeeperSentMonth: null,
      })
      .where(eq(shops.id, input.shopId));
    return;
  }
  await db
    .update(shops)
    .set({
      bookkeeperEmail: input.email,
      bookkeeperEmailSetAt: input.now,
      bookkeeperEmailSetByPersonId: input.personId,
      bookkeeperSentMonth: bookkeeperMonthOnSet(input.now, input.timeZone),
    })
    .where(
      and(
        eq(shops.id, input.shopId),
        or(isNull(shops.bookkeeperEmail), ne(shops.bookkeeperEmail, input.email)),
      ),
    );
}

/** Every real shop with a bookkeeper address: the daily pass's candidates. */
export async function listBookkeeperShops(db: DbExecutor) {
  return db
    .select({
      id: shops.id,
      slug: shops.slug,
      name: shops.name,
      timezone: shops.timezone,
      currency: shops.currency,
      defaultLocale: shops.defaultLocale,
      email: shops.bookkeeperEmail,
      sentMonth: shops.bookkeeperSentMonth,
    })
    .from(shops)
    .where(and(eq(shops.isDemo, false), isNotNull(shops.bookkeeperEmail)));
}

/**
 * **The claim**: moves `bookkeeper_sent_month` to `month` only while the shop
 * still names `email` and has not sent that month, in one statement, so two
 * passes at once send it once and an address changed mid-pass is never mailed
 * the old one's files. True when this caller won.
 */
export async function claimBookkeeperMonth(
  db: DbExecutor,
  input: { shopId: string; email: string; month: string },
): Promise<boolean> {
  const claimed = await db
    .update(shops)
    .set({ bookkeeperSentMonth: input.month })
    .where(
      and(
        eq(shops.id, input.shopId),
        eq(shops.bookkeeperEmail, input.email),
        or(isNull(shops.bookkeeperSentMonth), lt(shops.bookkeeperSentMonth, input.month)),
      ),
    )
    .returning({ id: shops.id });
  return claimed.length > 0;
}

/**
 * Gives a claimed month back after a send that failed, so the next day's pass
 * tries again; only while the claim is still this one.
 */
export async function releaseBookkeeperMonth(
  db: DbExecutor,
  input: { shopId: string; month: string; previous: string | null },
): Promise<void> {
  await db
    .update(shops)
    .set({ bookkeeperSentMonth: input.previous })
    .where(and(eq(shops.id, input.shopId), eq(shops.bookkeeperSentMonth, input.month)));
}
