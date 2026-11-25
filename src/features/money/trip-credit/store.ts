import { and, desc, eq, sql } from "drizzle-orm";
import { loadActiveStaffRoles } from "@/db/authz";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb, DbExecutor } from "@/db/client";
import { boundLockWaits, isLockWaitRefusal } from "@/db/lock-bounds";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import { bookingCapabilities, bookings, shops, tripCreditEntries, trips } from "@/db/schema";
import { lockTripCreditPerson, tripCreditBalance } from "@/db/trip-credit-ledger";
import { liveTrip } from "@/db/trips";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seatCheckoutCharge } from "@/lib/deposits";
import {
  STAFF_TRIP_CREDIT_REASONS,
  type StaffTripCreditReason,
  safeTripCreditBalance,
  validTripCreditAmount,
} from "@/lib/trip-credit";
import { isUuid } from "@/lib/uuid";
import { unsupportedTripCreditSource } from "./sources";

type Scope = {
  shopId: string;
  personId: string;
  actorPersonId: string;
  attemptId: string;
  currency: string;
};
export type TripCreditResult =
  | { ok: true; balanceCents: number; amountCents: number; replay: boolean }
  | {
      ok: false;
      reason:
        | "invalid"
        | "not_authorized"
        | "not_found"
        | "unavailable"
        | "insufficient"
        | "changed"
        | "busy";
    };
const refused = (reason: Extract<TripCreditResult, { ok: false }>["reason"]): TripCreditResult => ({
  ok: false,
  reason,
});

function validScope(input: Scope) {
  return (
    [input.shopId, input.personId, input.actorPersonId, input.attemptId].every(isUuid) &&
    /^[a-z]{3}$/.test(input.currency)
  );
}

export async function grantTripCredit(
  db: AppDb,
  input: Scope & { amountCents: number; reason: StaffTripCreditReason },
): Promise<TripCreditResult> {
  if (
    !validScope(input) ||
    !validTripCreditAmount(input.amountCents) ||
    !STAFF_TRIP_CREDIT_REASONS.includes(input.reason)
  )
    return refused("invalid");
  try {
    return await db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const [shop] = await tx
        .select({ currency: shops.currency })
        .from(shops)
        .where(eq(shops.id, input.shopId))
        .for("share", { noWait: true });
      if (!shop || shop.currency !== input.currency) return refused("changed");
      if (!(await lockTripCreditPerson(tx, input.shopId, input.personId)))
        return refused("not_found");
      const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
      if (!roles?.some((role) => role === "owner" || role === "manager"))
        return refused("not_authorized");
      const balance = await tripCreditBalance(tx, input.shopId, input.personId, input.currency);
      if (balance === null) return refused("unavailable");
      const [prior] = await tx
        .select()
        .from(tripCreditEntries)
        .where(
          and(
            eq(tripCreditEntries.shopId, input.shopId),
            eq(tripCreditEntries.id, input.attemptId),
          ),
        );
      if (prior)
        return prior.shopId === input.shopId &&
          prior.personId === input.personId &&
          prior.actorPersonId === input.actorPersonId &&
          prior.currency === input.currency &&
          prior.kind === "grant" &&
          prior.amountCents === input.amountCents &&
          prior.reason === input.reason
          ? { ok: true, balanceCents: balance, amountCents: prior.amountCents, replay: true }
          : refused("changed");
      if (!Number.isSafeInteger(balance + input.amountCents)) return refused("unavailable");
      const [entry] = await tx
        .insert(tripCreditEntries)
        .values({
          id: input.attemptId,
          shopId: input.shopId,
          personId: input.personId,
          actorPersonId: input.actorPersonId,
          currency: input.currency,
          kind: "grant",
          amountCents: input.amountCents,
          reason: input.reason,
        })
        .onConflictDoNothing()
        .returning({ id: tripCreditEntries.id });
      if (!entry) return refused("changed");
      return {
        ok: true,
        balanceCents: balance + input.amountCents,
        amountCents: input.amountCents,
        replay: false,
      };
    });
  } catch (error) {
    if (isLockWaitRefusal(error)) return refused("busy");
    throw error;
  }
}

