import { hash } from "bcryptjs";
import { and, eq, inArray, isNotNull, isNull, notInArray, or } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { reusablePurposes } from "@/lib/capabilities";
import { nowDate } from "@/lib/clock";
import { crewPublicNameToStore } from "@/lib/crew-public-name";
import { shopDefaults } from "@/lib/curated-defaults";
import { generateDemoShopIdentity, pinnedDemoShopIdentity } from "@/lib/demo-identity";
import { demoEmail } from "@/lib/simulator-email";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";
import type { DbExecutor } from "./client";
import { DEMO_SHOP_SLUG } from "./demo-shop";
import { deleteHeldSendsAndDeskRows } from "./departure-notes";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { deleteDemoSafetyTrail } from "./incident-reports";
import { isUniqueConstraintViolation } from "./query-helpers";
import {
  accountSecurity,
  accountSessions,
  accountStepUps,
  activityEvents,
  authProviderAccounts,
  authVerifications,
  boatSnags,
  boats,
  bookingArrivalEvents,
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingReferrals,
  bookings,
  buddyTeamEvents,
  buddyTeamMembers,
  capabilities,
  cards,
  courseFormRecords,
  courseFormRequirements,
  courseForms,
  courseFormVersions,
  courses,
  crewAssignmentRequests,
  crewAvailabilityBlocks,
  customerGearItems,
  deals,
  departureBoatSafetySnapshots,
  divePackageEntitlements,
  diveSiteCreatures,
  diveSites,
  executedDives,
  formDrafts,
  gearItems,
  gearReservations,
  gearServiceEvents,
  importedPaymentHistory,
  inboundMessages,
  integrationDeliveries,
  integrationEvents,
  integrationOauthStates,
  interests,
  internalNotes,
  marineLifeRequests,
  mediaDeletionAttempts,
  notificationDeliveries,
  notificationSendQueue,
  orderLineItems,
  orders,
  paymentDisputes,
  paymentOperationIntents,
  people,
  personRoles,
  platformBackupProgress,
  preDepartureCheckEvents,
  priorGearAssignments,
  priorVisits,
  processorErasureObligations,
  recapPhotos,
  recapPulses,
  rentalFitProfiles,
  reviewModerationEvents,
  reviewReplies,
  safetyDrillParticipants,
  safetyDrills,
  shopBackupDeliveryClaims,
  shopStripeAccounts,
  shops,
  shopTextTranslations,
  staffCredentials,
  staffReplies,
  staffShifts,
  stripePayouts,
  stripeRefundFailures,
  todayReadMarks,
  tripAssignments,
  tripBlowoutDivers,
  tripBlowouts,
  tripChangeEvents,
  tripConservation,
  tripDives,
  tripHelpRequests,
  tripRecapPhotos,
  tripRequirements,
  tripReviews,
  tripSeries,
  tripSeriesCrew,
  tripSeriesSkips,
  tripSightings,
  tripStageEvents,
  trips,
  userAccounts,
  waiverDeliveries,
  waiverDrafts,
  waiverMaterialityDecisions,
  waiverRecords,
  waiverSealAcknowledgements,
  waiverTemplates,
  workOrderCare,
  workOrderEvents,
  workOrderItems,
  workOrderLines,
  workOrders,
} from "./schema";
import { seedBackup } from "./seed-backup";
import { AT_SEA_CREW } from "./seed-boat-at-sea";
import { staffDefs } from "./seed-cast";
import { DEMO_SHOP_TIMEZONE, dateAt, demoTodayShifts } from "./seed-clock";
import { enforceMintedDemoCap } from "./seed-demo-lifecycle";
import { MINTED_DEMO_BRAND_COLOR } from "./seed-identifiers";
import { seedListedShops } from "./seed-listed-shops";
import { seedPackages } from "./seed-packages";
import { seedPreDepartureChecklist } from "./seed-pre-departure-checklist";
import { type SeedShape, seedDemoSchedule, shapeHas } from "./seed-schedule";
import { DEMO_SHOP_BRAND } from "./seed-shop-brand";
import { syncDemoStripeAccount } from "./stripe-accounts";

const DEMO_BOAT_CAPACITIES = {
  "Mantis I": 17,
  "Mantis II": 20,
} as const;

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * The seeded Blue Mantis shop backs the customer-facing demo experience in
 * every environment (docs ADR 20260718-production-demo-seed).
 *
 * **The order the scenarios run in is the data.** This file seeds the stable
 * half (shop, staff, logins); the resettable day is `./seed-schedule.ts`, which
 * builds one typed context (the board) and then runs `THE_DAY`, an ordered list
 * of steps each in the `demo` or the `history` set. Several read rows an
 * earlier one inserted (the roster indexes into `customerDefs`, the trips index
 * into the sites, the payments index into the bookings). Reordering them, or
 * moving work between them, changes what the demo shop contains — and the e2e
 * fleet's visual baselines are pixel-keyed to it. Add a scenario as a new
 * `seed-*.ts` module and one entry in `THE_DAY`, never by wedging rows into an
 * existing one (ADR 20261104-seed-is-one-context-and-named-sets).
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
 * | `./seed-course-inquiries.ts` | date interests for courses off the public pages, in all three `person_id` states |
 * | `./seed-course-materials.ts` | the links behind two courses' learning materials, and one student marked done |
 * | `./seed-front-desk.ts` | the desk's own day: walk-ins, wait lists, inquiries, tips |
 * | `./seed-course-photos.ts` | a species photo of its own on every course, so the storefront reads as a shop and not a template |
 * | `./seed-packages.ts` | two dive packages on sale, so the public Packages tab and price list have something to show |
 * | `./seed-history.ts` | the trailing quarter that gives owner reporting something to report |
 * | `./seed-cert-gates.ts` | the boats a card can be refused on, one gate each, and the course carve-out |
 * | `./seed-buddy-teams.ts` | two buddy teams on today's reef boat, plus the odd-roster remainder; the dawn boat's divers paired at the dock |
 * | `./seed-demo-lifecycle.ts` | minting, reaping, and capping throwaway demo shops |
 * | `./seed-backup.ts` | the shop-owned backup destination and its weekly delivery history |
 * | `./seed-orders.ts` | the billing states past "paid": open, part-paid, refunded, void, written off |
 * | `./seed-desk-trail.ts` | the notes and activity behind today's reef boat, so its Guests tab has a history |
 * | `./seed-desk-handoff.ts` | the morning's desk acts on that same boat, the owner's read mark behind them, and the two divers who said the crew may know it is their first trip |
 * | `./seed-sightings.ts` | a month of the crew's sighting log on Molasses and French, so "Seen here this month" is a real beat on the demo's trip pages |
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
 * `./seed-recent-recaps.ts` is deliberately **not** in this table, though
 * `THE_DAY` calls it in the `history` set. It is a keeper, run by the daily
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
 * **The demo's units follow its country**, by the one rule every shop starts
 * on (`shopDefaults`): Blue Mantis is in Key Largo, so depths read in feet,
 * the water in Fahrenheit and prices in dollars. It used to seed metres and
 * Celsius, so a Florida diver read "6–12 m" and "27°C" (UX review 2026-10-10,
 * item 5). Shared by the canonical shop, a minted one, and the reset that
 * puts back what a spec flipped.
 */
