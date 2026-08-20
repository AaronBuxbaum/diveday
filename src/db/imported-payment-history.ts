/**
 * Read model for historical payment, refund, and receipt evidence imported
 * from another system. It intentionally stays outside `orders.ts`: an
 * imported source row is not a local invoice and must never pick up Stripe
 * actions, booking-payment effects, or an order-detail route by association.
 */

import { and, count, desc, eq, gte, ilike, lte } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import type { DbExecutor } from "./client";
import { offsetPage } from "./paging";
import { importedPaymentHistory, people } from "./schema";

/** A second bounded list inside Orders; source history can span decades. */
export const IMPORTED_PAYMENT_HISTORY_PAGE_SIZE = 25;

export type ImportedPaymentHistoryFilter = {
  personId?: string;
  personQuery?: string;
  /** Calendar-date bounds are inclusive because the column has no time-of-day. */
  from?: CalendarDate;
  to?: CalendarDate;
};

function importedPaymentHistoryWhere(shopId: string, filter: ImportedPaymentHistoryFilter) {
  // The writer always links evidence to a person in the same shop, but the
  // table's two ordinary foreign keys cannot express that composite tenant
  // invariant. Keep the read fail-closed as well: a malformed direct row must
  // never make another shop's diver name visible in Orders.
  const conditions = [eq(importedPaymentHistory.shopId, shopId), eq(people.shopId, shopId)];
  if (filter.personId) conditions.push(eq(importedPaymentHistory.personId, filter.personId));
  if (filter.personQuery) conditions.push(ilike(people.fullName, `%${filter.personQuery}%`));
  if (filter.from) conditions.push(gte(importedPaymentHistory.occurredOn, filter.from));
  if (filter.to) conditions.push(lte(importedPaymentHistory.occurredOn, filter.to));
  return and(...conditions);
}

/**
 * One bounded, tenant-scoped page of imported source evidence. The two Orders
 * date inputs apply only when staff choose an explicit custom range: the usual
 * “last 90 days” view is for current shop invoices, while a migration's older
 * history should remain discoverable by default.
 */
export async function listImportedPaymentHistory(
  db: DbExecutor,
  shopId: string,
  filter: ImportedPaymentHistoryFilter = {},
  page: { page?: number; pageSize?: number } = {},
) {
  const where = importedPaymentHistoryWhere(shopId, filter);
  return offsetPage({
    page: page.page,
    pageSize: page.pageSize ?? IMPORTED_PAYMENT_HISTORY_PAGE_SIZE,
    countRows: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(importedPaymentHistory)
        .innerJoin(people, eq(people.id, importedPaymentHistory.personId))
        .where(where);
      return row?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({ history: importedPaymentHistory, person: people })
        .from(importedPaymentHistory)
        .innerJoin(people, eq(people.id, importedPaymentHistory.personId))
        .where(where)
        // Calendar dates are not unique (a sales export has a whole day's
        // receipts), so importedAt/id make a page boundary stable.
        .orderBy(
          desc(importedPaymentHistory.occurredOn),
          desc(importedPaymentHistory.importedAt),
          desc(importedPaymentHistory.id),
        )
        .limit(limit)
        .offset(offset),
  });
}
