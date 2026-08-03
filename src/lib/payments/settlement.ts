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
 * What a percent-off code can have left for the shop to collect: the asked
 * total, less that percentage, with the **discount rounded up** so the answer
 * is a floor on what Stripe can have captured rather than a ceiling.
 *
 * Used only when Stripe reported no `amount_total` at all (PAY-M3). Recording
 * a discounted party at its quoted, pre-discount amounts makes the per-booking
 * ledger sum above what the one shared payment intent actually captured, and
 * `booking_payments.amountCents` is exactly the figure a later cancellation
 * asks Stripe to reverse — so the first party member to cancel drains more
 * than their share and a later one is refused money already paid out. Erring
 * *low* is the safe direction: a share below the true proportional one can
 * only ever under-refund by a cent, never overdraw the pot.
 *
 * Rounding is not bit-exact against Stripe. Stripe applies a percent-off
 * coupon per line item and rounds each, so its total discount can differ from
 * `ceil(total × percent / 100)` by up to about half a cent per line — with
 * three or more lines this figure can sit a cent or two *above* what Stripe
 * kept. A one- or two-cent overstatement cannot produce the failure above: it
 * surfaces as Stripe refusing the last few cents of the final refund, which
 * the caller already reports as `manual` for staff, not as money moving twice.
 */
export function netOfPercentDiscount(totalCents: number, discountPercent: number): number {
  const total = sanitize(totalCents);
  const percent = Math.min(100, sanitize(discountPercent));
  return Math.max(0, total - Math.ceil((total * percent) / 100));
}

/**
 * Split `settledTotalCents` across `shares` in proportion to what each was
 * asked for, by the largest-remainder method: every share gets the floor of
 * its exact proportion, then the leftover cents go one each to the largest
 * remainders (ties broken by `key`, ascending). The result sums to *exactly*
 * the settled total — no cent is invented and none is dropped.
 *
 * **Precondition: `settledTotalCents <= Σ askedCents`.** Within it, no share is
 * ever allocated above its own `askedCents`, so a discount can never hand one
 * party member more than they paid. Above it that guarantee does not hold and
 * cannot: every share is scaled up together, because a proportional split has
 * no basis for deciding which booking a surplus belongs to. The precondition is
 * stated rather than enforced here — clamping inside this function would break
 * the "sums to exactly the settled total" guarantee above, which the
 * per-booking ledger depends on. Clamping is the **caller's** job:
 * `markCheckoutPaidBySessionId` (src/db/checkouts.ts) clamps Stripe's reported
 * total to the checkout's own asked total and logs the mismatch, so an
 * over-total figure can never inflate what a refund later reverses.
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
