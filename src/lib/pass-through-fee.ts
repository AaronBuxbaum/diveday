/** A shop-configured charge collected for a third party, such as a park. */
export type PassThroughFee = { name: string; amountCents: number };

/**
 * Validate a JSON setting at the boundary before it reaches Stripe. Invalid
 * settings fail closed to no fee; a malformed setting must never create an
 * arbitrary line item or a negative charge.
 */
export function parsePassThroughFee(value: unknown): PassThroughFee | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { name?: unknown; amountCents?: unknown };
  if (typeof candidate.name !== "string") return null;
  const name = candidate.name.trim().slice(0, 120);
  const amountCents = candidate.amountCents;
  if (!name || typeof amountCents !== "number" || !Number.isInteger(amountCents)) return null;
  if (amountCents <= 0 || amountCents > 1_000_000) return null;
  return { name, amountCents };
}

export function passThroughTotalCents(fee: PassThroughFee | null, diverCount: number): number {
  if (!fee || !Number.isInteger(diverCount) || diverCount <= 0) return 0;
  return fee.amountCents * diverCount;
}
