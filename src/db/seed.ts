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
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  certifications,
  courseInquiries,
  coursePaths,
  courses,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
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
  rollCallCrewAttestations,
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
  tripDives,
  tripLastMinutePromos,
  tripRequirements,
  tripReviews,
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { seedBackup } from "./seed-backup";
import { seedBookings } from "./seed-bookings";
import { seedCatalog } from "./seed-catalog";
import { seedCertGates } from "./seed-cert-gates";
import { at, DEMO_SHOP_TIMEZONE, demoTodayDepartureStart } from "./seed-clock";
import { enforceMintedDemoCap } from "./seed-demo-lifecycle";
import { seedDiveSites } from "./seed-dive-sites";
import { seedDivers } from "./seed-divers";
import { seedFrontDesk } from "./seed-front-desk";
import { seedHistory } from "./seed-history";
import { seedMoreTrips } from "./seed-more-trips";
import { seedNitrox } from "./seed-nitrox";
import { seedRentalFit } from "./seed-rental-fit";
import { seedTrips } from "./seed-trips";

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
 * | `./seed-more-trips.ts` | the rest of the month's board beyond today's three headline boats |
 * | `./seed-nitrox.ts` | EANx cards and the per-dive gas the wreck charter gates on |
 * | `./seed-rental-fit.ts` | divers' saved sizes, so the gear locker has something to pull |
 * | `./seed-front-desk.ts` | the desk's own day: walk-ins, wait lists, inquiries, tips |
 * | `./seed-history.ts` | the trailing quarter that gives owner reporting something to report |
 * | `./seed-cert-gates.ts` | the boats a card can be refused on, one gate each, and the course carve-out |
 * | `./seed-demo-lifecycle.ts` | minting, reaping, and capping throwaway demo shops |
 * | `./seed-backup.ts` | the shop-owned backup destination and its weekly delivery history |
 *
 * The public surface is unchanged: `@/db/seed` still exports everything it
 * always did, including the lifecycle helpers re-exported at the bottom.
 */

