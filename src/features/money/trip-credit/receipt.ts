import type { DbExecutor } from "@/db/client";
import { currentTripCreditCoverage, tripCreditBalance } from "@/db/trip-credit-ledger";

/** A credit receipt proves current coverage, never merely a provider label. */
export async function tripCreditReceipt(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  entryId: string,
) {
  const debit = await currentTripCreditCoverage(db, shopId, bookingId);
  if (!debit || debit.id !== entryId) return null;
  const balanceCents = await tripCreditBalance(db, shopId, debit.personId, debit.currency);
  return balanceCents === null
    ? null
    : { amountCents: debit.amountCents, currency: debit.currency, balanceCents };
}
