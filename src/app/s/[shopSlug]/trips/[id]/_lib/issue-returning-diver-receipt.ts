import { type IssuedCapability, issueReturningDiverReceipt } from "@/db/booking-capabilities";
import type { getBookingForTrip } from "@/db/bookings";
import type { DbExecutor } from "@/db/client";
import { log } from "@/lib/log";
import { RETURNING_DIVER_DEVICE_TOKEN_PATTERN } from "@/lib/returning-diver";

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
    deviceToken: string | null;
    deviceGeneration: string | null;
  },
): Promise<void> {
  if (
    !input.optedIn ||
    input.embed ||
    !input.redirectCapability ||
    !input.deviceToken ||
    !RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test(input.deviceToken) ||
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
      deviceToken: input.deviceToken,
      deviceGeneration: input.deviceGeneration,
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

    // The opt-in slot is tab-scoped and already present in sessionStorage.
    // No per-booking Set-Cookie response can overwrite a concurrent receipt.
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
