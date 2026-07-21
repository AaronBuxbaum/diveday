import { hash } from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate, nowMs } from "@/lib/clock";
import { courseSlug } from "@/lib/courses";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { COURSE_TEMPLATES } from "./course-templates";
import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  bookingPayments,
  bookings,
  certifications,
  courses,
  type DiveSpecialty,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  globalDiveSites,
  globalDiveSiteVersions,
  nitroxCertifications,
  notificationDeliveries,
  notificationDeliveryAttempts,
  orderLineItems,
  orders,
  people,
  personRoles,
  rentalFitProfiles,
  rollCallEvents,
  shops,
  specialtyCertifications,
  tripAssignments,
  tripDives,
  tripRequirements,
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * The seeded Blue Mantis shop backs the customer-facing demo experience in
 * every environment (docs ADR 20260718-production-demo-seed).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const INSTRUCTOR_EMAIL = "marcus@bluemantis.example";

/** Public-domain and CC0 images from Wikimedia Commons, bundled for reliable rendering. */
function commonsImage(filename: string): string {
  return `/dive-sites/${encodeURIComponent(filename)}`;
}

/** n days from now at the given local-ish hour/minute (UTC-anchored; demo data). */
function at(daysFromNow: number, hour: number, minute = 0): Date {
  const d = new Date(nowMs() + daysFromNow * DAY_MS);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

/**
 * Anchored to the clock rather than the calendar so one seeded trip always
 * sails *today*, whatever time the demo is opened. Today's departure board is
 * the first thing staff see, and a demo that never has a boat out cannot show
 * it. Always in the future, so it never falls out of the upcoming schedule.
 */
function hoursFromNow(hours: number, from = nowDate()): Date {
  const d = new Date(from.getTime() + hours * 60 * 60 * 1000);
  // Round up to the next half hour: dive boats leave at 7:30, not 7:49, and a
  // ragged time reads as a bug in every screenshot of the demo.
  const step = 30 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / step) * step);
}

const DEMO_SHOP_TIMEZONE = "America/New_York";

/**
 * Start of the seeded departure that must sail *today in the shop's timezone*.
 * Within five hours of local midnight the plain now+5h offset rounds into
 * tomorrow, which empties the departure board the demo (and the Today tests)
 * are built around — so it clamps to the last half-hour slot that still sails
 * today. Only once local midnight is closer than that final slot does the
 * trip concede to tomorrow morning: "today, in the future" has run out of room.
 */
export function demoTodayDepartureStart(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
): Date {
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  const candidate = hoursFromNow(5, now);
  if (localDay(candidate) === localDay(now)) return candidate;
  const lastSlotToday = wallTimeToUtc(
    { ...utcToWallTime(now, timeZone), hour: 23, minute: 30 },
    timeZone,
  );
  return lastSlotToday.getTime() > now.getTime() ? lastSlotToday : candidate;
}

export async function seedIfEmpty(db: DbExecutor): Promise<void> {
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
export async function seedDemo(db: DbExecutor): Promise<void> {
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Blue Mantis Divers",
      slug: DEMO_SHOP_SLUG,
      timezone: DEMO_SHOP_TIMEZONE,
      // A front-desk address, not a person's — this is printed on the public
      // course pages, where it backs the "Get in touch" composer.
      contactEmail: "hello@bluemantis.example",
      contactPhone: "+1 305 555 0142",
      isDemo: true,
    })
    .returning();
  if (!shop) throw new Error("seed: failed to insert demo shop");

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: "Blue Mantis Diving Release",
    version: 1,
    body: DEFAULT_WAIVER_BODY,
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

/**
 * Seed a dynamically created shop with the standard demo dataset (schedule,
 * bookings, rental fit, nitrox) for dynamic onboarding trials.
 */
export async function seedShopWithDemoData(db: DbExecutor, shopId: string): Promise<void> {
  await db.insert(waiverTemplates).values({
    shopId,
    title: DEFAULT_WAIVER_TITLE,
    version: 1,
    body: DEFAULT_WAIVER_BODY,
  });

  const staffDefs = [
    {
      fullName: "Marcus Webb",
      email: INSTRUCTOR_EMAIL,
      roles: ["instructor"],
      password: DEV_STAFF_LOGINS.instructor.password,
    },
    {
      fullName: "Keiko Tanaka",
      email: "keiko@bluemantis.example",
      roles: ["divemaster"],
      password: DEV_STAFF_LOGINS.divemaster.password,
    },
    {
      fullName: "Sal Moretti",
      email: "sal@bluemantis.example",
      roles: ["captain"],
      password: DEV_STAFF_LOGINS.captain.password,
    },
  ] as const;

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId,
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

  // Seed user accounts for these staff members so they can log in/switch on dynamic trial shops too
  await db.insert(userAccounts).values(
    await Promise.all(
      staff.map(async (person, i) => ({
        personId: person.id,
        email: staffDefs[i].email,
        hashedPassword: await hash(staffDefs[i].password, 4),
      })),
    ),
  );

  await seedDemoSchedule(db, shopId);
}

/**
 * The shop's divers. **Order is load-bearing**: the rosters below index into
 * this list, and tests assert on the exact names that land on today's boat.
 * Append to the end; never reorder or insert.
 *
 * Emergency contacts are deliberately incomplete. A manifest whose every field
 * is filled cannot show a crew what a manifest is *for*, so two divers arrive
 * without one and the roll-call sheet says so out loud.
 */
