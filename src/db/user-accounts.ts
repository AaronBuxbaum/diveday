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
  /** The shop's own locale — the only signal for an account-lifecycle email's
   * language, since no per-person preference is stored (docs ADR
   * 20260731-notification-locale). */
  defaultLocale: string;
};

const contactColumns = {
  id: userAccounts.id,
  email: userAccounts.email,
  ownerName: people.fullName,
  shopId: shops.id,
  shopSlug: shops.slug,
  shopName: shops.name,
  timezone: shops.timezone,
  defaultLocale: shops.defaultLocale,
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

/**
 * Accepting a staff invite: sets the invitee's own chosen password, flips the
 * account from `invited` to `active` so it can sign in, and stamps
 * `emailVerifiedAt` — clicking a link mailed to that address is the same
 * email-ownership proof `email_verification` records
 * (20260726-staff-invite-accounts). Accepts a transaction so a caller can
 * pair this with the token claim that authorized it.
 */
export async function activateStaffAccount(
  db: DbExecutor,
  userAccountId: string,
  hashedPassword: string,
  now: Date = nowDate(),
): Promise<void> {
  await db
    .update(userAccounts)
    .set({ hashedPassword, status: "active", emailVerifiedAt: now })
    .where(eq(userAccounts.id, userAccountId));
}

/**
 * Whether this person's account already dismissed the first-visit role
 * orientation card on Today (task 79, UX persona 11 "Kai"). `personId` is
 * unique in `user_accounts`, so this resolves straight from the session's
 * person id without a separate account-id lookup. An account with no row at
 * all (should not happen for a signed-in staff session, but the query stays
 * defensive) counts as not dismissed — the card fails open to visible rather
 * than silently never showing.
 */
export async function isOrientationDismissed(db: DbExecutor, personId: string): Promise<boolean> {
  const [account] = await db
    .select({ orientationDismissedAt: userAccounts.orientationDismissedAt })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  return account?.orientationDismissedAt != null;
}

/** Records the dismissal so the orientation card never shows this account again. */
export async function dismissOrientation(
  db: DbExecutor,
  personId: string,
  now: Date = nowDate(),
): Promise<void> {
  await db
    .update(userAccounts)
    .set({ orientationDismissedAt: now })
    .where(eq(userAccounts.personId, personId));
}
