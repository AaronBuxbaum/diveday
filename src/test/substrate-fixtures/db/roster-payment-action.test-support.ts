import { and, eq } from "drizzle-orm";
import { createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { trips } from "@/db/schema";

/** A real roster submission; callers supply the current version when needed. */
export function paymentForm(bookingId: string, status: string): FormData {
  const data = new FormData();
  data.set("bookingId", bookingId);
  data.set("status", status);
  return data;
}

export function moneyForm(bookingId: string, status: string, amount: string, method = "cash") {
  const data = paymentForm(bookingId, status);
  data.set("amount", amount);
  data.set("method", method);
  return data;
}

/** A fresh unpaid seat on a $120 departure, so every balance is known. */
export async function unpaidSeatAt120(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(trips)
    .set({ priceCents: 12_000 })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));
  const seated = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Ines Calloway",
    email: "ines.calloway@example.com",
  });
  if (!seated.ok) throw new Error("seat not booked");
  return seated.bookingId;
}