/** No provider calls, fee lots, or cash collection: promotional value settles the full seat fare. */
export async function redeemTripCredit(
  db: AppDb,
  input: Scope & { bookingId: string; expectedFareCents: number },
): Promise<TripCreditResult> {
  return redeemWithAuthority(db, input, { kind: "staff" });
}

export async function redeemOwnTripCredit(
  db: AppDb,
  input: { token: string; attemptId: string; currency: string; expectedFareCents: number },
): Promise<TripCreditResult> {
  const capability = await verifyBookingCapability(db, {
    token: input.token,
    purpose: "readiness",
  });
  if (!capability?.delivered) return refused("not_authorized");
  return redeemWithAuthority(
    db,
    {
      shopId: capability.shopId,
      personId: capability.personId,
      actorPersonId: capability.personId,
      bookingId: capability.bookingId,
      attemptId: input.attemptId,
      currency: input.currency,
      expectedFareCents: input.expectedFareCents,
    },
    { kind: "readiness", token: input.token },
  );
}

async function redeemWithAuthority(
  db: AppDb,
  input: Scope & { bookingId: string; expectedFareCents: number },
  authority: { kind: "staff" } | { kind: "readiness"; token: string },
): Promise<TripCreditResult> {
  if (
    !validScope(input) ||
    !isUuid(input.bookingId) ||
    !validTripCreditAmount(input.expectedFareCents)
  )
    return refused("invalid");
  try {
    return await db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const [hint] = await tx
        .select({ tripId: bookings.tripId })
        .from(bookings)
        .where(and(eq(bookings.shopId, input.shopId), eq(bookings.id, input.bookingId)));
      if (!hint) return refused("not_found");
      // Departure first, matching cancellation and seating. Keep repricing from changing the quote.
      const [trip] = await tx
        .select()
        .from(trips)
        .where(and(eq(trips.shopId, input.shopId), eq(trips.id, hint.tripId), liveTrip()))
        .for("no key update");
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.id, input.bookingId),
            eq(bookings.tripId, hint.tripId),
          ),
        )
        .for("update");
      if (!trip || !booking || booking.personId !== input.personId) return refused("not_found");
      const [shop] = await tx
        .select()
        .from(shops)
        .where(eq(shops.id, input.shopId))
        .for("share", { noWait: true });
      if (!shop || shop.currency !== input.currency) return refused("changed");
      if (!(await lockTripCreditPerson(tx, input.shopId, input.personId)))
        return refused("not_found");
      if (authority.kind === "staff") {
        if (
          !isStaff((await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId)) ?? undefined)
        )
          return refused("not_authorized");
      } else {
        await tx
          .select({ id: bookingCapabilities.id })
          .from(bookingCapabilities)
          .where(
            and(
              eq(bookingCapabilities.shopId, input.shopId),
              eq(bookingCapabilities.bookingId, input.bookingId),
            ),
          )
          .for("update");
        const cap = await verifyBookingCapability(tx, {
          token: authority.token,
          purpose: "readiness",
        });
        if (
          !cap?.delivered ||
          cap.shopId !== input.shopId ||
          cap.personId !== input.personId ||
          cap.bookingId !== input.bookingId ||
          booking.identityUnconfirmedAt
        )
          return refused("not_authorized");
      }
      const balance = await tripCreditBalance(tx, input.shopId, input.personId, input.currency);
      if (balance === null) return refused("unavailable");
      const [prior] = await tx
        .select()
        .from(tripCreditEntries)
        .where(
          and(
            eq(tripCreditEntries.shopId, input.shopId),
            eq(tripCreditEntries.id, input.attemptId),
          ),
        );
      if (prior)
        return prior.shopId === input.shopId &&
          prior.personId === input.personId &&
          prior.actorPersonId === input.actorPersonId &&
          prior.currency === input.currency &&
          prior.kind === "redeem" &&
          prior.bookingId === input.bookingId &&
          prior.amountCents === input.expectedFareCents
          ? { ok: true, balanceCents: balance, amountCents: prior.amountCents, replay: true }
          : refused("changed");
      const charge =
        trip.courseId === null ? seatCheckoutCharge(trip, null, booking.participantType) : null;
      const fare = charge ? charge.amountCents + charge.balanceDueCents : null;
      if (fare !== input.expectedFareCents) return refused("changed");
      if (
        booking.status !== "booked" ||
        (booking.groupHoldUntil !== null && booking.groupHoldUntil <= nowDate()) ||
        booking.identityUnconfirmedAt ||
        trip.status !== "scheduled" ||
        trip.startsAt <= nowDate() ||
        trip.isRehearsal ||
        trip.isPrivate ||
        shop.taxEnabled ||
        shop.passThroughFee ||
        booking.wantsNitrox ||
        booking.paidRentalKinds.length
      )
        return refused("unavailable");
      const payment = await getBookingPayment(tx, input.shopId, input.bookingId);
      if (
        payment &&
        (payment.status !== "unpaid" ||
          payment.provider ||
          (payment.amountCents ?? 0) !== 0 ||
          payment.manualHeldCents !== 0)
      )
        return refused("unavailable");
      if (await unsupportedCreditSource(tx, input.shopId, input.bookingId))
        return refused("unavailable");
      if (balance < input.expectedFareCents) return refused("insufficient");
      const [entry] = await tx
        .insert(tripCreditEntries)
        .values({
          id: input.attemptId,
          shopId: input.shopId,
          personId: input.personId,
          actorPersonId: input.actorPersonId,
          currency: input.currency,
          kind: "redeem",
          amountCents: input.expectedFareCents,
          bookingId: input.bookingId,
        })
        .onConflictDoNothing()
        .returning({ id: tripCreditEntries.id });
      if (!entry) return refused("changed");
      const saved = await setBookingPayment(tx, {
        shopId: input.shopId,
        bookingId: input.bookingId,
        status: "paid",
        amountCents: 0,
        currency: input.currency,
        provider: "trip_credit",
        providerRef: input.attemptId,
        recordedByPersonId: input.actorPersonId,
        operation: "trip_credit_redeemed",
      });
      if (!saved) throw new Error("trip_credit_payment_write_refused");
      return {
        ok: true,
        balanceCents: balance - input.expectedFareCents,
        amountCents: input.expectedFareCents,
        replay: false,
      };
    });
  } catch (error) {
    if (isLockWaitRefusal(error)) return refused("busy");
    throw error;
  }
}

