"use server";

import {
  acknowledgeReturningDiverReceipt,
  readReturningDiverReceipt,
  revokeReturningDiverReceipt,
  verifyBookingCapability,
} from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { shopIdBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { RETURNING_DIVER_DEVICE_TOKEN_PATTERN } from "@/lib/returning-diver";

const MAX_DEVICE_SLOTS_PER_REQUEST = 32;

export type ReturningDiverMemoryScope =
  | { kind: "shop"; shopSlug: string }
  | { kind: "readiness"; readinessToken: string };

function validReceiptId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validGeneration(value: string | null): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  );
}

async function resolveScopeShopId(
  db: Awaited<ReturnType<typeof getDb>>,
  scope: ReturningDiverMemoryScope,
): Promise<string | null> {
  if (scope?.kind === "shop") {
    if (typeof scope.shopSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scope.shopSlug))
      return null;
    return shopIdBySlug(db, scope.shopSlug);
  }
  if (
    scope?.kind === "readiness" &&
    typeof scope.readinessToken === "string" &&
    /^[A-Za-z0-9_-]{40,128}$/.test(scope.readinessToken)
  ) {
    const capability = await verifyBookingCapability(db, {
      token: scope.readinessToken,
      purpose: "readiness",
    });
    return capability?.shopId ?? null;
  }
  return null;
}

/** The server clock is authoritative for the local memory's 30-day deadline. */
export async function getReturningDiverServerTime(): Promise<number> {
  return nowDate().getTime();
}

/** Resolve opt-in receipts from opaque, shop-scoped tab slots; identity stays server-bound. */
export async function prepareReturningDiverMemories(
  scope: ReturningDiverMemoryScope,
  slots: Array<{ token: string; generation: string | null }>,
): Promise<
  Array<{
    deviceToken: string;
    receiptId: string;
    receiptOrder: string;
    deviceGeneration: string | null;
    shopSlug: string;
    diver: { fullName: string; email: string };
    expiresAt: number;
  }>
> {
  if (!Array.isArray(slots) || slots.length > MAX_DEVICE_SLOTS_PER_REQUEST) return [];
  try {
    const unique = new Map<string, string | null>();
    for (const slot of slots) {
      if (
        typeof slot?.token === "string" &&
        RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test(slot.token) &&
        validGeneration(slot.generation)
      ) {
        unique.set(slot.token, slot.generation);
      }
    }
    const db = await getDb();
    const expectedShopId = await resolveScopeShopId(db, scope);
    if (!expectedShopId) return [];
    const results = await Promise.all(
      [...unique].map(async ([deviceToken, deviceGeneration]) => {
        const memory = await readReturningDiverReceipt(db, {
          deviceToken,
          deviceGeneration,
          expectedShopId,
        });
        return memory && (scope.kind !== "shop" || memory.shopSlug === scope.shopSlug)
          ? {
              deviceToken,
              receiptId: memory.receiptId,
              receiptOrder: memory.receiptOrder,
              deviceGeneration: memory.deviceGeneration,
              shopSlug: memory.shopSlug,
              diver: memory.diver,
              expiresAt: memory.memoryExpiresAt,
            }
          : null;
      }),
    );
    return results.filter((result): result is NonNullable<typeof result> => result !== null);
  } catch {
    return [];
  }
}

/** Called only after the browser confirms its shop-scoped localStorage write. */
export async function acknowledgeReturningDiverMemory(
  scope: ReturningDiverMemoryScope,
  deviceToken: string,
  expectedReceiptId: string,
  deviceGeneration: string | null,
): Promise<boolean> {
  if (
    !RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test(deviceToken) ||
    !validReceiptId(expectedReceiptId) ||
    !validGeneration(deviceGeneration)
  )
    return false;
  try {
    const db = await getDb();
    const expectedShopId = await resolveScopeShopId(db, scope);
    if (!expectedShopId) return false;
    return await acknowledgeReturningDiverReceipt(db, {
      deviceToken,
      expectedReceiptId,
      deviceGeneration,
      expectedShopId,
    });
  } catch {
    return false;
  }
}

/** A receipt row supplies the shop binding; callers cannot select a shop. */
export async function revokeClearedReturningDiverReceipt(
  shopSlug: string,
  deviceToken: string,
  previousDeviceGeneration: string | null,
  nextDeviceGeneration: string,
): Promise<boolean> {
  if (
    typeof shopSlug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ||
    typeof deviceToken !== "string" ||
    !RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test(deviceToken) ||
    !validGeneration(previousDeviceGeneration) ||
    !validGeneration(nextDeviceGeneration)
  )
    return false;
  try {
    const db = await getDb();
    const expectedShopId = await shopIdBySlug(db, shopSlug);
    if (!expectedShopId) return false;
    return await revokeReturningDiverReceipt(db, {
      deviceToken,
      expectedShopId,
      previousDeviceGeneration,
      nextDeviceGeneration,
    });
  } catch {
    return false;
  }
}
