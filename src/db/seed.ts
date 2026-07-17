import type { AppDb } from "./client";
import { bookings, people, personRoles, shops, trips } from "./schema";

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * Dev-only convenience — production seeds nothing (ADR-0005).
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

  const customers = await db
    .insert(people)
    .values(
      customerNames.map((fullName, i) => ({
        shopId: shop.id,
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
        shopId: shop.id,
        title: "Two-Tank Reef — Molasses & French",
        description: "Morning double dip on the outer reef. All levels, OW required.",
        startsAt: at(1, 11, 30), // ~7:30 AM Eastern
        endsAt: at(1, 15, 0),
        capacity: 12,
      },
      {
        shopId: shop.id,
        title: "Night Dive — City of Washington",
        description: "Torches, tarpon, and bioluminescence. AOW or Night specialty.",
        startsAt: at(2, 22, 0), // ~6:00 PM Eastern
        endsAt: at(3, 0, 30),
        capacity: 8,
      },
      {
        shopId: shop.id,
        title: "Wreck Trip — Spiegel Grove",
        description: "The big one. AOW + Deep required, nitrox recommended.",
        startsAt: at(5, 12, 0),
        endsAt: at(5, 16, 0),
        capacity: 10,
      },
      {
        shopId: shop.id,
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
      shopId: shop.id,
      status: "booked" as const,
      ...row,
    })),
  );
}
