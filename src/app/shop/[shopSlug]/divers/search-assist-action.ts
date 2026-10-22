"use server";

import { shopAssist } from "@/db/assist-shop";
import { loadActiveStaffRoles } from "@/db/authz";
import { DIVER_FILTERS } from "@/db/divers";
import {
  DIVER_SEARCH_FEATURE,
  DIVER_SEARCH_MAX_ASK,
  diverSearchCall,
  diverSearchFilters,
} from "@/lib/assists/diver-search";
import { canDeleteDiver } from "@/lib/authz";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { rosterHref } from "./_components/RosterOrderLine";

/**
 * **search**: the roster's plain-words ask, answered as the roster's own URL.
 * Only the ask and the list's view names go to Claude, never a diver's row;
 * the list then runs its ordinary query. "Removed" is offered only to a
 * staffer who may see removed divers, exactly as the chip is.
 */
export async function askRosterAction(shopSlug: string, rawAsk: string): Promise<string | null> {
  const ask = typeof rawAsk === "string" ? rawAsk.trim().slice(0, DIVER_SEARCH_MAX_ASK) : "";
  if (!ask) return null;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const roles = await loadActiveStaffRoles(db, shop.id, session.user.personId);
  const canDelete = roles !== null && canDeleteDiver(roles);
  const views = DIVER_FILTERS.filter((view) => view !== "removed" || canDelete) as [
    (typeof DIVER_FILTERS)[number],
    ...(typeof DIVER_FILTERS)[number][],
  ];
  const value = await shopAssist(db, {
    shopId: shop.id,
    feature: DIVER_SEARCH_FEATURE,
    call: diverSearchCall(ask, views),
  });
  const filters = diverSearchFilters(value, ask);
  if (!filters) return null;
  return rosterHref(shopPath(shopSlug, "divers"), {
    query: filters.query,
    filter: filters.view,
    sort: filters.sort,
  });
}
