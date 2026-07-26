import { and, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { people, shops, userAccounts } from "./schema";

export type AccountContact = {
  id: string;
  email: string;
  ownerName: string;
  shopId: string;
  shopSlug: string;
  shopName: string;
  timezone: string;
};

const contactColumns = {
  id: userAccounts.id,
  email: userAccounts.email,
  ownerName: people.fullName,
  shopId: shops.id,
  shopSlug: shops.slug,
  shopName: shops.name,
  timezone: shops.timezone,
};

/** The context an already-resolved account id needs to render a lifecycle email. */
export async function getAccountContact(
  db: DbExecutor,
  userAccountId: string,
): Promise<AccountContact | null> {
  const [row] = await db
    .select(contactColumns)
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(eq(userAccounts.id, userAccountId))
    .limit(1);
  return row ?? null;
}

/**
 * Resolves a forgot-password request by email — active accounts only, so a
 * disabled account never receives a reset link. Callers must never let this
 * null/non-null result change the response a visitor sees (CR-013): a
 * password-reset request always reports the same generic confirmation,
 * whether or not the email matched anything.
 */
export async function findActiveAccountByEmail(
  db: DbExecutor,
  email: string,
): Promise<AccountContact | null> {
  const [row] = await db
    .select(contactColumns)
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(and(eq(userAccounts.email, email.toLowerCase()), eq(userAccounts.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Accepts a transaction so a caller can pair this with the token claim that authorized it (see consumeAccountToken). */
export async function markEmailVerified(
  db: DbExecutor,
  userAccountId: string,
  now: Date = nowDate(),
): Promise<void> {
  await db
    .update(userAccounts)
    .set({ emailVerifiedAt: now })
    .where(eq(userAccounts.id, userAccountId));
}

/** Accepts a transaction so a caller can pair this with the token claim that authorized it (see consumeAccountToken). */
export async function setAccountPassword(
  db: DbExecutor,
  userAccountId: string,
  hashedPassword: string,
): Promise<void> {
  await db.update(userAccounts).set({ hashedPassword }).where(eq(userAccounts.id, userAccountId));
}
