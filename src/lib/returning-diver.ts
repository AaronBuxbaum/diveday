/**
 * A diver may opt in to remembering the lead name/email on this device for
 * this shop. This is a convenience only: never payment data, account data, or
 * a cross-shop identity. The server authorizes a successful opt-in before the
 * client writes the memory.
 */

import { DAY_MS, nowDate } from "@/lib/clock";

const STORAGE_PREFIX = "diveday:returning-diver:v2:";
const LEGACY_STORAGE_KEY = "diveday:returning-diver:v1";
export const RETURNING_DIVER_MEMORY_MS = 30 * DAY_MS;
export const RETURNING_DIVER_RECEIPT_COOKIE = "diveday-returning-diver-receipt";

export type ReturningDiver = { fullName: string; email: string };

type StoredReturningDiver = ReturningDiver & { expiresAt: number };

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

function clearLegacyStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
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
): void {
  clearLegacyStorage();
  const key = storageKey(shopSlug);
  if (!key || !diver.fullName.trim() || !diver.email.trim() || expiresAt <= now.getTime()) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...diver, expiresAt } satisfies StoredReturningDiver),
    );
  } catch {
    // Private browsing, quota exceeded, storage disabled — silently skip.
  }
}

export function loadReturningDiver(shopSlug: string, now: Date = nowDate()): ReturningDiver | null {
  clearLegacyStorage();
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
    if ((parsed as StoredReturningDiver).expiresAt <= now.getTime()) {
      localStorage.removeItem(key);
      return null;
    }
    return { fullName: parsed.fullName, email: parsed.email };
  } catch {
    return null;
  }
}

export function forgetReturningDiver(shopSlug: string): void {
  clearLegacyStorage();
  const key = storageKey(shopSlug);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be blocked; forgetting in the current form still works.
  }
}
