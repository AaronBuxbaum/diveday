"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  acknowledgeReturningDiverMemory,
  prepareReturningDiverMemory,
  revokeClearedReturningDiverReceipt,
} from "@/app/actions/returning-diver-memory";
import {
  saveReturningDiver,
  snapshotReturningDiverClearGenerations,
  subscribeToReturningDiverClears,
} from "@/lib/returning-diver";

/**
 * Retries an opted-in write on same-origin public navigation; renders nothing.
 * Browser shutdown before hydration still cannot guarantee the local write.
 */
export function RetryReturningDiverMemory() {
  const pathname = usePathname();

  useEffect(
    () =>
      subscribeToReturningDiverClears(({ shopSlug, receiptId }) => {
        if (receiptId) void revokeClearedReturningDiverReceipt(shopSlug, receiptId);
      }),
    [],
  );

  useEffect(() => {
    // This receipt belongs to a diver's public flow. Staff pages on a shared
    // shop device must never resolve it or persist diver details there.
    if (!pathname || !(pathname.startsWith("/s/") || pathname.startsWith("/ready/"))) return;
    let active = true;
    const clearSnapshot = snapshotReturningDiverClearGenerations();
    void prepareReturningDiverMemory()
      .then(async (result) => {
        if (!active || !result) return;
        const saved = saveReturningDiver(
          result.shopSlug,
          result.diver,
          result.expiresAt,
          undefined,
          {
            id: result.receiptId,
            generationAtStart: clearSnapshot?.[result.shopSlug] ?? null,
          },
        );
        // An explicit clear is itself final: acknowledge the receipt so it
        // cannot keep retrying, while storage failures remain retryable.
        if (saved !== "unavailable" && active)
          await acknowledgeReturningDiverMemory(result.receiptId);
      })
      .catch(() => {
        // This optional memory retry never affects navigation or a booking.
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  return null;
}
