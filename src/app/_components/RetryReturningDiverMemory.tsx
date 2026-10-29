"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  acknowledgeReturningDiverMemory,
  prepareReturningDiverMemories,
  revokeClearedReturningDiverReceipt,
} from "@/app/actions/returning-diver-memory";
import {
  getReturningDiverDeviceSlots,
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
      subscribeToReturningDiverClears(({ deviceToken, generation }) => {
        if (deviceToken) void revokeClearedReturningDiverReceipt(deviceToken, generation);
      }),
    [],
  );

  useEffect(() => {
    // This receipt belongs to a diver's public flow. Staff pages on a shared
    // shop device must never resolve it or persist diver details there.
    if (!pathname || !(pathname.startsWith("/s/") || pathname.startsWith("/ready/"))) return;
    let active = true;
    const slots = getReturningDiverDeviceSlots();
    if (slots.length === 0) return;
    void prepareReturningDiverMemories(slots)
      .then(async (result) => {
        if (!active) return;
        await Promise.all(
          result.map(async (memory) => {
            const slot = slots.find(({ token }) => token === memory.deviceToken);
            if (!slot) return;
            const saved = saveReturningDiver(
              memory.shopSlug,
              memory.diver,
              memory.expiresAt,
              undefined,
              {
                id: memory.receiptId,
                order: memory.receiptOrder,
                generationAtStart: memory.deviceGeneration,
              },
            );
            // A clear is final: revoke its server receipt so a cloned tab or a
            // lost local marker cannot retry this now-withdrawn consent.
            if (saved === "cleared" && active) {
              const generation = snapshotReturningDiverClearGenerations()?.[memory.shopSlug];
              if (generation)
                await revokeClearedReturningDiverReceipt(memory.deviceToken, generation);
            } else if (saved === "saved" && active) {
              await acknowledgeReturningDiverMemory(
                memory.deviceToken,
                memory.receiptId,
                memory.deviceGeneration,
              );
            }
          }),
        );
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
