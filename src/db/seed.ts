import { hash } from "bcryptjs";
import { and, eq, inArray, or } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { generateDemoShopIdentity } from "@/lib/demo-identity";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";
import type { DbExecutor } from "./client";
import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  accountTokens,
  activityEvents,
  boats,
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  buddyPairMembers,
  buddyTeamEvents,
  calendarFeeds,
  certifications,
  courseInquiries,
  courses,
  dayCloseouts,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  gearItems,
  gearReservations,
  gearServiceEvents,
  importedPaymentHistory,
  internalNotes,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  marineLifeRequests,
  nitroxCertifications,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  orderLineItems,
  orders,
  paymentOperationIntents,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  priorVisits,
  processorErasureObligations,
  recapPhotos,
  rentalFitProfiles,
  reviewModerationEvents,
  rollCallCrewEvents,
  rollCallEvents,
  shopPromoCodes,
  shopPromoRedemptions,
  shopStripeAccounts,
  shops,
  specialtyCertifications,
  staffShifts,
  tips,
  tripAssignments,
  tripBlowoutDivers,
  tripBlowouts,
  tripDives,
  tripInvitations,
  tripLastMinutePromoRecipients,
  tripLastMinutePromos,
  tripRecapPhotos,
  tripRequirements,
  tripReviews,
  tripSeries,
  tripSeriesSkips,
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverDeliveries,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { seedBackup } from "./seed-backup";
import { seedBookings } from "./seed-bookings";
import { seedBuddyPairs } from "./seed-buddy-pairs";
import { LEAD_INSTRUCTOR_NAME, RELIEF_INSTRUCTOR_NAME, staffDefs } from "./seed-cast";
import { seedCatalog } from "./seed-catalog";
import { seedCertGates } from "./seed-cert-gates";
import { DEMO_SHOP_TIMEZONE, demoTodayDepartureStart } from "./seed-clock";
import { seedCounterBlockers } from "./seed-counter-blockers";
import { seedCourseInquiries } from "./seed-course-inquiries";
import { seedDateRequests } from "./seed-date-requests";
import { enforceMintedDemoCap } from "./seed-demo-lifecycle";
import { seedDeskTrail } from "./seed-desk-trail";
import { seedDiveSiteCatalog } from "./seed-dive-site-catalog";
import { seedDiveSites } from "./seed-dive-sites";
import { seedDiverTrail } from "./seed-diver-trail";
import { seedDivers } from "./seed-divers";
import { seedFrontDesk } from "./seed-front-desk";
import { seedGear } from "./seed-gear";
import { seedHistory } from "./seed-history";
import { seedMedicalReview } from "./seed-medical-review";
import { seedMinimumSeats } from "./seed-minimum-seats";
import { seedMoreTrips } from "./seed-more-trips";
import { seedNitrox } from "./seed-nitrox";
import { seedOpenInvoice } from "./seed-open-invoice";
import { seedOrders } from "./seed-orders";
import { seedPromos } from "./seed-promos";
import { seedRecentRecaps } from "./seed-recent-recaps";
import { seedRentalFit } from "./seed-rental-fit";
import { seedSelfDeclaredJoiners } from "./seed-self-declared";
import { seedTripLegs } from "./seed-trip-legs";
import { seedTrips } from "./seed-trips";
import { seedWaiverEvidence } from "./seed-waiver-evidence";
import { seedWaiverVersions } from "./seed-waiver-versions";

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * The seeded Blue Mantis shop backs the customer-facing demo experience in
 * every environment (docs ADR 20260718-production-demo-seed).
 *
 * **This file is the orchestrator, and the order it calls in is the data.**
 * Each scenario below writes one part of the shop's story, and several read
 * rows an earlier one inserted (the roster indexes into `customerDefs`, the
 * trips index into the sites, the payments index into the bookings). Reordering
 * these calls, or moving work between them, changes what the demo shop
 * contains — and the e2e fleet's visual baselines are pixel-keyed to it. Add a
 * scenario as a new `seed-*.ts` module called from here, never by wedging rows
 * into an existing one (ADR 20260803-seed-scenario-modules).
 *
 * | Module | The shop story it seeds |
 * | --- | --- |
 * | `./seed-clock.ts` | every date in the demo, anchored to the frozen clock |
 * | `./seed-cast.ts` | the divers on file, in the order the rosters index into |
 * | `./seed-waiver-versions.ts` | the release's own version history — two superseded wordings behind the current one |
 * | `./seed-more-trips.ts` | the rest of the month's board beyond today's three headline boats |
 * | `./seed-nitrox.ts` | EANx cards and the per-dive gas the wreck charter gates on |
 * | `./seed-rental-fit.ts` | divers' saved sizes, so the gear locker has something to pull |
 * | `./seed-gear.ts` | the rental fleet on the wall — tagged units, service clocks, a few reserved for the wreck trip |
 * | `./seed-course-inquiries.ts` | course leads off the public pages, in all three `person_id` states |
 * | `./seed-front-desk.ts` | the desk's own day: walk-ins, wait lists, inquiries, tips |
 * | `./seed-history.ts` | the trailing quarter that gives owner reporting something to report |
 * | `./seed-cert-gates.ts` | the boats a card can be refused on, one gate each, and the course carve-out |
 * | `./seed-buddy-pairs.ts` | two buddy teams on today's reef boat, plus the odd-roster remainder |
 * | `./seed-demo-lifecycle.ts` | minting, reaping, and capping throwaway demo shops |
 * | `./seed-backup.ts` | the shop-owned backup destination and its weekly delivery history |
 * | `./seed-orders.ts` | the billing states past "paid": open, part-paid, refunded, void, written off |
 * | `./seed-desk-trail.ts` | the notes and activity behind today's reef boat, so its Guests tab has a history |
 * | `./seed-diver-trail.ts` | the same table read the other way round — what the desk has done about eight of the cast, so a diver's record opens on a history rather than an empty Activity panel |
 * | `./seed-dive-site-catalog.ts` | DiveDay's published dive-site templates — shared by every shop, never this one's |
 * | `./seed-self-declared.ts` | the two list joiners who said what they can dive, so the marks a staffer reads before a blast are ever rendered |
 * | `./seed-trip-legs.ts` | how far the boat really runs on the three departures where it is not the shop's usual twenty minutes |
 * | `./seed-waiver-evidence.ts` | when releases were really signed, and which of them carry an integrity seal |
 *
 * There is no `seed-reviews.ts`, though this table claimed one until 2026-08-15:
 * verified diver reviews and the post-trip tips the recap collects are written by
 * `./seed-history.ts` (`reviewRows` and `tipRows`, at the end of the file), because
 * both hang off a booking on a departure that has already sailed. A row here
 * naming a file that does not exist is worse than no row — it sent a session
 * looking for the demo's missing tips in a module nobody ever wrote.
 *
 * `./seed-recent-recaps.ts` is deliberately **not** in this table and is not
 * called from the orchestrator below. It is a keeper, run by the daily
 * demo-refresh pass (`src/db/demo-refresh.ts`), for the tips and reviews that go
 * missing as the demo ages past the instant this seed ran — read its docstring
 * before assuming it belongs here.
 *
 * The public surface is unchanged: `@/db/seed` still exports everything it
 * always did, including the lifecycle helpers re-exported at the bottom.
 */

