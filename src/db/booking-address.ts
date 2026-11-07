import { getTableColumns, sql } from "drizzle-orm";
import { bookings, people } from "./schema";

/**
 * **Where a seat's mail goes**: the shared inbox it was booked from when its
 * diver holds no address of their own (`bookings.delivery_email`, Aaron
 * 2026-11-06), else the diver's own email. For a select over `bookings` joined
 * to `people`; a person-scoped send has no seat and reads `people.email`.
 */
export const bookingAddress = sql<
  string | null
>`coalesce(${bookings.deliveryEmail}, ${people.email})`.mapWith(people.email);

/** The seat's person row with {@link bookingAddress} in its `email`. */
export const bookingRecipient = { ...getTableColumns(people), email: bookingAddress };
