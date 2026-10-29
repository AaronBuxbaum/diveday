"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  acknowledgeReturningDiverMemory,
  prepareReturningDiverMemories,
  type ReturningDiverMemoryScope,
  revokeClearedReturningDiverReceipt,
} from "@/app/actions/returning-diver-memory";
import {
  getReturningDiverDeviceSlots,
  saveReturningDiver,
  snapshotReturningDiverClearGenerations,
  subscribeToReturningDiverClears,
} from "@/lib/returning-diver";

function scopeForPublicPath(pathname: string | null): ReturningDiverMemoryScope | null {
  if (!pathname) return null;
  const shopMatch = /^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(pathname);
  if (shopMatch?.[1]) return { kind: "shop", shopSlug: shopMatch[1] };
  const readyMatch = /^\/ready\/([A-Za-z0-9_-]{40,128})\/?$/.exec(pathname);
  if (readyMatch?.[1]) return { kind: "readiness", readinessToken: readyMatch[1] };
  return null;
}

/**
 * Retries an opted-in write on same-origin public navigation; renders nothing.
 * Browser shutdown before hydration still cannot guarantee the local write.
 */
export function RetryReturningDiverMemory() {
  const pathname = usePathname();

  useEffect(
    () =>
      subscribeToReturningDiverClears(
        ({ shopSlug, deviceToken, generation, previousGeneration }) => {
          if (deviceToken)
            void revokeClearedReturningDiverReceipt(
              shopSlug,
              deviceToken,
              previousGeneration,
              generation,
            );
        },
      ),
    [],
  );

  useEffect(() => {
    // This receipt belongs to a diver's public flow. Staff pages on a shared
    // shop device must never resolve it or persist diver details there.
    const scope = scopeForPublicPath(pathname);
    if (!scope) return;
    let active = true;
    const slots = getReturningDiverDeviceSlots(scope.kind === "shop" ? scope.shopSlug : undefined);
    if (slots.length === 0) return;
    void prepareReturningDiverMemories(scope, slots)
      .then(async (result) => {
        if (!active) return;
        await Promise.all(
          result.map(async (memory) => {
            if (scope.kind === "shop" && memory.shopSlug !== scope.shopSlug) return;
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
                await revokeClearedReturningDiverReceipt(
                  memory.shopSlug,
                  memory.deviceToken,
                  memory.deviceGeneration,
                  generation,
                );
            } else if (saved === "saved" && active) {
              await acknowledgeReturningDiverMemory(
                scope,
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
