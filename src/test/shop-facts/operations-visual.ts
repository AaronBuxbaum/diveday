import { createHash, randomUUID } from "node:crypto";
import { readActiveStaffRoles } from "../../db/authz";
import { callTripBlowout, getTripBlowout } from "../../db/blowouts";
import { issueBookingCapability } from "../../db/booking-capabilities";
import type { AppDb } from "../../db/client";
import { setShopPassThroughFee } from "../../db/shops";
import { setShopTaxEnabled } from "../../db/shops.test-support";
import { getShopCurrency } from "../../db/stripe-accounts";
import { createTrip, listStaff } from "../../db/trips";
import { seatDiver } from "../../features/bookings/seat-diver";
import { recordPurchase, recordPurchaseRefund } from "../../features/money/recorded-purchases";
import { grantTripCredit, redeemTripCredit } from "../../features/money/trip-credit";
import {
  createRecoveryActivity,
  transitionRecoveryActivity,
} from "../../features/trips/recovery-activities/store";
import { HOUR_MS } from "../../lib/clock";
import { fakeEmail } from "../fakes";
import { prepareWeatherAlternatives } from "./prepare-weather-alternatives";

/** Real private-shop transactions; never manufacture money or seating projections. */
export async function prepareOperationsVisual(
  db: AppDb,
  shop: { id: string; slug: string },
  _actorId: string,
  now: Date,
) {
  // The test door supplies any seeded person, not an authorized staff identity.
  // Resolve the actual live owner rather than assuming insertion order is authority.
  let actorId: string | undefined;
  for (const staff of await listStaff(db, shop.id)) {
    const roles = await readActiveStaffRoles(db, shop.id, staff.person.id);
    if (roles?.includes("owner")) {
      actorId = staff.person.id;
      break;
    }
  }
  if (!actorId) throw new Error("operations visual fixture needs an active shop owner");
  const currency = await getShopCurrency(db, shop.id);
  await setShopTaxEnabled(db, shop.id, false);
  await setShopPassThroughFee(db, shop.id, null);
  const source = await prepareWeatherAlternatives(db, shop.id, now);
  const purchase = await recordPurchase(db, {
    shopId: shop.id,
    personId: source.personId,
    createdByPersonId: actorId,
    attemptId: randomUUID(),
    currency,
    collection: "cash",
    taxCents: 400,
    tipCents: 600,
    receiptReference: "COUNTER-1042",
    lineItems: [
      { kind: "rental", description: "Regulator rental", quantity: 1, unitAmountCents: 5000 },
    ],
  });
  if (!purchase.ok) throw new Error(`visual receipt refused: ${purchase.reason}`);
  const returned = await recordPurchaseRefund(db, {
    shopId: shop.id,
    orderId: purchase.order.id,
    actorPersonId: actorId,
    attemptId: randomUUID(),
    amountCents: 1000,
    expectedRefundedCents: 0,
    currency,
    reason: "Cash already returned for unused rental",
  });
  if (!returned.ok) throw new Error(`visual external return refused: ${returned.reason}`);
  const granted = await grantTripCredit(db, {
    shopId: shop.id,
    personId: source.personId,
    actorPersonId: actorId,
    attemptId: randomUUID(),
    currency,
    amountCents: 15000,
    reason: "goodwill",
  });
  if (!granted.ok) throw new Error(`visual goodwill grant refused: ${granted.reason}`);
  await callTripBlowout(db, {
    shopId: shop.id,
    tripId: source.sourceTripId,
    calledByPersonId: actorId,
    refunds: "queue",
    provider: fakeEmail().provider,
  });
  const blowout = await getTripBlowout(db, shop.id, source.sourceTripId);
  if (!blowout?.divers[0]) throw new Error("visual recovery diver missing");
  // Named by the shop's pinned slug, not random: the prepared inquiry link
  // prints this id, and a different one each run moved the capture's pixels.
  const hash = createHash("sha256").update(`recovery-activity:${shop.slug}`).digest("hex");
  const activityId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const made = await createRecoveryActivity(db, {
    shopId: shop.id,
    tripId: source.sourceTripId,
    actorPersonId: actorId,
    attemptId: activityId,
    title: "Reef photography in the classroom",
    location: "The classroom beside the dock and equipment workshop",
    startsAt: new Date(now.getTime() + 10 * 24 * HOUR_MS),
    endsAt: new Date(now.getTime() + (10 * 24 + 2) * HOUR_MS),
    capacity: 8,
    coordinatorPersonId: actorId,
    arrangementsConfirmed: true,
  });
  if (!made.ok) throw new Error(`visual classroom refused: ${made.reason}`);
  const context = {
    shopId: shop.id,
    tripId: source.sourceTripId,
    actorPersonId: actorId,
    activityId,
    blowoutDiverId: blowout.divers[0].id,
  };
  const offered = await transitionRecoveryActivity(db, {
    ...context,
    attemptId: randomUUID(),
    expectedRevision: 0,
    kind: "offer",
  });
  if (!offered.ok) throw new Error(`visual offer refused: ${offered.reason}`);
  const confirmed = await transitionRecoveryActivity(db, {
    ...context,
    attemptId: randomUUID(),
    expectedRevision: offered.revision,
    kind: "confirm",
    participantRevision: 0,
  });
  if (!confirmed.ok) throw new Error(`visual place refused: ${confirmed.reason}`);
  const eligible = await seatDiver(db, {
    shopId: shop.id,
    tripId: source.alternativeTripId,
    actorPersonId: actorId,
    diver: { personId: source.personId },
    entry: "roster",
    refusals: "specific",
  });
  if (!eligible.ok) throw new Error(`visual eligible fare refused: ${eligible.reason}`);
  const redeemed = await redeemTripCredit(db, {
    shopId: shop.id,
    personId: source.personId,
    actorPersonId: actorId,
    attemptId: randomUUID(),
    currency,
    bookingId: eligible.bookingId,
    expectedFareCents: 8000,
  });
  if (!redeemed.ok) throw new Error(`visual redemption refused: ${redeemed.reason}`);
  const next = await createTrip(db, {
    shopId: shop.id,
    title: "Next sheltered shore session",
    startsAt: new Date(now.getTime() + 12 * 24 * HOUR_MS),
    endsAt: new Date(now.getTime() + (12 * 24 + 2) * HOUR_MS),
    capacity: 6,
    priceCents: 6000,
    diveMode: "shore",
  });
  if (!next) throw new Error("visual next fare refused");
  const nextSeat = await seatDiver(db, {
    shopId: shop.id,
    tripId: next.id,
    actorPersonId: actorId,
    diver: { personId: source.personId },
    entry: "roster",
    refusals: "specific",
  });
  if (!nextSeat.ok) throw new Error(`visual next seat refused: ${nextSeat.reason}`);
  const delivered = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: nextSeat.bookingId,
    purpose: "readiness",
    delivered: true,
  });
  const redirect = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: nextSeat.bookingId,
    purpose: "readiness",
  });
  if (!delivered || !redirect) throw new Error("visual credit readiness links missing");
  return {
    ...source,
    redeemedBookingId: eligible.bookingId,
    eligibleBookingId: nextSeat.bookingId,
    creditDelivered: delivered.token,
    creditRedirect: redirect.token,
    orderId: purchase.order.id,
    activityId,
  };
}
