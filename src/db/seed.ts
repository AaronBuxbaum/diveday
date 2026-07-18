import { hash } from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  bookings,
  people,
  personRoles,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * Dev-only convenience — production seeds nothing (ADR-0005). The same demo
 * shop backs the customer-facing demo experience (docs ADR 20260718-demo-mode).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** n days from now at the given local-ish hour/minute (UTC-anchored; demo data). */
function at(daysFromNow: number, hour: number, minute = 0): Date {
  const d = new Date(Date.now() + daysFromNow * DAY_MS);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

export async function seedIfEmpty(db: AppDb): Promise<void> {
  const existing = await db.select({ id: shops.id }).from(shops).limit(1);
  if (existing.length > 0) return;
  await seedDemo(db);
}

/**
 * The stable half of the demo: the shop, its staff, and their logins. Seeded
 * once and left alone — resetting the demo playground never touches these, so
 * a signed-in demo session survives a reset (docs ADR 20260718-demo-mode).
 */
export async function seedDemo(db: AppDb): Promise<void> {
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Blue Mantis Divers",
      slug: "blue-mantis",
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("seed: failed to insert demo shop");

  const staffDefs = [
    { fullName: "Dana Reyes", email: "dana@bluemantis.example", roles: ["owner", "manager"] },
    { fullName: "Marcus Webb", email: "marcus@bluemantis.example", roles: ["instructor"] },
    { fullName: "Keiko Tanaka", email: "keiko@bluemantis.example", roles: ["divemaster"] },
    { fullName: "Sal Moretti", email: "sal@bluemantis.example", roles: ["captain"] },
  ] as const;

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId: shop.id,
        fullName: s.fullName,
        email: s.email,
        emergencyContactName: "On file",
        emergencyContactPhone: "+1-305-555-0100",
      })),
    )
    .returning();

  await db.insert(personRoles).values(
    staff.flatMap((person, i) =>
      staffDefs[i].roles.map((role) => ({
        personId: person.id,
        role,
      })),
    ),
  );

  // Staff sign-in accounts with deterministic dev passwords (never in prod).
  // Cost 4 keeps seeding fast in tests; real account creation flows must use
  // a production-grade cost.
  const logins = Object.values(DEV_STAFF_LOGINS);
  await db.insert(userAccounts).values(
    await Promise.all(
      logins.map(async (login) => {
        const person = staff.find((p) => p.email === login.email);
        if (!person) throw new Error(`seed: no staff person for ${login.email}`);
        return {
          personId: person.id,
          email: login.email,
          hashedPassword: await hash(login.password, 4),
        };
      }),
    ),
  );

  await seedDemoSchedule(db, shop.id);
}

const customerNames = [
  "Priya Sharma",
  "Tom Okafor",
  "Lena Fischer",
  "Diego Alvarez",
  "June Park",
  "Omar Haddad",
  "Nadia Petrov",
  "Sam Whitfield",
  "Ines Costa",
  "Ravi Menon",
  "Amara Osei",
  "Felix Grant",
];

/**
 * The resettable half of the demo: customers, trips, and their bookings. This
 * is the playground a prospective customer pokes at — schedule a trip, cancel a
 * booking, fill a boat — and the exact set of rows resetDemoSchedule restores.
 */
export async function seedDemoSchedule(db: AppDb, shopId: string): Promise<void> {
  const customers = await db
    .insert(people)
    .values(
      customerNames.map((fullName, i) => ({
        shopId,
        fullName,
        email: `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
        phone: `+1-305-555-01${String(i + 10).padStart(2, "0")}`,
      })),
    )
    .returning();

  await db
    .insert(personRoles)
    .values(customers.map((person) => ({ personId: person.id, role: "customer" as const })));

  const tripRows = await db
    .insert(trips)
    .values([
      {
        shopId,
        title: "Two-Tank Reef — Molasses & French",
        description: "Morning double dip on the outer reef. All levels, OW required.",
        startsAt: at(1, 11, 30), // ~7:30 AM Eastern
        endsAt: at(1, 15, 0),
        capacity: 12,
      },
      {
        shopId,
        title: "Night Dive — City of Washington",
        description: "Torches, tarpon, and bioluminescence. AOW or Night specialty.",
        startsAt: at(2, 22, 0), // ~6:00 PM Eastern
        endsAt: at(3, 0, 30),
        capacity: 8,
      },
      {
        shopId,
        title: "Wreck Trip — Spiegel Grove",
        description: "The big one. AOW + Deep required, nitrox recommended.",
        startsAt: at(5, 12, 0),
        endsAt: at(5, 16, 0),
        capacity: 10,
      },
      {
        shopId,
        title: "Two-Tank Reef — Christ of the Abyss",
        description: "Classic shallow sites, great for refreshers and new OW divers.",
        startsAt: at(7, 11, 30),
        endsAt: at(7, 15, 0),
        capacity: 12,
      },
    ])
    .returning();

  // Booking spread: busy reef trip, quiet night dive, sold-out wreck, fresh listing.
  const [reef, night, wreck] = tripRows;
  if (!reef || !night || !wreck) throw new Error("seed: failed to insert demo trips");
  const bookingRows = [
    ...customers.slice(0, 9).map((c) => ({ tripId: reef.id, personId: c.id })),
    ...customers.slice(4, 7).map((c) => ({ tripId: night.id, personId: c.id })),
    ...customers.slice(0, 10).map((c) => ({ tripId: wreck.id, personId: c.id })),
  ];
  await db.insert(bookings).values(
    bookingRows.map((row) => ({
      shopId,
      status: "booked" as const,
      ...row,
    })),
  );
}

/**
 * Restore the demo playground to its seeded state. Wipes the shop's trips,
 * bookings, crew assignments, and every non-staff person (seeded customers plus
 * any walk-ups the booking flow created), then re-seeds the schedule. Staff and
 * their logins are deliberately left in place so the demo session stays valid
 * (docs ADR 20260718-demo-mode).
 */
export async function resetDemoSchedule(db: AppDb, shopId: string): Promise<void> {
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);

  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
  }
  await db.delete(trips).where(eq(trips.shopId, shopId));

  const staffRows = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])));
  const staffIds = new Set(staffRows.map((r) => r.personId));

  const shopPeople = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shopId));
  const nonStaffIds = shopPeople.map((p) => p.id).filter((id) => !staffIds.has(id));
  if (nonStaffIds.length > 0) {
    await db.delete(personRoles).where(inArray(personRoles.personId, nonStaffIds));
    await db.delete(people).where(inArray(people.id, nonStaffIds));
  }

  await seedDemoSchedule(db, shopId);
}