async function unsupportedCreditSource(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.id, bookingId),
        unsupportedTripCreditSource(shopId, bookingId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function readTripCredit(
  db: DbExecutor,
  shopId: string,
  personId: string,
  currency: string,
) {
  const entries = await db
    .select()
    .from(tripCreditEntries)
    .where(and(eq(tripCreditEntries.shopId, shopId), eq(tripCreditEntries.personId, personId)))
    .orderBy(desc(tripCreditEntries.occurredAt), desc(tripCreditEntries.seq))
    .limit(50);
  const totals = await db
    .select({
      currency: tripCreditEntries.currency,
      total: sql<string>`sum(case when ${tripCreditEntries.kind} = 'redeem' then -${tripCreditEntries.amountCents} else ${tripCreditEntries.amountCents} end)::text`,
    })
    .from(tripCreditEntries)
    .where(and(eq(tripCreditEntries.shopId, shopId), eq(tripCreditEntries.personId, personId)))
    .groupBy(tripCreditEntries.currency);
  const balances = totals.map((row) => ({
    currency: row.currency,
    balanceCents: safeTripCreditBalance(row.total),
  }));
  if (!balances.some((row) => row.currency === currency))
    balances.push({ currency, balanceCents: 0 });
  const native = balances.find((row) => row.currency === currency);
  return { balanceCents: native ? native.balanceCents : 0, balances, entries };
}
