import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { compare } from "bcryptjs";
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { isStaff, type Role } from "@/lib/authz";
import { nowDate, nowMs } from "@/lib/clock";
import {
  PASSKEY_CHALLENGE_TTL_SECONDS,
  type PasskeyBinding,
  type PasskeyCeremony,
} from "@/lib/passkeys";
import { createPendingHandle, hashPendingHandle } from "@/lib/pending-sign-in";
import type { StepUpPurpose } from "@/lib/security-step-up";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";
import { beginTotpEnrollment, enableTotp, grantStepUp, hasStepUp } from "./account-security";
import type { AppTransaction, DbExecutor } from "./client";
import type { VerifiedUser } from "./credentials";
import { boundLockWaits } from "./lock-bounds";
import {
  accountPasskeyChallenges,
  accountPasskeys,
  accountSessions,
  personRoles,
  shops,
} from "./schema";
import { cancelPendingSignIn, finishFirstFactor, lockAccount } from "./sign-in-challenges";

type RelyingParty = { origin: string; rpId: string };

async function liveAccount(tx: AppTransaction, accountId: string) {
  const locked = await lockAccount(tx, accountId);
  if (
    locked?.account.status !== "active" ||
    !locked.person ||
    locked.person.deletedAt ||
    locked.person.anonymizedAt
  )
    return null;
  const [shop] = await tx.select().from(shops).where(eq(shops.id, locked.person.shopId));
  const roles = (
    await tx
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, locked.person.id))
  ).map((row) => row.role as Role);
  if (!shop || !isStaff(roles)) return null;
  const verified: VerifiedUser = {
    id: locked.account.id,
    email: locked.account.email,
    personId: locked.person.id,
    shopId: shop.id,
    shopSlug: shop.slug,
    name: locked.person.fullName,
    roles,
  };
  return { ...locked, verified };
}

async function liveSession(tx: AppTransaction, binding: PasskeyBinding) {
  const account = await liveAccount(tx, binding.userAccountId);
  if (!account || account.verified.shopId !== binding.shopId) return null;
  const [session] = await tx
    .select({ id: accountSessions.id })
    .from(accountSessions)
    .where(
      and(
        eq(accountSessions.id, binding.accountSessionId),
        eq(accountSessions.userAccountId, binding.userAccountId),
        eq(accountSessions.shopId, binding.shopId),
        gt(accountSessions.expiresAt, nowDate()),
        gt(accountSessions.lastHumanActivityAt, new Date(nowMs() - STAFF_IDLE_LIMIT_MS)),
      ),
    )
    .for("update");
  return session ? account : null;
}

/** Existing protection cannot be replaced by possession of the session it protects. */
async function mayManageFactors(
  tx: AppTransaction,
  binding: PasskeyBinding,
  live: NonNullable<Awaited<ReturnType<typeof liveSession>>>,
) {
  const keys = await listAccountPasskeys(tx, binding.userAccountId, binding.shopId);
  return (
    (!live.security?.totpEnabledAt && keys.length === 0) ||
    hasStepUp(tx, { ...binding, purpose: "security" })
  );
}

export async function authorizeFactorManagementPassword(
  db: DbExecutor,
  binding: PasskeyBinding,
  password: string,
) {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await liveSession(tx, binding);
    if (!live?.account.hashedPassword || !(await compare(password, live.account.hashedPassword)))
      return false;
    return Boolean(await grantStepUp(tx, { ...binding, purpose: "security" }));
  });
}

export async function beginProtectedTotpEnrollment(db: DbExecutor, binding: PasskeyBinding) {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await liveSession(tx, binding);
    if (!live || !(await mayManageFactors(tx, binding, live)))
      return { status: "proof_required" as const };
    const enrollment = await beginTotpEnrollment(tx, binding.userAccountId);
    return enrollment
      ? { status: "started" as const, ...enrollment }
      : { status: "unavailable" as const };
  });
}

export async function enableProtectedTotp(db: DbExecutor, binding: PasskeyBinding, code: string) {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await liveSession(tx, binding);
    if (!live || !(await mayManageFactors(tx, binding, live)))
      return { status: "proof_required" as const };
    return {
      status: "checked" as const,
      enabled: await enableTotp(tx, binding.userAccountId, code),
    };
  });
}

