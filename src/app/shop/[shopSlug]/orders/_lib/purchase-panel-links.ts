import { shopPath } from "@/lib/staff-notices";
import type { OrdersSearch } from "./orders-search";

/** Open/close only this panel; preserve the ledger's current filters and page. */
export function purchasePanelHref(shopSlug: string, search: OrdersSearch, open: boolean) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (value && !["purchase", "notice", "add", "bookingId"].includes(key)) params.set(key, value);
  if (open) params.set("purchase", "1");
  const query = params.toString();
  return `${shopPath(shopSlug, "orders")}${query ? `?${query}` : ""}`;
}
