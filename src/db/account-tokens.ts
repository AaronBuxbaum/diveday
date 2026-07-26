import { and, eq, exists, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  type AccountTokenPurpose,
  createAccountToken,
  hashAccountToken,
  ttlForAccountTokenPurpose,
} from "@/lib/account-tokens";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { accountTokens, userAccounts } from "./schema";

export type IssuedAccountToken = { token: string; tokenId: string; expiresAt: Date };

/**
 * Mints a fresh, purpose-bound token for an account, superseding any prior
 * outstanding token of the same purpose — a diver requesting a second reset
 * link should invalidate the first, not leave two live at once.
 */
export async function issueAccountToken(
  db: AppDb,
  input: { userAccountId: string; purpose: AccountTokenPurpose; now?: Date },
): Promise<IssuedAccountToken> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    // Locks the account row before superseding-then-inserting — under READ
    // COMMITTED, two concurrent issuances (a double-click, a refreshed
    // forgot-password submit) could otherwise both read zero outstanding
    // tokens and both insert, leaving two live at once and violating the
    // "a fresh token supersedes the prior one" invariant (security review
    // finding). Matches saveWaiverTemplate's shop-row lock exactly. PGlite is
    // single-connection so tests can't exhibit the race — the lock is for
    // production Postgres.
    await tx
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.id, input.userAccountId))
      .for("update");
    await tx
      .update(accountTokens)
      .set({ supersededAt: now })
      .where(
        and(
          eq(accountTokens.userAccountId, input.userAccountId),
          eq(accountTokens.purpose, input.purpose),
          isNull(accountTokens.usedAt),
          isNull(accountTokens.supersededAt),
        ),
      );

    const token = createAccountToken();
    const expiresAt = new Date(now.getTime() + ttlForAccountTokenPurpose(input.purpose));
    const [row] = await tx
      .insert(accountTokens)
      .values({
        userAccountId: input.userAccountId,
        purpose: input.purpose,
        tokenHash: hashAccountToken(token),
        expiresAt,
      })
      .returning({ id: accountTokens.id });
    if (!row) throw new Error("Failed to issue account token");
    return { token, tokenId: row.id, expiresAt };
  });
}

/**
 * Read-only validity check for rendering a page (e.g. deciding whether to
 * show a reset form or an "expired" notice) — never marks the token used.
 * The authoritative, one-time gate is `consumeAccountToken`; a caller must
 * never treat this check alone as authorizing a mutation.
 */
export async function checkAccountToken(
  db: DbExecutor,
  input: { token: string; purpose: AccountTokenPurpose; now?: Date },
): Promise<{ userAccountId: string } | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({ userAccountId: accountTokens.userAccountId })
    .from(accountTokens)
    .where(
      and(
        eq(accountTokens.tokenHash, hashAccountToken(input.token)),
        eq(accountTokens.purpose, input.purpose),
        isNull(accountTokens.usedAt),
        isNull(accountTokens.supersededAt),
        gt(accountTokens.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Whether this exact token was genuinely consumed (`consumeAccountToken`
 * succeeded for it) — never whether it merely exists. The one thing a page is
 * allowed to render a "success" state from after a redirect, instead of
 * trusting a caller-controlled query parameter on its own: a garbage token
 * with a forged `?confirmed=1` must still read as failed (security review
 * finding on 20260725-account-lifecycle-emails).
 */
export async function wasAccountTokenConsumed(
  db: DbExecutor,
  input: { token: string; purpose: AccountTokenPurpose },
): Promise<boolean> {
  const [row] = await db
    .select({ id: accountTokens.id })
    .from(accountTokens)
    .where(
      and(
        eq(accountTokens.tokenHash, hashAccountToken(input.token)),
        eq(accountTokens.purpose, input.purpose),
        isNotNull(accountTokens.usedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Atomically claims a token for one-time use: the `WHERE` re-checks every
 * validity condition — including that the account isn't disabled, not just
 * that it wasn't disabled when the token was requested — at the moment of
 * the update, so two concurrent submits of the same link can never both
 * succeed, and a disabled account's outstanding tokens stop working
 * immediately. Deliberately "not disabled" rather than "active": an `invite`
 * token's account starts life `invited`, not `active` (20260726-staff-
 * invite-accounts), and still needs to be consumable. The sole gate a
 * mutating action may rely on. Accepts a transaction so the caller can claim
 * the token and perform its protected mutation (marking an account verified,
 * setting a new password) atomically — a failure between the two must not
 * burn a one-time link for nothing (security review finding).
 */
export async function consumeAccountToken(
  db: DbExecutor,
  input: { token: string; purpose: AccountTokenPurpose; now?: Date },
): Promise<{ userAccountId: string } | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .update(accountTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(accountTokens.tokenHash, hashAccountToken(input.token)),
        eq(accountTokens.purpose, input.purpose),
        isNull(accountTokens.usedAt),
        isNull(accountTokens.supersededAt),
        gt(accountTokens.expiresAt, now),
        exists(
          db
            .select({ one: sql`1` })
            .from(userAccounts)
            .where(
              and(
                eq(userAccounts.id, accountTokens.userAccountId),
                ne(userAccounts.status, "disabled"),
              ),
            ),
        ),
      ),
    )
    .returning({ userAccountId: accountTokens.userAccountId });
  return row ?? null;
}
