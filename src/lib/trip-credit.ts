import { createHash } from "node:crypto";

/** Promotional value only: never cash received, cash owed, or prepaid dive entitlements. */
const TRIP_CREDIT_KINDS = ["grant", "redeem", "restore"] as const;
export type TripCreditKind = (typeof TRIP_CREDIT_KINDS)[number];
export const TRIP_CREDIT_REASONS = ["goodwill", "promotion", "referral"] as const;
export type TripCreditReason = (typeof TRIP_CREDIT_REASONS)[number];
/** What staff may choose; `referral` is written only by the buddy-credit sweep. */
export const STAFF_TRIP_CREDIT_REASONS = ["goodwill", "promotion"] as const;
export type StaffTripCreditReason = (typeof STAFF_TRIP_CREDIT_REASONS)[number];
/** The largest buddy credit a shop may set, in minor units (the pass-through fee's ceiling). */
export const MAX_BUDDY_CREDIT_CENTS = 1_000_000;

export function validBuddyCreditCents(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_BUDDY_CREDIT_CENTS;
}
export const MAX_TRIP_CREDIT_CENTS = 2_147_483_647;

export function validTripCreditAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_TRIP_CREDIT_CENTS;
}

/** PostgreSQL SUM(integer) is bigint: never coerce it to a rounded JS balance. */
export function safeTripCreditBalance(value: string): number | null {
  try {
    const total = BigInt(value);
    return total >= 0n && total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
  } catch {
    return null;
  }
}

/** A fixed namespace, so a buddy seat's credit has one id forever. Never change it. */
const BUDDY_CREDIT_NAMESPACE = "6d3f9a52-1c47-4b8e-a0d1-5e2c7b9f4a36";

/**
 * **The one ledger id a buddy seat's credit can have** (issue #4260): a
 * name-based (version 5) UUID of the buddy's booking id, so however often the
 * sweep reads a referral it can only ever write this entry.
 */
export function buddyCreditEntryId(buddyBookingId: string): string {
  const bytes = createHash("sha1")
    .update(Buffer.from(BUDDY_CREDIT_NAMESPACE.replaceAll("-", ""), "hex"))
    .update(buddyBookingId.toLowerCase())
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
