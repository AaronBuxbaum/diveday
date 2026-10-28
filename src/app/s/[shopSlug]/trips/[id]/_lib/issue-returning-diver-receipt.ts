import { cookies } from "next/headers";
import {
  type IssuedCapability,
  issueReturningDiverReceipt,
  RETURNING_DIVER_RECEIPT_TTL_MS,
} from "@/db/booking-capabilities";
import type { getBookingForTrip } from "@/db/bookings";
import type { DbExecutor } from "@/db/client";
import { log } from "@/lib/log";
import { RETURNING_DIVER_RECEIPT_COOKIE } from "@/lib/returning-diver";

/** Best-effort, post-booking opt-in; receipt failures never undo a confirmed seat. */
export async function issueReturningDiverReceiptForBooking(
  db: DbExecutor,
  input: {
    optedIn: boolean;
    embed: boolean | undefined;
    shopId: string;
    bookingId: string;
    tripId: string;
    confirmedBooking: Awaited<ReturnType<typeof getBookingForTrip>>;
    redirectCapability: IssuedCapability | null;
  },
): Promise<void> {
  if (
    !input.optedIn ||
    input.embed ||
    !input.redirectCapability ||
    !input.confirmedBooking ||
    input.confirmedBooking.booking.identityUnconfirmedAt !== null ||
    !input.confirmedBooking.person.email
  )
    return;

  try {
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      expectedPersonId: input.confirmedBooking.booking.personId,
      expectedTripId: input.tripId,
      redirectReadinessToken: input.redirectCapability.token,
    });
    if (!receipt) return;

    const cookieStore = await cookies();
    cookieStore.set(RETURNING_DIVER_RECEIPT_COOKIE, receipt.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/ready",
      maxAge: Math.ceil(RETURNING_DIVER_RECEIPT_TTL_MS / 1000),
    });
  } catch (error) {
    // The booking is already confirmed. Memory is optional and cannot turn
    // a successful seat into an error page.
    log("booking.returning_diver_receipt_failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
}