/** The canonical demo's addresses — `dev-credentials.ts` holds the sign-ins. */
const canonicalStaffEmail = (local: string) => `${local}@demo.invalid`;

/**
 * The one 12-hour shift every member of the demo cast works today, so the
 * rostering surface (`/shop/<slug>/staffing`) has a day to show.
 *
 * Shared by all three places staff arrive in a demo shop — the canonical seed,
 * a shop minted by "Try the live demo", and `restoreMissingStableStaff`'s
 * repair — because a shop that has a cast and no shifts renders an empty
 * roster, which is what a minted demo did until 2026-08-15. Part of the
 * **stable** half: a schedule reset never re-seeds these, so a person who
 * already has one keeps it.
 */
async function seedStaffShifts(db: DbExecutor, shopId: string, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return;
  const startsAt = new Date(demoTodayDepartureStart().getTime() - 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 12 * 60 * 60 * 1000);
  await db.insert(staffShifts).values(
    personIds.map((personId) => ({
      shopId,
      personId,
      startsAt,
      endsAt,
      note: "Demo schedule",
      createdByPersonId: personId,
    })),
  );
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
export async function seedDemo(db: DbExecutor, opts: { history?: boolean } = {}): Promise<void> {
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Blue Mantis Divers",
      slug: DEMO_SHOP_SLUG,
      timezone: DEMO_SHOP_TIMEZONE,
      // A front-desk address, not a person's — this is printed on the public
      // course pages, where it backs the "Get in touch" composer.
      contactEmail: "hello@demo.invalid",
      contactPhone: "+1 305 555 0142",
      // A real street exercises the address end to end (structured data,
      // settings form) without publishing anything a search engine could act
      // on for a demo fixture.
      addressStreet: "100 Ocean Drive",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
      latitude: 25.0865,
      longitude: -80.4473,
      // Rents the core kit plus both add-ons and fills nitrox, and prices them:
      // a full set is cheaper than the pieces, each piece has its own price, and
      // nitrox is a per-dive surcharge. Divers see these when they set their
      // rental fit. Most real shops leave nitrox unticked (default off) — the
      // demo shop opts in so the flow has something to demonstrate.
      rentalItems: [
        "bcd",
        "regulator",
        "wetsuit",
        "mask_fins",
        "weights",
        "dive_computer",
        "gopro",
        "nitrox",
      ],
      rentalPricing: {
        setCents: 4500,
        perItemCents: {
          bcd: 1500,
          regulator: 1500,
          wetsuit: 1200,
          mask_fins: 800,
          weights: 500,
          dive_computer: 1000,
          gopro: 2000,
        },
        nitroxCents: 1200,
      },
      isDemo: true,
      hasShoreDiving: true,
      hasPoolDiving: true,
    })
    .returning();
  if (!shop) throw new Error("seed: failed to insert demo shop");

  await db.insert(boats).values([
    { shopId: shop.id, name: "Mantis I", capacity: 12 },
    { shopId: shop.id, name: "Mantis II", capacity: 20 },
  ]);

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: "Blue Mantis Diving Release",
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId: shop.id,
        fullName: s.fullName,
        email: canonicalStaffEmail(s.local),
        emergencyContactName: s.emergencyContact?.[0] ?? null,
        emergencyContactPhone: s.emergencyContact?.[1] ?? null,
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

  // Staff sign-in accounts use the demo bypass token rather than storing that
  // public password as a real credential. This keeps the bypass scoped to the
  // demo shop: if a test or operator turns isDemo off, "password" no longer
  // authenticates these accounts. Cost 4 keeps seeding fast in tests; real
  // account creation flows must use a production-grade cost.
  const logins = Object.values(DEV_STAFF_LOGINS);
  const accountRows = logins.map(async (login) => {
    const person = staff.find((p) => p.email === login.email);
    if (!person) throw new Error(`seed: no staff person for ${login.email}`);
    return {
      personId: person.id,
      email: login.email,
      hashedPassword: await hash(crypto.randomUUID(), 4),
    };
  });
  // Hoisted so the acknowledgement below fits on the line the check reads. The
  // fan-out is over bcrypt, not over queries: it awaits `hash()` for a handful
  // of logins and hands one array to one `.values()`.
  const accounts = await Promise.all(accountRows); // diveday:allow-db-concurrency: bcrypt, not queries
  await db.insert(userAccounts).values(accounts);

  await seedStaffShifts(
    db,
    shop.id,
    staff.map((person) => person.id),
  );

  await seedDemoSchedule(db, shop.id, opts);

  // Stable half, like staff and their shifts: a backup destination is a
  // settings row a demo visitor cannot break, so it lives outside the
  // resettable schedule (ADR 20260804-shop-owned-backup-export).
  await seedBackup(db, shop.id);
}

/**
 * Mint a brand-new, self-contained demo shop with a generated identity and the
 * full demo dataset, and return how to sign into it. This is what "Try the live
 * demo" creates now: each visitor gets their own disposable `isDemo` shop instead
 * of sharing the canonical blue-mantis fixture (ADR 20260724-per-visitor-demo-shops).
 *
 * The staff are the same friendly cast as the canonical demo (Dana/Marcus/Keiko/
 * Sal) so the demo banner and role switcher read identically, but their emails
 * are namespaced under the unique slug so they never collide on the global
 * `user_accounts.email` index. Sign-in for every role goes through the `isDemo`
 * bypass token (src/lib/credentials.ts), so no real password is minted or stored.
 *
 * Demo names carry no random suffix any more (src/lib/demo-identity.ts): the
 * visitor sees a slug and a sign-in address a real shop could have. That trades
 * an astronomically-unlikely collision for a merely-rare one, so
 * `insertDemoShop` below retries on the unique violation instead of assuming it
 * away.
 */

/** Postgres `unique_violation` — the only insert failure here that a retry fixes. */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    // node-postgres and PGlite both surface the SQLSTATE on `code`; the driver
    // wraps it, so check the cause too rather than only the outermost error.
    ((error as { code?: unknown }).code === PG_UNIQUE_VIOLATION ||
      isUniqueViolation((error as { cause?: unknown }).cause))
  );
}

