import { and, eq, gt, isNull } from "drizzle-orm";
import {
  type AccountTokenPurpose,
  createAccountToken,
  hashAccountToken,
  ttlForAccountTokenPurpose,
} from "@/lib/account-tokens";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { accountTokens } from "./schema";

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
 * Atomically claims a token for one-time use: the `WHERE` re-checks every
 * validity condition at the moment of the update, so two concurrent submits
 * of the same link can never both succeed. The sole gate a mutating action
 * may rely on.
 */
export async function consumeAccountToken(
  db: AppDb,
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
      ),
    )
    .returning({ userAccountId: accountTokens.userAccountId });
  return row ?? null;
}
