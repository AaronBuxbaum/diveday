import { and, eq, exists, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { CONTACT_EMAIL_CONFIRMATION_TTL_MS } from "@/lib/contact-email-confirmation";
import type { AppDb, DbExecutor } from "./client";
import { shopContactEmailConfirmationTokens, shops } from "./schema";

/**
 * Proving a shop controls its front-desk address (issue #1288). The token is
 * minted for one address, sent only to that address, and consuming it sets
 * `shops.contact_email_confirmed_at` only while the shop still names that
 * address -- so a manager cannot mint on an inbox they control and then bless
 * a different one by editing the field in between. `setShopContact` clears the
 * confirmation on any change of address for the same reason, from the other
 * side.
 */

export type IssuedContactEmailConfirmation = { token: string; tokenId: string; expiresAt: Date };

/** Mints a fresh link for the shop's current address, superseding any outstanding one. */
export async function issueShopContactEmailConfirmation(
  db: AppDb,
  input: { shopId: string; email: string; now?: Date },
): Promise<IssuedContactEmailConfirmation> {
  const now = input.now ?? nowDate();
  const email = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    // Lock the shop row so two saves in flight cannot both leave a live token
    // (same shape as issueAccountToken).
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, input.shopId)).for("update");
    await tx
      .update(shopContactEmailConfirmationTokens)
      .set({ supersededAt: now })
      .where(
        and(
          eq(shopContactEmailConfirmationTokens.shopId, input.shopId),
          isNull(shopContactEmailConfirmationTokens.usedAt),
          isNull(shopContactEmailConfirmationTokens.supersededAt),
        ),
      );
    const token = createBearerToken();
    const expiresAt = new Date(now.getTime() + CONTACT_EMAIL_CONFIRMATION_TTL_MS);
    const [row] = await tx
      .insert(shopContactEmailConfirmationTokens)
      .values({ shopId: input.shopId, email, tokenHash: hashBearerToken(token), expiresAt })
      .returning({ id: shopContactEmailConfirmationTokens.id });
    if (!row) throw new Error("Failed to issue contact email confirmation token");
    return { token, tokenId: row.id, expiresAt };
  });
}

/** The live-token conditions every read and the consume share. */
function liveToken(token: string, now: Date) {
  return and(
    eq(shopContactEmailConfirmationTokens.tokenHash, hashBearerToken(token)),
    isNull(shopContactEmailConfirmationTokens.usedAt),
    isNull(shopContactEmailConfirmationTokens.supersededAt),
    gt(shopContactEmailConfirmationTokens.expiresAt, now),
  );
}

/** The shop still names the address this token was minted for. */
function shopStillNamesAddress() {
  return exists(
    sql`(select 1 from ${shops} where ${shops.id} = ${shopContactEmailConfirmationTokens.shopId} and lower(${shops.contactEmail}) = ${shopContactEmailConfirmationTokens.email})`,
  );
}

/**
 * Read-only: what the confirm page renders for a link that would still work.
 * `null` for an unknown, spent, expired or superseded token, and for one whose
 * address the shop has since changed. Never marks anything; `consume` below is
 * the one gate a mutation may rely on.
 */
export async function checkShopContactEmailConfirmation(
  db: DbExecutor,
  input: { token: string; now?: Date },
): Promise<{ shopId: string; shopName: string; email: string } | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({
      shopId: shopContactEmailConfirmationTokens.shopId,
      shopName: shops.name,
      email: shopContactEmailConfirmationTokens.email,
    })
    .from(shopContactEmailConfirmationTokens)
    .innerJoin(shops, eq(shops.id, shopContactEmailConfirmationTokens.shopId))
    .where(and(liveToken(input.token, now), shopStillNamesAddress()))
    .limit(1);
  return row ?? null;
}

/**
 * Whether this exact token was consumed -- the only thing the page may render a
 * success state from after the redirect, never a caller-controlled query flag
 * (the same rule `/verify/[token]` follows).
 */
export async function wasShopContactEmailConfirmed(
  db: DbExecutor,
  input: { token: string },
): Promise<{ shopName: string; email: string } | null> {
  const [row] = await db
    .select({ shopName: shops.name, email: shopContactEmailConfirmationTokens.email })
    .from(shopContactEmailConfirmationTokens)
    .innerJoin(shops, eq(shops.id, shopContactEmailConfirmationTokens.shopId))
    .where(
      and(
        eq(shopContactEmailConfirmationTokens.tokenHash, hashBearerToken(input.token)),
        isNotNull(shopContactEmailConfirmationTokens.usedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Thrown inside the consume transaction to roll the token claim back. */
const ADDRESS_CHANGED_UNDER_CLAIM = Symbol("diveday:contact-email-address-changed");

/**
 * Atomically claims the token and stamps the shop confirmed, in one
 * transaction: the `WHERE` re-checks every condition -- including that the
 * shop still names the token's address -- at the moment of the update, so two
 * submits of the same link cannot both succeed and a token minted for an old
 * address can never bless a new one.
 *
 * Two things close the window between the claim and the stamp (security
 * review finding on #1296): the shop row is locked first, so a concurrent
 * `setShopContact` serialises behind this transaction rather than slipping a
 * new address in between the two statements; and the stamp itself is
 * conditional on the address, so if it ever matched nothing the claim rolls
 * back with it. PGlite is single-connection, so tests cannot exhibit the
 * race -- the lock is for production Postgres.
 */
export async function consumeShopContactEmailConfirmation(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<{ shopId: string } | null> {
  const now = input.now ?? nowDate();
  try {
    return await db.transaction(async (tx) => {
      const [live] = await tx
        .select({ shopId: shopContactEmailConfirmationTokens.shopId })
        .from(shopContactEmailConfirmationTokens)
        .where(liveToken(input.token, now))
        .limit(1);
      if (!live) return null;
      await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, live.shopId)).for("update");

      const [claimed] = await tx
        .update(shopContactEmailConfirmationTokens)
        .set({ usedAt: now })
        .where(and(liveToken(input.token, now), shopStillNamesAddress()))
        .returning({
          shopId: shopContactEmailConfirmationTokens.shopId,
          email: shopContactEmailConfirmationTokens.email,
        });
      if (!claimed) return null;
      const [stamped] = await tx
        .update(shops)
        .set({ contactEmailConfirmedAt: now })
        .where(
          and(eq(shops.id, claimed.shopId), sql`lower(${shops.contactEmail}) = ${claimed.email}`),
        )
        .returning({ id: shops.id });
      if (!stamped) throw ADDRESS_CHANGED_UNDER_CLAIM;
      return { shopId: claimed.shopId };
    });
  } catch (error) {
    if (error === ADDRESS_CHANGED_UNDER_CLAIM) return null;
    throw error;
  }
}
