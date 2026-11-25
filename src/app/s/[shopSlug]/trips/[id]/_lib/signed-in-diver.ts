import { randomUUID } from "node:crypto";
import type { AppDb } from "@/db/client";
import { currentDiver, currentDiverToken } from "@/features/accounts/diver-sign-in";
import { type KnownDiver, readKnownPerson } from "@/features/bookings/booking-handoff";
import {
  plainSeatCreditFare,
  readTripCredit,
  redeemSignedInTripCredit,
} from "@/features/money/trip-credit";
import { isUuid } from "@/lib/uuid";

type CreditShop = { id: string; currency: string; taxEnabled: boolean; passThroughFee: unknown };
type CreditTrip = Parameters<typeof plainSeatCreditFare>[0];

/**
 * What the booking form starts from for a signed-in diver (ADR
 * 20261125-diver-sign-in): who they are, as the handoff's known-diver panel
 * reads them, and the trip credit offer when their balance covers a plain seat
 * here. Null when nobody is signed in to this shop.
 */
export async function readSignedInBooker(
  db: AppDb,
  input: {
    shop: CreditShop;
    trip: CreditTrip;
    now: Date;
  },
): Promise<{
  known: Omit<KnownDiver, "bookingId">;
  tripCredit: { balanceCents: number; fareCents: number; attemptId: string } | null;
} | null> {
  const diver = await currentDiver(db, input.shop.id);
  if (!diver) return null;
  const known = await readKnownPerson(db, {
    shopId: input.shop.id,
    personId: diver.personId,
    now: input.now,
  });
  if (!known) return null;
  const fareCents = plainSeatCreditFare(input.trip, input.shop, input.now);
  const balanceCents = fareCents
    ? ((await readTripCredit(db, input.shop.id, diver.personId, input.shop.currency))
        .balanceCents ?? 0)
    : 0;
  return {
    known,
    tripCredit:
      fareCents && balanceCents >= fareCents
        ? // One id per render of the form: a resubmit of this form replays it.
          { balanceCents, fareCents, attemptId: randomUUID() }
        : null,
  };
}

/**
 * Spends the signed-in diver's trip credit on the seat this submit booked, the
 * session cookie as the proof of who they are. True only when the ledger took
 * the debit (or a resubmit replayed it); false sends the diver on to pay.
 * Only a plain seat: one diver, no code, no group hold, no gear.
 */
export async function spendSignedInCredit(
  db: AppDb,
  input: {
    shop: CreditShop;
    trip: CreditTrip | null;
    bookingId: string;
    form: {
      fields: Record<string, unknown>;
      seats: number;
      promoCodeInput: unknown;
      groupHold: boolean;
      gearSelections: ReadonlyArray<{ rentedKinds: readonly unknown[]; wantsNitrox: boolean }>;
    };
  },
): Promise<boolean> {
  const { form } = input;
  const plainSeat =
    form.fields.useTripCredit === "on" &&
    form.seats === 1 &&
    !form.promoCodeInput &&
    !form.groupHold &&
    form.gearSelections.every((pick) => pick.rentedKinds.length === 0 && !pick.wantsNitrox);
  if (!plainSeat || !input.trip) return false;
  const sessionToken = await currentDiverToken();
  const fare = plainSeatCreditFare(input.trip, input.shop);
  if (!sessionToken || !fare) return false;
  const spent = await redeemSignedInTripCredit(db, {
    shopId: input.shop.id,
    sessionToken,
    bookingId: input.bookingId,
    attemptId: isUuid(String(form.fields.tripCreditAttempt ?? ""))
      ? String(form.fields.tripCreditAttempt)
      : randomUUID(),
    currency: input.shop.currency,
    expectedFareCents: fare,
  });
  return spent.ok;
}
