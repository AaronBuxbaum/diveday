/** Half-up proration in integer native-currency minor units, without float multiplication. */
export function collectionShareCents(
  amount: number,
  numerator: number,
  denominator: number,
): number {
  if (
    ![amount, numerator, denominator].every(Number.isSafeInteger) ||
    amount < 0 ||
    numerator < 0 ||
    denominator <= 0
  ) {
    throw new Error("collection_share_invalid_money");
  }
  const total = BigInt(amount) * BigInt(numerator);
  const result = (total * 2n + BigInt(denominator)) / (2n * BigInt(denominator));
  const cents = Number(result);
  if (!Number.isSafeInteger(cents)) throw new Error("collection_share_overflow");
  return cents;
}
