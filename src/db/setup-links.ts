import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { isSetupLinkTokenShape } from "@/lib/setup-links";
import {
  mintCapability,
  openCapability,
  recordSetupLinkSpentBy,
  spendCapability,
} from "./capabilities";
import type { DbExecutor } from "./client";
import { setupRequests } from "./schema";

/**
 * Single-use setup links (ADR 20261009-single-use-setup-links): `shop_setup`
 * capabilities naming their set-up request and no shop (ADR
 * 20261105-capabilities-shop-id-nullable). The rules are in
 * `src/lib/setup-links.ts` and the purpose's record in `CAPABILITY_POLICY`;
 * this is what a setup link means on top of them.
 */

export type IssuedSetupLink = { token: string; expiresAt: Date };

/** Mint a link for one set-up request. The raw token is returned once and never stored. */
export async function issueSetupLink(
  db: DbExecutor,
  input: { setupRequestId: string; now?: Date },
): Promise<IssuedSetupLink> {
  const minted = await mintCapability(db, {
    purpose: "shop_setup",
    shopId: null,
    subjectId: input.setupRequestId,
    now: input.now ?? nowDate(),
  });
  if (!minted.expiresAt) throw new Error("A setup link must expire");
  return { token: minted.token, expiresAt: minted.expiresAt };
}

/** What the form opens with: the answers the request already gave. */
export type OpenSetupLink = {
  shopName: string;
  contactName: string;
  email: string;
};

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
  const live = await openCapability(db, { purpose: "shop_setup", token, now });
  if (!live) return null;
  const [row] = await db
    .select({
      shopName: setupRequests.shopName,
      contactName: setupRequests.contactName,
      email: setupRequests.email,
    })
    .from(setupRequests)
    .where(eq(setupRequests.id, live.subjectId))
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
  return (await spendCapability(db, { purpose: "shop_setup", token, now })) !== null;
}

/**
 * Record which shop a spent link opened, in the transaction that spent it and
 * created the shop, and answer the set-up request the link was minted for.
 */
export async function recordSetupLinkShop(
  db: DbExecutor,
  token: string,
  shopId: string,
): Promise<{ setupRequestId: string } | null> {
  return recordSetupLinkSpentBy(db, { token, shopId });
}
