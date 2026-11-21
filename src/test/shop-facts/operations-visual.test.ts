import { expect, it } from "vitest";
import { getTripBlowout } from "../../db/blowouts";
import { getBookingPayment } from "../../db/payments";
import { createPerson } from "../../db/people";
import { readRecoveryActivities } from "../../db/recovery-activities";
import { recordedPurchaseDay } from "../../features/money/recorded-purchases";
import { readTripCredit, tripCreditBookingOptions } from "../../features/money/trip-credit";
import { calendarDateInTimezone } from "../../lib/calendar-date";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "../staff-session";
import { prepareOperationsVisual } from "./operations-visual";

const context = fileScopedShopContext();
it("prepares actual receipts, external return, goodwill and a cancelled-diver classroom recovery", async () => {
  const { db, shop } = context;
  const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const now = nowDate();
  const arbitraryPerson = await createPerson(db, {
    shopId: shop.id,
    fullName: "Test door arbitrary nonstaff person",
    email: null,
    phone: null,
    origin: "counter",
  });
  // /api/test/shop passes an arbitrary earliest person, not necessarily staff.
  const fact = await prepareOperationsVisual(db, shop, arbitraryPerson.id, now);
  const day = await recordedPurchaseDay(
    db,
    shop,
    actor,
    calendarDateInTimezone(now, shop.timezone),
  );
  expect(day?.receipts).toContainEqual(
    expect.objectContaining({ method: "cash", grossCents: 5000, taxCents: 400, tipCents: 600 }),
  );
  expect(day?.returns).toContainEqual(expect.objectContaining({ amountCents: 1000, count: 1 }));
  expect((await readTripCredit(db, shop.id, fact.personId, shop.currency)).balanceCents).toBe(7000);
  expect(await tripCreditBookingOptions(db, shop.id, fact.personId)).toContainEqual(
    expect.objectContaining({ bookingId: fact.eligibleBookingId }),
  );
  const credit = await readTripCredit(db, shop.id, fact.personId, shop.currency);
  expect(credit.entries.map((entry) => entry.kind)).toEqual(
    expect.arrayContaining(["grant", "redeem"]),
  );
  expect(await getBookingPayment(db, shop.id, fact.redeemedBookingId)).toMatchObject({
    provider: "trip_credit",
    amountCents: 0,
  });
  const blowout = await getTripBlowout(db, shop.id, fact.sourceTripId);
  expect(blowout?.divers).toHaveLength(1);
  if (!blowout) throw new Error("missing blowout");
  const activities = await readRecoveryActivities(db, shop.id, blowout.id);
  expect(activities[0].offers).toHaveLength(1);
  expect(activities[0].participants).toEqual([
    expect.objectContaining({ participant: expect.objectContaining({ status: "confirmed" }) }),
  ]);
});