const customerDefs: Array<{ fullName: string; emergencyContact?: [string, string] }> = [
  { fullName: "Priya Sharma", emergencyContact: ["Asha Sharma (sister)", "+1-305-555-0231"] },
  { fullName: "Tom Okafor", emergencyContact: ["Ngozi Okafor (wife)", "+1-305-555-0232"] },
  { fullName: "Lena Fischer", emergencyContact: ["Jonas Fischer (husband)", "+49-30-555-0233"] },
  { fullName: "Diego Alvarez", emergencyContact: ["Rosa Alvarez (mother)", "+1-786-555-0234"] },
  { fullName: "June Park", emergencyContact: ["Min-ho Park (father)", "+1-305-555-0235"] },
  { fullName: "Omar Haddad", emergencyContact: ["Layla Haddad (sister)", "+1-305-555-0236"] },
  // No contact on file: the manifest gap the crew chases at the dock.
  { fullName: "Nadia Petrov" },
  { fullName: "Sam Whitfield", emergencyContact: ["Ruth Whitfield (mother)", "+1-954-555-0238"] },
  { fullName: "Ines Costa", emergencyContact: ["Paulo Costa (brother)", "+351-21-555-0239"] },
  { fullName: "Ravi Menon", emergencyContact: ["Divya Menon (wife)", "+1-305-555-0240"] },
  { fullName: "Amara Osei", emergencyContact: ["Kwame Osei (father)", "+1-305-555-0241"] },
  { fullName: "Felix Grant" },
  { fullName: "Hana Kobayashi", emergencyContact: ["Ren Kobayashi (brother)", "+81-3-555-0243"] },
  { fullName: "Mateo Duarte", emergencyContact: ["Sofia Duarte (wife)", "+1-305-555-0244"] },
  { fullName: "Zoe Bennett", emergencyContact: ["Harriet Bennett (mother)", "+44-20-555-0245"] },
  { fullName: "Yusuf Demir", emergencyContact: ["Elif Demir (sister)", "+90-212-555-0246"] },
  { fullName: "Clara Nguyen", emergencyContact: ["Binh Nguyen (father)", "+1-305-555-0247"] },
  { fullName: "Theo Lindqvist", emergencyContact: ["Ida Lindqvist (wife)", "+46-8-555-0248"] },
];

/**
 * The resettable half of the demo: customers, their cards, the course catalog,
 * trips, requirements, and bookings. This is the playground a prospective
 * customer pokes at — schedule a trip, cancel a booking, fill a boat — and the
 * exact set of rows resetDemoSchedule restores. Staff already exist (stable
 * half), so the instructor is looked up rather than passed in.
 */
