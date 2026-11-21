"use server";

import { getDb } from "@/db/client";
import { type OrderableCustomer, searchOrderableCustomers } from "@/db/orders";
import { requireStaffSession } from "@/features/accounts/session";

/**
 * **The order forms' customer search** (issue #4601), asked as a staffer types.
 * Scoped to the signed-in staffer's own shop, live people only; a few matches
 * and whether there are more, never the whole shop.
 */
export async function searchOrderCustomersAction(
  query: string,
): Promise<{ customers: OrderableCustomer[]; more: boolean }> {
  const session = await requireStaffSession();
  if (typeof query !== "string") return { customers: [], more: false };
  const db = await getDb();
  return searchOrderableCustomers(db, session.user.shopId, query.slice(0, 100));
}