/**
 * How many names to try before giving up. Each attempt draws from
 * {@link DEMO_NAME_COMBINATIONS} against a live population bounded by
 * `enforceMintedDemoCap`, so the chance of even one collision is small and of
 * five in a row is negligible — five is "something is actually wrong", not
 * "unlucky", and failing there beats spinning.
 */
const DEMO_IDENTITY_ATTEMPTS = 5;

/**
 * Insert the shop row under a freshly-minted identity, regenerating the *whole*
 * identity on a name collision — never patching the slug alone, since every
 * staff email is derived from it and would otherwise disagree with the shop.
 */
async function insertDemoShop(db: DbExecutor) {
  let lastError: unknown;
  for (let attempt = 0; attempt < DEMO_IDENTITY_ATTEMPTS; attempt += 1) {
    const identity = generateDemoShopIdentity();
    try {
      const [shop] = await db
        .insert(shops)
        .values({
          name: identity.name,
          slug: identity.slug,
          timezone: DEMO_SHOP_TIMEZONE,
          contactEmail: identity.emailFor("hello"),
          contactPhone: "+1 305 555 0142",
          rentalItems: [
            "bcd",
            "regulator",
            "wetsuit",
            "mask_fins",
            "weights",
            "dive_computer",
            "gopro",
            "nitrox",
          ],
          rentalPricing: {
            setCents: 4500,
            perItemCents: {
              bcd: 1500,
              regulator: 1500,
              wetsuit: 1200,
              mask_fins: 800,
              weights: 500,
              dive_computer: 1000,
              gopro: 2000,
            },
            nitroxCents: 1200,
          },
          isDemo: true,
          hasShoreDiving: true,
          hasPoolDiving: true,
        })
        .returning();
      if (!shop) throw new Error("createDemoShop: failed to insert shop");
      return { shop, identity };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw new Error(
    `createDemoShop: no free demo shop name after ${DEMO_IDENTITY_ATTEMPTS} attempts`,
    { cause: lastError },
  );
}

export async function createDemoShop(
  db: DbExecutor,
  opts: { history?: boolean } = {},
): Promise<{ slug: string; ownerEmail: string }> {
  // Aggregate storage cap (security review, finding 1): the per-IP rate limit
  // bounds one visitor's burst but not the fleet-wide total, so an IP-rotating
  // attacker could pile up minted shops between 7-day reaper passes. Before
  // minting, evict the oldest minted demos so the live count never exceeds the
  // ceiling — the canonical demo and real shops are never eligible (see below).
  await enforceMintedDemoCap(db);

  const { shop, identity } = await insertDemoShop(db);

  await db.insert(boats).values([
    { shopId: shop.id, name: "Mantis I", capacity: 12 },
    { shopId: shop.id, name: "Mantis II", capacity: 20 },
  ]);

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: DEFAULT_WAIVER_TITLE,
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId: shop.id,
        fullName: s.fullName,
        email: identity.emailFor(s.local),
        emergencyContactName: s.emergencyContact?.[0] ?? null,
        emergencyContactPhone: s.emergencyContact?.[1] ?? null,
      })),
    )
    .returning();

  await db
    .insert(personRoles)
    .values(
      staff.flatMap((person, i) =>
        staffDefs[i].roles.map((role) => ({ personId: person.id, role })),
      ),
    );

  // Placeholder hashes: every demo sign-in uses the isDemo bypass token, so these
  // accounts never need a password that matches.
  const accountRows = staff.map(async (person, i) => ({
    personId: person.id,
    email: identity.emailFor(staffDefs[i].local),
    hashedPassword: await hash(crypto.randomUUID(), 4),
  }));
  // Same shape as `seedDemo`'s above, and the same acknowledgement.
  const accounts = await Promise.all(accountRows); // diveday:allow-db-concurrency: bcrypt, not queries
  await db.insert(userAccounts).values(accounts);

  // The same day on the roster the canonical demo gets. Without it a minted
  // demo's rostering surface was empty — the cast was there, nobody was ever
  // working — and an e2e spec could not take a shop of its own to write a
  // shift into (ADR 20260815-per-test-private-shops).
  await seedStaffShifts(
    db,
    shop.id,
    staff.map((person) => person.id),
  );

  // A visitor's demo should carry the same owner-facing story as the
  // canonical demo, including sailed trips, tips, and reviews. Test-only
  // private shops can opt into the lean schedule when they need isolation
  // from history-only rows.
  await seedDemoSchedule(db, shop.id, { history: opts.history !== false });

  return { slug: shop.slug, ownerEmail: identity.emailFor("dana") };
}

/**
 * The resettable half of the demo: customers, their cards, the course catalog,
 * trips, requirements, and bookings. This is the playground a prospective
 * customer pokes at — schedule a trip, cancel a booking, fill a boat — and the
 * exact set of rows resetDemoSchedule restores. Staff already exist (stable
 * half), so the instructor is looked up rather than passed in.
 */
