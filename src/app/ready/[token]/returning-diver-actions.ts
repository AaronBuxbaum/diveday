"use server";

import { cookies } from "next/headers";
import { consumeReturningDiverReceipt } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { RETURNING_DIVER_RECEIPT_COOKIE } from "@/lib/returning-diver";

/**
 * Redeem the one-use browser receipt only after the ready page hydrates. A
 * server render or RSC prefetch never consumes it. The readiness token is
 * untrusted input; the DB requires it to match the exact undelivered redirect
 * capability recorded on the receipt.
 */
export async function redeemReturningDiverReceipt(
  redirectReadinessToken: string,
): Promise<{ diver: { fullName: string; email: string }; expiresAt: number } | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(redirectReadinessToken)) return null;

  try {
    const cookieStore = await cookies();
    const receiptToken = cookieStore.get(RETURNING_DIVER_RECEIPT_COOKIE)?.value;
    if (!receiptToken || !/^[A-Za-z0-9_-]{20,128}$/.test(receiptToken)) return null;

    const redeemed = await consumeReturningDiverReceipt(await getDb(), {
      receiptToken,
      redirectReadinessToken,
    });
    if (!redeemed) return null;

    try {
      cookieStore.delete(RETURNING_DIVER_RECEIPT_COOKIE);
    } catch {
      // The receipt is already consumed; its short cookie expiry is a fallback.
    }
    return { diver: redeemed.diver, expiresAt: redeemed.memoryExpiresAt };
  } catch {
    // Memory is a convenience. A DB or cookie failure cannot turn a confirmed
    // booking into an error state or hide the server-rendered confirmation.
    return null;
  }
}
