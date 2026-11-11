import { collectionShareCents } from "../../lib/collection-money";

type OriginalSplit = { taxCents: number; tipCents: number; passThroughCents: number };
/**
 * Keep the fee basis exactly equal to the source ledger's integer proration.
 * Allocate its complement across exclusions, with the final levy taking the
 * rounding remainder. Independent rounding could invent a cent or exceed
 * the money retained, especially in zero-decimal currencies.
 */
export function remainingCounterReceipt(
  original: OriginalSplit,
  totalCents: number,
  heldCents: number,
): OriginalSplit {
  const excluded = original.taxCents + original.tipCents + original.passThroughCents;
  if (excluded === 0) return { taxCents: 0, tipCents: 0, passThroughCents: 0 };
  const basis = collectionShareCents(totalCents - excluded, heldCents, totalCents);
  const keptExcluded = heldCents - basis;
  const taxCents = collectionShareCents(original.taxCents, keptExcluded, excluded);
  const tipAndFees = original.tipCents + original.passThroughCents;
  const tipCents =
    tipAndFees === 0
      ? 0
      : collectionShareCents(original.tipCents, keptExcluded - taxCents, tipAndFees);
  return { taxCents, tipCents, passThroughCents: keptExcluded - taxCents - tipCents };
}