export async function seedDemoSchedule(
  db: DbExecutor,
  shopId: string,
  opts: { history?: boolean } = {},
): Promise<void> {
  // Look the instructors up by **name**, not by a hardcoded email and no longer
  // by role. The name is the one key both shops share: a minted demo carries
  // per-shop-unique emails, and since DOM-M7 the shop has two instructors, so
  // `where role = 'instructor' limit 1` would return whichever row Postgres
  // felt like and move the whole seeded demo between runs. `staffDefs` is the
  // single cast both seeders insert from, so these two names always resolve.
  const instructorsByName = new Map(
    (
      await db
        .select({ id: people.id, fullName: people.fullName })
        .from(people)
        .innerJoin(personRoles, eq(people.id, personRoles.personId))
        .where(and(eq(people.shopId, shopId), eq(personRoles.role, "instructor")))
    ).map((row) => [row.fullName, { id: row.id }]),
  );
  const instructor = instructorsByName.get(LEAD_INSTRUCTOR_NAME);
  const reliefInstructor = instructorsByName.get(RELIEF_INSTRUCTOR_NAME);
  if (!instructor) throw new Error("seed: lead instructor missing from stable staff");
  if (!reliefInstructor) throw new Error("seed: relief instructor missing from stable staff");

  // Only the canonical blue-mantis demo pins the recap booking's id — the visual
  // tests mint a recap link from that fixed id. A freshly-minted demo shop gets a
  // random id so a second demo never collides on that primary key.
  const [shopRow] = await db
    .select({ slug: shops.slug, timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const pinRecapBooking = shopRow?.slug === DEMO_SHOP_SLUG;

  // Before anything issues a waiver: the release's own version history, so the
  // shop's current text is version 3 with two superseded wordings behind it,
  // the way a trading shop's paperwork actually looks. Every scenario below
  // snapshots `getCurrentWaiverTemplate`, so this has to settle what "current"
  // means first (src/db/seed-waiver-versions.ts).
  await seedWaiverVersions(db, shopId);

  // The shop's story, in the only order it makes sense in: who dives here, what
  // the shop teaches, where it dives, what is on the board, and who is booked
  // on it. Each step reads rows the ones before it inserted — see the module
  // map at the top of this file before moving anything between them.
  const customers = await seedDivers(db, shopId);
  const { courseRows, discoverCourse, openWaterCourse, courseIdByTitle } = await seedCatalog(
    db,
    shopId,
  );
  // DiveDay's own catalog first: the shop's Molasses Reef records which
  // template version it came from, and the library reads that back to offer the
  // newer one.
  await seedDiveSiteCatalog(db);
  const { siteByName, benwood, french } = await seedDiveSites(db, shopId);
  const { tripRows, captainId, divemasterId } = await seedTrips(db, shopId, {
    instructor,
    reliefInstructor,
    courseRows,
    courseIdByTitle,
    discoverCourse,
    openWaterCourse,
    siteByName,
    benwood,
    french,
  });
  const { bookingRows, wreck, waiverTemplate, promoRedemptionBooking } = await seedBookings(
    db,
    shopId,
    {
      customers,
      tripRows,
      pinRecapBooking,
    },
  );

  await seedMoreTrips(db, shopId, {
    customers,
    siteByName,
    courseRows,
    instructorId: instructor.id,
    captainId,
    divemasterId,
    waiverTemplate,
  });

  await seedPromos(db, shopId, promoRedemptionBooking);

  await seedNitrox(db, shopId, customers, wreck, bookingRows);
  await seedRentalFit(db, shopId, customers);
  // The rental fleet on the wall, after the bookings so a few units can be
  // reserved against the upcoming wreck trip (ADR 20260815-minimal-gear-register).
  await seedGear(db, shopId, {
    timezone: shopRow?.timezone ?? DEMO_SHOP_TIMEZONE,
    tripRows,
    bookingRows,
  });
  // Leads off the public course pages. After the catalog and the divers, so the
  // one lead that links to an existing diver has somebody to link to.
  await seedCourseInquiries(db, shopId, { courseIdByTitle });
  // The same table's other half: divers asking for a *dive* on a date the
  // board has nothing on — the rows the requests list groups by day
  // (src/lib/date-requests.ts).
  await seedDateRequests(db, shopId);
  await seedFrontDesk(db, shopId, customers, tripRows, bookingRows, opts.history !== false);
  // The trailing quarter of already-sailed trips that gives owner reporting
  // something to report. Off for the lean unit-test template and for trial
  // shops (see callers); on for the demo shop and the e2e fleet.
  if (opts.history !== false) {
    await seedHistory(db, shopId, instructor.id);
    await seedRecentRecaps(db, shopId);
    // The billing states that back-fill never produces: it invoices a paid trip
    // fee or a paid deposit and nothing else, so "Refunded", "Void",
    // "Uncollectible" and every retail line kind were unreachable from a shop
    // with three hundred invoices on file. A dozen standalone counter orders
    // fill them in (src/db/seed-orders.ts). Rides with the history flag because
    // it is the same "what has this shop billed" story, and because the lean
    // unit-test template is deliberately order-free.
    await seedOrders(db, shopId, { customers, createdByPersonId: instructor.id });
    // The desk's own paper trail on today's reef boat: private notes against
    // three seats and the account of what has been done to the departure
    // (src/db/seed-desk-trail.ts). Both tables are otherwise written only by
    // something a visitor does, so the Guests tab opened on "No activity yet"
    // in every seeded shop. Annotation only — nothing here is read by
    // readiness, the manifest, or Today.
    const [reefTrip] = tripRows;
    if (reefTrip) {
      await seedDeskTrail(db, shopId, {
        trip: reefTrip,
        roster: bookingRows,
        divers: customers,
        actorPersonId: instructor.id,
      });
      // One unpaid seat on that same boat, so the Overview's pulse has a money
      // fact to state and the Orders index has something to be narrowed to
      // (src/db/seed-open-invoice.ts). Deliberately `open`: a booking-linked
      // paid or refunded order would cascade onto the seat's payment gate,
      // which is what seed-orders.ts's bookingId-null rule is protecting.
      await seedOpenInvoice(db, shopId, {
        trip: reefTrip,
        roster: bookingRows,
        divers: customers,
        createdByPersonId: instructor.id,
      });
    }
  }

  // Last on purpose, unlike every other step above. This one only *adds* — four
  // departures whose cert gates each refuse for exactly one reason, and the
  // Advanced Open Water session that proves the course carve-out — and running
  // it after everything else means no row seeded before it moves, right down to
  // its `nextCreatedAt()` stamp (the counter is shared across scenarios). It
  // reads the divers, the sites, the catalog, and the crew, and nothing reads
  // it back.
  await seedCertGates(db, shopId, {
    customers,
    siteByName,
    courseRows,
    instructorId: instructor.id,
    captainId,
    divemasterId,
    waiverTemplate,
  });

  // Adds-only, like seedCertGates above: two buddy teams on today's reef
  // trip — a pair and a divemaster-led trio — plus their `formed` trail
  // entries, and no roll-call events, so nothing seeded before it moves and no
  // head-count gap opens on Today (src/db/seed-buddy-pairs.ts, ADR
  // 20260804-buddy-teams).
  await seedBuddyPairs(db, shopId, {
    customers,
    tripRows,
    bookingRows,
    // Keiko when the crew seed found her; the instructor otherwise (the type
    // allows an undefined divemaster even though the demo cast always has one).
    pairedByPersonId: divemasterId ?? instructor.id,
  });

  // Adds-only and late, for the same reason as the two above: one departure
  // tomorrow whose gates all fire at once, and one diver holding none of them,
  // so the counter has a card with five reasons on it to render
  // (src/db/seed-counter-blockers.ts). Nothing seeded before it moves, and it
  // has not sailed, so it opens no head count.
  await seedCounterBlockers(db, shopId, { siteByName, captainId, divemasterId });

  // Same shape and the same reasons: its own departure, added late, four days
  // out and three of six seats sold — the long-range run a shop states a
  // minimum head count on, in the state it is worked in (short, deadline still
  // ahead). See src/db/seed-minimum-seats.ts.
  await seedMinimumSeats(db, shopId, { siteByName, captainId, divemasterId });

  // Adds-only and late for the same reasons as the three above: two people who
  // are on the shop-wide last-minute list and nothing else, one claiming Open
  // Water and one saying they hold no card at all, so the marks a staffer reads
  // before a discount blast are actually rendered somewhere
  // (src/db/seed-self-declared.ts). Neither holds a seat, so no readiness count,
  // roster or head count moves. Rides the history flag like the list itself.
  await seedSelfDeclaredJoiners(db, shopId, opts.history !== false);

  // Adds-only and late, like the four above: the desk's trail **per diver**,
  // so the Activity section on a diver's record opens on a real history rather
  // than an empty panel (src/db/seed-diver-trail.ts). It writes `activity_events`
  // and nothing else — a table read only by the Guests tab's collapsed log and
  // by that section, never by readiness, the manifest, or a head count — so
  // nothing seeded before it moves. Last of the adds-only group because it
  // reads every seat the earlier scenarios sold, including the cert-gate and
  // minimum-seats departures.
  await seedDiverTrail(db, shopId, {
    roster: bookingRows,
    divers: customers,
    // Instructor, then the divemaster and captain when the crew seed found
    // them — the trail rotates through the crew in that order.
    actorPersonIds: [instructor.id, divemasterId, captainId].filter(
      (id): id is string => typeof id === "string",
    ),
  });

  // Updates-only, and the only step here that writes no rows at all: how far the
  // boat runs on the three departures where the answer is not the shop's usual
  // twenty minutes (src/db/seed-trip-legs.ts). After every scenario that creates
  // a departure, since it sets a column on their dives; before the waiver seal
  // below, which nothing may write after. Canonical demo only — a stated leg
  // beats the shop's own ride-out figure, which is exactly what a spec taking a
  // shop of its own is usually testing.
  await seedTripLegs(db, shopId, opts.history !== false);

  // A synthetic, status-only medical-review hold on a future departure gives
  // the demo and staff training a real fail-closed waiver path without storing
  // any health answers. It remains unresolved every time the demo resets; the
  // policy/legal decision behind production medical handling is still H-01–H-03.
  await seedMedicalReview(db, shopId, waiverTemplate, tripRows);

  // Truly last, and updates-only: what the shop's signed evidence looks like
  // once every scenario above has finished writing releases — signatures dated
  // across the weeks divers actually signed in rather than all at this instant,
  // and an integrity seal on everything signed since the shop's account got one
  // (src/db/seed-waiver-evidence.ts). A seal covers a record's final stored
  // metadata, so nothing may write a waiver row after this.
  await seedWaiverEvidence(db, shopId);
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
export async function resetDemoSchedule(
  db: DbExecutor,
  shopId: string,
  opts: { history?: boolean } = {},
): Promise<void> {
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);

  // Booking- and trip-dependent operational history first. Delete order is a
  // topological sort of the foreign-key graph: every table that references
  // bookings, trips, or people must be cleared before those parents. A missing
  // child here surfaces as an FK-violation mid-run — e.g. a waitlist entry or
  // order left behind blocks the trips/bookings delete and dirties the next
  // test's fixture (regression tests live in seed.test.ts).
  await db.delete(rollCallCrewEvents).where(eq(rollCallCrewEvents.shopId, shopId));
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
  // Neither of these is seeded — both are written only by what a visitor does
  // (a staff note on a diver, the activity trail `seat-diver.ts` appends), and
  // both reference `people` without cascade. So a demo where anyone used the
  // Guests tab or left a note handed the people purge below a 23503 to trip
  // over. Shop-wide, because there is no seeded row here to preserve.
  await db.delete(internalNotes).where(eq(internalNotes.shopId, shopId));
  await db.delete(activityEvents).where(eq(activityEvents.shopId, shopId));
  // The close-out trail references people (its actor), so it clears before the
  // people purge below — and clearing it at all is what keeps the close-out
  // surface deterministic between specs: a day one test closed must read as
  // open again for the next test's fixture (ADR 20260804-day-closeout).
  await db.delete(dayCloseouts).where(eq(dayCloseouts.shopId, shopId));
  await db.delete(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId));
  // The gear register, children first: reservations reference gear_items and
  // bookings, service events reference gear_items and people (their recording
  // staffer) — so all three clear before bookings and the people purge below.
  // The whole fleet is reset-owned and re-seeded (seed-gear.ts), so a spec may
  // add, retire, or reserve units freely and the next test starts clean.
  await db.delete(gearReservations).where(eq(gearReservations.shopId, shopId));
  await db.delete(gearServiceEvents).where(eq(gearServiceEvents.shopId, shopId));
  await db.delete(gearItems).where(eq(gearItems.shopId, shopId));
  // References people, so it clears before them like any other people-scoped row.
  await db.delete(priorVisits).where(eq(priorVisits.shopId, shopId));
  await db.delete(importedPaymentHistory).where(eq(importedPaymentHistory.shopId, shopId));
  // Per-channel delivery state hangs off the waiver record, so it goes first.
  await db.delete(waiverDeliveries).where(eq(waiverDeliveries.shopId, shopId));
  await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shopId));
  await db.delete(bookingPayments).where(eq(bookingPayments.shopId, shopId));
  // Readiness/confirm capabilities reference bookings, so they must go before them.
  await db.delete(bookingCapabilities).where(eq(bookingCapabilities.shopId, shopId));
  // Tips reference bookings, so they must go before them — same FK this
  // cascade's sibling (deleteDemoShopCascade) already fixed (Codex finding:
  // this reset path had its own, separate child-first list and was missed).
  await db.delete(tips).where(eq(tips.shopId, shopId));
  await db
    .delete(notificationDeliveryAttempts)
    .where(eq(notificationDeliveryAttempts.shopId, shopId));
  await db.delete(notificationSendQueue).where(eq(notificationSendQueue.shopId, shopId));
  await db.delete(notificationDeliveries).where(eq(notificationDeliveries.shopId, shopId));
  // Recap photos reference bookings and trips, so they must go before both.
  await db.delete(recapPhotos).where(eq(recapPhotos.shopId, shopId));
  // The shared close-out photo album also references its trip and uploader.
  await db.delete(tripRecapPhotos).where(eq(tripRecapPhotos.shopId, shopId));
  // The moderation trail references the review it describes, so it goes first
  // (ADR 20260813-review-moderation-has-a-floor).
  await db.delete(reviewModerationEvents).where(eq(reviewModerationEvents.shopId, shopId));
  // Reviews reference bookings, trips, and people — all three parents below.
  await db.delete(tripReviews).where(eq(tripReviews.shopId, shopId));
  // Stripe checkout/refund state references bookings, trips, and orders, so it
  // must be cleared before those parents or the deletes below FK-violate and
  // abort the whole reset mid-run — leaving a prior payment test's trips and
  // bookings to leak into the next test's fixture (this is what made trips.spec
  // flake under the full suite). booking_checkout_bookings references both
  // booking_checkouts and bookings; payment_operation_intents references trips,
  // bookings, orders, and booking_checkouts — so both go before booking_checkouts.
  await db.delete(bookingCheckoutBookings).where(eq(bookingCheckoutBookings.shopId, shopId));
  await db.delete(paymentOperationIntents).where(eq(paymentOperationIntents.shopId, shopId));
  // A redemption points at the checkout that spent the code, so it goes first
  // (docs ADR 20260729-shop-promo-codes). The codes themselves are shop config
  // and survive a schedule reset.
  await db.delete(shopPromoRedemptions).where(eq(shopPromoRedemptions.shopId, shopId));
  await db.delete(bookingCheckouts).where(eq(bookingCheckouts.shopId, shopId));
  // Orders (and their line items) reference bookings and people; the waitlist
  // references trips and people. Both must go before the parents below.
  await db.delete(orderLineItems).where(eq(orderLineItems.shopId, shopId));
  await db.delete(orders).where(eq(orders.shopId, shopId));
  await db.delete(tripInvitations).where(eq(tripInvitations.shopId, shopId));
  await db.delete(tripWaitlistEntries).where(eq(tripWaitlistEntries.shopId, shopId));
  // References trips (last-minute-deal blasts) and people (the last-minute
  // list itself), so both must go before the trips/people deletes below or
  // this FK-violates and aborts the whole reset mid-run (docs ADR
  // 20260727-last-minute-fill-promos; same class of bug the tripWaitlistEntries
  // comment above already walks).
  await db
    .delete(tripLastMinutePromoRecipients)
    .where(eq(tripLastMinutePromoRecipients.shopId, shopId));
  await db.delete(tripLastMinutePromos).where(eq(tripLastMinutePromos.shopId, shopId));
  // Before the entries they point at. Added with Leo's self-serve unsubscribe
  // (docs ADR 20260731-self-serve-unsubscribe) but not to this ordering, which
  // made every `/api/test/reset` throw 23503 mid-run and leave the demo shop
  // half-reset — the e2e fleet then failed in whichever spec happened to read
  // the wreckage next, which is why the flake moved around between runs.
  await db
    .delete(lastMinuteListUnsubscribeTokens)
    .where(eq(lastMinuteListUnsubscribeTokens.shopId, shopId));
  await db.delete(lastMinuteListEntries).where(eq(lastMinuteListEntries.shopId, shopId));
  // References people (courtesy-email opt-out tokens minted for waitlist
  // invites and trip recaps), so it must go before the people deletes below
  // or this FK-violates and aborts the whole reset mid-run — the same class
  // of bug the last-minute-list unsubscribe token comment above already walks.
  await db
    .delete(personCourtesyEmailUnsubscribeTokens)
    .where(eq(personCourtesyEmailUnsubscribeTokens.shopId, shopId));
  // The blow-out cascade's two tables, innermost first: the per-diver rows
  // reference both `bookings` and `trip_blowouts`, and the cascade row
  // references `trips`. Missing from this ordering when the cascade shipped,
  // which made `/api/test/reset` throw 23503 on
  // `trip_blowouts_trip_id_trips_id_fkey` for every run that had called a
  // blow-out — the reset then aborted half-done and the e2e fleet failed in
  // whichever spec next read the wreckage, exactly as the last-minute-list
  // comment above describes (ADR 20260804-blowout-cascade).
  await db.delete(tripBlowoutDivers).where(eq(tripBlowoutDivers.shopId, shopId));
  await db.delete(tripBlowouts).where(eq(tripBlowouts.shopId, shopId));
  // The buddy-team trail references trips and people and outlives the
  // membership rows by design (ADR 20260804-buddy-teams), so it clears before
  // both parents — same ordering rule the cascade comments above walk.
  await db.delete(buddyTeamEvents).where(eq(buddyTeamEvents.shopId, shopId));
  // Buddy pairs reference bookings, so they go first or the bookings delete
  // below FK-violates and aborts the whole reset mid-run — the same class of
  // bug the token comments above already walk (ADR 20260804-buddy-teams).
  await db.delete(buddyPairMembers).where(eq(buddyPairMembers.shopId, shopId));
  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  await db.delete(tripRequirements).where(eq(tripRequirements.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
    await db.delete(tripDives).where(inArray(tripDives.tripId, tripIds));
  }
  await db.delete(trips).where(eq(trips.shopId, shopId));
  // After the trips that point at them. Series rows are never seeded — only the
  // schedule board writes one — so a spec that creates a recurring departure
  // used to leave the series behind while its trips went, and the next spec in
  // the same worker opened the board on a stale recurrence nothing had booked.
  // Not an FK violation, which is exactly why it survived: this reset's other
  // omissions announced themselves with a 23503, and a silent leak does not.
  // Found by the shop-scoped sweep in `delete-path-coverage.test.ts`, which the
  // cascade's own ordering had already got right.
  // Before the series it points at, and after the trips: a skip is the
  // memory of a date that is no longer there.
  await db.delete(tripSeriesSkips).where(eq(tripSeriesSkips.shopId, shopId));
  await db.delete(tripSeries).where(eq(tripSeries.shopId, shopId));
  await db.delete(diveSiteMoments).where(eq(diveSiteMoments.shopId, shopId));
  await db.delete(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId));
  // A species request points at the site the staffer was writing when they hit
  // the wall, so it goes before the sites — the FK is `ON DELETE SET NULL`, but
  // the row's own `shop_id` is not, and leaving it would block the shop delete
  // outright. Cleared on a schedule reset too: nothing seeds it, so an empty
  // table is the demo shop's correct state, and the e2e suite writes one every
  // time it exercises the picker's refusal.
  await db.delete(marineLifeRequests).where(eq(marineLifeRequests.shopId, shopId));
  await db.delete(diveSites).where(eq(diveSites.shopId, shopId));
  // A course inquiry references its course without cascade (a lead is
  // evidence, not something a schedule reset should silently vanish), so it
  // must go before the courses delete or this FK-violates and aborts the whole
  // reset mid-run — the same class of bug the comment above already walks.
  await db.delete(courseInquiries).where(eq(courseInquiries.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  await db.delete(certifications).where(eq(certifications.shopId, shopId));
  await db.delete(specialtyCertifications).where(eq(specialtyCertifications.shopId, shopId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.shopId, shopId));

  // Everyone except the staff seeded once at shop creation (`staffDefs`, by
  // full name since canonical and minted shops give them different emails) —
  // seeded customers, booking-flow walk-ups, and any staff invited or promoted
  // mid-test. Checking `STAFF_ROLES` alone isn't enough: e2e/staff-invite.spec.ts
  // invites and accepts a new instructor, which makes them a real staff-role
  // person indistinguishable from the seeded cast by role — so without the name
  // check, that invited person became permanently "stable" and leaked into every
  // later spec sharing this worker (a "Priya Nair" row on the settings/team
  // screenshot whose invite email embeds the wall-clock millisecond it was
  // created, never matching twice — this was the flakiest screenshot in the
  // visual suite, stability 0.07).
  //
  // Read off `staffDefs` rather than re-typed here. This list was a second
  // hand-maintained copy of the cast, and it did exactly what a second copy
  // does: adding the shop's relief instructor (DOM-M7) left her outside the
  // set, so the first reset purged her and the very next `seedDemoSchedule`
  // threw looking her back up.
  // Before the purge reads the roster, not after: the purge keeps a person by
  // finding them holding a staff **role**, so a cast member who has lost one
  // would be swept out here and re-inserted below under a new id — churning the
  // very rows this is meant to hold steady.
  await restoreMissingStableStaff(db, shopId);

  const STABLE_STAFF_NAMES = new Set<string>(staffDefs.map((s) => s.fullName));
  const staffRows = await db
    .select({ personId: personRoles.personId, fullName: people.fullName })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])));
  const stableStaffIds = new Set(
    staffRows.filter((r) => STABLE_STAFF_NAMES.has(r.fullName)).map((r) => r.personId),
  );

  const shopPeople = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shopId));
  const purgeIds = shopPeople.map((p) => p.id).filter((id) => !stableStaffIds.has(id));
  if (purgeIds.length > 0) {
    await db.delete(personRoles).where(inArray(personRoles.personId, purgeIds));
    // Scoped to the purged people, not shop-wide: the stable half seeds shifts
    // for the four permanent staff and never re-seeds them, so clearing the
    // table outright would empty the rostering surface for good after one
    // reset. Only a person who is going needs their rows to go — the same
    // shape as the erasure-obligation delete below. This matters because the
    // purge does take staff: e2e/staff-invite.spec.ts invites and accepts a
    // new instructor, who is not one of the stable four.
    await db.delete(staffShifts).where(inArray(staffShifts.personId, purgeIds));
    await db.delete(calendarFeeds).where(inArray(calendarFeeds.personId, purgeIds));
    // Login rows reference people (user_accounts.person_id), so they must go
    // before the people they belong to or the delete below FK-violates (23503),
    // aborts the whole reset mid-run, and leaks the churned schedule into the
    // next spec's fixture. A purged person carries a login whenever a flow
    // minted one for them — contact import (src/db/import.ts), diver signup,
    // and staff invite/accept all do — so this is not hypothetical; it is what
    // made trips.spec flake under the full suite. deleteDemoShopCascade already
    // clears these; the per-reset path must too. Account tokens (email verify /
    // password reset) reference the login row itself, one layer further down
    // the same chain — a forgot-password request against a purged person's
    // account leaves one behind, so it must go before user_accounts for the
    // identical reason (security review finding on 20260725-account-lifecycle-emails).
    const purgeAccountIds = (
      await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(inArray(userAccounts.personId, purgeIds))
    ).map((row) => row.id);
    if (purgeAccountIds.length > 0) {
      await db.delete(accountTokens).where(inArray(accountTokens.userAccountId, purgeAccountIds));
    }
    await db.delete(userAccounts).where(inArray(userAccounts.personId, purgeIds));
    // A processor-erasure obligation names the erased person and the staff
    // member who discharged it (ADR 20260803-processor-erasure-obligations), so
    // an erasure run against the demo shop leaves a row pointing at a person
    // this purge is about to delete — the same FK chain the login rows above
    // walk, with the same consequence if it is missed.
    await db
      .delete(processorErasureObligations)
      .where(
        or(
          inArray(processorErasureObligations.personId, purgeIds),
          inArray(processorErasureObligations.dischargedByPersonId, purgeIds),
        ),
      );
    await db.delete(people).where(inArray(people.id, purgeIds));
  }

  // Shop-level fixtures a test can mutate directly (not just schedule data)
  // (Codex finding): `shops.review_url` (Settings → Review link) and a
  // connected `shop_stripe_accounts` row (`/api/test/seed-stripe-account`)
  // both persist across resets otherwise, since neither is schedule/booking
  // data — leaking into whichever spec runs next in the same worker and
  // making its assertions order-dependent (e2e/recap.spec.ts's own "review
  // link starts absent" check, for one). The canonical seed never sets
  // either, so restoring to that state is just deleting/nulling them.
  // `shops.depth_unit` is the same class of leak: it's the only
  // shop-settings column e2e/depth-and-age-surfaces.spec.ts's "read back in
  // the shop's own unit" test mutates (metres → feet, mid-test), and nothing
  // ever flips it back — a second run against the same server (e.g. a local
  // `pnpm exec playwright test` rerun without restarting `next start`)
  // starts already on "feet" and the test's own `/Maximum depth \(metres\)/`
  // locator then never matches, hanging for the full test timeout rather
  // than failing fast.
  // `shops.temperature_unit` rides along for the same reason: it is the second
  // half of the same settings pair and leaks exactly the same way once a spec
  // flips it.
  await db
    .update(shops)
    .set({ reviewUrl: null, depthUnit: "meters", temperatureUnit: "celsius" })
    .where(eq(shops.id, shopId));
  await db.delete(shopStripeAccounts).where(eq(shopStripeAccounts.shopId, shopId));

  // The waiver is the same class of fixture. Editing the release text saves a
  // *new version* rather than mutating the signed one, so a spec that edits it
  // leaves the shop on version 2 — and the next spec asserting "Version 1" or
  // reading the default body sees the previous test's edit instead. The signed
  // records referencing these rows were cleared at the top of this reset, so
  // the templates can be replaced outright. The title is immutable in the UI,
  // so the existing one is the shop's own (the canonical demo and a minted one
  // seed different titles) and is what gets restored.
  const [existingWaiver] = await db
    .select({ title: waiverTemplates.title })
    .from(waiverTemplates)
    .where(eq(waiverTemplates.shopId, shopId))
    .limit(1);
  await db.delete(waiverTemplates).where(eq(waiverTemplates.shopId, shopId));
  await db.insert(waiverTemplates).values({
    shopId,
    title: existingWaiver?.title ?? DEFAULT_WAIVER_TITLE,
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  // Shop-wide discount codes, for the same reason and by the same means.
  //
  // These were deliberately left in place for a long time on the grounds that a
  // code is shop config rather than schedule data — but "config" is exactly what
  // makes a mutation leak. `setShopPromoEnabled` flips the seeded REEF10 between
  // `active` and `disabled` from the staff page, so a spec that switches it off
  // (or on) hands the next spec in the same worker a shop whose promo box
  // behaves differently, and the diver-facing "code accepted" assertions become
  // order-dependent (issue #330). The redemptions and the checkouts that spent
  // them were cleared at the top of this reset, and `booking_checkouts` — the
  // only other table with an FK to a code — went with them, so the codes can be
  // replaced outright the way the waiver templates just were. `seedDemoSchedule`
  // re-inserts REEF10 and OPENWATER25 in their seeded state below; a code some
  // test minted is not seeded state and correctly does not come back.
  await db.delete(shopPromoCodes).where(eq(shopPromoCodes.shopId, shopId));

  // The low-level reset stays lean by default so callers that are resetting a
  // fixture do not unexpectedly recreate hundreds of historical tips/reviews.
  // Full demo refreshes opt into the reporting story explicitly.
  await seedDemoSchedule(db, shopId, { history: opts.history === true });
}

/**
 * Put back any member of the stable cast this shop is missing, so the re-seed
 * below can find them.
 *
 * The stable half is seeded **once**, when the shop is created, and never
 * again — which is fine for a shop minted by the code running now, and wrong
 * for the canonical demo, which was created months ago and has been carried
 * forward by migrations ever since. Every time `staffDefs` gains a member, that
 * long-lived shop is a person short of the cast the current code expects, and
 * `seedDemoSchedule` throws looking them up ("seed: relief instructor missing
 * from stable staff") — which is what took `/api/cron/demo-refresh` down to a
 * nightly 503 after DOM-M7 added Talia Okonkwo. The reset had already rolled
 * back by then, so the demo simply aged, and the only visible symptom was the
 * cron's own alarm.
 *
 * **A name is not identity here, and this is the whole subtlety.** The purge
 * above and `seedDemoSchedule` can both match the cast by name because they run
 * after it, on rows they control — but a *diver* is called whatever the booking
 * form was given, and `e2e/returning-diver.spec.ts` books a seat as "Sal
 * Moretti", the seeded captain's own name. Keyed by name, this granted that
 * diver the `captain` role, the shop then had two captains, `seedDemoSchedule`
 * rostered whichever one the role lookup returned first, and the real captain's
 * Today lost the boat they crew. A staff role handed to a customer is the
 * serious half of that; the failing lens test was only how it surfaced.
 *
 * So the key is the **address**. `people_shop_email_unique` makes it one row
 * per shop, and the seed writes `<local>@<domain>` for every member of the cast
 * — `demo.invalid` for the canonical demo, `<slug>.demo.invalid` for a minted
 * one. The domain is read off a colleague who is both still here and *actually
 * on staff*, rather than rebuilt from the shop's slug: one fewer copy of a rule
 * to drift, and a diver who books as `sal@example.com` cannot answer the
 * question, because holding a staff role is part of being asked.
 *
 * Roles are reconciled for the whole cast, not just the people this inserts: the
 * lookups that throw join through `person_roles`, so a member who is present but
 * has lost a role is the same outage with a different cause.
 *
 * No sign-in account is minted. `dev-credentials.ts` decides which staff are
 * demo personas to log in as, and someone who is crew on the boat rather than a
 * persona has never had one.
 */
async function restoreMissingStableStaff(db: DbExecutor, shopId: string): Promise<void> {
  const castLocals = new Set<string>(staffDefs.map((s) => s.local));
  const localPartOf = (email: string | null) => (email ?? "").split("@")[0];
  const domainOf = (email: string | null) => (email ?? "").split("@")[1];

  // Which address convention this shop follows, answered only by someone who
  // holds a staff role — see the note above on why a matching name, or even a
  // matching local part, is not enough on its own.
  const onStaff = await db
    .select({ email: people.email })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])));
  const domain = onStaff
    .map((person) => (castLocals.has(localPartOf(person.email)) ? domainOf(person.email) : ""))
    .find(Boolean);
  // Not a demo shop that drifted — it is a shop with no recognisable cast at
  // all, and inventing an address for one would be a guess.
  if (!domain) return;

  const addressFor = (local: string) => `${local}@${domain}`;
  const idByAddress = new Map(
    (
      await db
        .select({ id: people.id, email: people.email })
        .from(people)
        .where(eq(people.shopId, shopId))
    )
      .filter((person) => person.email)
      .map((person) => [person.email as string, person.id]),
  );

  const missing = staffDefs.filter((s) => !idByAddress.has(addressFor(s.local)));
  if (missing.length > 0) {
    const restored = await db
      .insert(people)
      .values(
        missing.map((s) => ({
          shopId,
          fullName: s.fullName,
          email: addressFor(s.local),
          emergencyContactName: s.emergencyContact?.[0] ?? null,
          emergencyContactPhone: s.emergencyContact?.[1] ?? null,
        })),
      )
      .returning({ id: people.id, email: people.email });
    for (const person of restored) idByAddress.set(person.email as string, person.id);
    // The same shift the stable seed gives every one of them. Without it the
    // repair leaves a person on the roster and off the rostering surface, which
    // is a different wrong answer from the one it just fixed — and the reset
    // never re-seeds shifts for staff who already have one, so this is the only
    // moment they can get theirs.
    await seedStaffShifts(
      db,
      shopId,
      restored.map((person) => person.id),
    );
  }

  const castIds = staffDefs
    .map((s) => idByAddress.get(addressFor(s.local)))
    .filter((id) => id !== undefined);
  const heldRoles = new Set(
    (
      await db
        .select({ personId: personRoles.personId, role: personRoles.role })
        .from(personRoles)
        .where(inArray(personRoles.personId, castIds))
    ).map((row) => `${row.personId}:${row.role}`),
  );
  const owedRoles = staffDefs.flatMap((s) => {
    const personId = idByAddress.get(addressFor(s.local));
    if (!personId) return [];
    return s.roles
      .filter((role) => !heldRoles.has(`${personId}:${role}`))
      .map((role) => ({ personId, role }));
  });
  if (owedRoles.length > 0) await db.insert(personRoles).values(owedRoles);
}

/**
 * The demo-shop lifecycle, re-exported so `@/db/seed` stays the one import for
 * everything about demo data. See `./seed-demo-lifecycle.ts`.
 */
export { DEMO_RECAP_BOOKING_ID } from "./seed-bookings";
export { demoTodayDepartureStart } from "./seed-clock";
export {
  DEFAULT_DEMO_SHOP_MAX_LIVE,
  DEFAULT_DEMO_TTL_MS,
  deleteDemoShopCascade,
  enforceMintedDemoCap,
  purgeMintedDemoShops,
  reapExpiredDemoShops,
} from "./seed-demo-lifecycle";
