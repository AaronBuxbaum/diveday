import { and, eq, exists, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { createAccountToken, hashAccountToken } from "@/lib/account-tokens";
import { nowDate } from "@/lib/clock";
import { SHOP_CONTACT_EMAIL_TTL_MS } from "@/lib/shop-contact-email";
import type { AppDb, DbExecutor } from "./client";
import { shopContactEmailTokens, shops } from "./schema";

export type IssuedShopContactEmailToken = { token: string; tokenId: string; expiresAt: Date };

/**
 * Mints a fresh confirmation link for one shop's contact address, superseding
 * any earlier outstanding one — a manager who saves the field twice should not
 * leave two live links, and the second email is the one they are looking at.
 *
 * Locks the shop row first, for the reason `issueAccountToken` locks the
 * account row: under READ COMMITTED two concurrent saves could each read zero
 * outstanding tokens and each insert, leaving two live at once. PGlite is
 * single-connection so no test can exhibit the race; the lock is for production
 * Postgres.
 */
export async function issueShopContactEmailToken(
  db: AppDb,
  input: { shopId: string; email: string; now?: Date },
): Promise<IssuedShopContactEmailToken> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, input.shopId)).for("update");
    await tx
      .update(shopContactEmailTokens)
      .set({ supersededAt: now })
      .where(
        and(
          eq(shopContactEmailTokens.shopId, input.shopId),
          isNull(shopContactEmailTokens.usedAt),
          isNull(shopContactEmailTokens.supersededAt),
        ),
      );

    const token = createAccountToken();
    const expiresAt = new Date(now.getTime() + SHOP_CONTACT_EMAIL_TTL_MS);
    const [row] = await tx
      .insert(shopContactEmailTokens)
      .values({
        shopId: input.shopId,
        email: input.email,
        tokenHash: hashAccountToken(token),
        expiresAt,
      })
      .returning({ id: shopContactEmailTokens.id });
    if (!row) throw new Error("Failed to issue shop contact email token");
    return { token, tokenId: row.id, expiresAt };
  });
}

/**
 * Read-only validity check, for deciding whether to render a confirm button or
 * an "this link has expired" notice. Never marks anything used — the
 * authoritative one-time gate is {@link confirmShopContactEmail}, and a caller
 * must never treat this alone as authorizing the write.
 */
export async function checkShopContactEmailToken(
  db: DbExecutor,
  input: { token: string; now?: Date },
): Promise<{ shopId: string; email: string } | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({ shopId: shopContactEmailTokens.shopId, email: shopContactEmailTokens.email })
    .from(shopContactEmailTokens)
    .where(
      and(
        eq(shopContactEmailTokens.tokenHash, hashAccountToken(input.token)),
        isNull(shopContactEmailTokens.usedAt),
        isNull(shopContactEmailTokens.supersededAt),
        gt(shopContactEmailTokens.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Whether this exact token was genuinely consumed — never whether it merely
 * exists. The one thing the page may render a success state from after its
 * redirect, rather than trusting a caller-controlled `?confirmed=1`: a garbage
 * token with a forged parameter must still read as failed (the same security
 * review finding `wasAccountTokenConsumed` exists for).
 */
export async function wasShopContactEmailTokenConsumed(
  db: DbExecutor,
  token: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shopContactEmailTokens.id })
    .from(shopContactEmailTokens)
    .where(
      and(
        eq(shopContactEmailTokens.tokenHash, hashAccountToken(token)),
        isNotNull(shopContactEmailTokens.usedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Claims the token and stamps the shop confirmed, in one transaction.
 *
 * Two conditions, both re-checked at the moment of the write rather than when
 * the link was rendered:
 *
 * 1. **The token is still live.** The `WHERE` on the claim carries every
 *    validity condition, so two concurrent submits of the same link can never
 *    both succeed.
 * 2. **The shop's contact email is still the address this link was sent to.**
 *    Without it, a manager could ask for a link at an address they control,
 *    change the field to somebody else's, and open the first link to mark the
 *    second confirmed — which is the whole thing this feature exists to
 *    prevent. A mismatch consumes nothing and returns null: the link is not
 *    burned, it simply does not apply to what the field says now.
 */
export async function confirmShopContactEmail(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<{ shopId: string; email: string } | null> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    // **The shop row first, and locked** — the same order, and for the same
    // reason, as `issueShopContactEmailToken`. It serialises this confirm
    // against a concurrent `setShopContact` on the same shop, so the address
    // cannot move between the claim's check and the stamp below; taking the two
    // locks in the opposite order to the issuer is also how a save racing a
    // confirm deadlocks. The shop is read off the token rather than passed in,
    // because a bearer link is all the caller has.
    const [target] = await tx
      .select({ shopId: shopContactEmailTokens.shopId })
      .from(shopContactEmailTokens)
      .where(eq(shopContactEmailTokens.tokenHash, hashAccountToken(input.token)))
      .limit(1);
    if (!target) return null;
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, target.shopId)).for("update");

    const [claimed] = await tx
      .update(shopContactEmailTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(shopContactEmailTokens.tokenHash, hashAccountToken(input.token)),
          isNull(shopContactEmailTokens.usedAt),
          isNull(shopContactEmailTokens.supersededAt),
          gt(shopContactEmailTokens.expiresAt, now),
          // Condition 2, in the claim's own `WHERE` rather than as a check
          // after it: a mismatch must leave the token unspent, and the same
          // `exists`-inside-the-update shape `consumeAccountToken` uses for
          // "the account is not disabled" gets that without a rollback.
          exists(
            tx
              .select({ one: sql`1` })
              .from(shops)
              .where(
                and(
                  eq(shops.id, shopContactEmailTokens.shopId),
                  eq(shops.contactEmail, shopContactEmailTokens.email),
                ),
              ),
          ),
        ),
      )
      .returning({
        shopId: shopContactEmailTokens.shopId,
        email: shopContactEmailTokens.email,
      });
    if (!claimed) return null;

    // **The address predicate again, on the write itself.** The `exists` above
    // evaluated against an unlocked row, so under READ COMMITTED a
    // `setShopContact` committing between the two statements would have its
    // *new* address stamped confirmed — a manager could hold a link for an
    // inbox they control, fire the confirm and a save of somebody else's
    // address a millisecond apart, and win the race often enough to try again
    // (a lost race consumes nothing). Repeating the predicate here closes the
    // window: the second statement re-reads the latest committed row and
    // matches zero rows unless it is still the address this link proved
    // (`security-reviewer`, issue #1288).
    const [stamped] = await tx
      .update(shops)
      .set({ contactEmailConfirmedAt: now })
      .where(and(eq(shops.id, claimed.shopId), eq(shops.contactEmail, claimed.email)))
      .returning({ id: shops.id });
    return stamped ? claimed : null;
  });
}
