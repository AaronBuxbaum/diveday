/** Promotional value only: never cash received, cash owed, or prepaid dive entitlements. */
const TRIP_CREDIT_KINDS = ["grant", "redeem", "restore"] as const;
export type TripCreditKind = (typeof TRIP_CREDIT_KINDS)[number];
export const TRIP_CREDIT_REASONS = ["goodwill", "promotion"] as const;
export type TripCreditReason = (typeof TRIP_CREDIT_REASONS)[number];
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
