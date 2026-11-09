import { eq } from "drizzle-orm";
import { isStaff, type Role } from "@/lib/authz";
import { demoBypassEnabled } from "@/lib/demo-bypass";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import { bindSignInToken, openSignInToken } from "@/lib/magic-sign-in";
import { checkAccountToken, consumeAccountToken, issueAccountToken } from "./account-tokens";
import type { AppTransaction, DbExecutor } from "./client";
import type { VerifiedUser } from "./credentials";
import { boundLockWaits } from "./lock-bounds";
import { personRoles, shops, userAccounts } from "./schema";
import { cancelPendingSignIn, finishFirstFactor, lockAccount } from "./sign-in-challenges";
import { getAccountContact } from "./user-accounts";

async function eligible(tx: AppTransaction, id: string, demo = false) {
  const locked = await lockAccount(tx, id);
  if (
    locked?.account.status !== "active" ||
    (!demo && (!locked.account.emailVerified || !locked.account.emailVerifiedAt)) ||
    isDemoAccountEmail(locked.account.email) !== demo ||
    !locked.person ||
    locked.person.deletedAt ||
    locked.person.anonymizedAt
  )
    return null;
  const [shop] = await tx.select().from(shops).where(eq(shops.id, locked.person.shopId));
  if (!shop || shop.isDemo !== demo || (demo && !demoBypassEnabled())) return null;
  const roles = (
    await tx
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, locked.person.id))
  ).map((r) => r.role as Role);
  if (!isStaff(roles) || (demo && !roles.includes("owner"))) return null;
  return {
    ...locked,
    person: locked.person,
    verifiedAt: locked.account.emailVerifiedAt,
    shop,
    roles,
  };
}

/** Deferred callers receive the current account address, never a supplied destination. */
export async function issueMagicSignIn(db: DbExecutor, email: string) {
  const [candidate] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.email, email));
  if (!candidate) return null;
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await eligible(tx, candidate.id);
    if (!live || live.account.email !== email) return null;
    const issued = await issueAccountToken(tx, {
      userAccountId: candidate.id,
      purpose: "magic_sign_in",
    });
    const contact = await getAccountContact(tx, candidate.id);
    if (!contact) throw new Error("account_contact_missing");
    return {
      ...issued,
      contact,
      token: bindSignInToken(issued.token, live.account.email, live.verifiedAt as Date),
    };
  });
}

export async function startMagicSignIn<T>(
  db: DbExecutor,
  input: { token: string; previousHandle: string | null },
  persist: (tx: AppTransaction, verified: VerifiedUser) => Promise<T>,
) {
  await cancelPendingSignIn(db, input.previousHandle);
  const demo = /^[A-Za-z0-9_-]{43}$/.test(input.token);
  const purpose = demo ? "demo_sign_in" : "magic_sign_in";
  if (!demo && !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(input.token))
    return { status: "invalid" as const };
  const token = input.token.split(".")[0];
  const candidate = await checkAccountToken(db, { token, purpose });
  if (!candidate) return { status: "invalid" as const };
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await eligible(tx, candidate.userAccountId, demo);
    if (
      !live ||
      (!demo && !openSignInToken(input.token, live.account.email, live.verifiedAt as Date))
    )
      return { status: "invalid" as const };
    const spent = await consumeAccountToken(tx, { token, purpose });
    if (!spent) return { status: "invalid" as const };
    return finishFirstFactor(
      tx,
      {
        id: live.account.id,
        email: live.account.email,
        personId: live.person.id,
        shopId: live.shop.id,
        shopSlug: live.shop.slug,
        name: live.person.fullName,
        roles: live.roles,
      },
      Boolean(live.security?.totpEnabledAt),
      persist,
    );
  });
}
