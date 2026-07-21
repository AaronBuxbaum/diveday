"use server";

import { getDb } from "@/db/client";
import { type SearchResults, searchShop } from "@/db/search";
import { getShopById } from "@/db/shops";
import { requireStaffSession } from "@/lib/session";

/**
 * The command palette's only data source. Auth and shop scope are re-derived
 * from the session on every call, so the query can never reach beyond the
 * signed-in staffer's own shop.
 */
export async function searchShopAction(query: string): Promise<SearchResults> {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return { divers: [], trips: [] };
  return searchShop(db, session.user.shopId, query, shop.timezone);
}