async function issueChallenge(
  db: DbExecutor,
  input: RelyingParty & {
    ceremony: PasskeyCeremony;
    challenge: string;
    binding?: PasskeyBinding;
    purpose?: StepUpPurpose;
  },
  previousHandle: string | null,
) {
  if (previousHandle)
    await db
      .delete(accountPasskeyChallenges)
      .where(eq(accountPasskeyChallenges.tokenHash, hashPendingHandle(previousHandle)));
  // Bounded collection also covers anonymous ceremonies, without a background job.
  const expired = db
    .select({ id: accountPasskeyChallenges.id })
    .from(accountPasskeyChallenges)
    .where(lte(accountPasskeyChallenges.expiresAt, nowDate()))
    .limit(50);
  await db.delete(accountPasskeyChallenges).where(inArray(accountPasskeyChallenges.id, expired));
  const handle = createPendingHandle();
  await db.insert(accountPasskeyChallenges).values({
    ...input.binding,
    origin: input.origin,
    rpId: input.rpId,
    ceremony: input.ceremony,
    purpose: input.purpose,
    challenge: input.challenge,
    tokenHash: hashPendingHandle(handle),
    expiresAt: new Date(nowMs() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000),
  });
  return handle;
}

/** Atomic spend before verification: a failed assertion cannot replay a ceremony either. */
async function consumeChallenge(
  db: DbExecutor,
  handle: string | null,
  ceremony: PasskeyCeremony,
  rp: RelyingParty,
  binding?: PasskeyBinding,
  purpose?: StepUpPurpose,
) {
  if (!handle || !/^[A-Za-z0-9_-]{43}$/.test(handle)) return null;
  const [row] = await db
    .delete(accountPasskeyChallenges)
    .where(eq(accountPasskeyChallenges.tokenHash, hashPendingHandle(handle)))
    .returning();
  if (
    !row ||
    row.ceremony !== ceremony ||
    row.origin !== rp.origin ||
    row.rpId !== rp.rpId ||
    row.expiresAt.getTime() <= nowMs() ||
    row.userAccountId !== (binding?.userAccountId ?? null) ||
    row.accountSessionId !== (binding?.accountSessionId ?? null) ||
    row.shopId !== (binding?.shopId ?? null) ||
    row.purpose !== (purpose ?? null)
  )
    return null;
  return row;
}

export async function listAccountPasskeys(db: DbExecutor, accountId: string, shopId: string) {
  return db
    .select({
      id: accountPasskeys.id,
      name: accountPasskeys.name,
      createdAt: accountPasskeys.createdAt,
      lastUsedAt: accountPasskeys.lastUsedAt,
    })
    .from(accountPasskeys)
    .where(
      and(
        eq(accountPasskeys.userAccountId, accountId),
        eq(accountPasskeys.shopId, shopId),
        isNull(accountPasskeys.deletedAt),
      ),
    );
}

export async function beginPasskeyRegistration(
  db: DbExecutor,
  binding: PasskeyBinding,
  rp: RelyingParty,
  previousHandle: string | null,
) {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await liveSession(tx, binding);
    if (!live || !(await mayManageFactors(tx, binding, live))) return null;
    const existing = await tx
      .select({ id: accountPasskeys.credentialId })
      .from(accountPasskeys)
      .where(
        and(
          eq(accountPasskeys.userAccountId, binding.userAccountId),
          eq(accountPasskeys.shopId, binding.shopId),
          isNull(accountPasskeys.deletedAt),
        ),
      );
    const options = await generateRegistrationOptions({
      rpName: "DiveDay",
      rpID: rp.rpId,
      userID: new TextEncoder().encode(binding.userAccountId),
      userName: live.account.email,
      userDisplayName: live.verified.name,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      excludeCredentials: existing,
      timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
    });
    const handle = await issueChallenge(
      tx,
      { ...rp, binding, ceremony: "register", challenge: options.challenge },
      previousHandle,
    );
    return { options, handle };
  });
}

export async function registerAccountPasskey(
  db: DbExecutor,
  binding: PasskeyBinding,
  rp: RelyingParty,
  handle: string | null,
  response: RegistrationResponseJSON,
  name: string,
) {
  const challenge = await consumeChallenge(db, handle, "register", rp, binding);
  if (!challenge || !name.trim() || name.trim().length > 80) return false;
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      requireUserVerification: true,
    });
  } catch {
    return false;
  }
  if (!result.verified || !result.registrationInfo.userVerified) return false;
  const { credential } = result.registrationInfo;
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await liveSession(tx, binding);
    if (!live || !(await mayManageFactors(tx, binding, live))) return false;
    const [created] = await tx
      .insert(accountPasskeys)
      .values({
        shopId: binding.shopId,
        userAccountId: binding.userAccountId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        name: name.trim(),
      })
      .onConflictDoNothing()
      .returning({ id: accountPasskeys.id });
    return Boolean(created);
  });
}

