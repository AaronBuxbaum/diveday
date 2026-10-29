/**
 * A diver may opt in to remembering the lead name/email on this device for
 * this shop. This is a convenience only: never payment data, account data, or
 * a cross-shop identity. The server authorizes a successful opt-in before the
 * client writes the memory.
 */

import { DAY_MS, nowDate } from "@/lib/clock";

const STORAGE_PREFIX = "diveday:returning-diver:v2:";
const CLEAR_PREFIX = "diveday:returning-diver:clear:v2:";
const LEGACY_STORAGE_KEY = "diveday:returning-diver:v1";
export const RETURNING_DIVER_MEMORY_MS = 30 * DAY_MS;
export const RETURNING_DIVER_RECEIPT_COOKIE = "diveday-returning-diver-receipt";

export type ReturningDiver = { fullName: string; email: string };

type StoredReturningDiver = ReturningDiver & {
  expiresAt: number;
  receiptId?: string;
  issuedAt?: number;
};

function isReturningDiver(value: unknown): value is ReturningDiver {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fullName?: unknown }).fullName === "string" &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

function storageKey(shopSlug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ? `${STORAGE_PREFIX}${shopSlug}` : null;
}

function clearKey(shopSlug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug) ? `${CLEAR_PREFIX}${shopSlug}` : null;
}

function activeClearTimestamp(key: string, now: Date): number | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { clearedAt?: unknown }).clearedAt !== "number" ||
      typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number"
    ) {
      localStorage.removeItem(key);
      return null;
    }
    const clear = parsed as { clearedAt: number; expiresAt: number };
    if (clear.expiresAt <= now.getTime()) {
      localStorage.removeItem(key);
      return null;
    }
    return clear.clearedAt;
  } catch {
    throw new Error("device storage is unavailable");
  }
}

function clearOnlyThisReceipt(key: string, receiptId: string | undefined): void {
  if (!receiptId) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { receiptId?: unknown }).receiptId === receiptId
    ) {
      localStorage.removeItem(key);
    }
  } catch {
    // A blocked store cannot safely confirm or remove this write.
  }
}

function clearLegacyStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be blocked; remembering anyone is optional.
  }
}

/** Remove expired shop-scoped copies opportunistically whenever memory is used. */
function clearExpiredShopMemories(now: Date): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((key): key is string => key?.startsWith(STORAGE_PREFIX) ?? false);
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as { expiresAt?: unknown }).expiresAt === "number" &&
          (parsed as { expiresAt: number }).expiresAt <= now.getTime()
        ) {
          localStorage.removeItem(key);
        }
      } catch {
        // The active shop's malformed value is removed by its normal read.
      }
    }
  } catch {
    // Storage can be blocked; remembering anyone is optional.
  }
}

/** Best-effort: storage failures never block booking or the confirmation. */
export function saveReturningDiver(
  shopSlug: string,
  diver: ReturningDiver,
  expiresAt: number,
  now: Date = nowDate(),
  receipt?: { id: string; issuedAt: number },
): "saved" | "cleared" | "unavailable" {
  clearLegacyStorage();
  clearExpiredShopMemories(now);
  const key = storageKey(shopSlug);
  if (!key || !diver.fullName.trim() || !diver.email.trim() || expiresAt <= now.getTime())
    return "unavailable";
  let clearedAt: number | null;
  try {
    const tombstone = clearKey(shopSlug);
    clearedAt = tombstone ? activeClearTimestamp(tombstone, now) : null;
  } catch {
    return "unavailable";
  }
  const issuedAt = receipt?.issuedAt ?? now.getTime();
  if (clearedAt !== null && issuedAt <= clearedAt) return "cleared";
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...diver,
        expiresAt,
        ...(receipt ? { receiptId: receipt.id, issuedAt: receipt.issuedAt } : {}),
      } satisfies StoredReturningDiver),
    );
    // A clear in another tab may land between the pre-write check and setItem.
    // Recheck afterward and remove only this receipt, preserving any newer
    // opt-in that may already have replaced it.
    const tombstone = clearKey(shopSlug);
    const latestClear = tombstone ? activeClearTimestamp(tombstone, now) : null;
    if (latestClear !== null && issuedAt <= latestClear) {
      clearOnlyThisReceipt(key, receipt?.id);
      return "cleared";
    }
    return "saved";
  } catch {
    // Private browsing, quota exceeded, storage disabled — silently skip.
    return "unavailable";
  }
}

export function loadReturningDiver(shopSlug: string, now: Date = nowDate()): ReturningDiver | null {
  clearLegacyStorage();
  clearExpiredShopMemories(now);
  const key = storageKey(shopSlug);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.removeItem(key);
      return null;
    }
    if (
      !isReturningDiver(parsed) ||
      typeof (parsed as { expiresAt?: unknown }).expiresAt !== "number"
    ) {
      localStorage.removeItem(key);
      return null;
    }
    const tombstone = clearKey(shopSlug);
    const clearedAt = tombstone ? activeClearTimestamp(tombstone, now) : null;
    const issuedAt = (parsed as StoredReturningDiver).issuedAt;
    if (clearedAt !== null && (typeof issuedAt !== "number" || issuedAt <= clearedAt)) {
      localStorage.removeItem(key);
      return null;
    }
    if ((parsed as StoredReturningDiver).expiresAt <= now.getTime()) {
      localStorage.removeItem(key);
      return null;
    }
    return { fullName: parsed.fullName, email: parsed.email };
  } catch {
    return null;
  }
}

export function forgetReturningDiver(shopSlug: string, now: Date = nowDate()): void {
  clearLegacyStorage();
  clearExpiredShopMemories(now);
  const key = storageKey(shopSlug);
  const tombstone = clearKey(shopSlug);
  if (!key || !tombstone) return;
  try {
    const clearedAt = now.getTime();
    localStorage.setItem(
      tombstone,
      JSON.stringify({ clearedAt, expiresAt: clearedAt + RETURNING_DIVER_MEMORY_MS }),
    );
    localStorage.removeItem(key);
  } catch {
    // Storage can be blocked; forgetting in the current form still works.
  }
}
