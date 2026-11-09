import { and, eq, exists, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import type { AccountTokenPurpose } from "@/lib/account-tokens";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { mintCapability, openCapability, spendCapability, verifyCapability } from "./capabilities";
import type { DbExecutor } from "./client";
import { capabilities, personRoles, userAccounts } from "./schema";

/**
 * The account tokens (verify, reset, invite) as `capabilities` rows naming a
 * sign-in account and no shop (ADR 20261105-capabilities-shop-id-nullable).
 * Their policy (one live token per account and purpose, once-use, the time
 * limit) is one record each in `CAPABILITY_POLICY`; this module is what an
 * account token means on top of it.
 */

/** A token was asked for an account that is disabled: none is minted. */
export class DisabledAccountError extends Error {
  constructor() {
    super("account is disabled");
    this.name = "DisabledAccountError";
  }
}

export type IssuedAccountToken = { token: string; tokenId: string; expiresAt: Date };

async function holdsStaffRole(db: DbExecutor, userAccountId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(userAccounts)
    .innerJoin(personRoles, eq(personRoles.personId, userAccounts.personId))
    .where(and(eq(userAccounts.id, userAccountId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  return Boolean(row);
}

/**
 * Mints a fresh, purpose-bound token for an account, superseding any prior
 * outstanding token of the same purpose — a diver requesting a second reset
 * link should invalidate the first, not leave two live at once. The mint locks
 * the account row before it revokes and inserts, so two requests in flight (a
 * double-click, a refreshed forgot-password submit) cannot both leave a live
 * link; the table's partial unique index is the backstop.
 */
export async function issueAccountToken(
  db: DbExecutor,
  input: { userAccountId: string; purpose: AccountTokenPurpose; now?: Date },
): Promise<IssuedAccountToken> {
  return db.transaction(async (tx) => {
    // The mint below locks this row too, so a removal that commits first is seen here: a link
    // minted just after it would be live again on a re-enable (issue #3989, security review).
    const [account] = await tx
      .select({ status: userAccounts.status })
      .from(userAccounts)
      .where(eq(userAccounts.id, input.userAccountId))
      .for("update");
    if (account?.status === "disabled") throw new DisabledAccountError();
    // A removal leaves an invitee `invited` with no staff role (issue #3997): an invite minted
    // after it would open a login for someone no longer on the team.
    if (input.purpose === "invite" && !(await holdsStaffRole(tx, input.userAccountId))) {
      throw new DisabledAccountError();
    }
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
 * The account status each purpose is spent on. An invite and a reset both set a password, so an
 * invite is spent only while the account waits to accept it (issue #3997) and a reset only on an
 * active account: an invitee has none to reset, their way in is the invite (issue #4013). A
 * verification link harms nobody on an invited account, so it only refuses a disabled one.
 */
const ACCOUNT_STATUS_SPENDING = {
  invite: eq(userAccounts.status, "invited"),
  demo_sign_in: eq(userAccounts.status, "active"),
  magic_sign_in: sql`${userAccounts.status} = 'active' and ${userAccounts.emailVerified} = true and ${userAccounts.emailVerifiedAt} is not null`,
  password_reset: eq(userAccounts.status, "active"),
  email_verification: ne(userAccounts.status, "disabled"),
} as const satisfies Record<AccountTokenPurpose, SQL>;

/**
 * Atomically claims a token for one-time use: the one conditional update
 * re-checks every validity condition — including that the account isn't
 * disabled, not just that it wasn't disabled when the token was requested —
 * so two concurrent submits of the same link can never both succeed, and a
 * disabled account's outstanding tokens stop working immediately.
 * Which account statuses each purpose is spent on is `ACCOUNT_STATUS_SPENDING`
 * (20260726-staff-invite-accounts). The sole gate a mutating action may rely
 * on. Accepts a transaction so the caller can claim the token and perform its
 * protected mutation (marking an account verified, setting a new password)
 * atomically — a failure between the two must not burn a one-time link for
 * nothing (security review finding).
 */
export async function consumeAccountToken(
  db: DbExecutor,
  input: { token: string; purpose: AccountTokenPurpose; now?: Date },
): Promise<{ userAccountId: string } | null> {
  // The account before the link: a removal and an erasure lock the account and then withdraw its
  // links, so spending first would take the two the other way round and could deadlock into a 500
  // (issues #4013, #4068). Peek for the account, lock it, then spend, which re-checks every
  // condition under the lock. Inside the caller's transaction the lock lasts to its commit.
  const open = await checkAccountToken(db, input);
  if (!open) return null;
  await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.id, open.userAccountId))
    .for("update");
  const spent = await spendCapability(db, {
    ...input,
    alsoRequire: exists(
      db
        .select({ one: sql`1` })
        .from(userAccounts)
        .where(
          and(
            eq(userAccounts.id, capabilities.userAccountId),
            ACCOUNT_STATUS_SPENDING[input.purpose],
          ),
        ),
    ),
  });
  return spent ? { userAccountId: spent.subjectId } : null;
}

const ACCOUNT_TOKEN_PURPOSES: readonly AccountTokenPurpose[] = [
  "email_verification",
  "password_reset",
  "magic_sign_in",
  "demo_sign_in",
  "invite",
];

/**
 * Turns off every unspent account token an account holds (`revoked_at`), without minting a
 * replacement. Spending already refuses a disabled account, but that refusal lifts on re-enable;
 * a removal calls this so a link mailed before it does not come back to life (issue #3989). The
 * rows stay, so the fact that they were withdrawn stays on record.
 */
export async function withdrawAccountTokens(
  db: DbExecutor,
  input: { userAccountId: string; now?: Date },
): Promise<void> {
  await db
    .update(capabilities)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(capabilities.userAccountId, input.userAccountId),
        inArray(capabilities.purpose, [...ACCOUNT_TOKEN_PURPOSES]),
        isNull(capabilities.usedAt),
        isNull(capabilities.revokedAt),
      ),
    );
}