const INSTRUCTOR_EMAIL = "marcus@demo.invalid";

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
    })
    .returning();
  if (!shop) throw new Error("seed: failed to insert demo shop");

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: "Blue Mantis Diving Release",
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  const staffDefs = [
    { fullName: "Dana Reyes", email: "dana@demo.invalid", roles: ["owner", "manager"] },
    { fullName: "Marcus Webb", email: INSTRUCTOR_EMAIL, roles: ["instructor"] },
    { fullName: "Keiko Tanaka", email: "keiko@demo.invalid", roles: ["divemaster"] },
    { fullName: "Sal Moretti", email: "sal@demo.invalid", roles: ["captain"] },
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

  // Staff sign-in accounts use the demo bypass token rather than storing that
  // public password as a real credential. This keeps the bypass scoped to the
  // demo shop: if a test or operator turns isDemo off, "password" no longer
  // authenticates these accounts. Cost 4 keeps seeding fast in tests; real
  // account creation flows must use a production-grade cost.
  const logins = Object.values(DEV_STAFF_LOGINS);
  await db.insert(userAccounts).values(
    await Promise.all(
      logins.map(async (login) => {
        const person = staff.find((p) => p.email === login.email);
        if (!person) throw new Error(`seed: no staff person for ${login.email}`);
        return {
          personId: person.id,
          email: login.email,
          hashedPassword: await hash(crypto.randomUUID(), 4),
        };
      }),
    ),
  );

  const demoShiftStart = new Date(demoTodayDepartureStart().getTime() - 60 * 60 * 1000);
  const demoShiftEnd = new Date(demoShiftStart.getTime() + 12 * 60 * 60 * 1000);
  await db.insert(staffShifts).values(
    staff.map((person) => ({
      shopId: shop.id,
      personId: person.id,
      startsAt: demoShiftStart,
      endsAt: demoShiftEnd,
      note: "Demo schedule",
      createdByPersonId: person.id,
    })),
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
 * The random slug suffix makes collisions on the global `shops.slug` index
 * astronomically unlikely under concurrent minting; a `23505` here means "the
 * visitor hit that lottery" and the action can simply be retried.
 */
export async function createDemoShop(
  db: DbExecutor,
): Promise<{ slug: string; ownerEmail: string }> {
  // Aggregate storage cap (security review, finding 1): the per-IP rate limit
  // bounds one visitor's burst but not the fleet-wide total, so an IP-rotating
  // attacker could pile up minted shops between 7-day reaper passes. Before
  // minting, evict the oldest minted demos so the live count never exceeds the
  // ceiling — the canonical demo and real shops are never eligible (see below).
  await enforceMintedDemoCap(db);

  const identity = generateDemoShopIdentity();

  const [shop] = await db
    .insert(shops)
    .values({
      name: identity.name,
      slug: identity.slug,
      timezone: DEMO_SHOP_TIMEZONE,
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
    })
    .returning();
  if (!shop) throw new Error("createDemoShop: failed to insert shop");

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: DEFAULT_WAIVER_TITLE,
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  const staffDefs = [
    { fullName: "Dana Reyes", local: "dana", roles: ["owner", "manager"] },
    { fullName: "Marcus Webb", local: "marcus", roles: ["instructor"] },
    { fullName: "Keiko Tanaka", local: "keiko", roles: ["divemaster"] },
    { fullName: "Sal Moretti", local: "sal", roles: ["captain"] },
  ] as const;

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId: shop.id,
        fullName: s.fullName,
        email: identity.emailFor(s.local),
        emergencyContactName: "On file",
        emergencyContactPhone: "+1-305-555-0100",
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
  await db.insert(userAccounts).values(
    await Promise.all(
      staff.map(async (person, i) => ({
        personId: person.id,
        email: identity.emailFor(staffDefs[i].local),
        hashedPassword: await hash(crypto.randomUUID(), 4),
      })),
    ),
  );

  // No fabricated billing back-fill on a minted demo: `seedHistory` pins
  // globally-unique waiver token hashes and Stripe ids that would collide with
  // the canonical demo (and with a second minted demo). The billing/orders
  // showcase lives on blue-mantis; a throwaway demo is the lean schedule.
  await seedDemoSchedule(db, shop.id, { history: false });

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
  // Look the instructor up by their role within the shop, not by a hardcoded
  // email — so this seeds the canonical blue-mantis demo and any freshly-minted
  // demo shop (whose staff carry per-shop-unique emails) alike.
  const [instructor] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "instructor")))
    .limit(1);
  if (!instructor) throw new Error("seed: instructor missing from stable staff");

  // Only the canonical blue-mantis demo pins the recap booking's id — the visual
  // tests mint a recap link from that fixed id. A freshly-minted demo shop gets a
  // random id so a second demo never collides on that primary key.
  const [shopRow] = await db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const pinRecapBooking = shopRow?.slug === DEMO_SHOP_SLUG;

  // The shop's story, in the only order it makes sense in: who dives here, what
  // the shop teaches, where it dives, what is on the board, and who is booked
  // on it. Each step reads rows the ones before it inserted — see the module
  // map at the top of this file before moving anything between them.
  const customers = await seedDivers(db, shopId);
  const { courseRows, discoverCourse, openWaterCourse, courseIdByTitle } = await seedCatalog(
    db,
    shopId,
  );
  const { siteByName, benwood, french } = await seedDiveSites(db, shopId);
  const { tripRows, captainId, divemasterId } = await seedTrips(db, shopId, {
    instructor,
    courseRows,
    courseIdByTitle,
    discoverCourse,
    openWaterCourse,
    siteByName,
    benwood,
    french,
  });
  const { bookingRows, wreck, waiverTemplate } = await seedBookings(db, shopId, {
    customers,
    tripRows,
    pinRecapBooking,
  });

  await seedMoreTrips(db, shopId, {
    customers,
    siteByName,
    courseRows,
    instructorId: instructor.id,
    captainId,
    divemasterId,
    waiverTemplate,
  });

  // Two shop-wide promo codes, so the staff page and the diver-facing promo
  // box both have something real behind them. The Stripe ids are fabricated —
  // the demo never connects an account — the same convention the seeded orders
  // and tips already use.
  await db
    .insert(shopPromoCodes)
    .values([
      {
        shopId,
        code: "REEF10",
        description: "Standing returning-diver discount",
        discountPercent: 10,
        scope: "all" as const,
        status: "active" as const,
        stripeCouponId: "coupon_demo_reef10",
        stripePromotionCodeId: "promo_demo_reef10",
        createdAt: at(-30, 9),
      },
      {
        shopId,
        code: "OPENWATER25",
        description: "Course push — expired, kept as history",
        discountPercent: 25,
        scope: "courses" as const,
        status: "active" as const,
        maxRedemptions: 20,
        expiresAt: at(-1, 12),
        stripeCouponId: "coupon_demo_ow25",
        stripePromotionCodeId: "promo_demo_ow25",
        createdAt: at(-45, 9),
      },
    ])
    // `resetDemoSchedule` clears the shop's codes just before calling back in
    // here, so this normally inserts into an empty table and restores both to
    // their seeded state (status included — a spec that switched REEF10 off
    // must not hand that off to the next spec; issue #330). The conflict clause
    // stays as a belt-and-braces guard for any caller that re-seeds a shop
    // whose codes are still present: the (shop, code) index is unique.
    .onConflictDoNothing();

  await seedNitrox(db, shopId, customers, wreck, bookingRows);
  await seedRentalFit(db, shopId, customers);
  await seedFrontDesk(db, shopId, customers, tripRows, bookingRows, opts.history !== false);
  // The trailing quarter of already-sailed trips that gives owner reporting
  // something to report. Off for the lean unit-test template and for trial
  // shops (see callers); on for the demo shop and the e2e fleet.
  if (opts.history !== false) {
    await seedHistory(db, shopId, instructor.id);
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
  await db.delete(rollCallCrewAttestations).where(eq(rollCallCrewAttestations.shopId, shopId));
  await db.delete(rollCallCrewEvents).where(eq(rollCallCrewEvents.shopId, shopId));
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
  await db.delete(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId));
  // References people, so it clears before them like any other people-scoped row.
  await db.delete(priorVisits).where(eq(priorVisits.shopId, shopId));
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
  await db.delete(tripWaitlistEntries).where(eq(tripWaitlistEntries.shopId, shopId));
  // References trips (last-minute-deal blasts) and people (the last-minute
  // list itself), so both must go before the trips/people deletes below or
  // this FK-violates and aborts the whole reset mid-run (docs ADR
  // 20260727-last-minute-fill-promos; same class of bug the tripWaitlistEntries
  // comment above already walks).
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
  // Paths first: their steps cascade from either side, but a path row itself
  // is only shop-scoped, so deleting courses alone would strand it. A course
  // inquiry references its course without cascade (a lead is evidence, not
  // something a schedule reset should silently vanish), so it must go before
  // the courses delete or this FK-violates and aborts the whole reset mid-run
  // — the same class of bug the comment above already walks.
  await db.delete(coursePaths).where(eq(coursePaths.shopId, shopId));
  await db.delete(courseInquiries).where(eq(courseInquiries.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  await db.delete(certifications).where(eq(certifications.shopId, shopId));
  await db.delete(specialtyCertifications).where(eq(specialtyCertifications.shopId, shopId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.shopId, shopId));

  // Everyone except the four staff seeded once at shop creation (seedDemo's
  // and createDemoShop's own `staffDefs`, by full name since canonical and
  // minted shops give them different emails) — seeded customers, booking-flow
  // walk-ups, and any staff invited or promoted mid-test. Checking `STAFF_ROLES`
  // alone isn't enough: e2e/staff-invite.spec.ts invites and accepts a new
  // instructor, which makes them a real staff-role person indistinguishable
  // from the seeded four by role — so without the name check, that invited
  // person became permanently "stable" and leaked into every later spec
  // sharing this worker (a "Priya Nair" row on the settings/team screenshot
  // whose invite email embeds the wall-clock millisecond it was created,
  // never matching twice — this was the flakiest screenshot in the visual
  // suite, stability 0.07).
  const STABLE_STAFF_NAMES = new Set(["Dana Reyes", "Marcus Webb", "Keiko Tanaka", "Sal Moretti"]);
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

  await seedDemoSchedule(db, shopId, { history: opts.history === true });
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
