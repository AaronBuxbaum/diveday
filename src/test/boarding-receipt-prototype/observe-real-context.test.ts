import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { readActiveStaffRoles } from "@/db/authz";
import { bookings, people, shops, trips, userAccounts } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { returnedTrip } from "@/test/substrate-fixtures/db/roll-call-test-fixtures";
import { observeRealContextForTest } from "./observe-real-context";

const ctx = fileScopedShopContext();
it("observes live tenant and staff data only as a nonauthoritative context", async () => {
  const { db, shop } = ctx;
  const fixture = await returnedTrip(db, shop.id, { endedHoursAgo: -2, divers: 1 });
  const bookingId = fixture.bookingIds[0];
  if (!bookingId) throw new Error("booking missing");
  let actorId: string | undefined;
  for (const member of await listStaff(db, shop.id)) {
    const roles = await readActiveStaffRoles(db, shop.id, member.person.id);
    if (roles && isStaff(roles)) {
      actorId = member.person.id;
      break;
    }
  }
  if (!actorId) throw new Error("active staff missing");
  const [subject] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Independent test subject" })
    .returning({ id: people.id });
  if (!subject || subject.id === actorId) throw new Error("distinct subject missing");
  await db.update(bookings).set({ personId: subject.id }).where(eq(bookings.id, bookingId));
  const args = { shopId: shop.id, tripId: fixture.trip.id, bookingId, actorId };
  expect(await observeRealContextForTest(db, args)).toMatchObject({
    kind: "observed_only",
    ...args,
    personId: subject.id,
    generation: "unknown",
  });
  const [foreignShop] = await db
    .insert(shops)
    .values({ name: "Other test shop", slug: `other-${randomUUID()}`, timezone: "UTC" })
    .returning();
  if (!foreignShop) throw new Error("foreign shop missing");
  const [foreignPerson] = await db
    .insert(people)
    .values({ shopId: foreignShop.id, fullName: "Foreign test subject" })
    .returning();
  if (!foreignPerson) throw new Error("foreign person missing");
  const [foreignTrip] = await db
    .insert(trips)
    .values({
      shopId: foreignShop.id,
      title: "Foreign trip",
      startsAt: nowDate(),
      endsAt: new Date(nowDate().getTime() + 3_600_000),
      capacity: 1,
      priceCents: 1000,
    })
    .returning();
  if (!foreignTrip) throw new Error("foreign trip missing");
  const [foreignBooking] = await db
    .insert(bookings)
    .values({
      shopId: foreignShop.id,
      tripId: foreignTrip.id,
      personId: foreignPerson.id,
      status: "booked",
      bookedAs: "diver",
    })
    .returning();
  if (!foreignBooking) throw new Error("foreign booking missing");
  expect(
    await observeRealContextForTest(db, {
      ...args,
      tripId: foreignTrip.id,
      bookingId: foreignBooking.id,
    }),
  ).toEqual({ kind: "unavailable" });
  expect(await observeRealContextForTest(db, { ...args, shopId: randomUUID() })).toEqual({
    kind: "unavailable",
  });
  expect(await observeRealContextForTest(db, { ...args, actorId: randomUUID() })).toEqual({
    kind: "unavailable",
  });
  expect(await observeRealContextForTest(db, { ...args, tripId: randomUUID() })).toEqual({
    kind: "unavailable",
  });
  const other = await returnedTrip(db, shop.id, { endedHoursAgo: -2, divers: 1 });
  await db.update(bookings).set({ tripId: other.trip.id }).where(eq(bookings.id, bookingId));
  expect(await observeRealContextForTest(db, args)).toEqual({ kind: "unavailable" });
  expect(await observeRealContextForTest(db, { ...args, tripId: other.trip.id })).toMatchObject({
    kind: "observed_only",
    generation: "unknown",
    tripId: other.trip.id,
  });
  await db.update(bookings).set({ tripId: fixture.trip.id }).where(eq(bookings.id, bookingId));
  const [booking] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!booking) throw new Error("booking missing");
  await db
    .update(userAccounts)
    .set({ status: "disabled" })
    .where(eq(userAccounts.personId, actorId));
  expect(await observeRealContextForTest(db, args)).toEqual({ kind: "unavailable" });
  await db.update(userAccounts).set({ status: "active" }).where(eq(userAccounts.personId, actorId));
  // The schema requires an anonymized person to be deleted, so this covers
  // the combined state rather than isolating the anonymized predicate.
  await db
    .update(people)
    .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
    .where(eq(people.id, booking.personId));
  const actorRoles = await readActiveStaffRoles(db, shop.id, actorId);
  expect(actorRoles && isStaff(actorRoles)).toBe(true);
  expect(await observeRealContextForTest(db, args)).toEqual({ kind: "unavailable" });
});
