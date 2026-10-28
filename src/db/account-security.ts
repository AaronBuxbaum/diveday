import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { nowDate, nowMs } from "@/lib/clock";
import {
  openingKeys,
  openSecretWithKeyring,
  type StoredSealing,
  sealingKey,
  sealSecret,
  secretKeyFingerprint,
  secretKeyFromEnvironment,
} from "@/lib/secret-box";
import {
  createTotpSecret,
  generateRecoveryCodes,
  matchTotpStep,
  recoveryCodeHashes,
} from "@/lib/totp";
import type { AppDb, DbExecutor } from "./client";
import {
  accountSecurity,
  accountSessions,
  accountSignInChallenges,
  accountStepUps,
  userAccounts,
} from "./schema";

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
  const keyId = secretKeyFingerprint(sealingKey(key.key));
  const issued = {
    totpSecretSealed: sealSecret(secret, key.key),
    totpSecretKeyId: keyId,
    recoveryCodeHashes: hashes,
    recoveryCodesKeyId: keyId,
  };
  await db
    .insert(accountSecurity)
    .values({ userAccountId, ...issued })
    .onConflictDoUpdate({
      target: accountSecurity.userAccountId,
      set: {
        ...issued,
        totpEnabledAt: null,
        lastTotpStep: null,
        updatedAt: nowDate(),
      },
    });
  return { secret, recoveryCodes };
}

type RecoveryCodeRefreshResult =
  | { ok: true; codes: string[] }
  | { ok: false; reason: "invalid" | "unavailable" };

/**
 * Replace the recovery codes for an enabled account after a fresh second
 * factor. The account row lock serializes rotation with disable; the
 * recovery-hash compare-and-swap also prevents two concurrent refreshes from
 * returning different valid code sets to the same account.
 */
export async function refreshAccountRecoveryCodes(
  db: AppDb,
  userAccountId: string,
  code: string,
): Promise<RecoveryCodeRefreshResult> {
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") return { ok: false, reason: "unavailable" };

  return db.transaction(async (tx): Promise<RecoveryCodeRefreshResult> => {
    await tx
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.id, userAccountId))
      .for("update");

    const current = await getAccountSecurity(tx, userAccountId);
    if (!current?.totpEnabledAt || !current.totpSecretSealed) {
      return { ok: false, reason: "invalid" };
    }
    if (!(await verifyAccountSecondFactor(tx, userAccountId, code, { consumeTotpStep: false }))) {
      return { ok: false, reason: "invalid" };
    }

    // Recovery-code verification spends one code in this transaction.
    // Snapshot the resulting hash list, then replace only if that exact state
    // is still current.
    const verified = await getAccountSecurity(tx, userAccountId);
    if (
      !verified?.totpEnabledAt ||
      !verified.totpSecretSealed ||
      verified.totpEnabledAt.getTime() !== current.totpEnabledAt.getTime() ||
      verified.totpSecretSealed !== current.totpSecretSealed
    ) {
      return { ok: false, reason: "unavailable" };
    }

    const codes = generateRecoveryCodes();
    const keyId = secretKeyFingerprint(sealingKey(key.key));
    const [row] = await tx
      .update(accountSecurity)
      .set({
        recoveryCodeHashes: recoveryCodeHashes(codes, sealingKey(key.key), userAccountId),
        recoveryCodesKeyId: keyId,
        updatedAt: nowDate(),
      })
      .where(
        and(
          eq(accountSecurity.userAccountId, userAccountId),
          eq(accountSecurity.totpEnabledAt, verified.totpEnabledAt),
          eq(accountSecurity.totpSecretSealed, verified.totpSecretSealed),
          sql`${accountSecurity.recoveryCodeHashes} = ${JSON.stringify(verified.recoveryCodeHashes)}::jsonb`,
        ),
      )
      .returning({ userAccountId: accountSecurity.userAccountId });

    return row ? { ok: true, codes } : { ok: false, reason: "unavailable" };
  });
}

/**
 * Turns two-factor on once a code proves the secret was scanned. The code
 * spends its time step, as sign-in does, so the one typed here cannot be
 * replayed at sign-in inside its window.
 */
export async function enableTotp(
  db: DbExecutor,
  userAccountId: string,
  code: string,
): Promise<boolean> {
  const security = await getAccountSecurity(db, userAccountId);
  const opened = openTotpSecret(security);
  const step = opened ? matchTotpStep(opened.plaintext, code, nowMs()) : null;
  if (!opened || step === null) return false;
  const [row] = await db
    .update(accountSecurity)
    .set({ totpEnabledAt: nowDate(), lastTotpStep: step, updatedAt: nowDate() })
    .where(
      and(
        eq(accountSecurity.userAccountId, userAccountId),
        or(isNull(accountSecurity.lastTotpStep), lt(accountSecurity.lastTotpStep, step)),
      ),
    )
    .returning({ userAccountId: accountSecurity.userAccountId });
  if (!row) return false;
  await recordCurrentKey(db, userAccountId, opened);
  return true;
}