const DEMO_SHOP_UNITS = shopDefaults({ country: "US", timeZone: DEMO_SHOP_TIMEZONE });
/** The two unit columns alone, for the reset that puts them back. */
const DEMO_SHOP_UNIT_COLUMNS = {
  depthUnit: DEMO_SHOP_UNITS.depthUnit,
  temperatureUnit: DEMO_SHOP_UNITS.temperatureUnit,
};

/**
 * The shifts every member of the demo cast works today (`demoTodayShifts`:
 * around today's departure, on its own local day), so the rostering surface
 * (`/shop/<slug>/staffing`) has a day to show.
 *
 * Shared by all three places staff arrive in a demo shop — the canonical seed,
 * a shop minted by "Try the live demo", and `restoreMissingStableStaff`'s
 * repair — because a shop that has a cast and no shifts renders an empty
 * roster, which is what a minted demo did until 2026-08-15. Part of the
 * **stable** half: a schedule reset never re-seeds these, so a person who
 * already has one keeps it.
 */
async function seedStaffShifts(
  db: DbExecutor,
  shopId: string,
  cast: { id: string; fullName: string; roles: readonly string[] }[],
  { boatAtSea }: { boatAtSea: boolean },
): Promise<void> {
  if (cast.length === 0) return;
  const now = nowDate();
  await db.insert(staffShifts).values(
    cast.flatMap((person) =>
      // The boats' crew (`DEMO_DAWN_CREW_ROLES`) are on from 4:30 too; the boat
      // at sea's crew (`AT_SEA_CREW`) work her hours, when the demo has her.
      demoTodayShifts(now, DEMO_SHOP_TIMEZONE, {
        crew: person.roles.some((role) => DEMO_DAWN_CREW_ROLES.has(role)),
        atSea: boatAtSea && AT_SEA_CREW.some((member) => member.fullName === person.fullName),
      }).map(({ startsAt, endsAt }) => ({
        shopId,
        personId: person.id,
        startsAt,
        endsAt,
        // No note: a seed label ("Demo schedule") on every chip of the Crew
        // view read as a test fixture, not a shop (UX audit 2026-10-07, item 34).
        note: null,
        createdByPersonId: person.id,
      })),
    ),
  );
}

/**
 * Who crews the first-light boat (`seed-more-trips.ts` puts the shop's captain,
 * divemaster and assistant instructor on every charter it seeds), and so whose
 * day starts at 4:30 rather than an hour before today's departure.
 */
const DEMO_DAWN_CREW_ROLES: ReadonlySet<string> = new Set([
  "captain",
  "divemaster",
  "assistant_instructor",
]);

export async function seedIfEmpty(db: DbExecutor): Promise<void> {
  const existing = await db.select({ id: shops.id }).from(shops).limit(1);
  if (existing.length > 0) return;
  await seedDemo(db, "history");
}

/**
 * The demo's dusk boat, by title and clock, for the close-out's carry-over read
 * (`src/features/today/closeout-reader.ts`), which lives outside `src/db`.
 */
export { DEMO_SHOP_TIMEZONE, demoFinishedDuskDeparture } from "./seed-clock";
/**
 * The colour a branded minted shop wears: mantis green, chosen because it is
 * not the product's teal and dark enough for white text as typed. Exported for
 * `e2e/storefront-brand.spec.ts`, which proves the storefront wears it.
 */
export { AT_SEA_DUSK_TITLE, MINTED_DEMO_BRAND_COLOR } from "./seed-identifiers";
export { DEMO_SHOP_BRAND } from "./seed-shop-brand";

/**
 * **The brand a minted shop wears when a visual capture or a brand spec asks
 * for one**: Blue Mantis's profile, in a different colour, face and logo, so
 * the brand spec proves the storefront follows the shop's own choices rather
 * than the canonical demo's. Left off, a minted shop is blank shop-wide config,
 * which is what every behavioural spec expects.
 *
 * The logo is a bundled frame, as the cover photo is, because the fleet
 * configures no media storage, so an upload through the form is refused. A
 * different frame from the cover and from every seeded site's lead photo, so
 * the tile reads as its own picture (`seed-brand-photos.test.ts` holds it).
 */
export const MINTED_DEMO_BRAND: Partial<typeof shops.$inferInsert> = {
  ...DEMO_SHOP_BRAND,
  brandColor: MINTED_DEMO_BRAND_COLOR,
  brandDisplayFont: "bricolage_grotesque",
  logoUrl: `/dive-sites/${encodeURIComponent("Sand Key Light 2005.jpg")}`,
};

/**
 * The stable half of the demo: the shop, its default waiver template, its
 * staff, and their logins. Seeded once and left alone — resetting the demo
 * playground never touches these, so a signed-in demo session survives a reset
 * (docs ADR 20260718-demo-mode).
 */
