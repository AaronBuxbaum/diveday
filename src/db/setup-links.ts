import { and, eq, gt, isNull } from "drizzle-orm";
import { createAccountToken, hashAccountToken } from "@/lib/account-tokens";
import { nowDate } from "@/lib/clock";
import { isSetupLinkTokenShape, SETUP_LINK_TTL_MS } from "@/lib/setup-links";
import type { DbExecutor } from "./client";
import { setupRequests, shopSetupLinks } from "./schema";

/**
 * Single-use setup links (ADR 20261009-single-use-setup-links). The rules are
 * in `src/lib/setup-links.ts`; this is their storage.
 */

export type IssuedSetupLink = { token: string; expiresAt: Date };

/** Mint a link for one set-up request. The raw token is returned once and never stored. */
export async function issueSetupLink(
  db: DbExecutor,
  input: { setupRequestId: string; now?: Date },
): Promise<IssuedSetupLink> {
  const now = input.now ?? nowDate();
  const token = createAccountToken();
  const expiresAt = new Date(now.getTime() + SETUP_LINK_TTL_MS);
  await db.insert(shopSetupLinks).values({
    tokenHash: hashAccountToken(token),
    setupRequestId: input.setupRequestId,
    expiresAt,
    createdAt: now,
  });
  return { token, expiresAt };
}

/** What the form opens with: the answers the request already gave. */
export type OpenSetupLink = {
  shopName: string;
  contactName: string;
  email: string;
};

function openLinkCondition(token: string, now: Date) {
  return and(
    eq(shopSetupLinks.tokenHash, hashAccountToken(token)),
    isNull(shopSetupLinks.spentAt),
    gt(shopSetupLinks.expiresAt, now),
  );
}

/**
 * The request behind a link that still opens the form, or null for anything
 * else: a token of the wrong shape, an unknown one, a spent one, an expired
 * one. The four are one answer on purpose; the page tells nobody which.
 */
export async function openSetupLink(
  db: DbExecutor,
  token: unknown,
  now: Date = nowDate(),
): Promise<OpenSetupLink | null> {
  if (!isSetupLinkTokenShape(token)) return null;
  const [row] = await db
    .select({
      shopName: setupRequests.shopName,
      contactName: setupRequests.contactName,
      email: setupRequests.email,
    })
    .from(shopSetupLinks)
    .innerJoin(setupRequests, eq(setupRequests.id, shopSetupLinks.setupRequestId))
    .where(openLinkCondition(token, now))
    .limit(1);
  return row ?? null;
}

/**
 * Spend a link. Call it inside the transaction that creates the shop: the
 * conditional update is the claim, so of two submissions racing on one link
 * exactly one sees `true`, and a rolled-back shop leaves the link unspent.
 */
export async function spendSetupLink(
  db: DbExecutor,
  token: unknown,
  now: Date = nowDate(),
): Promise<boolean> {
  if (!isSetupLinkTokenShape(token)) return false;
  const spent = await db
    .update(shopSetupLinks)
    .set({ spentAt: now })
    .where(openLinkCondition(token, now))
    .returning({ id: shopSetupLinks.id });
  return spent.length === 1;
}

/**
 * Record which shop a spent link opened, in the transaction that spent it and
 * created the shop.
 */
export async function recordSetupLinkShop(
  db: DbExecutor,
  token: string,
  shopId: string,
): Promise<void> {
  await db
    .update(shopSetupLinks)
    .set({ spentByShopId: shopId })
    .where(eq(shopSetupLinks.tokenHash, hashAccountToken(token)));
}