export async function seedDemoSchedule(db: DbExecutor, shopId: string): Promise<void> {
  const [instructor] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, INSTRUCTOR_EMAIL)))
    .limit(1);
  if (!instructor) throw new Error("seed: instructor missing from stable staff");

  const customers = await db
    .insert(people)
    .values(
      customerDefs.map((customer, i) => ({
        shopId,
        fullName: customer.fullName,
        email: `${customer.fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
        phone: `+1-305-555-01${String(i + 10).padStart(2, "0")}`,
        emergencyContactName: customer.emergencyContact?.[0] ?? null,
        emergencyContactPhone: customer.emergencyContact?.[1] ?? null,
      })),
    )
    .returning();

  await db
    .insert(personRoles)
    .values(customers.map((person) => ({ personId: person.id, role: "diver" as const })));

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

  // The rest of the regulars, carrying the states a desk actually sees: cards
  // still queued for review, one that came back rejected, one expiring inside
  // the month, and agencies beyond the two the shop teaches. Kept separate from
  // the block above because that block's ten divers crew today's boat and their
  // readiness is asserted exactly.
  const laterCerts: Array<{
    index: number;
    agency: "padi" | "ssi" | "naui" | "sdi" | "tdi";
    level: "open_water" | "advanced_open_water" | "rescue" | "divemaster";
    status: "verified" | "pending" | "rejected";
    expiresAt?: Date;
  }> = [
    { index: 12, agency: "padi", level: "advanced_open_water", status: "verified" },
    { index: 13, agency: "ssi", level: "open_water", status: "pending" },
    { index: 14, agency: "padi", level: "rescue", status: "verified", expiresAt: at(26, 12) },
    // The card did not match the name on the booking; the desk sent it back.
    { index: 15, agency: "naui", level: "open_water", status: "rejected" },
    { index: 16, agency: "sdi", level: "open_water", status: "verified" },
    { index: 17, agency: "tdi", level: "divemaster", status: "verified" },
  ];
  const laterCertRows = laterCerts
    .map((cert) => {
      const person = customers[cert.index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        agency: cert.agency,
        level: cert.level,
        identifier: `DEMO-${String(cert.index + 1).padStart(4, "0")}`,
        status: cert.status,
        expiresAt: cert.expiresAt ?? null,
      };
    })
    .filter((row) => row !== null);
  if (laterCertRows.length > 0) await db.insert(certifications).values(laterCertRows);

  // Specialty evidence: customer[1] is the AOW diver, fully carded for the
  // demanding trips; customer[2] has a Deep card still awaiting verification so
  // the pending gate is visible on a roster.
  if (customers[1] && customers[2]) {
    await db.insert(specialtyCertifications).values([
      {
        shopId,
        personId: customers[1].id,
        agency: "padi" as const,
        specialty: "deep" as const,
        identifier: "DEMO-SPEC-DEEP-2",
        status: "verified" as const,
      },
      {
        shopId,
        personId: customers[1].id,
        agency: "padi" as const,
        specialty: "wreck" as const,
        identifier: "DEMO-SPEC-WRECK-2",
        status: "verified" as const,
      },
      {
        shopId,
        personId: customers[1].id,
        agency: "padi" as const,
        specialty: "night" as const,
        identifier: "DEMO-SPEC-NIGHT-2",
        status: "verified" as const,
      },
      {
        shopId,
        personId: customers[2].id,
        agency: "ssi" as const,
        specialty: "deep" as const,
        identifier: "DEMO-SPEC-DEEP-3",
        status: "pending" as const,
      },
    ]);
  }

  // Catalog baselines: DSD/OW welcome uncertified students; continuing
  // education admits only a verified card at the stated level.
  const courseRows = await db
    .insert(courses)
    .values(
      [
        {
          shopId,
          agency: "padi",
          title: "Discover Scuba Diving",
          description: "A supervised first underwater experience with an instructor.",
          priceCents: 17500,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "padi",
          title: "Open Water Diver",
          description: "The foundational certification course for new divers.",
          priceCents: 49900,
          eLearningPriceCents: 21000,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "padi",
          title: "Advanced Open Water Diver",
          description: "Build confidence and range with five adventure dives.",
          priceCents: 42500,
          eLearningPriceCents: 19000,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Scuba Refresher",
          description: "A patient skills tune-up before getting back in the water.",
          priceCents: 12500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Rescue Diver",
          description: "Problem prevention and rescue skills for experienced divers.",
          priceCents: 52500,
          eLearningPriceCents: 24500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Enriched Air (Nitrox) Diver",
          description: "Plan and dive safely with enriched air nitrox.",
          priceCents: 19500,
          eLearningPriceCents: 15000,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Peak Performance Buoyancy",
          description: "Two dives spent fixing weighting, trim, and control.",
          priceCents: 22500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Night Diver",
          description: "Three evening dives and the skills the dark demands.",
          priceCents: 29500,
          eLearningPriceCents: 14500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Deep Diver",
          description: "Four dives that extend your range to 40 meters.",
          priceCents: 42500,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Wreck Diver",
          description: "Survey, mapping, and limited penetration on four dives.",
          priceCents: 44500,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Divemaster",
          description: "The first professional rating, taught as an internship.",
          priceCents: 125000,
          eLearningPriceCents: 32500,
          minimumCertificationLevel: "rescue" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Try Scuba",
          description: "A supervised first scuba experience.",
          priceCents: 15000,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "ssi",
          title: "SSI Open Water Diver",
          description: "SSI's entry-level autonomous diver certification.",
          priceCents: 47500,
          eLearningPriceCents: 19500,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "ssi",
          title: "Advanced Adventurer",
          description: "Five guided specialty adventure dives.",
          priceCents: 39900,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Diver Stress & Rescue",
          description: "Recognize stress and respond to diver emergencies.",
          priceCents: 49900,
          eLearningPriceCents: 22500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Enriched Air Nitrox 40",
          description: "Use nitrox mixes up to 40 percent oxygen.",
          priceCents: 18500,
          eLearningPriceCents: 14000,
          minimumCertificationLevel: "open_water" as const,
        },
        // The public page lives at /courses/<slug>; the catalog is the only place
        // slugs are minted, so the seed mints them the same way an import does.
      ].map((course) => ({ ...course, slug: courseSlug(course.title) })),
    )
    .returning();
  const discoverCourse = courseRows.find((course) => course.title === "Discover Scuba Diving");
  if (!discoverCourse) throw new Error("seed: DSD course missing");

  // The demo shop starts where a real shop does: every course pre-filled with
  // DiveDay's default page copy. That default content is the shop's starting
  // point — it edits from there. Open Water is the one a visitor is most
  // likely to open, so it is the most complete.
  for (const template of COURSE_TEMPLATES) {
    const course = courseRows.find((row) => row.title === template.title);
    if (!course) continue;
    await db.update(courses).set(template.content).where(eq(courses.id, course.id));
  }
  const openWaterCourse = courseRows.find((course) => course.title === "Open Water Diver");
  const courseIdByTitle = new Map(courseRows.map((course) => [course.title, course.id]));

  const [existingMolassesTemplate] = await db
    .select()
    .from(globalDiveSites)
    .where(eq(globalDiveSites.slug, "molasses-reef"))
    .limit(1);
  let molassesTemplate = existingMolassesTemplate;
  if (!molassesTemplate) {
    [molassesTemplate] = await db
      .insert(globalDiveSites)
      .values({ slug: "molasses-reef", currentVersion: 2 })
      .returning();
    if (!molassesTemplate) throw new Error("seed: common-site template missing");
    await db.insert(globalDiveSiteVersions).values([
      {
        globalDiveSiteId: molassesTemplate.id,
        version: 1,
        briefing: {
          name: "Molasses Reef",
          locationName: "Key Largo National Marine Sanctuary",
          forecastLatitude: 25.0117,
          forecastLongitude: -80.3764,
          description: "A bright outer-reef classic with a relaxed profile.",
          marineLife: "Parrotfish · angelfish · southern stingrays",
        },
      },
      {
        globalDiveSiteId: molassesTemplate.id,
        version: 2,
        briefing: {
          name: "Molasses Reef",
          locationName: "Key Largo National Marine Sanctuary",
          forecastLatitude: 25.0117,
          forecastLongitude: -80.3764,
          description:
            "A bright outer-reef classic with a relaxed profile and plenty of room to explore.",
          marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
          marineLifeDescription:
            "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels.",
          difficulty: "beginner",
          depthRange: "6–12 m",
          currentNote: "Usually gentle; the crew confirms the final plan.",
          divePlan:
            "Follow the coral ridge, pause at the sand channels, then drift back along the shallow garden.",
          landmarks: ["Molasses Reef Light", "Historic ship's winch", "Spanish anchor"],
          imageUrls: [
            commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
            commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
            commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
          ],
        },
      },
    ]);
  }

  const siteRows = await db
    .insert(diveSites)
    .values([
      {
        shopId,
        sourceTemplateId: molassesTemplate.id,
        sourceTemplateVersion: 1,
        name: "Molasses Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0117,
        forecastLongitude: -80.3764,
        description:
          "A bright outer-reef classic with a relaxed profile and plenty of room to explore.",
        marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
        marineLifeDescription:
          "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels.",
        difficulty: "beginner",
        depthRange: "6–12 m",
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Follow the coral ridge, pause at the sand channels, then drift back along the shallow garden.",
        landmarks: ["Molasses Reef Light", "Historic ship's winch", "Spanish anchor"],
        imageUrls: [
          commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
          commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
          commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
        ],
      },
      {
        shopId,
        name: "Spiegel Grove",
        locationName: "Key Largo, Florida",
        // The glossary's canonical gate: a deep wreck dived externally needs
        // AOW + Deep. (Wreck specialty is for penetration, not the whole site.)
        // Every trip that visits inherits at least this (readiness composes it).
        minimumCertificationLevel: "advanced_open_water" as const,
        requiredSpecialties: ["deep"] as DiveSpecialty[],
        forecastLatitude: 25.0789,
        forecastLongitude: -80.2186,
        description:
          "A deliberately sunk former Navy ship with dramatic structure and blue-water scale.",
        marineLife: "Goliath grouper · barracuda · jacks · soft coral",
        marineLifeDescription:
          "Expect big silhouettes, moving schools, and changing light along the exterior decks.",
        difficulty: "advanced",
        depthRange: "18–40 m",
        currentNote: "Open-water current can be strong; the crew confirms the line plan.",
        divePlan:
          "Descend together on the mooring line, tour the exterior flight deck and well deck, then return to the ascent line with reserve gas.",
        landmarks: ["Flight deck and cranes", "Well deck"],
        imageUrls: [
          commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
          commonsImage("AtlanticGoliathGrouper.jpg"),
        ],
      },
      {
        shopId,
        name: "Christ of the Abyss",
        locationName: "John Pennekamp Coral Reef State Park",
        forecastLatitude: 25.1292,
        forecastLongitude: -80.4011,
        description: "A shallow, iconic statue site that rewards an unhurried reef dive.",
        marineLife: "Sergeant majors · blue tangs · French angelfish · coral gardens",
        marineLifeDescription:
          "A gentle route with lots to notice near the reef and plenty of light for photos.",
        difficulty: "beginner",
        depthRange: "5–8 m",
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Arc from the mooring through the bright sand channels, pause at the statue, then return across the shallow coral garden.",
        landmarks: ["Christ of the Abyss", "Dry Rocks sand channels"],
        imageUrls: [
          commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
          commonsImage("Blue Tang Pickles 20080310.jpg"),
          commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
        ],
      },
      {
        shopId,
        name: "Benwood Wreck",
        locationName: "Key Largo, Florida",
        forecastLatitude: 25.0561,
        forecastLongitude: -80.3222,
        description: "A broken freighter lying in shallow sand — wreck scale without wreck depth.",
        marineLife: "Sergeant majors · glassy sweepers · moray eels · yellowtail snapper",
        marineLifeDescription:
          "The hull is a fish apartment block: look into every gap and something is home.",
        difficulty: "intermediate",
        depthRange: "8–15 m",
        currentNote: "Mild, but the site sits in open water — the crew calls the drop.",
        divePlan:
          "Swim the length of the hull from bow to stern along the sand, then return over the plates at 9 meters.",
        landmarks: ["Bow section", "Collapsed midships plates"],
        imageUrls: [
          commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
          commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
        ],
      },
      {
        shopId,
        name: "French Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0333,
        forecastLongitude: -80.3494,
        description: "Swim-throughs, ledges, and overhangs on a shallow spur-and-groove reef.",
        marineLife: "Nurse sharks · green morays · parrotfish · barracuda",
        marineLifeDescription:
          "The overhangs hide sleeping nurse sharks; check the ceilings, not just the sand.",
        difficulty: "beginner",
        depthRange: "6–14 m",
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Drop on the mooring, work the ledges and swim-throughs into the current, then drift back over the coral heads.",
        landmarks: ["Christmas Tree Cave", "Hourglass Cave", "White Sand Bottom Cave"],
        imageUrls: [
          commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
          commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
        ],
      },
    ])
    .returning();
  const siteByName = new Map(siteRows.map((site) => [site.name, site]));
  const molasses = siteByName.get("Molasses Reef");
  if (molasses) {
    await db.insert(diveSiteCreatures).values([
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Stoplight parrotfish",
        kind: "fish",
        imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
        description: "A bright reef grazer with a beak-like mouth.",
        preparationTip: "Move slowly near coral heads and let the colour find you.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Elkhorn coral",
        kind: "coral",
        imageUrl: commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
        description: "Branching coral that makes a remarkable shallow reef silhouette.",
        preparationTip: "Practice neutral buoyancy; never touch or brace on coral.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Southern stingray",
        kind: "ray",
        imageUrl: commonsImage("Dasyatis americana NOAA.jpg"),
        description: "Often seen gliding over the sand channels.",
        preparationTip: "Give rays space and watch from the side, not above.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Blue tang",
        kind: "fish",
        imageUrl: commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
        description: "Electric-blue reef fish that often travel in loose groups.",
        preparationTip: "Scan just above the reef for small groups moving together.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "French angelfish",
        kind: "fish",
        imageUrl: commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
        description: "A tall, dark fish edged with tiny flashes of yellow.",
        preparationTip: "Look beside tall sponges and coral faces where they feed.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Yellowtail snapper",
        kind: "schooling fish",
        imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
        description: "Silver schools marked by a bright yellow stripe and tail.",
        preparationTip: "Look into the blue beyond the reef instead of only looking down.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Goliath grouper",
        kind: "fish",
        imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
        description: "Enormous and unbothered; usually parked under a ledge.",
        preparationTip: "Give it room and never block its way out from under an overhang.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Nurse shark",
        kind: "shark",
        imageUrl: commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
        description: "A broad, mellow bottom-resting shark with rounded fins.",
        preparationTip: "Check quiet ledges without crowding or blocking an animal's path.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Reef grouper & grunt",
        kind: "reef fish",
        imageUrl: commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
        description: "Chunky grouper often share the reef with striped grunts.",
        preparationTip: "Pause beside coral overhangs and let hidden fish emerge.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Grooved brain coral",
        kind: "coral",
        imageUrl: commonsImage("Brain coral 2 Molasses Reef 20080309.jpg"),
        description: "Rounded coral patterned with maze-like ridges and valleys.",
        preparationTip: "Notice the pattern while keeping fins and hands safely clear.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Finger sponge",
        kind: "sponge",
        imageUrl: commonsImage("Sponge 06 Molasses Reef 20230714.jpg"),
        description: "Bright tubular sponges that add colour and height to the reef.",
        preparationTip: "Look between coral heads for shapes that do not sway like plants.",
      },
    ]);
    await db.insert(diveSiteMoments).values({
      shopId,
      diveSiteId: molasses.id,
      caption: "A quiet moment watching a ray disappear into blue water.",
      imageUrl: commonsImage("Dasyatis americana NOAA.jpg"),
      isPublished: true,
    });
  }

  // A site with an empty field guide reads as a site the shop does not know.
  // Both of the other seeded sites get one, written to their own character:
  // the wreck is about scale and silhouettes, the statue about a slow shallow
  // reef you can spend an hour on.
  const spiegel = siteByName.get("Spiegel Grove");
  const christ = siteByName.get("Christ of the Abyss");
  const benwood = siteByName.get("Benwood Wreck");
  const french = siteByName.get("French Reef");
  const laterCreatures = [
    ...(benwood
      ? [
          {
            diveSiteId: benwood.id,
            name: "Glassy sweeper",
            kind: "schooling fish",
            imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
            description: "Copper-colored clouds that fill the shaded spaces inside the hull.",
            preparationTip: "Stay outside the plates and let the school reform around you.",
          },
          {
            diveSiteId: benwood.id,
            name: "Reef grouper",
            kind: "fish",
            imageUrl: commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
            description: "Holds a favorite gap in the wreckage and watches you go past.",
            preparationTip: "Approach slowly and from the side; a crowded fish just leaves.",
          },
        ]
      : []),
    ...(french
      ? [
          {
            diveSiteId: french.id,
            name: "Nurse shark",
            kind: "shark",
            imageUrl: commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
            description: "Often asleep under the ledges, which is where divers miss them.",
            preparationTip: "Look up into the overhangs, and never block the way out of one.",
          },
          {
            diveSiteId: french.id,
            name: "Stoplight parrotfish",
            kind: "fish",
            imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
            description: "You will hear them grazing the coral before you find them.",
            preparationTip: "Hold still near a coral head and follow the crunching sound.",
          },
        ]
      : []),
    ...(spiegel
      ? [
          {
            diveSiteId: spiegel.id,
            name: "Goliath grouper",
            kind: "fish",
            imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
            description: "A car-sized grouper that holds station in the ship's shadows.",
            preparationTip: "Keep your distance and your buoyancy; never corner one in a doorway.",
          },
          {
            diveSiteId: spiegel.id,
            name: "Yellowtail snapper",
            kind: "schooling fish",
            imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
            description: "Silver schools that hang above the deck, facing into the current.",
            preparationTip: "Look out into the blue, not only down at the hull.",
          },
          {
            diveSiteId: spiegel.id,
            name: "Remora",
            kind: "fish",
            imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
            description: "Riders that detach and circle when their host moves off.",
            preparationTip: "If one takes an interest in you, keep swimming — it loses interest.",
          },
        ]
      : []),
    ...(christ
      ? [
          {
            diveSiteId: christ.id,
            name: "Sergeant major",
            kind: "fish",
            imageUrl: commonsImage("Blue Tang Pickles 20080310.jpg"),
            description: "Small striped fish that guard purple egg patches on the statue's base.",
            preparationTip: "A guarding male will bump your mask; back off rather than push in.",
          },
          {
            diveSiteId: christ.id,
            name: "French angelfish",
            kind: "fish",
            imageUrl: commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
            description: "Usually in pairs, moving unhurried between coral heads.",
            preparationTip: "Stay still for a moment and the pair will often come to you.",
          },
          {
            diveSiteId: christ.id,
            name: "Elkhorn coral",
            kind: "coral",
            imageUrl: commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
            description: "Shallow branching coral that catches the light on the way back.",
            preparationTip: "This is the shallowest part of the dive — watch your fins above it.",
          },
        ]
      : []),
  ];
  if (laterCreatures.length > 0) {
    await db.insert(diveSiteCreatures).values(laterCreatures.map((row) => ({ shopId, ...row })));
  }
  const laterMoments = [
    spiegel
      ? {
          diveSiteId: spiegel.id,
          caption: "The moment the flight deck resolves out of the blue on the way down.",
          imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
          isPublished: true,
        }
      : null,
    christ
      ? {
          diveSiteId: christ.id,
          caption: "Eight meters down, hands up, sunlight all the way to the sand.",
          imageUrl: commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
          isPublished: true,
        }
      : null,
  ].filter((row) => row !== null);
  if (laterMoments.length > 0) {
    await db.insert(diveSiteMoments).values(laterMoments.map((row) => ({ shopId, ...row })));
  }

  /**
   * A dated session for a catalog course, or nothing at all when this shop does
   * not carry that title. Spread into the trips list so a missing course drops
   * its session quietly instead of throwing the whole seed.
   */
  function courseSession(
    courseTitle: string,
    trip: {
      title: string;
      description: string;
      startsAt: Date;
      endsAt: Date;
      capacity: number;
      plannedDives?: number;
    },
  ) {
    const courseId = courseIdByTitle.get(courseTitle);
    return courseId ? [{ shopId, courseId, ...trip }] : [];
  }

  const todaySailStart = demoTodayDepartureStart();
  const tripRows = await db
    .insert(trips)
    .values([
      {
        shopId,
        diveSiteId: siteByName.get("Molasses Reef")?.id,
        title: "Two-Tank Reef — Molasses & French",
        description: "Morning double dip on the outer reef. All levels, OW required.",
        startsAt: todaySailStart, // sails today, so Today always has a board
        endsAt: new Date(todaySailStart.getTime() + 3.5 * 60 * 60 * 1000),
        capacity: 12,
      },
      {
        shopId,
        title: "Night Dive — City of Washington",
        description: "Torches, tarpon, and bioluminescence. Night specialty required.",
        startsAt: at(2, 22, 0), // ~6:00 PM Eastern
        endsAt: at(3, 0, 30),
        capacity: 8,
      },
      {
        shopId,
        diveSiteId: siteByName.get("Spiegel Grove")?.id,
        title: "Wreck Trip — Spiegel Grove",
        description: "The big one. AOW + Deep + nitrox required.",
        startsAt: at(5, 12, 0),
        endsAt: at(5, 16, 0),
        capacity: 10,
      },
      {
        shopId,
        diveSiteId: siteByName.get("Christ of the Abyss")?.id,
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
      // The course page is only half a demo without a date to book: this is the
      // session its "See dates" button lands on.
      ...(openWaterCourse
        ? [
            {
              shopId,
              courseId: openWaterCourse.id,
              title: "Open Water Diver — three-day course",
              description: "Certification course over three days. No experience required.",
              startsAt: at(9, 12, 0),
              endsAt: at(11, 21, 0),
              // 5 students to one instructor: a realistic class, and it keeps
              // this session's "N spots left" distinct from every other seeded
              // trip's, which e2e assertions match on by text.
              capacity: 5,
            },
          ]
        : []),
      // A working board is not four boats: these fill out the fortnight so the
      // schedule, the dive-site pages, and the course catalog all have
      // something behind them. Every one leaves a different number of spots —
      // "N spots left" is the string e2e matches trips by, and two trips
      // showing the same count make that assertion ambiguous.
      {
        shopId,
        diveSiteId: benwood?.id,
        title: "Two-Tank Reef — Benwood & Elbow",
        description: "Shallow wreck first, coral heads second. A good day-two boat.",
        startsAt: at(3, 11, 30),
        endsAt: at(3, 15, 0),
        capacity: 12,
      },
      {
        shopId,
        diveSiteId: french?.id,
        title: "Afternoon Two-Tank — French Reef",
        description: "Swim-throughs and ledges, with the light coming in low on the second tank.",
        startsAt: at(6, 17, 0),
        endsAt: at(6, 21, 0),
        capacity: 10,
      },
      ...courseSession("Enriched Air (Nitrox) Diver", {
        title: "Enriched Air (Nitrox) — classroom & two dives",
        description: "Analyze your own cylinder, then use the procedures on two reef dives.",
        startsAt: at(8, 12, 0),
        endsAt: at(8, 20, 0),
        capacity: 6,
      }),
      ...courseSession("Peak Performance Buoyancy", {
        title: "Peak Performance Buoyancy — one day",
        description: "A real weight check, then two dives spent hovering.",
        startsAt: at(13, 12, 0),
        endsAt: at(13, 19, 0),
        capacity: 4,
      }),
      ...courseSession("Night Diver", {
        title: "Night Diver — three evenings",
        description: "Dusk, dark, and navigation, over three consecutive evenings.",
        startsAt: at(15, 21, 0),
        endsAt: at(18, 1, 30),
        capacity: 6,
        plannedDives: 3,
      }),
      ...courseSession("Deep Diver", {
        title: "Deep Diver — Spiegel Grove & the wall",
        description: "Four dives building to 40 meters, with gas planning that keeps up.",
        startsAt: at(20, 12, 0),
        endsAt: at(21, 20, 0),
        capacity: 6,
        plannedDives: 4,
      }),
    ])
    .returning();

  /**
   * What each tank actually is. "Dive 1 · Dive 2" tells a diver nothing they
   * could not have guessed; these are the words the crew uses at the briefing,
   * which is what makes a trip page worth opening the night before.
   *
   * A trip with no entry here still gets its dives — just unnamed, the way a
   * charter looks before anyone has written the plan.
   */
  const divePlans: Record<string, Array<{ title: string; site?: string; description: string }>> = {
    "Two-Tank Reef — Molasses & French": [
      {
        title: "Molasses Reef",
        site: "Molasses Reef",
        description: "A relaxed sweep along the outer reef. Look for rays in the sand channels.",
      },
      {
        title: "French Reef",
        site: "French Reef",
        description:
          "French Reef is the second tank; the crew confirms the exact mooring at the dock.",
      },
    ],
    "Two-Tank Reef — Benwood & Elbow": [
      {
        title: "Benwood Wreck",
        site: "Benwood Wreck",
        description: "Bow to stern along the sand, then back over the plates. Watch the ceilings.",
      },
      {
        title: "Elbow Reef",
        description:
          "Shallow coral heads and a wreck-strewn bottom; a long, easy second tank on a full tank of air.",
      },
    ],
    "Afternoon Two-Tank — French Reef": [
      {
        title: "French Reef swim-throughs",
        site: "French Reef",
        description: "Christmas Tree Cave and the ledges, into the current and drifting back.",
      },
      {
        title: "White Sand Bottom Cave",
        site: "French Reef",
        description: "The low sun gets into the overhangs — the best light of the day is here.",
      },
    ],
    "Wreck Trip — Spiegel Grove": [
      {
        title: "Flight deck and cranes",
        site: "Spiegel Grove",
        description:
          "Down the mooring together, a tour of the exterior, and back to the line with reserve gas.",
      },
      {
        title: "Well deck",
        site: "Spiegel Grove",
        description: "Shallower and slower after the surface interval, staying outside the hull.",
      },
    ],
    "Two-Tank Reef — Christ of the Abyss": [
      {
        title: "Christ of the Abyss",
        site: "Christ of the Abyss",
        description: "The statue first, before the other boats arrive, then the sand channels.",
      },
      {
        title: "Dry Rocks coral garden",
        site: "Christ of the Abyss",
        description: "A shallow, unhurried loop — the tank most refresher divers remember.",
      },
    ],
    "Night Dive — City of Washington": [
      {
        title: "Wreck site at dusk",
        description: "In the water before the light goes, so the descent is on a familiar bottom.",
      },
      {
        title: "Full dark",
        description: "Torches off for a minute at the safety stop, for the bioluminescence.",
      },
    ],
  };

  const tripDiveRows = tripRows.flatMap((trip) => {
    const plan = divePlans[trip.title] ?? [];
    return Array.from({ length: trip.plannedDives }, (_, index) => {
      const dive = plan[index];
      return {
        tripId: trip.id,
        diveNumber: index + 1,
        title: dive?.title ?? null,
        diveSiteId: dive?.site
          ? (siteByName.get(dive.site)?.id ?? null)
          : index === 0
            ? (trip.diveSiteId ?? null)
            : null,
        description: dive?.description ?? null,
      };
    });
  });
  if (tripDiveRows.length > 0) await db.insert(tripDives).values(tripDiveRows);

  await db.insert(tripRequirements).values(
    tripRows.map((trip) => {
      // The night dive has no site of its own, so its Night gate is trip-level;
      // night diving needs the Night specialty, not a higher level. The wreck
      // trip inherits AOW + Deep from the Spiegel Grove site and adds a
      // trip-level nitrox requirement (deep wreck bottom time).
      const isNight = trip.title.startsWith("Night Dive");
      const isWreck = trip.title.startsWith("Wreck Trip");
      // Same rule createTrip applies: a course session inherits its catalog
      // baseline verbatim, null included — an entry-level class is the one
      // place an uncertified diver belongs on a boat. Everything else takes the
      // shop's default Open Water gate.
      const course = trip.courseId
        ? courseRows.find((entry) => entry.id === trip.courseId)
        : undefined;
      return {
        tripId: trip.id,
        shopId,
        requiresWaiver: true,
        minimumCertificationLevel: course
          ? course.minimumCertificationLevel
          : ("open_water" as const),
        requiredSpecialties: (isNight ? ["night"] : []) as DiveSpecialty[],
        requiresNitrox: isWreck,
        // The premium wreck charter is paid up front; the reef trips are not.
        requiresPayment: isWreck,
      };
    }),
  );

  const discoverSession = tripRows.find((trip) => trip.courseId === discoverCourse.id);
  if (!discoverSession) throw new Error("seed: DSD session missing");
  // Every course session needs an instructor before it can take a booking. The
  // charters get a captain and a divemaster, because a boat with an empty crew
  // list is the one thing no dive shop has ever had.
  const crewByRole = new Map(
    (
      await db
        .select({ id: people.id, role: personRoles.role })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(eq(people.shopId, shopId))
    ).map((row) => [row.role, row.id]),
  );
  const captainId = crewByRole.get("captain");
  const divemasterId = crewByRole.get("divemaster");
  await db.insert(tripAssignments).values(
    tripRows.flatMap((trip) => {
      if (trip.courseId) return [{ tripId: trip.id, personId: instructor.id }];
      return [
        ...(captainId ? [{ tripId: trip.id, personId: captainId }] : []),
        ...(divemasterId ? [{ tripId: trip.id, personId: divemasterId }] : []),
      ];
    }),
  );

  // Conditions are a live reading, not a description: the boat that sails today
  // has this morning's numbers, the next two have yesterday's, and everything
  // further out is honestly blank because nobody has looked yet.
  const conditions: Array<[number, Record<string, unknown>]> = [
    [
      0,
      {
        conditionsSummary:
          "A calm morning is expected; the crew will confirm the final call at the dock.",
        waterTemperatureC: 27,
        visibilityMeters: 18,
        surfaceConditions: "Light east breeze · gentle chop",
      },
    ],
    [
      1,
      {
        conditionsSummary:
          "Warm and still after dark. Bring a light layer for the surface interval.",
        waterTemperatureC: 28,
        visibilityMeters: 15,
        surfaceConditions: "Glassy · no swell forecast",
      },
    ],
    [
      2,
      {
        conditionsSummary:
          "Open water, so the call is made at the dock. Expect current on the line.",
        waterTemperatureC: 26,
        visibilityMeters: 24,
        surfaceConditions: "Moderate southeast wind · 1 m swell",
      },
    ],
  ];
  for (const [index, values] of conditions) {
    const trip = tripRows[index];
    if (!trip) continue;
    await db
      .update(trips)
      .set({ ...values, conditionsUpdatedAt: nowDate() })
      .where(eq(trips.id, trip.id));
  }

  // Booking spread: busy reef trip, quiet night dive, sold-out wreck, fresh listing.
  const [reef, night, wreck] = tripRows;
  if (!reef || !night || !wreck) throw new Error("seed: failed to insert demo trips");

  /**
   * Later sailings carry their own regulars — divers 10 and up, never the ten
   * who crew today's boat. Today's roster and its readiness counts are asserted
   * exactly; a name added to it changes what the departure board says.
   *
   * The remaining-seat counts these produce are load-bearing too. "N spots
   * left" is how e2e picks a trip out of the schedule, so no seeded trip may
   * leave six seats (a spec creates its own six-seat boat), only the reef trip
   * may leave three, and only the wreck charter may read Full.
   */
  const laterRosters: Array<[string, number[]]> = [
    ["Two-Tank Reef — Benwood & Elbow", [10, 11, 12]],
    ["Afternoon Two-Tank — French Reef", [13, 14, 15]],
    ["Enriched Air (Nitrox) — classroom & two dives", [16, 17]],
    ["Night Diver — three evenings", [13]],
    ["Deep Diver — Spiegel Grove & the wall", [17]],
  ];
  const bookingRows = [
    ...customers.slice(0, 9).map((c) => ({ tripId: reef.id, personId: c.id })),
    ...customers.slice(4, 7).map((c) => ({ tripId: night.id, personId: c.id })),
    ...customers.slice(0, 10).map((c) => ({ tripId: wreck.id, personId: c.id })),
    ...laterRosters.flatMap(([title, indexes]) => {
      const trip = tripRows.find((row) => row.title === title);
      if (!trip) return [];
      return indexes
        .map((index) => customers[index])
        .filter((person) => person !== undefined)
        .map((person) => ({ tripId: trip.id, personId: person.id }));
    }),
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

  // Payment demo on the pay-to-board wreck trip: one paid, one deposit, the
  // rest unpaid (an absent row reads as unpaid in readiness).
  const wreckBookings = bookingRows_.filter((b) => b.tripId === wreck.id);
  const paidBooking = wreckBookings.find((b) => b.personId === customers[1]?.id);
  const depositBooking = wreckBookings.find((b) => b.personId === customers[0]?.id);
  const paymentSeed = [
    paidBooking
      ? { bookingId: paidBooking.id, status: "paid" as const, amountCents: 18_000 }
      : null,
    depositBooking
      ? { bookingId: depositBooking.id, status: "deposit_paid" as const, amountCents: 6_000 }
      : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);
  if (paymentSeed.length > 0) {
    await db
      .insert(bookingPayments)
      .values(paymentSeed.map((row) => ({ shopId, currency: "usd", ...row })));
  }

  await seedNitrox(db, shopId, customers, wreck, bookingRows_);
  await seedRentalFit(db, shopId, customers);
  await seedFrontDesk(db, shopId, customers, tripRows, bookingRows_);
}

/**
 * The paperwork side of a working week: divers waiting on a sold-out charter,
 * rental sizes already asked for on the boats that have not sailed yet, a
 * couple of invoices out, and the confirmation emails that went with them —
 * including one that bounced, because they do.
 *
 * Nothing here touches today's boat. Its roster, its readiness counts, and the
 * blocker copy on the departure board are asserted exactly, and they describe a
 * morning where the work has not been done yet — which is the point of showing
 * it.
 */
async function seedFrontDesk(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
  tripRows: { id: string; title: string }[],
  bookingRows: { id: string; tripId: string; personId: string }[],
): Promise<void> {
  const tripByTitle = new Map(tripRows.map((trip) => [trip.title, trip.id]));
  const wreckId = tripByTitle.get("Wreck Trip — Spiegel Grove");

  // The sold-out charter is where a wait-list earns its keep.
  if (wreckId) {
    const waiting = [10, 11, 12].map((index) => customers[index]).filter((c) => c !== undefined);
    if (waiting.length > 0) {
      await db
        .insert(tripWaitlistEntries)
        .values(waiting.map((person) => ({ shopId, tripId: wreckId, personId: person.id })));
    }
  }

  // Orders are deliberately absent. An order belongs to a Stripe account the
  // shop connected itself, and fabricating one here would show the settings
  // page a connected integration whose "Refresh status" button then calls the
  // real Stripe API and fails. The payment states that gate boarding are
  // seeded on the wreck charter instead, where they are real.

  // The confirmations that went out. Only successes: a seeded bounce would put
  // a permanent red row on the dashboard that no amount of retrying clears,
  // since there is no provider behind it to succeed on the second attempt.
  const notified = bookingRows.filter((booking) => booking.tripId === wreckId).slice(0, 4);
  const deliveries = notified.map((booking, index) => ({
    shopId,
    bookingId: booking.id,
    kind: "booking_confirmation" as const,
    status: "sent" as const,
    providerMessageId: `demo-msg-${index}`,
    attemptedAt: new Date(nowMs() - (index + 1) * 60 * 60 * 1000),
  }));
  if (deliveries.length > 0) {
    await db.insert(notificationDeliveries).values(deliveries);
    await db
      .insert(notificationDeliveryAttempts)
      .values(deliveries.map((delivery) => ({ ...delivery, isRetry: false })));
  }
}

/**
 * The fit book the front desk already keeps: sizes for the divers who have
 * been in before, so tomorrow's prep list is mostly filled in before anyone
 * asks. Deliberately partial — a real fit book always is, and the gaps are
 * what the departure board is complaining about.
 */
async function seedRentalFit(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
): Promise<void> {
  const fits: Array<
    [
      number,
      {
        bcd: string | null;
        wetsuit: string | null;
        boot: string;
        fin: string;
        weights?: string;
        ownsRegulator?: boolean;
      },
    ]
  > = [
    [0, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "6 kg" }],
    [1, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "8 kg" }],
    // A diver with their own reg — the prep list has to leave it off.
    [3, { bcd: "L", wetsuit: "M", boot: "10", fin: "M", ownsRegulator: true }],
    [4, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    [7, { bcd: "XL", wetsuit: "XL", boot: "12", fin: "L", weights: "10 kg" }],
    // Sizes half-recorded, which is how a fit book actually looks.
    [12, { bcd: null, wetsuit: "M", boot: "7", fin: "M" }],
  ];
  const profiles = fits
    .map(([index, fit]) => {
      const person = customers[index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        rentsBcd: true,
        rentsRegulator: !fit.ownsRegulator,
        rentsWetsuit: true,
        rentsMaskFins: true,
        rentsWeights: true,
        bcdSize: fit.bcd,
        wetsuitSize: fit.wetsuit,
        bootSize: fit.boot,
        finSize: fit.fin,
        weightPreference: fit.weights ?? null,
      };
    })
    .filter((row) => row !== null);
  if (profiles.length > 0) await db.insert(rentalFitProfiles).values(profiles);
}

/**
 * Nitrox demo: a couple of verified EANx cards (and one pending), plus an
 * enriched-air request on the wreck charter — so the prep list shows a real
 * mix split and a real card gate the moment a fresh checkout boots.
 */
async function seedNitrox(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
  wreck: { id: string },
  bookingRows: { id: string; tripId: string; personId: string }[],
): Promise<void> {
  // Two verified EANx cards, one still pending review.
  await db.insert(nitroxCertifications).values([
    {
      shopId,
      personId: customers[0].id,
      agency: "padi" as const,
      identifier: "EANX-0001",
      status: "verified" as const,
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: customers[1].id,
      agency: "ssi" as const,
      identifier: "EANX-0002",
      status: "verified" as const,
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: customers[2].id,
      agency: "padi" as const,
      identifier: "EANX-0003",
      status: "pending" as const,
    },
  ]);

  // An enriched-air request from a diver whose card is verified, on the
  // nitrox-required wreck charter.
  const wreckBookingForCert = bookingRows.find(
    (b) => b.tripId === wreck.id && b.personId === customers[0].id,
  );
  if (wreckBookingForCert) {
    await db
      .update(bookings)
      .set({ wantsNitrox: true })
      .where(eq(bookings.id, wreckBookingForCert.id));
  }
}

/**
 * Restore the demo playground to its seeded state. Wipes everything a visitor
 * can touch — trips and their sessions, bookings and everything hanging off
 * them (waivers, roll call), the course catalog, cards, rental fit,
 * and every non-staff person (seeded customers plus any walk-ups the booking
 * flow created) — then re-seeds the schedule. The shop, its default waiver
 * template, staff, and their logins are deliberately left in place so the demo
 * session stays valid (docs ADR 20260718-demo-mode).
 *
 * Deletes run children-first so foreign keys never block a reset, however far
 * a visitor drove the tool (signed a waiver, saved a fit, ran roll call).
 */
export async function resetDemoSchedule(db: DbExecutor, shopId: string): Promise<void> {
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);

  // Booking- and trip-dependent operational history first. Delete order is a
  // topological sort of the foreign-key graph: every table that references
  // bookings, trips, or people must be cleared before those parents. A missing
  // child here surfaces as an FK-violation mid-run — e.g. a waitlist entry or
  // order left behind blocks the trips/bookings delete and dirties the next
  // test's fixture (regression tests live in seed.test.ts).
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
  await db.delete(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId));
  await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shopId));
  await db.delete(bookingPayments).where(eq(bookingPayments.shopId, shopId));
  await db
    .delete(notificationDeliveryAttempts)
    .where(eq(notificationDeliveryAttempts.shopId, shopId));
  await db.delete(notificationDeliveries).where(eq(notificationDeliveries.shopId, shopId));
  // Orders (and their line items) reference bookings and people; the waitlist
  // references trips and people. Both must go before the parents below.
  await db.delete(orderLineItems).where(eq(orderLineItems.shopId, shopId));
  await db.delete(orders).where(eq(orders.shopId, shopId));
  await db.delete(tripWaitlistEntries).where(eq(tripWaitlistEntries.shopId, shopId));
  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  await db.delete(tripRequirements).where(eq(tripRequirements.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
    await db.delete(tripDives).where(inArray(tripDives.tripId, tripIds));
  }
  await db.delete(trips).where(eq(trips.shopId, shopId));
  await db.delete(diveSiteMoments).where(eq(diveSiteMoments.shopId, shopId));
  await db.delete(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId));
  await db.delete(diveSites).where(eq(diveSites.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  await db.delete(certifications).where(eq(certifications.shopId, shopId));
  await db.delete(specialtyCertifications).where(eq(specialtyCertifications.shopId, shopId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.shopId, shopId));

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
