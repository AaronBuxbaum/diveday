import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { nowDate, nowMs } from "@/lib/clock";
import { openSecret, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import {
  createTotpSecret,
  generateRecoveryCodes,
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
  await db
    .insert(accountSecurity)
    .values({
      userAccountId,
      totpSecretSealed: sealSecret(secret, key.key),
      recoveryCodeHashes: recoveryCodeHashes(recoveryCodes),
    })
    .onConflictDoUpdate({
      target: accountSecurity.userAccountId,
      set: {
        totpSecretSealed: sealSecret(secret, key.key),
        recoveryCodeHashes: recoveryCodeHashes(recoveryCodes),
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
  const security = await getAccountSecurity(db, userAccountId);
  const key = secretKeyFromEnvironment();
  const secret =
    security?.totpSecretSealed && key.status === "ok"
      ? openSecret(security.totpSecretSealed, key.key)
      : null;
  if (!secret || !verifyTotpCode(secret, code)) return false;
  await db
    .update(accountSecurity)
    .set({ totpEnabledAt: nowDate(), updatedAt: nowDate() })
    .where(eq(accountSecurity.userAccountId, userAccountId));
  return true;
}

/**
 * Verifies a second factor. Sign-in consumes a TOTP time step to prevent a
 * replayed code from creating another session; step-up and factor-management
 * checks can validate the still-current TOTP window without consuming it so a
 * staff member is not locked out of the next action immediately after sign-in.
 * A recovery code is always removed atomically from the stored hash list.
 */
export async function verifyAccountSecondFactor(
  db: DbExecutor,
  userAccountId: string,
  code: string,
  options: { consumeTotpStep?: boolean } = {},
): Promise<boolean> {
  const security = await getAccountSecurity(db, userAccountId);
  if (!security?.totpEnabledAt) return true;

  const secret = await getTotpSecret(db, userAccountId);
  const now = nowMs();
  const step = Math.floor(now / 1_000 / 30);
  if (secret && verifyTotpCode(secret, code, now)) {
    if (options.consumeTotpStep === false) return true;
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

  const recoveryHash = recoveryCodeHashes([code.trim().toUpperCase()])[0];
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

export async function getTotpSecret(db: DbExecutor, userAccountId: string) {
  const security = await getAccountSecurity(db, userAccountId);
  const key = secretKeyFromEnvironment();
  return security?.totpSecretSealed && key.status === "ok"
    ? openSecret(security.totpSecretSealed, key.key)
    : null;
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
