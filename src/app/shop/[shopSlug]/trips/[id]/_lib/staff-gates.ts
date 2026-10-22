import {
  canPersonActOnKind,
  canPersonManageOrders,
  canPersonManagePaymentSettings,
  canPersonOverrideCertBlock,
} from "@/db/authz";
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
 * - `mayDiscount`: who is offered "with a discount" on the Offer, and the deals
 *   sent (money work, `canPersonManagePaymentSettings`).
 */
export async function readStaffGates(db: AppDb, shopId: string, personId: string) {
  const [canManageOrders, mayOverrideCertBlock, mayInviteFromWaitlist, mayDiscount] =
    await Promise.all([
      canPersonManageOrders(db, shopId, personId),
      canPersonOverrideCertBlock(db, shopId, personId),
      canPersonActOnKind(db, shopId, personId, "seat_wanted"),
      canPersonManagePaymentSettings(db, shopId, personId),
    ]);
  return { canManageOrders, mayOverrideCertBlock, mayInviteFromWaitlist, mayDiscount };
}
