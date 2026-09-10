import { cookies } from "next/headers";
import type { AppDb } from "@/db/client";
import { verifyShelfToken } from "@/db/person-shelf-tokens";
import { getShelfPageData, type ShelfPageData } from "@/db/shelf";
import { SHELF_COOKIE } from "@/lib/shelf-links";

/**
 * **Who is reading this storefront, when their phone carries their shelf.**
 *
 * The cookie is written on `/shelf/[token]` at this shop's own path, so the
 * browser only offers it back here. That path scoping is the browser's promise
 * rather than ours, so the tenant check is done again in code: the token
 * resolves to a shop, and a shop that is not the one being rendered reads as no
 * cookie at all. Same rule the referral cookie states at length
 * (`src/lib/referrals.ts`) and for the same reason — a cookie is client-held
 * state, and its writer is never the only thing between it and a page.
 *
 * Null covers every refusal at once: no cookie, a cookie for another shop, a
 * token that has been revoked, expired, or names a record that is gone. All of
 * them render the storefront exactly as an anonymous visitor sees it, which is
 * the shipped page and is what the composition test pins.
 *
 * **Never counts as an open.** Only the shelf itself does that
 * (`recordShelfOpen`), so the diver record's number stays a count of visits to
 * the file rather than a count of times a phone wandered past the storefront.
 */
export async function readShelfWelcome(
  db: AppDb,
  input: { shopId: string; now: Date },
): Promise<ShelfPageData | null> {
  const token = (await cookies()).get(SHELF_COOKIE)?.value;
  if (!token) return null;
  const capability = await verifyShelfToken(db, { token, now: input.now });
  if (!capability || capability.shopId !== input.shopId) return null;
  return getShelfPageData(db, {
    shopId: capability.shopId,
    personId: capability.personId,
    now: input.now,
  });
}
