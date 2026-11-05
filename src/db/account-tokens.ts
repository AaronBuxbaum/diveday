import { and, eq, exists, ne, sql } from "drizzle-orm";
import type { AccountTokenPurpose } from "@/lib/account-tokens";
import { mintCapability, openCapability, spendCapability, verifyCapability } from "./capabilities";
import type { AppDb, DbExecutor } from "./client";
import { capabilities, userAccounts } from "./schema";

/**
 * The account tokens (verify, reset, invite) as `capabilities` rows naming a
 * sign-in account and no shop (ADR 20261105-capabilities-shop-id-nullable).
 * Their policy (one live token per account and purpose, once-use, the time
 * limit) is one record each in `CAPABILITY_POLICY`; this module is what an
 * account token means on top of it.
 */

export type IssuedAccountToken = { token: string; tokenId: string; expiresAt: Date };

/**
 * Mints a fresh, purpose-bound token for an account, superseding any prior
 * outstanding token of the same purpose — a diver requesting a second reset
 * link should invalidate the first, not leave two live at once. The mint locks
 * the account row before it revokes and inserts, so two requests in flight (a
 * double-click, a refreshed forgot-password submit) cannot both leave a live
 * link; the table's partial unique index is the backstop.
 */
export async function issueAccountToken(
  db: AppDb,
  input: { userAccountId: string; purpose: AccountTokenPurpose; now?: Date },
): Promise<IssuedAccountToken> {
  return db.transaction(async (tx) => {
    const minted = await mintCapability(tx, {
      purpose: input.purpose,
      shopId: null,
      subjectId: input.userAccountId,
      now: input.now,
    });
    if (!minted.expiresAt) throw new Error(`${input.purpose} must expire`);
    return { token: minted.token, tokenId: minted.id, expiresAt: minted.expiresAt };
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
  const live = await openCapability(db, input);
  return live ? { userAccountId: live.subjectId } : null;
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
  const known = await verifyCapability(db, input);
  return known?.usedAt != null;
}

/**
 * Atomically claims a token for one-time use: the one conditional update
 * re-checks every validity condition — including that the account isn't
 * disabled, not just that it wasn't disabled when the token was requested —
 * so two concurrent submits of the same link can never both succeed, and a
 * disabled account's outstanding tokens stop working immediately.
 * Deliberately "not disabled" rather than "active": an `invite` token's
 * account starts life `invited`, not `active` (20260726-staff-invite-accounts),
 * and still needs to be consumable. The sole gate a mutating action may rely
 * on. Accepts a transaction so the caller can claim the token and perform its
 * protected mutation (marking an account verified, setting a new password)
 * atomically — a failure between the two must not burn a one-time link for
 * nothing (security review finding).
 */
export async function consumeAccountToken(
  db: DbExecutor,
  input: { token: string; purpose: AccountTokenPurpose; now?: Date },
): Promise<{ userAccountId: string } | null> {
  const spent = await spendCapability(db, {
    ...input,
    alsoRequire: exists(
      db
        .select({ one: sql`1` })
        .from(userAccounts)
        .where(
          and(eq(userAccounts.id, capabilities.userAccountId), ne(userAccounts.status, "disabled")),
        ),
    ),
  });
  return spent ? { userAccountId: spent.subjectId } : null;
}
