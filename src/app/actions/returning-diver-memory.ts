"use server";

import {
  acknowledgeReturningDiverReceipt,
  readReturningDiverReceipt,
  revokeReturningDiverReceipt,
} from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { RETURNING_DIVER_DEVICE_TOKEN_PATTERN } from "@/lib/returning-diver";

const MAX_DEVICE_SLOTS_PER_REQUEST = 32;

function validReceiptId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validGeneration(value: string | null): boolean {
  return (
    value === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Resolve opt-in receipts from opaque, shop-scoped tab slots; identity stays server-bound. */
export async function prepareReturningDiverMemories(
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
    const results = await Promise.all(
      [...unique].map(async ([deviceToken, deviceGeneration]) => {
        const memory = await readReturningDiverReceipt(db, { deviceToken, deviceGeneration });
        return memory
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
    return await acknowledgeReturningDiverReceipt(await getDb(), {
      deviceToken,
      expectedReceiptId,
      deviceGeneration,
    });
  } catch {
    return false;
  }
}

/** A receipt row supplies the shop binding; callers cannot select a shop. */
export async function revokeClearedReturningDiverReceipt(
  deviceToken: string,
  nextDeviceGeneration: string,
): Promise<boolean> {
  if (
    !RETURNING_DIVER_DEVICE_TOKEN_PATTERN.test(deviceToken) ||
    !validGeneration(nextDeviceGeneration)
  )
    return false;
  try {
    return await revokeReturningDiverReceipt(await getDb(), {
      deviceToken,
      nextDeviceGeneration,
    });
  } catch {
    return false;
  }
}
