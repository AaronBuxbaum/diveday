import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bookingCheckoutBookings,
  bookingPaymentEvents,
  divePackageEntitlements,
  orders,
  paymentOperationIntents,
} from "@/db/schema";

/** Past and pending sources also count: a late provider receipt must not collide with credit. */
export function unsupportedTripCreditSource(shopId: string, bookingId: string | AnyPgColumn) {
  return sql<boolean>`(
    exists(select 1 from ${bookingPaymentEvents} where ${bookingPaymentEvents.shopId} = ${shopId} and ${bookingPaymentEvents.bookingId} = ${bookingId}
      and (${bookingPaymentEvents.amountCents} > 0 or ${bookingPaymentEvents.manualHeldCents} > 0
        or (${bookingPaymentEvents.provider} is not null and ${bookingPaymentEvents.provider} not in ('trip_credit', 'trip_credit_returned'))
        or (${bookingPaymentEvents.provider} is null and ${bookingPaymentEvents.status} in ('paid', 'deposit_paid', 'partly_refunded', 'refunded'))))
    or exists(select 1 from ${bookingCheckoutBookings} where ${bookingCheckoutBookings.shopId} = ${shopId} and ${bookingCheckoutBookings.bookingId} = ${bookingId})
    or exists(select 1 from ${orders} where ${orders.shopId} = ${shopId} and ${orders.bookingId} = ${bookingId})
    or exists(select 1 from ${divePackageEntitlements} where ${divePackageEntitlements.shopId} = ${shopId} and ${divePackageEntitlements.bookingId} = ${bookingId})
    or exists(select 1 from ${paymentOperationIntents} where ${paymentOperationIntents.shopId} = ${shopId} and ${paymentOperationIntents.bookingId} = ${bookingId})
  )`;
}