/**
 * Verifies a second factor. Sign-in spends the TOTP time step, so a replayed
 * code cannot open another session. Step-up and turning two-factor off pass
 * `consumeTotpStep: false`: they check the still-current window without
 * spending it, so a staffer is not locked out of the next action right after
 * signing in (Aaron's call, 2026-10-15). A recovery code is always removed
 * atomically from the stored hash list.
 */
export async function verifyAccountSecondFactor(
  db: DbExecutor,
  userAccountId: string,
  code: string,
  options: { consumeTotpStep?: boolean } = {},
): Promise<boolean> {
  const security = await getAccountSecurity(db, userAccountId);
  if (!security?.totpEnabledAt) return true;

  const opened = openTotpSecret(security);
  const now = nowMs();
  // The step the code was *for*, which with drift accepted is not always the
  // current one -- consuming the current step would leave the real one live.
  const step = opened ? matchTotpStep(opened.plaintext, code, now) : null;
  if (step !== null) {
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
    if (row && opened) await recordCurrentKey(db, userAccountId, opened);
    return Boolean(row);
  }

  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") return false;
  // A code issued before a key rotation was hashed under the previous key, and
  // cannot be re-hashed without its plaintext: each one is tried under both.
  for (const candidate of openingKeys(key.key)) {
    // A spent code also tells us which key hashed the row's codes, all of
    // which were issued together.
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
      recoveryCodesKeyId: secretKeyFingerprint(key),
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
 * What every account with two-factor on holds under the sealing key, for the
 * deploy's check that the keyring still opens it (`keyringOpensStored`,
 * `scripts/check-sealing-keys.ts`; issue #2999). An enrolment never confirmed
 * locks nobody out and is left out; so are recovery codes all spent.
 */
export async function storedSealings(db: DbExecutor): Promise<StoredSealing[]> {
  const rows = await db
    .select({
      sealed: accountSecurity.totpSecretSealed,
      codesKeyId: accountSecurity.recoveryCodesKeyId,
      codes: sql<number>`jsonb_array_length(${accountSecurity.recoveryCodeHashes})`,
    })
    .from(accountSecurity)
    .where(isNotNull(accountSecurity.totpEnabledAt));
  return rows.map((row) => ({
    sealed: row.sealed,
    codesKeyId: Number(row.codes) > 0 ? row.codesKeyId : null,
  }));
}

/**
 * The account's TOTP secret, or null when there is none or no key opens it.
 * Read-only: the security page shows it during enrolment.
 */
export async function getTotpSecret(db: DbExecutor, userAccountId: string) {
  return openTotpSecret(await getAccountSecurity(db, userAccountId))?.plaintext ?? null;
}

type AccountSecurityRow = NonNullable<Awaited<ReturnType<typeof getAccountSecurity>>>;

function openTotpSecret(security: AccountSecurityRow | null) {
  const key = secretKeyFromEnvironment();
  const sealed = security?.totpSecretSealed;
  if (!sealed || key.status !== "ok") return null;
  const opened = openSecretWithKeyring(sealed, key.key);
  return opened ? { ...opened, sealed, keyId: security.totpSecretKeyId, key: key.key } : null;
}

/**
 * After a code has been accepted: a secret still sealed under the previous key
 * is sealed again under the current one, so a rotation finishes for each
 * account at its next sign-in, and the row records the current key's
 * fingerprint. Only after acceptance: a wrong code writes nothing. The write is
 * conditional on the old ciphertext, so a concurrent re-enrolment is never
 * overwritten with the old secret.
 */
async function recordCurrentKey(
  db: DbExecutor,
  userAccountId: string,
  opened: NonNullable<ReturnType<typeof openTotpSecret>>,
) {
  const currentId = secretKeyFingerprint(sealingKey(opened.key));
  if (!opened.sealedWithPrevious && opened.keyId === currentId) return;
  await db
    .update(accountSecurity)
    .set({
      ...(opened.sealedWithPrevious
        ? { totpSecretSealed: sealSecret(opened.plaintext, opened.key) }
        : {}),
      totpSecretKeyId: currentId,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(accountSecurity.userAccountId, userAccountId),
        eq(accountSecurity.totpSecretSealed, opened.sealed),
      ),
    );
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
  return db.transaction(async (tx) => {
    await tx
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.id, userAccountId))
      .for("update");
    const [row] = await tx
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

    await tx
      .delete(accountSignInChallenges)
      .where(eq(accountSignInChallenges.userAccountId, userAccountId));
    return Boolean(row);
  });
}

export async function revokeAllAccountSessions(
  db: DbExecutor,
  userAccountId: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.id, userAccountId))
      .for("update");
    await tx.delete(accountSessions).where(eq(accountSessions.userAccountId, userAccountId));
    await tx
      .delete(accountSignInChallenges)
      .where(eq(accountSignInChallenges.userAccountId, userAccountId));
  });
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
