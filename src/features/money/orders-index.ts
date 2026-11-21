import { listPaidAfterCloseCheckouts } from "@/features/money/checkouts-paid-after-close";
import { latestShopPayouts } from "@/features/money/payouts";
import { recordedPurchaseDay } from "@/features/money/recorded-purchases";
import { roomChargesByHotel } from "@/features/money/room-charges";
import { listUnattributedRefunds } from "@/features/money/unattributed-refunds";
import {
  type ImportedPaymentHistoryFilter,
  listImportedPaymentHistory,
} from "@/features/records/imported-payment-history";
import { readActiveStaffRoles } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { pagedOrdersByDay, type ShopOrderFilter } from "../../db/orders";
import { getShopPersonName } from "../../db/people";
import { orderStatus } from "../../db/schema/index";
import { canAcceptPayments, getShopStripeAccount } from "../../db/stripe-accounts";
import { getShopTripTitle } from "../../db/trips";
import { readUnfinished } from "../../db/unfinished";
import { canManageOrders, canManagePaymentSettings, canViewShopReports } from "../../lib/authz";
import { nowDate } from "../../lib/clock";
import { shopMonthBounds, utcToWallTime } from "../../lib/zoned";

export { ORDER_DEFAULT_RANGE_DAYS } from "../../db/orders";

/** Every order status, in the enum's order: the Orders filter's choices. */
export const ORDER_STATUSES = orderStatus.enumValues;

/**
 * The back office beside the ledger, read only for payment-settings managers
 * (`visible`): stuck payment operations, refunds the shop owes, checkouts paid
 * after close, failed and unattributed refunds, and payouts with this month's
 * room charges per hotel (fifth-loop ideas, item 57). Unattributed refunds
 * stay separate (ADRs 20260813-shop-cancellation-refunds-itself and
 * 20261012-payouts-reach-diveday).
 */
export async function readBackOffice(
  db: AppDb,
  shop: { id: string; timezone: string },
  visible: boolean,
) {
  const shopId = shop.id;
  if (!visible) {
    return {
      stuckPaymentOperations: [],
      owedRefunds: [],
      paidAfterClose: [],
      failedRefunds: [],
      unattributedRefunds: [],
      payouts: { paid: null, failed: null, roomCharges: null },
    };
  }
  const wall = utcToWallTime(nowDate(), shop.timezone);
  const month = { year: wall.year, month: wall.month };
  const { from, to } = shopMonthBounds(month, shop.timezone);
  const [unfinished, paidAfterClose, unattributedRefunds, latest, totals] = await Promise.all([
    readUnfinished(db, shopId, {
      payment_operation: { withoutUnattributedRefunds: true },
      shop_cancellation_refund: {},
      failed_refund: {},
    }),
    listPaidAfterCloseCheckouts(db, shopId),
    listUnattributedRefunds(db, shopId),
    latestShopPayouts(db, shopId),
    roomChargesByHotel(db, shopId, from, to),
  ]);
  const {
    payment_operation: stuckPaymentOperations,
    shop_cancellation_refund: owedRefunds,
    failed_refund: failedRefunds,
  } = unfinished;
  const payouts = { ...latest, roomCharges: { month: month.month, totals } };
  return {
    stuckPaymentOperations,
    owedRefunds,
    paidAfterClose,
    failedRefunds,
    unattributedRefunds,
    payouts,
  };
}

/**
 * The Orders index's question in one call: whether the shop takes payments,
 * what this person may do (reconcile payments, create orders, export), the
 * back office for a reconciler, one page of the day ledger under the filter,
 * one page of imported history (none for a departure's view: imported records
 * carry no departure), and the names the person and trip filters show even
 * when nothing matches.
 *
 * Unauthorized staff never trigger the privileged reconciliation read.
 */
export async function getOrdersIndex(
  db: AppDb,
  shop: { id: string; timezone: string },
  personId: string,
  input: {
    filter: ShopOrderFilter;
    page: number;
    imported: { filter: ImportedPaymentHistoryFilter; page: number } | null;
    personFilter: string | undefined;
    tripFilter: string | undefined;
    receiptDay?: string;
  },
) {
  // Share a fresh authorization snapshot for this surface, never a render-cached result.
  const roles = await readActiveStaffRoles(db, shop.id, personId);
  const reconcile = roles !== null && canManagePaymentSettings(roles);
  const manageOrders = roles !== null && canManageOrders(roles);
  const exportOrders = roles !== null && canViewShopReports(roles);
  const [
    stripeAccount,
    backOffice,
    ledger,
    importedHistoryPage,
    filteredPersonName,
    filteredTripTitle,
    purchaseDay,
  ] = await Promise.all([
    getShopStripeAccount(db, shop.id),
    readBackOffice(db, shop, reconcile),
    pagedOrdersByDay(db, shop.id, shop.timezone, input.filter, { page: input.page }),
    input.imported
      ? listImportedPaymentHistory(db, shop.id, input.imported.filter, {
          page: input.imported.page,
        })
      : null,
    input.personFilter ? getShopPersonName(db, shop.id, input.personFilter) : null,
    input.tripFilter ? getShopTripTitle(db, shop.id, input.tripFilter) : null,
    recordedPurchaseDay(db, shop, personId, input.receiptDay),
  ]);
  return {
    paymentsConnected: canAcceptPayments(stripeAccount),
    can: { reconcilePayments: reconcile, manageOrders, exportOrders },
    backOffice,
    ledger,
    importedHistoryPage,
    filteredPersonName,
    filteredTripTitle,
    purchaseDay,
  };
}
