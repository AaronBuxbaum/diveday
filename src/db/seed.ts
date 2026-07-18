import { hash } from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import {
  DEFAULT_MAX_PPO2_BAR,
  DEFAULT_MAX_PPO2_CENTIBAR,
  maxOperatingDepthMeters,
} from "@/lib/nitrox";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  bookings,
  certifications,
  courses,
  gearAssignments,
  gearItems,
  gearServiceEvents,
  nitroxCertifications,
  nitroxFills,
  people,
  personRoles,
  rentalGearRequests,
  rollCallEvents,
  shops,
  tripAssignments,
  tripRequirements,
  trips,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * Dev-only convenience — production seeds nothing (ADR-0005). The same demo
 * shop backs the customer-facing demo experience (docs ADR 20260718-demo-mode).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const INSTRUCTOR_EMAIL = "marcus@bluemantis.example";

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
 * The stable half of the demo: the shop, its default waiver template, its
 * staff, and their logins. Seeded once and left alone — resetting the demo
 * playground never touches these, so a signed-in demo session survives a reset
 * (docs ADR 20260718-demo-mode).
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

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: "Blue Mantis Diving Release",
    version: 1,
    isDefault: true,
    body: "I understand that scuba diving and boat travel involve inherent risks. I will follow the crew's briefing, use equipment as instructed, and tell the shop if my health changes before departure.",
  });

  const staffDefs = [
    { fullName: "Dana Reyes", email: "dana@bluemantis.example", roles: ["owner", "manager"] },
    { fullName: "Marcus Webb", email: INSTRUCTOR_EMAIL, roles: ["instructor"] },
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
 * The resettable half of the demo: customers, their cards, the course catalog,
 * trips, requirements, and bookings. This is the playground a prospective
 * customer pokes at — schedule a trip, cancel a booking, fill a boat — and the
 * exact set of rows resetDemoSchedule restores. Staff already exist (stable
 * half), so the instructor is looked up rather than passed in.
 */
export async function seedDemoSchedule(db: AppDb, shopId: string): Promise<void> {
  const [instructor] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, INSTRUCTOR_EMAIL)))
    .limit(1);
  if (!instructor) throw new Error("seed: instructor missing from stable staff");

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

  await db.insert(certifications).values(
    customers.slice(0, 10).map((person, i) => ({
      shopId,
      personId: person.id,
      agency: i % 2 === 0 ? ("padi" as const) : ("ssi" as const),
      level: i === 1 ? ("advanced_open_water" as const) : ("open_water" as const),
      identifier: `DEMO-${String(i + 1).padStart(4, "0")}`,
      status: "verified" as const,
    })),
  );

  // Catalog baselines: DSD/OW welcome uncertified students; continuing
  // education admits only a verified card at the stated level.
  const courseRows = await db
    .insert(courses)
    .values([
      {
        shopId,
        title: "Discover Scuba Diving",
        description: "A supervised first underwater experience with an instructor.",
        minimumCertificationLevel: null,
      },
      {
        shopId,
        title: "Open Water Diver",
        description: "The foundational certification course for new divers.",
        minimumCertificationLevel: null,
      },
      {
        shopId,
        title: "Advanced Open Water",
        description: "Build confidence and range with five adventure dives.",
        minimumCertificationLevel: "open_water" as const,
      },
      {
        shopId,
        title: "Scuba Refresher",
        description: "A patient skills tune-up before getting back in the water.",
        minimumCertificationLevel: "open_water" as const,
      },
    ])
    .returning();
  const discoverCourse = courseRows.find((course) => course.title === "Discover Scuba Diving");
  if (!discoverCourse) throw new Error("seed: DSD course missing");

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
      {
        shopId,
        courseId: discoverCourse.id,
        title: "Discover Scuba — Pool & Reef",
        description: "A small, instructor-led first breath underwater. No C-card required.",
        startsAt: at(4, 14, 0),
        endsAt: at(4, 17, 0),
        capacity: 4,
      },
    ])
    .returning();

  await db.insert(tripRequirements).values(
    tripRows.map((trip) => ({
      tripId: trip.id,
      shopId,
      requiresWaiver: true,
      minimumCertificationLevel:
        trip.courseId === discoverCourse.id ? null : ("open_water" as const),
    })),
  );

  const discoverSession = tripRows.find((trip) => trip.courseId === discoverCourse.id);
  if (!discoverSession) throw new Error("seed: DSD session missing");
  await db.insert(tripAssignments).values({ tripId: discoverSession.id, personId: instructor.id });

  // Booking spread: busy reef trip, quiet night dive, sold-out wreck, fresh listing.
  const [reef, night, wreck] = tripRows;
  if (!reef || !night || !wreck) throw new Error("seed: failed to insert demo trips");
  const bookingRows = [
    ...customers.slice(0, 9).map((c) => ({ tripId: reef.id, personId: c.id })),
    ...customers.slice(4, 7).map((c) => ({ tripId: night.id, personId: c.id })),
    ...customers.slice(0, 10).map((c) => ({ tripId: wreck.id, personId: c.id })),
  ];
  const bookingRows_ = await db
    .insert(bookings)
    .values(
      bookingRows.map((row) => ({
        shopId,
        status: "booked" as const,
        ...row,
      })),
    )
    .returning();

  await seedNitrox(db, shopId, instructor.id, customers, wreck, bookingRows_);
}

