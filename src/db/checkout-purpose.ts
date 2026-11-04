import { eq, sql } from "drizzle-orm";

import { bookingCheckouts } from "@/db/schema";

/**
 * The two halves of `booking_checkouts` (issue #2718). A seat's checkout and a
 * post-trip tip share one table and one Stripe session-id space, so every read
 * names which it means: a tip that leaked into a fare reader would settle,
 * refund, recover or report a seat nobody bought. The checkout-purpose guard
 * (`scripts/check-checkout-purpose.mjs`) refuses a read of the table, or of its
 * booking links, that names neither and does not say why.
 */
export const fareCheckout = () => eq(bookingCheckouts.purpose, "fare");

/** A post-trip tip (ADR 20260726-post-trip-tipping). */
export const tipCheckout = () => eq(bookingCheckouts.purpose, "tip");

/**
 * What a completed tip came to: Stripe's own settled figure, else the amount
 * the diver chose (the two agree for a tip, which no promotion discounts).
 * What the diver paid, refunds not taken off: the data export's figure.
 */
export const tipAmountCents = sql<number>`coalesce(${bookingCheckouts.settledTotalCents}, ${bookingCheckouts.totalCents})`;

/**
 * What the shop still holds of a completed tip: {@link tipAmountCents} less
 * what Stripe has reversed off it, by a refund or a lost dispute
 * (`booking_checkouts.refunded_cents`, issue #3736). The figure every split,
 * sheet and total of tips adds up; never below zero.
 */
export const tipNetCents = sql<number>`greatest(coalesce(${bookingCheckouts.settledTotalCents}, ${bookingCheckouts.totalCents}) - ${bookingCheckouts.refundedCents}, 0)`;
