// i18n-exempt-file: test fixtures; the unit labels are seeded data a test reads back, never copy a person sees
import { eq } from "drizzle-orm";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createGearItem } from "./gear-items";
import { checkOutGearReservation, reserveGearUnit } from "./gear-reservations";
import { gearReservations, people, shops } from "./schema";
import { createTrip } from "./trips-create";

/**
 * **What the gear register's tests share** — a departure with a booked diver,
 * a second tenant, a staffer, a stored reservation, a shop of the suite's own,
 * and a set that is out. Each `gear-*.test.ts` sibling imports what it uses;
 * the database each runs against is its own (`fileScopedShopContext`), passed
 * in as `ctx`.
 */

/** A setup reservation: a hand pick whose staffer already said "Assign anyway". */
export const SETUP_PICK = { proposed: false, assignAnyway: true } as const;

export const TODAY = "2026-08-20";

export async function shopBooking(db: AppDb, shopId: string, name: string) {
  const startsAt = new Date("2026-09-01T12:00:00Z");
  const trip = await createTrip(db, {
    shopId,
    title: `Gear test departure — ${name}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 8,
    plannedDives: 2,
  });
  if (!trip) throw new Error("trip insert failed");
  const booking = await createBooking(db, {
    shopId,
    tripId: trip.id,
    actor: "staff",
    fullName: name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}@example.com`,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return { trip, bookingId: booking.bookingId, personId: booking.personId };
}

export async function rivalShop(db: AppDb) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Reef", slug: "rival-reef-gear", timezone: "America/New_York" })
    .returning();
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}

/** A staffer to attribute a release to (`released_by_person_id`, issue #2258). */
export async function deskStaffer(db: AppDb, shopId: string): Promise<string> {
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName: "Kai Desk" })
    .returning({ id: people.id });
  if (!row) throw new Error("staff insert failed");
  return row.id;
}

/** One reservation row as stored, released or not. */
export async function storedReservation(db: AppDb, reservationId: string) {
  const [row] = await db
    .select()
    .from(gearReservations)
    .where(eq(gearReservations.id, reservationId));
  return row ?? null;
}

/**
 * A shop of this suite's own. The seeded blue-mantis demo now ships with a
 * whole fleet (src/db/seed-gear.ts), so asserting counts and list contents
 * against it would pin the demo's inventory; a fresh shop keeps every
 * assertion about exactly the rows each test wrote — and doubles as proof
 * the readers are shop-scoped.
 */
export async function gearShopContext(source: { db: AppDb }) {
  const { db } = source;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Gear Test Divers", slug: "gear-test", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("gear test shop insert failed");
  return { db, shop };
}

export function mustCreate(outcome: Awaited<ReturnType<typeof createGearItem>>) {
  if (!outcome.ok) throw new Error(`create refused: ${outcome.reason}`);
  return outcome.item;
}

/** A booking with a BCD and a regulator reserved and handed over: a set that is out. */
export async function aSetOut(db: AppDb, shopId: string) {
  const bcd = mustCreate(
    await createGearItem(db, { shopId, kind: "bcd", label: "BCD #21", size: "M" }),
  );
  const reg = mustCreate(await createGearItem(db, { shopId, kind: "regulator", label: "Reg #21" }));
  const diver = await shopBooking(db, shopId, "Nadia Osei");
  const ids: string[] = [];
  for (const unit of [bcd, reg]) {
    const reserved = await reserveGearUnit(db, {
      shopId,
      gearItemId: unit.id,
      bookingId: diver.bookingId,
      reservedFrom: "2026-09-10",
      reservedUntil: "2026-09-11",
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error("reserve failed");
    await checkOutGearReservation(db, { shopId, reservationId: reserved.reservation.id });
    ids.push(reserved.reservation.id);
  }
  return {
    bookingId: diver.bookingId,
    personId: diver.personId,
    tripId: diver.trip.id,
    reservationIds: ids,
  };
}
