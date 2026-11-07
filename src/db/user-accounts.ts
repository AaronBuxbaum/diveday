import { and, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { consumeAccountToken } from "./account-tokens";
import type { AppDb, DbExecutor } from "./client";
import { accountSessions, accountSignInChallenges, people, shops, userAccounts } from "./schema";

export type AccountContact = {
  id: string;
  email: string;
  ownerName: string;
  shopId: string;
  shopSlug: string;
  shopName: string;
  timezone: string;
  /**
   * The shop's own locale — deliberately the shop's and not the joined
   * person's. `people.locale` records what a *diver* told us from their own
   * public booking or waiver link; account-lifecycle mail goes to a staff
   * member, and nothing in the staff surfaces ever writes that column (docs
   * ADR 20260731-per-person-notification-locale).
   */
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
    .set({ emailVerifiedAt: now, emailVerified: true })
    .where(eq(userAccounts.id, userAccountId));
}

/**
 * Accepts a transaction so a caller can pair this with the token claim that
 * authorized it (see consumeAccountToken). Also revokes every session
 * already issued for this account — the same reasoning
 * `setStaffAccountStatus`/`removeStaffMember` (src/db/staff-accounts.ts) and
 * person erasure (src/db/anonymize.ts) already apply on disable/removal:
 * "I think someone has my password" is the whole point of a reset, and a
 * session issued before it must not keep working after (security review
 * finding).
 */
export async function setAccountPassword(
  db: DbExecutor,
  userAccountId: string,
  hashedPassword: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(userAccounts).set({ hashedPassword }).where(eq(userAccounts.id, userAccountId));
    await tx.delete(accountSessions).where(eq(accountSessions.userAccountId, userAccountId));
    await tx
      .delete(accountSignInChallenges)
      .where(eq(accountSignInChallenges.userAccountId, userAccountId));
  });
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
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Only an account still waiting on its invite: set against an active one this would be a
    // password write with no proof of ownership (issue #3997).
    const activated = await tx
      .update(userAccounts)
      .set({ hashedPassword, status: "active", emailVerifiedAt: now, emailVerified: true })
      .where(and(eq(userAccounts.id, userAccountId), eq(userAccounts.status, "invited")))
      .returning({ id: userAccounts.id });
    if (activated.length === 0) return false;
    // An `invited` account can never have signed in (verifyCredentials refuses
    // anything but `active`), so there is nothing to revoke in practice today —
    // kept for the same reason setAccountPassword now does it: consistent with
    // every other place this account's credentials change.
    await tx.delete(accountSessions).where(eq(accountSessions.userAccountId, userAccountId));
    await tx
      .delete(accountSignInChallenges)
      .where(eq(accountSignInChallenges.userAccountId, userAccountId));
    return true;
  });
}

class InviteNotOpen extends Error {}

/**
 * Spends an invite and activates its account in one transaction: a failure between the two must
 * not burn a one-time link while leaving the account stuck `invited`. Null for a link that is
 * unknown, spent, withdrawn, expired, or whose account is no longer waiting on it.
 */
export async function claimStaffInvite(
  db: AppDb,
  input: { token: string; hashedPassword: string },
): Promise<{ userAccountId: string } | null> {
  try {
    return await db.transaction(async (tx) => {
      // consumeAccountToken locks the account before it spends (issue #4068).
      const claim = await consumeAccountToken(tx, { token: input.token, purpose: "invite" });
      if (!claim) return null;
      // Not invited any more: roll the claim back with it rather than burn a link for nothing.
      if (!(await activateStaffAccount(tx, claim.userAccountId, input.hashedPassword))) {
        throw new InviteNotOpen();
      }
      return claim;
    });
  } catch (error) {
    if (error instanceof InviteNotOpen) return null;
    throw error;
  }
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

/**
 * The id of the login account a person signs in with, or null when they have
 * none. `person_id` is unique in `user_accounts`, so a staff session's person
 * resolves to at most one account. The argument is the session's own
 * `personId` and nothing else: there is no shop predicate here, so a person id
 * read from a form would resolve another tenant's account.
 */
export async function getAccountIdForPerson(
  db: DbExecutor,
  personId: string,
): Promise<string | null> {
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  return account?.id ?? null;
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
