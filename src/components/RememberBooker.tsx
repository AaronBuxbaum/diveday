"use client";

import { useLayoutEffect } from "react";
import { saveReturningDiver } from "@/lib/returning-diver";

/**
 * Renders nothing — after hydration, asks the server to redeem the one-use
 * browser receipt. Only its successful response authorizes the client to write
 * the lead's name/email to this shop's 30-day device memory.
 *
 * Mounted only on the immediate `/ready` confirmation. The query flag alone
 * authorizes nothing: the server receipt is bound to the separate,
 * undelivered redirect readiness capability and exact booking.
 */
export function RememberBooker({
  shopSlug,
  redirectReadinessToken,
  redeemReceipt,
}: {
  shopSlug: string;
  redirectReadinessToken: string;
  redeemReceipt: (
    token: string,
  ) => Promise<{ diver: { fullName: string; email: string }; expiresAt: number } | null>;
}) {
  useLayoutEffect(() => {
    void redeemReceipt(redirectReadinessToken)
      .then((redeemed) => {
        if (redeemed) {
          saveReturningDiver(shopSlug, redeemed.diver, redeemed.expiresAt);
        }
      })
      .catch(() => {
        // This best-effort convenience never changes the booking confirmation.
      });
  }, [redirectReadinessToken, redeemReceipt, shopSlug]);
  return null;
}
