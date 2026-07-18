import { hash } from "bcryptjs";
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
  gearItems,
  nitroxCertifications,
  nitroxFills,
  people,
  personRoles,
  shops,
  tripAssignments,
  tripRequirements,
  trips,
  userAccounts,
  waiverTemplates,
} from "./schema";

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

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: "Blue Mantis Diving Release",
    version: 1,
    isDefault: true,
    body: "I understand that scuba diving and boat travel involve inherent risks. I will follow the crew's briefing, use equipment as instructed, and tell the shop if my health changes before departure.",
  });

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

  await db.insert(certifications).values(
    customers.slice(0, 10).map((person, i) => ({
      shopId: shop.id,
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
        shopId: shop.id,
        title: "Discover Scuba Diving",
        description: "A supervised first underwater experience with an instructor.",
        minimumCertificationLevel: null,
      },
      {
        shopId: shop.id,
        title: "Open Water Diver",
        description: "The foundational certification course for new divers.",
        minimumCertificationLevel: null,
      },
      {
        shopId: shop.id,
        title: "Advanced Open Water",
        description: "Build confidence and range with five adventure dives.",
        minimumCertificationLevel: "open_water" as const,
      },
      {
        shopId: shop.id,
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
      {
        shopId: shop.id,
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
      shopId: shop.id,
      requiresWaiver: true,
      minimumCertificationLevel:
        trip.courseId === discoverCourse.id ? null : ("open_water" as const),
    })),
  );

  const discoverSession = tripRows.find((trip) => trip.courseId === discoverCourse.id);
  const instructor = staff.find((person) => person.email === "marcus@bluemantis.example");
  if (!discoverSession || !instructor) throw new Error("seed: DSD session or instructor missing");
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
        shopId: shop.id,
        status: "booked" as const,
        ...row,
      })),
    )
    .returning();

  await seedNitrox(db, shop.id, staff, customers, wreck, bookingRows_);
}

/**
 * Nitrox demo: a small tank bank, a couple of verified EANx cards (and one
 * pending), and a logged fill on the wreck trip — so the nitrox surfaces show
 * a realistic gate and a real MOD from the moment a fresh checkout boots.
 */
async function seedNitrox(
  db: AppDb,
  shopId: string,
  staff: { id: string }[],
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
  const staffMember = staff[0];
  const tank = tanks[0];
  if (wreckBookingForCert && staffMember && tank) {
    await db.insert(nitroxFills).values({
      shopId,
      bookingId: wreckBookingForCert.id,
      gearItemId: tank.id,
      oxygenPercent: 32,
      maxDepthMeters: maxOperatingDepthMeters(32, DEFAULT_MAX_PPO2_BAR),
      maxPpO2Centibar: DEFAULT_MAX_PPO2_CENTIBAR,
      analyzerSignature: "Priya Sharma",
      filledByPersonId: staffMember.id,
    });
  }
}
