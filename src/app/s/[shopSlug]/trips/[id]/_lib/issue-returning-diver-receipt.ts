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

/** The optional memory path must never hold a committed booking past this budget. */
export const RETURNING_DIVER_RECEIPT_ISSUE_BUDGET_MS = 500;

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

  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const issue = issueReturningDiverReceipt(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      expectedPersonId: input.confirmedBooking.booking.personId,
      expectedTripId: input.tripId,
      redirectReadinessToken: input.redirectCapability.token,
    }).then(
      (receipt) => ({ kind: "finished" as const, receipt }),
      (error: unknown) => {
        log("booking.returning_diver_receipt_failed", "error", {
          bookingId: input.bookingId,
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
        return { kind: "failed" as const };
      },
    );
    const timedOut = new Promise<{ kind: "timed_out" }>((resolve) => {
      budgetTimer = setTimeout(
        () => resolve({ kind: "timed_out" }),
        RETURNING_DIVER_RECEIPT_ISSUE_BUDGET_MS,
      );
    });
    const result = await Promise.race([issue, timedOut]);
    if (result.kind === "timed_out") {
      log("booking.returning_diver_receipt_timed_out", "warn", {
        bookingId: input.bookingId,
        budgetMs: RETURNING_DIVER_RECEIPT_ISSUE_BUDGET_MS,
      });
      return;
    }
    if (result.kind !== "finished") return;
    const receipt = result.receipt;
    if (!receipt) return;

    const cookieStore = await cookies();
    // There is one pending receipt slot on the device. If two opted-in
    // bookings finish concurrently, the last Set-Cookie response wins. Each
    // receipt stays bound to its own booking and shop, so the winner can never
    // combine or overwrite identity fields from another receipt.
    cookieStore.set(RETURNING_DIVER_RECEIPT_COOKIE, receipt.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.ceil(RETURNING_DIVER_RECEIPT_TTL_MS / 1000),
    });
  } catch (error) {
    // The booking is already confirmed. Memory is optional and cannot turn
    // a successful seat into an error page.
    log("booking.returning_diver_receipt_failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  } finally {
    if (budgetTimer) clearTimeout(budgetTimer);
  }
}