/** Seed the canonical demo in a named shape (`SEED_SHAPES`). */
export async function seedDemo(db: DbExecutor, shape: SeedShape): Promise<void> {
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Blue Mantis Divers",
      slug: DEMO_SHOP_SLUG,
      ...DEMO_SHOP_BRAND,
      timezone: DEMO_SHOP_TIMEZONE,
      ...DEMO_SHOP_UNITS,
      // **Blue Mantis finished its own onboarding**, like the trading shop it
      // is meant to portray. Without this the queue asks it which currency it
      // works in on every screenshot ever taken of Today, which is the same
      // "a demo shouting about its own broken setup is a worse demo" the
      // trouble-state facts already avoid (issue #835).
      unitsConfirmedAt: nowDate(),
      // Its desk hours are its own, saved (the default 08:00 to 18:00), so the
      // storefront footer prints them. Every switch on the Features page
      // ("Our year", the crew schedule, the PADI checks, recap highlights
      // without a tap, hotel pickups from the Key Largo resorts) starts on for
      // every shop since 2026-10-23, so the demo photographs and exercises all
      // of them without naming one here.
      deskHoursConfirmedAt: nowDate(),
      // The desk takes cards and cash, and every "due at the shop" says so
      // (fifth-loop ideas, item 21); a new shop says nothing until it chooses.
      deskPayment: "card_and_cash",
      // A front-desk address, not a person's — this is printed on the public
      // course pages, where it backs the "Get in touch" composer.
      contactEmail: demoEmail("front.desk"),
      // The demo shop's front desk is confirmed: it is the state a real shop
      // reaches after opening the link (issue #1288), and the one the settings
      // capture should show.
      contactEmailConfirmedAt: new Date("2026-07-01T12:00:00.000Z"),
      contactPhone: "+1 305 555 0142",
      // The numbers a divemaster needs with a diver on the deck and no signal.
      // Seeded because the offline manifest renders them, so an unseeded shop
      // would photograph its own empty state on every capture of that page.
      emergencyReference: {
        lines: [
          // i18n-exempt: a shop types its own labels here, like its packing list.
          { label: "Recompression chamber", phone: "+1 305 555 0177" },
          // i18n-exempt: the shop's own words, not DiveDay's.
          { label: "Coast Guard (Sector Key West)", phone: "+1 305 555 0188" },
          // i18n-exempt: the shop's own words, not DiveDay's.
          { label: "DAN emergency hotline", phone: "+1 919 555 0111" },
        ],
        // Only the fallback now (fourth review, item 11): a departure on a
        // boat prints that boat's own name, call sign and MMSI, seeded below.
        vessel: "Both boats keep VHF 16",
        shoreContact: "Front desk, +1 305 555 0142",
        plan: "Give O2, call the chamber first, then the Coast Guard on 16.",
      },
      // **The canonical demo collects sales tax.** Every other shop starts with
      // this off (the column's default, and what a minted demo keeps) — but the
      // demo is a shop that has been running for a quarter, and its own report
      // has a "Tax collected" tile that would otherwise be a permanent $0.00.
      // Its seeded invoices carry the matching `tax_cents` (seed-history.ts).
      //
      // Turning it on is what makes the staff invoice form ask for a customer
      // billing address, so `orders?add=1` prefills the demo's own address for
      // it — see that page. `e2e/tax.spec.ts` drives freshly minted shops
      // precisely so it never depends on this one's setting, and the "a shop
      // starts with tax off" case still has a fixture: a minted demo.
      taxEnabled: true,
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
      // Rents the core kit plus the GoPro and fills nitrox, and prices them:
      // a full set is cheaper than the pieces, each piece has its own price, and
      // nitrox is a per-dive surcharge. Divers see these when they set their
      // rental fit. Most real shops leave nitrox unticked (default off) — the
      // demo shop opts in so the flow has something to demonstrate.
      rentalItems: [
        "bcd",
        "regulator",
        "wetsuit",
        "mask",
        "fins",
        "weights",
        "dive_computer",
        "gopro",
        // No drysuit on the demo's list (Aaron, 2026-10-03): it is an add-on a
        // shop ticks for itself, and new shops start without it too.
        "nitrox",
      ],
      rentalPricing: {
        setCents: 4500,
        perItemCents: {
          bcd: 1500,
          regulator: 1500,
          wetsuit: 1200,
          mask: 400,
          fins: 400,
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
    {
      shopId: shop.id,
      name: "Mantis I",
      capacity: DEMO_BOAT_CAPACITIES["Mantis I"],
      description:
        "The small boat — fourteen passenger places, plus room aboard for its three-person crew.",
      // Each hull's radio identity, printed on its departures' emergency card
      // (fourth review, item 11). Fictional, in the US MMSI range.
      callSign: "WDM2201",
      mmsi: "338055502",
    },
    {
      shopId: shop.id,
      name: "Mantis II",
      capacity: DEMO_BOAT_CAPACITIES["Mantis II"],
      description: "The big boat: camera table, warm freshwater showers and a ladder on each side.",
      callSign: "WDM2202",
      mmsi: "338055501",
      workingChannel: "VHF 68",
      // The big boat carries its papers (issue #3650), so the finished dawn departure's
      // safety snapshot copies real boat data. Every date sits past its paper's horizon
      // (`BOAT_PAPER_HORIZON_DAYS`: 90 days for the certificate and inspection, 60 for
      // registration and insurance), so none raises an errand on Today or a manifest line.
      // Mantis I carries none, as before. Fictional.
      certifiedPassengers: DEMO_BOAT_CAPACITIES["Mantis II"],
      certifiedTotalPersons: DEMO_BOAT_CAPACITIES["Mantis II"] + 3,
      coiExpiresOn: dateAt(730),
      inspectionDueOn: dateAt(240),
      registrationExpiresOn: dateAt(300),
      insuranceExpiresOn: dateAt(200),
    },
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
        // Their own answer about being named to divers (issue #1181, D21).
        // Two of the six, so the demo shows a shop where some people said yes
        // and some did not. Languages are deliberately not seeded beside it --
        // see `staffDefs`.
        crewPublicConsentAt: s.namedToDivers ? nowDate() : null,
        // Paired with the stamp by a check constraint, and by the same rule a
        // person's own consent form follows: the name divers see is stored, not
        // derived at render time (issue #1351). The demo cast is all
        // given-name-first, so the default is what they would have kept.
        crewPublicName: s.namedToDivers ? crewPublicNameToStore(null, s.fullName) : null,
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
    staff.map((person, i) => ({
      id: person.id,
      fullName: staffDefs[i].fullName,
      roles: staffDefs[i].roles,
    })),
    { boatAtSea: shapeHas(shape, "history") },
  );
  // The shop's own checklist items are settings, not schedule (ADR
  // 20260824-pre-departure-safety-check): seeded once here, never re-seeded by
  // a reset, which is why it is not inside seedDemoSchedule. Before it, so the
  // finished dawn boat can record its check against them (UX review
  // 2026-10-13, item 40).
  await seedPreDepartureChecklist(db, shop.id);
  // Stable half: packages are shop configuration a reset leaves standing.
  // Before the schedule, whose regular holds a card from one of them
  // (src/db/seed-booth.ts).
  await seedPackages(db, shop.id);
  await seedDemoSchedule(db, shop.id, shape);
  // Pay-at-booking in Stripe test mode, when configured (ADR
  // 20261009-demo-test-mode-payments); nothing otherwise.
  await syncDemoStripeAccount(db, shop.id);

  // Stable half, like staff and their shifts: a backup destination is a
  // settings row a demo visitor cannot break, so it lives outside the
  // resettable schedule (ADR 20260804-shop-owned-backup-export).
  await seedBackup(db, shop.id);
  // Two listed shops beside a demo no listing may show. Stable half: real
  // rows a reset never touches.
  await seedListedShops(db);
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
 * bypass token (src/db/credentials.ts), so no real password is minted or stored.
 *
 * Demo names carry no random suffix any more (src/lib/demo-identity.ts): the
 * visitor sees a slug and a sign-in address a real shop could have. That trades
 * an astronomically-unlikely collision for a merely-rare one, so
 * `insertDemoShop` below retries on the unique violation instead of assuming it
 * away.
 */

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
async function insertDemoShop(db: DbExecutor, pinnedSlug?: string, brand = false, isDemo = true) {
  let lastError: unknown;
  for (let attempt = 0; attempt < DEMO_IDENTITY_ATTEMPTS; attempt += 1) {
    // A pinned identity has nothing to retry *to* — it is the caller's own
    // name, and colliding with it means the previous test's shop is still
    // there, which is a fixture bug to surface rather than rename around.
    const identity = pinnedSlug ? pinnedDemoShopIdentity(pinnedSlug) : generateDemoShopIdentity();
    try {
      const [shop] = await db
        .insert(shops)
        .values({
          name: identity.name,
          slug: identity.slug,
          timezone: DEMO_SHOP_TIMEZONE,
          ...DEMO_SHOP_UNITS,
          // **Deliberately left unconfirmed**, unlike the canonical demo above.
          // A minted shop genuinely has not answered the units question, and
          // pre-answering it on the shop's behalf would make the one fixture
          // that can honestly show that state unable to (issue #835). The
          // visual capture of the queue's units row takes a minted shop for
          // exactly this reason.
          // Left unconfirmed, like the units above and for the same reason: a
          // shop that has just typed its front-desk address genuinely has not
          // proved it reads it, and this is the fixture that can honestly show
          // that state (issue #1288).
          contactEmail: identity.emailFor("hello"),
          contactEmailConfirmedAt: new Date("2026-07-01T12:00:00.000Z"),
          contactPhone: "+1 305 555 0142",
          // The canonical demo's own address, and for the canonical demo's own
          // reason: a real street exercises the address end to end (structured
          // data, the settings form, the site catalog's distance sort) without
          // publishing anything a search engine could act on for a fixture.
          //
          // A minted shop used to have none, which is not the same kind of gap
          // as the unconfirmed units above. Units are a *question the shop has
          // not answered yet*, and the setup queue exists to ask it. An absent
          // address is a **wall**: `dive-sites?view=catalog` cannot sort
          // DiveDay's published sites by distance from nowhere, so it renders
          // "Shop location required" instead of the catalog — and every visitor
          // who minted a demo to look around hit that instead of the feature.
          // It is also the shop's own detail rather than the demo data's, so
          // `/api/test/reset` leaves it alone (`RESET_KEEPS`).
          //
          // Key Largo, not the shop's timezone guessed into a city: minting
          // writes a shop the seed already knows everything about, which is the
          // opposite of the case `shops.address_street`'s comment protects —
          // a *real* shop still fills its own address in and never has one
          // guessed on its behalf.
          addressStreet: "100 Ocean Drive",
          addressLocality: "Key Largo",
          addressRegion: "FL",
          addressPostalCode: "33037",
          addressCountry: "US",
          latitude: 25.0865,
          longitude: -80.4473,
          rentalItems: [
            "bcd",
            "regulator",
            "wetsuit",
            "mask",
            "fins",
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
              mask: 400,
              fins: 400,
              weights: 500,
              dive_computer: 1000,
              gopro: 2000,
            },
            nitroxCents: 1200,
          },
          isDemo,
          hasShoreDiving: true,
          hasPoolDiving: true,
          ...(brand ? MINTED_DEMO_BRAND : {}),
        })
        .returning();
      if (!shop) throw new Error("createDemoShop: failed to insert shop");
      return { shop, identity };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
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
  /**
   * `brand` dresses the shop in `MINTED_DEMO_BRAND` (a logo, a cover photo,
   * badges, a colour and a display face), for the profile row's capture and
   * the storefront brand spec.
   * Left off, a minted shop is blank shop-wide config, as every behavioural
   * spec expects.
   *
   * `demo: false` mints a real-shaped shop (issue #2783) for the e2e harness, so the first-run
   * checklist, trial row and payments row render. Only `fixtureSignIn` lets its staff in.
   */
  opts: { shape?: SeedShape; slug?: string; brand?: boolean; demo?: boolean } = {},
): Promise<{ slug: string; ownerEmail: string }> {
  const shape = opts.shape ?? "history";
  // Aggregate storage cap (security review, finding 1): the per-IP rate limit
  // bounds one visitor's burst but not the fleet-wide total, so an IP-rotating
  // attacker could pile up minted shops between 7-day reaper passes. Before
  // minting, evict the oldest minted demos so the live count never exceeds the
  // ceiling — the canonical demo and real shops are never eligible (see below).
  await enforceMintedDemoCap(db);

  const { shop, identity } = await insertDemoShop(db, opts.slug, opts.brand, opts.demo !== false);

  await db.insert(boats).values([
    {
      shopId: shop.id,
      name: "Mantis I",
      capacity: DEMO_BOAT_CAPACITIES["Mantis I"],
      description:
        "The small boat — fourteen passenger places, plus room aboard for its three-person crew.",
      // Each hull's radio identity, printed on its departures' emergency card
      // (fourth review, item 11). Fictional, in the US MMSI range.
      callSign: "WDM2201",
      mmsi: "338055502",
    },
    {
      shopId: shop.id,
      name: "Mantis II",
      capacity: DEMO_BOAT_CAPACITIES["Mantis II"],
      description: "The big boat: camera table, warm freshwater showers and a ladder on each side.",
      callSign: "WDM2202",
      mmsi: "338055501",
      workingChannel: "VHF 68",
      // The big boat carries its papers (issue #3650), so the finished dawn departure's
      // safety snapshot copies real boat data. Every date sits past its paper's horizon
      // (`BOAT_PAPER_HORIZON_DAYS`: 90 days for the certificate and inspection, 60 for
      // registration and insurance), so none raises an errand on Today or a manifest line.
      // Mantis I carries none, as before. Fictional.
      certifiedPassengers: DEMO_BOAT_CAPACITIES["Mantis II"],
      certifiedTotalPersons: DEMO_BOAT_CAPACITIES["Mantis II"] + 3,
      coiExpiresOn: dateAt(730),
      inspectionDueOn: dateAt(240),
      registrationExpiresOn: dateAt(300),
      insuranceExpiresOn: dateAt(200),
    },
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
        // **Deliberately not `languages` or `namedToDivers` here.** A minted
        // shop is a fresh tenant for tests that need blank shop-wide config
        // (ADR 20260815-per-test-private-shops) — `crew-languages.spec.ts`'s
        // second case is literally "a shop with no recorded languages shows no
        // line at all". The demo shop above carries the cast's languages and
        // consents; this path carries the people and nothing they configured.
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
    staff.map((person, i) => ({
      id: person.id,
      fullName: staffDefs[i].fullName,
      roles: staffDefs[i].roles,
    })),
    { boatAtSea: shapeHas(shape, "history") },
  );
  // A visitor's demo should carry the same owner-facing story as the
  // canonical demo, including sailed trips, tips, and reviews. Test-only
  // private shops can opt into the lean schedule when they need isolation
  // from history-only rows.
  // The same checklist the canonical demo keeps, for the same reason and in
  // the same place: before the schedule, whose dawn boat records against it.
  await seedPreDepartureChecklist(db, shop.id);
  // The canonical demo's two packages, for a visitor's demo too, before the
  // schedule whose regular holds a card. A private test shop mints `lean`
  // and starts with nothing on sale, which is the state
  // `e2e/package-purchase.spec.ts` begins from.
  if (shapeHas(shape, "history")) await seedPackages(db, shop.id);
  await seedDemoSchedule(db, shop.id, shape);

  return { slug: shop.slug, ownerEmail: identity.emailFor("dana") };
}

/**
 * A card dispute (ADR 20261009-stripe-reversals-reach-diveday) and a failed
 * refund (issue #2291) each name the order or checkout they are about, and a
 * failed refund its seat, so both go before those.
 */
async function deleteStripeReversals(db: DbExecutor, shopId: string): Promise<void> {
  await db.delete(paymentDisputes).where(eq(paymentDisputes.shopId, shopId));
  await db.delete(stripeRefundFailures).where(eq(stripeRefundFailures.shopId, shopId));
  // A payout names no order or seat (ADR 20261012-payouts-reach-diveday); it
  // goes with the money it reported.
  await db.delete(stripePayouts).where(eq(stripePayouts.shopId, shopId));
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
 *
 * Two halves: {@link clearDemoSchedule} takes the shop down to what a reset
 * keeps, and {@link reseedClearedDemoSchedule} writes the seeded schedule back.
 * The e2e reset replays the second half from a copy instead of re-running it
 * (`src/db/demo-reset-snapshot.ts`); this function, which the in-app "reset demo
 * shop" action calls against real Postgres, always runs both.
 */
export async function resetDemoSchedule(
  db: DbExecutor,
  shopId: string,
  shape: SeedShape,
): Promise<void> {
  const cleared = await clearDemoSchedule(db, shopId);
  await reseedClearedDemoSchedule(db, shopId, cleared, shape);
}

/** What {@link clearDemoSchedule} read before it deleted, for the re-seed to put back. */
export type ClearedDemoSchedule = { waiverTitle: string };

/**
 * The delete half of {@link resetDemoSchedule}: every reset-owned row goes, and
 * the shop's kept rows are put back to their seeded values where a reset
 * restores them (boat paper dates, the shop's unit and alert columns).
 *
 * **It writes no reset-owned row.** Every insert lives in
 * {@link reseedClearedDemoSchedule}, so "the rows a reset owns" is exactly "the
 * rows this deletes", which is what lets the e2e snapshot capture them by
 * difference. The one insert left here is `restoreMissingStableStaff`, which
 * repairs the *kept* cast and writes nothing on a shop that has not drifted;
 * the snapshot's capture refuses a clear that inserted anything.
 */
export async function clearDemoSchedule(
  db: DbExecutor,
  shopId: string,
): Promise<ClearedDemoSchedule> {
  // The demo shop is excluded from platform backup, but clear its scheduler
  // checkpoint with the rest of its resettable state if a local run wrote one.
  await db.delete(platformBackupProgress).where(eq(platformBackupProgress.shopId, shopId));
  await db.delete(shopBackupDeliveryClaims).where(eq(shopBackupDeliveryClaims.shopId, shopId));
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);

  // Booking- and trip-dependent operational history first. Delete order is a
  // topological sort of the foreign-key graph: every table that references
  // bookings, trips, or people must be cleared before those parents. A missing
  // child here surfaces as an FK-violation mid-run — e.g. a waitlist entry or
  // order left behind blocks the trips/bookings delete and dirties the next
  // test's fixture (regression tests live in seed.test.ts).
  // The counter's own trail, beside roll call's and for the same reason: it is
  // per-departure operational history keyed on bookings that are about to go,
  // and a spec that checked somebody in would otherwise leave that arrival
  // standing for the next one (ADR 20260907-the-counter-survives-offline).
  // Today read marks are schedule history, not stable staff configuration. Their
  // acknowledgement links cascade before the departures they reference go away.
  await db.delete(todayReadMarks).where(eq(todayReadMarks.shopId, shopId));
  await db.delete(bookingArrivalEvents).where(eq(bookingArrivalEvents.shopId, shopId));
  await deleteDemoSafetyTrail(db, shopId);
  await db.delete(executedDives).where(eq(executedDives.shopId, shopId));
  // The crew's own tally of what the day saw, beside the dive log it sits under
  // on the manifest — per-departure history keyed on trips that are about to
  // go, so a spec that tapped a chip does not leave it standing for the next.
  await db.delete(tripConservation).where(eq(tripConservation.shopId, shopId));
  await db.delete(tripSightings).where(eq(tripSightings.shopId, shopId));
  // These records can contain order/customer payloads and point at schedule
  // data that is about to be replaced, so they must not survive a demo reset.
  // Keep the provider connections themselves: they are shop settings, not
  // part of the seeded schedule.
  await db.delete(integrationDeliveries).where(eq(integrationDeliveries.shopId, shopId));
  await db.delete(integrationEvents).where(eq(integrationEvents.shopId, shopId));
  await db.delete(integrationOauthStates).where(eq(integrationOauthStates.shopId, shopId));
  // The shop's own checklist *items* are settings, not schedule — kept, like
  // boats and dive_packages below (RESET_KEEPS). Only the per-departure taps
  // against them are schedule-scoped operational history.
  // Snags name the departures they were written and answered on.
  await db.delete(boatSnags).where(eq(boatSnags.shopId, shopId));
  await db.delete(preDepartureCheckEvents).where(eq(preDepartureCheckEvents.shopId, shopId));
  await db
    .delete(departureBoatSafetySnapshots)
    .where(eq(departureBoatSafetySnapshots.shopId, shopId));
  await db.delete(tripStageEvents).where(eq(tripStageEvents.shopId, shopId));
  await db.delete(safetyDrillParticipants).where(eq(safetyDrillParticipants.shopId, shopId));
  await db.delete(safetyDrills).where(eq(safetyDrills.shopId, shopId));
  await deleteHeldSendsAndDeskRows(db, shopId);
  await db.delete(formDrafts).where(eq(formDrafts.shopId, shopId));
  // Neither of these is seeded — both are written only by what a visitor does
  // (a staff note on a diver, the activity trail `seat-diver.ts` appends), and
  // both reference `people` without cascade. So a demo where anyone used the
  // Guests tab or left a note handed the people purge below a 23503 to trip
  // over. Shop-wide, because there is no seeded row here to preserve.
  await db.delete(internalNotes).where(eq(internalNotes.shopId, shopId));
  await db.delete(activityEvents).where(eq(activityEvents.shopId, shopId));
  // The staffing week's two crew-authored tables, both keyed on people and on
  // trips that are about to go. Reset-owned rather than settings: a blackout is
  // a fact about one week, and both are surfaces a spec writes to — leaving
  // either standing would leak one worker's "away" or one worker's ask into the
  // next test's board (`seedCrewAway` re-seeds the demo's own blackout).
  await db.delete(crewAssignmentRequests).where(eq(crewAssignmentRequests.shopId, shopId));
  await db.delete(crewAvailabilityBlocks).where(eq(crewAvailabilityBlocks.shopId, shopId));
  await db.delete(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId));
  // The bench, children first: lines, pieces, the Work done record and the
  // status trail reference the ticket, and a ticket references a customer, a
  // fleet unit, and the technician working it — so all of it clears before
  // gear_items, bookings and the people purge (ADR 20261008-gear-work-orders).
  await db.delete(workOrderLines).where(eq(workOrderLines.shopId, shopId));
  await db.delete(workOrderCare).where(eq(workOrderCare.shopId, shopId));
  await db.delete(workOrderItems).where(eq(workOrderItems.shopId, shopId));
  await db.delete(workOrderEvents).where(eq(workOrderEvents.shopId, shopId));
  await db.delete(workOrders).where(eq(workOrders.shopId, shopId));
  await db.delete(customerGearItems).where(eq(customerGearItems.shopId, shopId));
  // The gear register, children first: reservations reference gear_items and
  // bookings, service events reference gear_items and people (their recording
  // staffer) — so all three clear before bookings and the people purge below.
  // The whole fleet is reset-owned and re-seeded (seed-gear.ts), so a spec may
  // add, retire, or reserve units freely and the next test starts clean.
  await db.delete(gearReservations).where(eq(gearReservations.shopId, shopId));
  await db.delete(gearServiceEvents).where(eq(gearServiceEvents.shopId, shopId));
  await db.delete(priorGearAssignments).where(eq(priorGearAssignments.shopId, shopId));
  await db.delete(gearItems).where(eq(gearItems.shopId, shopId));
  // A trouble-state capture can lower a boat's raw capacity as well as change
  // its papers. Restore the seeded hull limits so one capture's over-capacity
  // example cannot close the next test's boat.
  for (const [name, capacity] of Object.entries(DEMO_BOAT_CAPACITIES)) {
    await db
      .update(boats)
      .set({ capacity })
      .where(and(eq(boats.shopId, shopId), eq(boats.name, name)));
  }
  // The demo seeds no certificate or paper dates. Reset them too, so one
  // capture's lapse cannot stand on the next test's manifest.
  await db
    .update(boats)
    .set({
      certifiedPassengers: null,
      certifiedTotalPersons: null,
      coiExpiresOn: null,
      inspectionDueOn: null,
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
    })
    .where(eq(boats.shopId, shopId));
  // References people, so it clears before them like any other people-scoped row.
  await db.delete(priorVisits).where(eq(priorVisits.shopId, shopId));
  await db.delete(importedPaymentHistory).where(eq(importedPaymentHistory.shopId, shopId));
  // Course forms (ADR 20261008-course-forms), children first: a signed record
  // references the booking, the person and the version; a requirement the
  // course and the form; a version the form and its author. The demo seeds
  // none, so a form a spec or a visitor wrote must not outlive the reset.
  await db.delete(courseFormRecords).where(eq(courseFormRecords.shopId, shopId));
  await db.delete(courseFormRequirements).where(eq(courseFormRequirements.shopId, shopId));
  await db.delete(courseFormVersions).where(eq(courseFormVersions.shopId, shopId));
  await db.delete(courseForms).where(eq(courseForms.shopId, shopId));
  // Per-channel delivery state hangs off the waiver record, so it goes first.
  await db.delete(waiverDeliveries).where(eq(waiverDeliveries.shopId, shopId));
  // So does an acknowledgement of a broken seal (#3891).
  await db.delete(waiverSealAcknowledgements).where(eq(waiverSealAcknowledgements.shopId, shopId));
  await db.delete(waiverDrafts).where(eq(waiverDrafts.shopId, shopId));
  await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shopId));
  // Readiness/confirm capabilities reference bookings, so they must go before them.
  await db.delete(bookingCapabilities).where(eq(bookingCapabilities.shopId, shopId));
  // The buddy referral references bookings (ADR 20260908-one-hand, decision 6,
  // lever W) — two of them, and neither is deleted first — so it goes before them.
  await db.delete(bookingReferrals).where(eq(bookingReferrals.shopId, shopId));
  await db.delete(notificationSendQueue).where(eq(notificationSendQueue.shopId, shopId));
  await db.delete(notificationDeliveries).where(eq(notificationDeliveries.shopId, shopId));
  // Recap photos reference bookings and trips, so they must go before both.
  await db.delete(recapPhotos).where(eq(recapPhotos.shopId, shopId));
  // The shared close-out photo album also references its trip and uploader.
  await db.delete(tripRecapPhotos).where(eq(tripRecapPhotos.shopId, shopId));
  // Both name their review, so go first (ADR 20260813-review-moderation-has-a-floor).
  await db.delete(reviewReplies).where(eq(reviewReplies.shopId, shopId));
  await db.delete(reviewModerationEvents).where(eq(reviewModerationEvents.shopId, shopId));
  // Reviews reference bookings, trips, and people — all three parents below.
  await db.delete(tripReviews).where(eq(tripReviews.shopId, shopId));
  // The pulse is the review's private sibling and hangs off the same three
  // parents, plus the staffer who addressed it (ADR
  // 20260904-reef-all-the-way-down, D40) — so it clears here for the same
  // reason and at the same point.
  await db.delete(recapPulses).where(eq(recapPulses.shopId, shopId));
  // The inbox (ADR 20260907-two-way-inbox): a reply names the message it
  // answers and the staffer who wrote it, a message names a diver and, when a
  // header said so, a notification delivery — so replies go first, messages
  // second, and both before the people and delivery rows they point at.
  await db.delete(staffReplies).where(eq(staffReplies.shopId, shopId));
  await db.delete(inboundMessages).where(eq(inboundMessages.shopId, shopId));
  // Stripe checkout/refund state references bookings, trips, and orders, so it
  // must be cleared before those parents or the deletes below FK-violate and
  // abort the whole reset mid-run — leaving a prior payment test's trips and
  // bookings to leak into the next test's fixture (this is what made trips.spec
  // flake under the full suite). booking_checkout_bookings references both
  // booking_checkouts and bookings; payment_operation_intents references trips,
  // bookings, orders, and booking_checkouts — so both go before booking_checkouts.
  await db.delete(bookingCheckoutBookings).where(eq(bookingCheckoutBookings.shopId, shopId));
  await db.delete(paymentOperationIntents).where(eq(paymentOperationIntents.shopId, shopId));
  await deleteStripeReversals(db, shopId);
  // The codes themselves are shop config and survive a schedule reset.
  // An entitlement points at the booking that consumed it and the order it was
  // bought on, so it goes before both. The package *definitions* are the shop's
  // price list and survive a schedule reset, exactly like the promo codes above
  // (ADR 20260822-a-package-is-entitlements-not-money).
  // **A stuck media deletion is not schedule data, and it still has to go.**
  // The seed creates none, so clearing them restores exactly the seeded state —
  // and leaving them made the reset non-restoring in the one direction that
  // shows: the media-deletion read (`src/db/unfinished.ts`) feeds Today an `urgency: "now"` row, so
  // a test that seeded a stale attempt (a fact through `/api/test/shop`) left a
  // "Recap photo" cleanup card on Today for whichever spec Playwright's
  // sharding ran next in that worker. That surfaced as three visual captures —
  // `close-out`, `nav-more-menu`, `nav-more-sheet` — reporting as changed on a
  // pull request that had touched none of them, with the leaked row visible in
  // the diff (found while accounting for issue #791's pixels).
  await db.delete(mediaDeletionAttempts).where(eq(mediaDeletionAttempts.shopId, shopId));
  await db.delete(divePackageEntitlements).where(eq(divePackageEntitlements.shopId, shopId));
  await db.delete(bookingCheckouts).where(eq(bookingCheckouts.shopId, shopId));
  // Orders (and their line items) reference bookings and people; the waitlist
  // references trips and people. Both must go before the parents below.
  await db.delete(orderLineItems).where(eq(orderLineItems.shopId, shopId));
  await db.delete(orders).where(eq(orders.shopId, shopId));
  // The capabilities (unsubscribe and stop links) name an interest or a person
  // by foreign key, so they go before the interests and the people. Added with Leo's self-serve unsubscribe (docs ADR
  // 20260731-self-serve-unsubscribe) but not to this ordering once, which made
  // every `/api/test/reset` throw 23503 mid-run and leave the demo shop
  // half-reset — the e2e fleet then failed in whichever spec happened to read
  // the wreckage next, which is why the flake moved around between runs.
  // A stable staffer's calendar feed (a reusable capability) survives the
  // reset; a purged person's goes with them below.
  await db
    .delete(capabilities)
    .where(
      and(eq(capabilities.shopId, shopId), notInArray(capabilities.purpose, reusablePurposes())),
    );
  await db.delete(interests).where(eq(interests.shopId, shopId));
  // References trips (last-minute-deal blasts) and the interests that carry a deal's
  // `promo_id`, so it goes after them and before the trips/people deletes below
  // or this FK-violates and aborts the whole reset mid-run (docs ADR
  // 20260727-last-minute-fill-promos).
  await db.delete(deals).where(and(eq(deals.shopId, shopId), isNotNull(deals.tripId)));
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
  await db.delete(tripHelpRequests).where(eq(tripHelpRequests.shopId, shopId));
  // The buddy-team trail references trips and people and outlives the
  // membership rows by design (ADR 20260804-buddy-teams), so it clears before
  // both parents — same ordering rule the cascade comments above walk.
  await db.delete(buddyTeamEvents).where(eq(buddyTeamEvents.shopId, shopId));
  // Buddy pairs reference bookings, so they go first or the bookings delete
  // below FK-violates and aborts the whole reset mid-run — the same class of
  // bug the token comments above already walk (ADR 20260804-buddy-teams).
  await db.delete(buddyTeamMembers).where(eq(buddyTeamMembers.shopId, shopId));
  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  await db.delete(tripRequirements).where(eq(tripRequirements.shopId, shopId));
  await db.delete(tripChangeEvents).where(eq(tripChangeEvents.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
    await db.delete(tripDives).where(inArray(tripDives.tripId, tripIds));
  }
  // The shop's Spanish for the trips, sites and courses about to go: a
  // translation has no foreign key to its subject, so it goes with them.
  await db.delete(shopTextTranslations).where(eq(shopTextTranslations.shopId, shopId));
  await db.delete(trips).where(eq(trips.shopId, shopId));
  // After the trips that point at them. The seed writes one run (the weekly
  // Saturday boat) and specs create more on the schedule board, so a reset
  // that left the series behind while its trips went opened the next spec's
  // board on a stale recurrence nothing had booked.
  // Not an FK violation, which is exactly why it survived: this reset's other
  // omissions announced themselves with a 23503, and a silent leak does not.
  // Found by the shop-scoped sweep in `delete-path-coverage.test.ts`, which the
  // cascade's own ordering had already got right.
  // Before the series they point at, after the trips: skips, and a run's crew.
  await db.delete(tripSeriesSkips).where(eq(tripSeriesSkips.shopId, shopId));
  await db.delete(tripSeriesCrew).where(eq(tripSeriesCrew.shopId, shopId));
  await db.delete(tripSeries).where(eq(tripSeries.shopId, shopId));
  await db.delete(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId));
  // A species request points at the site the staffer was writing when they hit
  // the wall, so it goes before the sites — the FK is `ON DELETE SET NULL`, but
  // the row's own `shop_id` is not, and leaving it would block the shop delete
  // outright. Cleared on a schedule reset too: nothing seeds it, so an empty
  // table is the demo shop's correct state, and the e2e suite writes one every
  // time it exercises the picker's refusal.
  await db.delete(marineLifeRequests).where(eq(marineLifeRequests.shopId, shopId));
  await db.delete(diveSites).where(eq(diveSites.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  // Every kind of card at once: the reset clears the shop's whole ledger.
  await db.delete(cards).where(eq(cards.shopId, shopId));
  await db.delete(staffCredentials).where(eq(staffCredentials.shopId, shopId));

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
    await db.delete(capabilities).where(inArray(capabilities.personId, purgeIds));
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
    const purgeAccounts = await db
      .select({ id: userAccounts.id, email: userAccounts.email })
      .from(userAccounts)
      .where(inArray(userAccounts.personId, purgeIds));
    const purgeAccountIds = purgeAccounts.map((row) => row.id);
    if (purgeAccountIds.length > 0) {
      await db.delete(capabilities).where(inArray(capabilities.userAccountId, purgeAccountIds));
      // A provider login references the account row and carries no cascade, so
      // it must go before user_accounts for the same reason the tokens above
      // do. Nothing writes this table yet — no OAuth provider is configured —
      // so today this deletes nothing and costs one statement; the day a
      // provider is enabled it is the difference between this path working and
      // FK-violating mid-run (issue #1594).
      await db
        .delete(authProviderAccounts)
        .where(inArray(authProviderAccounts.userAccountId, purgeAccountIds));
      // better-auth's verification rows reach nothing by foreign key — they
      // name a person as text in `identifier` — so they are cleared by the
      // handles better-auth writes them under rather than by a join. They
      // would not FK-violate; they would simply outlive the person, holding
      // their address and a live token (issue #1594's security review).
      await db
        .delete(authVerifications)
        .where(
          inArray(authVerifications.identifier, [
            ...new Set(purgeAccounts.flatMap((row) => [row.id, row.email])),
          ]),
        );
      await db.delete(accountStepUps).where(inArray(accountStepUps.userAccountId, purgeAccountIds));
      await db
        .delete(accountSecurity)
        .where(inArray(accountSecurity.userAccountId, purgeAccountIds));
      // Better Auth sessions reference the login row, so they must be cleared
      // before user_accounts for the same purged people. Stable staff sessions
      // stay intact because purgeAccountIds contains only non-staff people.
      await db
        .delete(accountSessions)
        .where(inArray(accountSessions.userAccountId, purgeAccountIds));
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
  // connected `shop_stripe_accounts` row (the `stripeAccount` fact)
  // both persist across resets otherwise, since neither is schedule/booking
  // data — leaking into whichever spec runs next in the same worker and
  // making its assertions order-dependent (e2e/recap.spec.ts's own "review
  // link starts absent" check, for one). The canonical seed never sets
  // either, so restoring to that state is just deleting/nulling them.
  // `shops.depth_unit` is the same class of leak: it's the only
  // shop-settings column e2e/depth-and-age-surfaces.spec.ts's "read back in
  // the shop's own unit" test mutates (feet → metres, mid-test), and nothing
  // ever flips it back — a second run against the same server (e.g. a local
  // `pnpm exec playwright test` rerun without restarting `next start`)
  // starts already on metres and the test's own `/Maximum depth \(feet\)/`
  // locator then never matches, hanging for the full test timeout rather
  // than failing fast.
  // `shops.temperature_unit` rides along for the same reason: it is the second
  // half of the same settings pair and leaks exactly the same way once a spec
  // flips it.
  // The shore contact's alert address (H-20261014-stale-roll-call-recipients) is the same class of leak: a
  // spec that saves one would leave the next spec's emergency reference
  // holding it. A demo shop never sends to it, and its links go with it.
  await db
    .update(shops)
    .set({
      reviewUrl: null,
      ...DEMO_SHOP_UNIT_COLUMNS,
      shoreAlertEmail: null,
      shoreAlertConsentAt: null,
      shoreAlertConsentByPersonId: null,
      shoreAlertConfirmedAt: null,
    })
    .where(eq(shops.id, shopId));
  // The shore contact's links go with the address (issue #3721).
  await db
    .delete(capabilities)
    .where(
      and(
        eq(capabilities.shopId, shopId),
        inArray(capabilities.purpose, ["shore_alert_confirm", "shore_alert_stop"]),
      ),
    );
  // Anything a spec connected goes here; the re-seed half puts back the one
  // connection the canonical demo is configured with.
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
  await db.delete(waiverMaterialityDecisions).where(eq(waiverMaterialityDecisions.shopId, shopId));
  await db.delete(waiverTemplates).where(eq(waiverTemplates.shopId, shopId));

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
  await db.delete(deals).where(and(eq(deals.shopId, shopId), isNull(deals.tripId)));

  return { waiverTitle: existingWaiver?.title ?? DEFAULT_WAIVER_TITLE };
}

/**
 * The insert half of {@link resetDemoSchedule}: everything a cleared shop gets
 * back. Only ever called on a shop {@link clearDemoSchedule} just cleared.
 */
async function reseedClearedDemoSchedule(
  db: DbExecutor,
  shopId: string,
  cleared: ClearedDemoSchedule,
  shape: SeedShape,
): Promise<void> {
  // The one connection the canonical demo is configured with: its Stripe
  // test-mode account, when the deployment names one (ADR
  // 20261009-demo-test-mode-payments). A minted demo is skipped.
  await syncDemoStripeAccount(db, shopId);
  // The waiver templates were replaced outright (see the clear half), under the
  // shop's own title.
  await db.insert(waiverTemplates).values({
    shopId,
    title: cleared.waiverTitle,
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  // The caller names the shape: a fixture reset that asks for `lean` does not
  // recreate hundreds of historical tips and reviews; a full demo refresh asks
  // for `history`.
  await seedDemoSchedule(db, shopId, shape);
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
      restored.map((person, i) => ({
        id: person.id,
        fullName: missing[i]?.fullName ?? "",
        roles: missing[i]?.roles ?? [],
      })),
      { boatAtSea: true },
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

export { bringDemoBoatsAtSeaHome } from "./seed-boat-at-sea";
export { demoTodayDepartureStart } from "./seed-clock";
/**
 * The demo-shop lifecycle, re-exported so `@/db/seed` stays the one import for
 * everything about demo data. See `./seed-demo-lifecycle.ts`.
 */
export {
  DEFAULT_DEMO_SHOP_MAX_LIVE,
  DEFAULT_DEMO_TTL_MS,
  deleteDemoShopCascade,
  enforceMintedDemoCap,
  purgeMintedDemoShops,
  reapExpiredDemoShops,
} from "./seed-demo-lifecycle";
export { DEMO_RECAP_BOOKING_ID } from "./seed-identifiers";
export { SEED_SHAPES, type SeedShape, seedDemoSchedule, shapeHas } from "./seed-schedule";
