import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { nowDate, nowMs } from "@/lib/clock";
import {
  openingKeys,
  openSecretWithKeyring,
  sealingKey,
  sealSecret,
  secretKeyFromEnvironment,
} from "@/lib/secret-box";
import {
  createTotpSecret,
  generateRecoveryCodes,
  matchTotpStep,
  recoveryCodeHashes,
  verifyTotpCode,
} from "@/lib/totp";
import type { DbExecutor } from "./client";
import { accountSecurity, accountSessions, accountStepUps } from "./schema";

const STEP_UP_TTL_MS = 15 * 60 * 1000;

export async function getAccountSecurity(db: DbExecutor, userAccountId: string) {
  const [row] = await db
    .select()
    .from(accountSecurity)
    .where(eq(accountSecurity.userAccountId, userAccountId));
  return row ?? null;
}

export async function beginTotpEnrollment(db: DbExecutor, userAccountId: string) {
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") return null;
  const current = await getAccountSecurity(db, userAccountId);
  if (current?.totpEnabledAt) return null;
  const secret = createTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const hashes = recoveryCodeHashes(recoveryCodes, sealingKey(key.key), userAccountId);
  await db
    .insert(accountSecurity)
    .values({
      userAccountId,
      totpSecretSealed: sealSecret(secret, key.key),
      recoveryCodeHashes: hashes,
    })
    .onConflictDoUpdate({
      target: accountSecurity.userAccountId,
      set: {
        totpSecretSealed: sealSecret(secret, key.key),
        recoveryCodeHashes: hashes,
        totpEnabledAt: null,
        lastTotpStep: null,
        updatedAt: nowDate(),
      },
    });
  return { secret, recoveryCodes };
}

export async function enableTotp(
  db: DbExecutor,
  userAccountId: string,
  code: string,
): Promise<boolean> {
  const secret = await resealedTotpSecret(db, userAccountId);
  if (!secret || !verifyTotpCode(secret, code)) return false;
  await db
    .update(accountSecurity)
    .set({ totpEnabledAt: nowDate(), updatedAt: nowDate() })
    .where(eq(accountSecurity.userAccountId, userAccountId));
  return true;
}

/**
 * Verifies a second factor, and spends it. Sign-in, step-up and turning
 * two-factor off each grant something, so each consumes the TOTP time step: a
 * code seen over a shoulder, or already used to sign in, does not pass again
 * inside its window. The next code arrives within one step. A recovery code is
 * removed atomically from the stored hash list.
 */
export async function verifyAccountSecondFactor(
  db: DbExecutor,
  userAccountId: string,
  code: string,
): Promise<boolean> {
  const security = await getAccountSecurity(db, userAccountId);
  if (!security?.totpEnabledAt) return true;

  const secret = await resealedTotpSecret(db, userAccountId);
  const now = nowMs();
  // The step the code was *for*, which with drift accepted is not always the
  // current one -- consuming the current step would leave the real one live.
  const step = secret ? matchTotpStep(secret, code, now) : null;
  if (step !== null) {
    const [row] = await db
      .update(accountSecurity)
      .set({ lastTotpStep: step, updatedAt: nowDate() })
      .where(
        and(
          eq(accountSecurity.userAccountId, userAccountId),
          or(isNull(accountSecurity.lastTotpStep), lt(accountSecurity.lastTotpStep, step)),
        ),
      )
      .returning({ userAccountId: accountSecurity.userAccountId });
    return Boolean(row);
  }

  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") return false;
  // A code issued before a key rotation was hashed under the previous key, and
  // cannot be re-hashed without its plaintext: each one is tried under both.
  for (const candidate of openingKeys(key.key)) {
    if (await spendRecoveryCode(db, userAccountId, code, candidate)) return true;
  }
  return false;
}

async function spendRecoveryCode(
  db: DbExecutor,
  userAccountId: string,
  code: string,
  key: Buffer,
): Promise<boolean> {
  const recoveryHash = recoveryCodeHashes([code], key, userAccountId)[0];
  const [row] = await db
    .update(accountSecurity)
    .set({
      // Delete from the value currently held by the row, rather than writing
      // the array read above. Two simultaneous uses of one recovery code can
      // therefore not write stale snapshots over one another.
      recoveryCodeHashes: sql`${accountSecurity.recoveryCodeHashes} - ${recoveryHash}`,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(accountSecurity.userAccountId, userAccountId),
        sql`${accountSecurity.recoveryCodeHashes} @> ${JSON.stringify([recoveryHash])}::jsonb`,
      ),
    )
    .returning({ userAccountId: accountSecurity.userAccountId });
  return Boolean(row);
}

