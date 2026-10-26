import { and, eq, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { isStaff, type Role } from "@/lib/authz";
import { nowDate, nowMs } from "@/lib/clock";
import { type VerifiedUser, verifyCredentials } from "@/lib/credentials";
import { demoBypassAccepted } from "@/lib/demo-bypass";
import {
  createPendingHandle,
  hashPendingHandle,
  PENDING_SIGN_IN_ATTEMPTS,
  PENDING_SIGN_IN_TTL_SECONDS,
} from "@/lib/pending-sign-in";
import { verifyAccountSecondFactor } from "./account-security";
import type { AppTransaction, DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";
import {
  accountSecurity,
  accountSignInChallenges,
  people,
  personRoles,
  shops,
  userAccounts,
} from "./schema";

type PersistSession<T> = (tx: AppTransaction, verified: VerifiedUser) => Promise<T>;

export async function cancelPendingSignIn(db: DbExecutor, handle: string | null): Promise<void> {
  if (handle)
    await db
      .delete(accountSignInChallenges)
      .where(eq(accountSignInChallenges.tokenHash, hashPendingHandle(handle)));
}

/** Read-only render lookup. Expiry ends validity immediately, regardless of cleanup. */
export async function hasPendingSignIn(db: DbExecutor, handle: string | null): Promise<boolean> {
  if (!handle) return false;
  const [row] = await db
    .select({ id: accountSignInChallenges.id })
    .from(accountSignInChallenges)
    .innerJoin(userAccounts, eq(userAccounts.id, accountSignInChallenges.userAccountId))
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(accountSecurity, eq(accountSecurity.userAccountId, userAccounts.id))
    .where(
      and(
        eq(accountSignInChallenges.tokenHash, hashPendingHandle(handle)),
        gt(accountSignInChallenges.expiresAt, nowDate()),
        gt(accountSignInChallenges.attemptsRemaining, 0),
        eq(userAccounts.status, "active"),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNotNull(accountSecurity.totpEnabledAt),
        eq(people.shopId, accountSignInChallenges.shopId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Account -> person -> security -> challenge is the completion lock order. */
async function lockAccount(tx: AppTransaction, accountId: string) {
  const [account] = await tx
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.id, accountId))
    .for("update");
  if (!account) return null;
  const [person] = await tx
    .select()
    .from(people)
    .where(and(eq(people.id, account.personId), isNull(people.deletedAt)))
    .for("no key update");
  const [security] = await tx
    .select()
    .from(accountSecurity)
    .where(eq(accountSecurity.userAccountId, accountId))
    .for("update");
  return { account, person, security };
}

export async function startCredentialSignIn<T>(
  db: DbExecutor,
  input: { email: string; password: string; previousHandle: string | null },
  persist: PersistSession<T>,
) {
  // Replacing even a refused credential attempt revokes this browser's earlier proof.
  await cancelPendingSignIn(db, input.previousHandle);
  let proof: { hashedPassword: string | null; passwordMatches: boolean } | undefined;
  // Refused passwords never lock an account: known and unknown attempts retain the decoy policy.
  const checked = await verifyCredentials(db, input.email, input.password, (observed) => {
    proof = observed;
  });
  if (!checked || !proof) return { status: "invalid" as const };
  const observed = proof;
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const locked = await lockAccount(tx, checked.id);
    if (
      locked?.account.status !== "active" ||
      locked.account.email !== input.email.toLowerCase() ||
      locked.account.hashedPassword !== observed.hashedPassword ||
      !locked.person ||
      locked.person.id !== checked.personId ||
      locked.person.deletedAt ||
      locked.person.anonymizedAt
    )
      return { status: "invalid" as const };
    const [shop] = await tx.select().from(shops).where(eq(shops.id, locked.person.shopId));
    const roles = (
      await tx
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, locked.person.id))
    ).map((r) => r.role as Role);
    if (
      !shop ||
      !isStaff(roles) ||
      (!observed.passwordMatches &&
        !demoBypassAccepted({
          shopIsDemo: shop.isDemo,
          accountEmail: locked.account.email,
          password: input.password,
        }))
    )
      return { status: "invalid" as const };
    const verified: VerifiedUser = {
      id: locked.account.id,
      email: locked.account.email,
      personId: locked.person.id,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: locked.person.fullName,
      roles,
    };
    if (!locked.security?.totpEnabledAt)
      return { status: "signed_in" as const, value: await persist(tx, verified) };
    const expired = tx
      .select({ id: accountSignInChallenges.id })
      .from(accountSignInChallenges)
      .where(lte(accountSignInChallenges.expiresAt, nowDate()))
      .limit(50);
    await tx.delete(accountSignInChallenges).where(inArray(accountSignInChallenges.id, expired));
    const handle = createPendingHandle();
    await tx.insert(accountSignInChallenges).values({
      shopId: verified.shopId,
      userAccountId: verified.id,
      tokenHash: hashPendingHandle(handle),
      expiresAt: new Date(nowMs() + PENDING_SIGN_IN_TTL_SECONDS * 1000),
      attemptsRemaining: PENDING_SIGN_IN_ATTEMPTS,
    });
    return { status: "pending" as const, handle };
  });
}