export async function renameAccountPasskey(
  db: DbExecutor,
  binding: PasskeyBinding,
  id: string,
  name: string,
) {
  if (!name.trim() || name.trim().length > 80) return false;
  return changePasskey(db, binding, id, { name: name.trim() });
}

export async function revokeAccountPasskey(db: DbExecutor, binding: PasskeyBinding, id: string) {
  return changePasskey(db, binding, id, { deletedAt: nowDate() });
}

async function changePasskey(
  db: DbExecutor,
  binding: PasskeyBinding,
  id: string,
  change: { name?: string; deletedAt?: Date },
) {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await liveSession(tx, binding);
    if (!live || (change.deletedAt && !(await mayManageFactors(tx, binding, live)))) return false;
    const rows = await tx
      .update(accountPasskeys)
      .set(change)
      .where(
        and(
          eq(accountPasskeys.id, id),
          eq(accountPasskeys.shopId, binding.shopId),
          eq(accountPasskeys.userAccountId, binding.userAccountId),
          isNull(accountPasskeys.deletedAt),
        ),
      )
      .returning({ id: accountPasskeys.id });
    return rows.length > 0;
  });
}

export async function beginPasskeyAuthentication(
  db: DbExecutor,
  rp: RelyingParty,
  previousHandle: string | null,
  binding?: PasskeyBinding,
  purpose?: StepUpPurpose,
) {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: "required",
    timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
  });
  const handle = await issueChallenge(
    db,
    {
      ...rp,
      binding,
      purpose,
      ceremony: binding ? "step-up" : "sign-in",
      challenge: options.challenge,
    },
    previousHandle,
  );
  return { options, handle };
}

async function verifyAssertion(
  tx: AppTransaction,
  accountId: string,
  shopId: string,
  response: AuthenticationResponseJSON,
  challenge: typeof accountPasskeyChallenges.$inferSelect,
) {
  const [key] = await tx
    .select()
    .from(accountPasskeys)
    .where(
      and(
        eq(accountPasskeys.credentialId, response.id),
        eq(accountPasskeys.userAccountId, accountId),
        eq(accountPasskeys.shopId, shopId),
        isNull(accountPasskeys.deletedAt),
      ),
    )
    .for("update");
  if (
    !key ||
    (response.response.userHandle &&
      response.response.userHandle !== Buffer.from(accountId).toString("base64url"))
  )
    return false;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      requireUserVerification: true,
      credential: {
        id: key.credentialId,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
        counter: key.counter,
      },
    });
    if (!result.verified || !result.authenticationInfo.userVerified) return false;
    await tx
      .update(accountPasskeys)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: nowDate() })
      .where(eq(accountPasskeys.id, key.id));
    return true;
  } catch {
    return false;
  }
}

export async function startPasskeySignIn<T>(
  db: DbExecutor,
  rp: RelyingParty,
  handle: string | null,
  response: AuthenticationResponseJSON,
  previousPending: string | null,
  persist: (tx: AppTransaction, verified: VerifiedUser) => Promise<T>,
) {
  await cancelPendingSignIn(db, previousPending);
  const challenge = await consumeChallenge(db, handle, "sign-in", rp);
  if (!challenge) return { status: "invalid" as const };
  const [candidate] = await db
    .select({ accountId: accountPasskeys.userAccountId })
    .from(accountPasskeys)
    .where(and(eq(accountPasskeys.credentialId, response.id), isNull(accountPasskeys.deletedAt)));
  if (!candidate) return { status: "invalid" as const };
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const live = await liveAccount(tx, candidate.accountId);
    if (
      !live ||
      !(await verifyAssertion(tx, candidate.accountId, live.verified.shopId, response, challenge))
    )
      return { status: "invalid" as const };
    return finishFirstFactor(tx, live.verified, Boolean(live.security?.totpEnabledAt), persist);
  });
}

export async function verifyPasskeyStepUp(
  db: DbExecutor,
  binding: PasskeyBinding,
  purpose: StepUpPurpose,
  rp: RelyingParty,
  handle: string | null,
  response: AuthenticationResponseJSON,
) {
  const challenge = await consumeChallenge(db, handle, "step-up", rp, binding, purpose);
  if (!challenge) return false;
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    if (
      !(await liveSession(tx, binding)) ||
      !(await verifyAssertion(tx, binding.userAccountId, binding.shopId, response, challenge))
    )
      return false;
    return Boolean(await grantStepUp(tx, { ...binding, purpose }));
  });
}
