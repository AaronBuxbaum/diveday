/**
 * Remembers who booked from this device, so the next visit can prefill the
 * lead diver's name/email instead of starting from a blank form (persona:
 * Marco, the repeat local). Name and email only — never payment data — and
 * entirely client-side: no server round trip, no cookie, no per-shop key.
 */

const STORAGE_KEY = "diveday:returning-diver:v1";

export type ReturningDiver = { fullName: string; email: string };

function isReturningDiver(value: unknown): value is ReturningDiver {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fullName?: unknown }).fullName === "string" &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

/** Best-effort: a full storage quota or a browser that blocks it should never break the form. */
export function saveReturningDiver(diver: ReturningDiver): void {
  if (!diver.fullName.trim() || !diver.email.trim()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diver));
  } catch {
    // Private browsing, quota exceeded, storage disabled — silently skip.
  }
}

export function loadReturningDiver(): ReturningDiver | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isReturningDiver(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearReturningDiver(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