/**
 * Nitrox demo: a small tank bank, a couple of verified EANx cards (and one
 * pending), and a logged fill on the wreck trip — so the nitrox surfaces show
 * a realistic gate and a real MOD from the moment a fresh checkout boots.
 */
async function seedNitrox(
  db: AppDb,
  shopId: string,
  filledByPersonId: string,
  customers: { id: string }[],
  wreck: { id: string },
  bookingRows: { id: string; tripId: string; personId: string }[],
): Promise<void> {
  const tanks = await db
    .insert(gearItems)
    .values(
      ["AL80 Nitrox #1", "AL80 Nitrox #2", "AL80 Nitrox #3"].map((label) => ({
        shopId,
        label,
        type: "tank" as const,
        size: "AL80",
      })),
    )
    .returning();

  // Two verified EANx cards, one still pending review.
  await db.insert(nitroxCertifications).values([
    {
      shopId,
      personId: customers[0].id,
      agency: "padi" as const,
      identifier: "EANX-0001",
      status: "verified" as const,
      reviewedAt: new Date(),
    },
    {
      shopId,
      personId: customers[1].id,
      agency: "ssi" as const,
      identifier: "EANX-0002",
      status: "verified" as const,
      reviewedAt: new Date(),
    },
    {
      shopId,
      personId: customers[2].id,
      agency: "padi" as const,
      identifier: "EANX-0003",
      status: "pending" as const,
    },
  ]);

  // One logged fill for a certified diver on the wreck ("nitrox recommended").
  const wreckBookingForCert = bookingRows.find(
    (b) => b.tripId === wreck.id && b.personId === customers[0].id,
  );
  const tank = tanks[0];
  if (wreckBookingForCert && tank) {
    await db.insert(nitroxFills).values({
      shopId,
      bookingId: wreckBookingForCert.id,
      gearItemId: tank.id,
      oxygenPercent: 32,
      maxDepthMeters: maxOperatingDepthMeters(32, DEFAULT_MAX_PPO2_BAR),
      maxPpO2Centibar: DEFAULT_MAX_PPO2_CENTIBAR,
      analyzerSignature: "Priya Sharma",
      filledByPersonId,
    });
  }
}

/**
 * Restore the demo playground to its seeded state. Wipes everything a visitor
 * can touch — trips and their sessions, bookings and everything hanging off
 * them (waivers, gear, roll call), the course catalog, cards, gear inventory,
 * and every non-staff person (seeded customers plus any walk-ups the booking
 * flow created) — then re-seeds the schedule. The shop, its default waiver
 * template, staff, and their logins are deliberately left in place so the demo
 * session stays valid (docs ADR 20260718-demo-mode).
 *
 * Deletes run children-first so foreign keys never block a reset, however far
 * a visitor drove the tool (signed a waiver, assigned gear, ran roll call).
 */
export async function resetDemoSchedule(db: AppDb, shopId: string): Promise<void> {
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);

  // Booking- and trip-dependent operational history first.
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
  await db.delete(nitroxFills).where(eq(nitroxFills.shopId, shopId));
  await db.delete(gearServiceEvents).where(eq(gearServiceEvents.shopId, shopId));
  await db.delete(gearAssignments).where(eq(gearAssignments.shopId, shopId));
  await db.delete(rentalGearRequests).where(eq(rentalGearRequests.shopId, shopId));
  await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shopId));
  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  await db.delete(tripRequirements).where(eq(tripRequirements.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
  }
  await db.delete(trips).where(eq(trips.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  await db.delete(certifications).where(eq(certifications.shopId, shopId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.shopId, shopId));
  await db.delete(gearItems).where(eq(gearItems.shopId, shopId));

  // Everyone who isn't staff — seeded customers plus booking-flow walk-ups.
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