/**
 * The account's TOTP secret, or null when there is none or no key opens it.
 * Read-only: the security page shows it during enrolment.
 */
export async function getTotpSecret(db: DbExecutor, userAccountId: string) {
  return (await openTotpSecret(db, userAccountId))?.plaintext ?? null;
}

async function openTotpSecret(db: DbExecutor, userAccountId: string) {
  const security = await getAccountSecurity(db, userAccountId);
  const key = secretKeyFromEnvironment();
  const sealed = security?.totpSecretSealed;
  if (!sealed || key.status !== "ok") return null;
  const opened = openSecretWithKeyring(sealed, key.key);
  return opened ? { ...opened, sealed, key: key.key } : null;
}

/**
 * The TOTP secret for a check that writes anyway (enabling, verifying). A
 * secret still sealed under the previous key is sealed again under the current
 * one, so a rotation finishes for each account at its next sign-in. The write
 * is conditional on the old ciphertext: two checks at once cannot overwrite
 * each other with anything but the same secret.
 */
async function resealedTotpSecret(db: DbExecutor, userAccountId: string) {
  const opened = await openTotpSecret(db, userAccountId);
  if (!opened) return null;
  if (opened.sealedWithPrevious) {
    await db
      .update(accountSecurity)
      .set({ totpSecretSealed: sealSecret(opened.plaintext, opened.key), updatedAt: nowDate() })
      .where(
        and(
          eq(accountSecurity.userAccountId, userAccountId),
          eq(accountSecurity.totpSecretSealed, opened.sealed),
        ),
      );
  }
  return opened.plaintext;
}

export async function listAccountSessions(db: DbExecutor, userAccountId: string) {
  return db
    .select({
      id: accountSessions.id,
      userAgent: accountSessions.userAgent,
      ipAddress: accountSessions.ipAddress,
      createdAt: accountSessions.createdAt,
      updatedAt: accountSessions.updatedAt,
      expiresAt: accountSessions.expiresAt,
    })
    .from(accountSessions)
    .where(
      and(
        eq(accountSessions.userAccountId, userAccountId),
        gt(accountSessions.expiresAt, nowDate()),
      ),
    )
    .orderBy(accountSessions.createdAt);
}

export async function revokeAccountSession(
  db: DbExecutor,
  userAccountId: string,
  sessionId: string,
) {
  const [row] = await db
    .delete(accountSessions)
    .where(and(eq(accountSessions.userAccountId, userAccountId), eq(accountSessions.id, sessionId)))
    .returning({ id: accountSessions.id });
  return Boolean(row);
}

export async function disableTotp(db: DbExecutor, userAccountId: string): Promise<boolean> {
  const [row] = await db
    .update(accountSecurity)
    .set({
      totpEnabledAt: null,
      totpSecretSealed: null,
      recoveryCodeHashes: [],
      lastTotpStep: null,
      updatedAt: nowDate(),
    })
    .where(eq(accountSecurity.userAccountId, userAccountId))
    .returning({ userAccountId: accountSecurity.userAccountId });
  return Boolean(row);
}

export async function revokeAllAccountSessions(
  db: DbExecutor,
  userAccountId: string,
): Promise<void> {
  await db.delete(accountSessions).where(eq(accountSessions.userAccountId, userAccountId));
}

export async function grantStepUp(
  db: DbExecutor,
  input: {
    userAccountId: string;
    accountSessionId: string;
    purpose: "money" | "export" | "backup";
  },
) {
  const now = nowDate();
  const [session] = await db
    .select({ id: accountSessions.id })
    .from(accountSessions)
    .where(
      and(
        eq(accountSessions.id, input.accountSessionId),
        eq(accountSessions.userAccountId, input.userAccountId),
      ),
    )
    .limit(1);
  if (!session) return null;
  const [row] = await db
    .insert(accountStepUps)
    .values({ ...input, verifiedAt: now, expiresAt: new Date(now.getTime() + STEP_UP_TTL_MS) })
    .returning();
  return row ?? null;
}

export async function hasStepUp(
  db: DbExecutor,
  input: {
    userAccountId: string;
    accountSessionId: string;
    purpose: "money" | "export" | "backup";
  },
) {
  const [row] = await db
    .select({ id: accountStepUps.id })
    .from(accountStepUps)
    .where(
      and(
        eq(accountStepUps.userAccountId, input.userAccountId),
        eq(accountStepUps.accountSessionId, input.accountSessionId),
        eq(accountStepUps.purpose, input.purpose),
        gt(accountStepUps.expiresAt, nowDate()),
      ),
    )
    .limit(1);
  return Boolean(row);
}
