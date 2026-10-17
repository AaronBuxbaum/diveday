import { canPersonActOnKind, canPersonManageOrders, canPersonOverrideCertBlock } from "@/db/authz";
import type { AppDb } from "@/db/client";

/**
 * The staff gates the departure page draws controls from, each read live from
 * the database. The page only decides what to *offer*; every action re-checks.
 *
 * - `canManageOrders`: the per-seat "Create order" door (issue #1925), read for
 *   itself, not borrowed from the discount gate.
 * - `mayOverrideCertBlock`: who is offered "Change anyway" past a missing card.
 * - `mayInviteFromWaitlist`: who is offered Invite, the audience of Today's
 *   wait-list row, which `holdSendAction` holds the same line on (issue #2134).
 */
export async function readStaffGates(db: AppDb, shopId: string, personId: string) {
  const [canManageOrders, mayOverrideCertBlock, mayInviteFromWaitlist] = await Promise.all([
    canPersonManageOrders(db, shopId, personId),
    canPersonOverrideCertBlock(db, shopId, personId),
    canPersonActOnKind(db, shopId, personId, "waitlist_seat"),
  ]);
  return { canManageOrders, mayOverrideCertBlock, mayInviteFromWaitlist };
}
