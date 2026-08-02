/**
 * Splitting one settled Stripe total across the bookings it paid for.
 *
 * A party checkout is a single Stripe payment, but DiveDay's ledger is
 * per-booking: each diver's `booking_payments.amountCents` is what a refund
 * later returns to them. Stripe reports only the one total it actually
 * collected (`amount_total`, after any discount it applied), so the split has
 * to happen here — framework-free, integer minor units end to end, never a
 * float division that leaves orphan cents (docs glossary: minor unit).
 */

/** One booking's claim on the settled money: what it was *asked* for. */
export type SettlementShare = {
  /**
   * Stable identity for this share (in practice the booking id). Used to
   * return the allocation and to break rounding ties deterministically, so the
   * same inputs always produce the same split — a replayed webhook must not
   * move a cent from one diver to another.
   */
  key: string;
  /** What this booking was asked to pay: its trip fee plus its own gear. */
  askedCents: number;
};

function sanitize(cents: number): number {
  return Number.isFinite(cents) ? Math.max(0, Math.trunc(cents)) : 0;
}

/**
 * Split `settledTotalCents` across `shares` in proportion to what each was
 * asked for, by the largest-remainder method: every share gets the floor of
 * its exact proportion, then the leftover cents go one each to the largest
 * remainders (ties broken by `key`, ascending). The result therefore sums to
 * *exactly* the settled total — no cent is invented and none is dropped — and
 * no share is rounded above what it was asked for, so a discount can never
 * hand one party member more than they paid.
 *
 * Degenerate inputs stay safe rather than throwing: no shares allocates
 * nothing; a zero asked total (a fully comped party) splits the settled amount
 * evenly, which is the only defensible reading when nothing was asked.
 */
export function allocateSettledTotal(
  shares: SettlementShare[],
  settledTotalCents: number,
): Map<string, number> {
  const allocation = new Map<string, number>();
  if (shares.length === 0) return allocation;

  const total = sanitize(settledTotalCents);
  const asked = shares.map((share) => sanitize(share.askedCents));
  const askedTotal = asked.reduce((sum, cents) => sum + cents, 0);
  // With nothing asked there is no proportion to honour; weight everyone
  // equally so the settled total still lands somewhere and still sums exactly.
  const weights = askedTotal > 0 ? asked : shares.map(() => 1);
  const weightTotal = askedTotal > 0 ? askedTotal : shares.length;

  // Integer arithmetic throughout: `total * weight` is an exact numerator, so
  // the floor and the remainder below are exact too (no float rounding).
  const parts = shares.map((share, index) => {
    const numerator = total * (weights[index] ?? 0);
    const base = Math.floor(numerator / weightTotal);
    return { key: share.key, base, remainder: numerator - base * weightTotal };
  });

  let leftover = total - parts.reduce((sum, part) => sum + part.base, 0);
  const byRemainder = [...parts].sort(
    (a, b) => b.remainder - a.remainder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  for (const part of byRemainder) {
    if (leftover <= 0) break;
    part.base += 1;
    leftover -= 1;
  }

  for (const part of parts) allocation.set(part.key, part.base);
  return allocation;
}