export async function completePendingSignIn<T>(
  db: DbExecutor,
  handle: string | null,
  code: string,
  allowAccount: (email: string) => Promise<boolean>,
  persist: PersistSession<T>,
) {
  if (!handle) return { status: "restart" as const };
  const digest = hashPendingHandle(handle);
  const [candidate] = await db
    .select({ accountId: accountSignInChallenges.userAccountId })
    .from(accountSignInChallenges)
    .where(eq(accountSignInChallenges.tokenHash, digest));
  if (!candidate) return { status: "restart" as const };
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const locked = await lockAccount(tx, candidate.accountId);
    const [challenge] = await tx
      .select()
      .from(accountSignInChallenges)
      .where(eq(accountSignInChallenges.tokenHash, digest))
      .for("update");
    if (!challenge) return { status: "restart" as const };
    const refuse = async () => {
      await tx.delete(accountSignInChallenges).where(eq(accountSignInChallenges.id, challenge.id));
      return { status: "restart" as const };
    };
    if (
      locked?.account.status !== "active" ||
      !locked.person ||
      locked.person.deletedAt ||
      locked.person.anonymizedAt ||
      locked.person.shopId !== challenge.shopId ||
      !locked.security?.totpEnabledAt ||
      challenge.expiresAt.getTime() <= nowMs() ||
      challenge.attemptsRemaining <= 0
    )
      return refuse();
    if (!(await allowAccount(locked.account.email))) return { status: "rate_limited" as const };
    const [shop] = await tx.select().from(shops).where(eq(shops.id, challenge.shopId));
    const roles = (
      await tx
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, locked.person.id))
    ).map((r) => r.role as Role);
    if (!shop || !isStaff(roles)) return refuse();
    await tx
      .update(accountSignInChallenges)
      .set({ attemptsRemaining: challenge.attemptsRemaining - 1 })
      .where(eq(accountSignInChallenges.id, challenge.id));
    const accepted =
      /^[A-Za-z0-9-]{6,32}$/.test(code) &&
      (await verifyAccountSecondFactor(tx, locked.account.id, code));
    if (!accepted) {
      if (challenge.attemptsRemaining === 1) return refuse();
      return { status: "invalid_code" as const };
    }
    await tx.delete(accountSignInChallenges).where(eq(accountSignInChallenges.id, challenge.id));
    const verified: VerifiedUser = {
      id: locked.account.id,
      email: locked.account.email,
      personId: locked.person.id,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: locked.person.fullName,
      roles,
    };
    return { status: "signed_in" as const, value: await persist(tx, verified) };
  });
}
