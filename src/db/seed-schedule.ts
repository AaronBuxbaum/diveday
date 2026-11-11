import { and, eq, inArray, ne } from "drizzle-orm";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import type { DbExecutor } from "./client";
import { DEMO_SHOP_SLUG } from "./demo-shop";
import { boats, crewAvailabilityBlocks, people, personRoles, shops } from "./schema";
import { seedBoatAtSea } from "./seed-boat-at-sea";
import { seedBookings } from "./seed-bookings";
import { fillWeeklyRun, seedBoothStories } from "./seed-booth";
import { seedBuddyPairs } from "./seed-buddy-teams";
import { LEAD_INSTRUCTOR_NAME, OWNER_NAME, RELIEF_INSTRUCTOR_NAME } from "./seed-cast";
import { seedCatalog } from "./seed-catalog";
import { seedCertGates } from "./seed-cert-gates";
import { DEMO_SHOP_TIMEZONE, demoTodayDepartureStart } from "./seed-clock";
import { seedConservation } from "./seed-conservation";
import { seedCounterBlockers } from "./seed-counter-blockers";
import { seedCounterRental } from "./seed-counter-rental";
import { seedCourseFormWording } from "./seed-course-form-wording";
import { seedCourseInquiries } from "./seed-course-inquiries";
import { seedCourseMaterials } from "./seed-course-materials";
import { seedCoursePhotos } from "./seed-course-photos";
import { seedDateRequests } from "./seed-date-requests";
import { seedDeskHandoff } from "./seed-desk-handoff";
import { seedDeskTrail } from "./seed-desk-trail";
import { seedDiveIntents } from "./seed-dive-intents";
import { seedDiveRecency } from "./seed-dive-recency";
import { seedDiveSiteCatalog } from "./seed-dive-site-catalog";
import { seedDiveSites } from "./seed-dive-sites";
import { seedDiverTrail } from "./seed-diver-trail";
import { seedDivers } from "./seed-divers";
import { seedFrontDesk, seedFrontDeskLists } from "./seed-front-desk";
import { seedGear } from "./seed-gear";
import { seedHistory } from "./seed-history";
import { seedHulls } from "./seed-hulls";
import { seedInbox } from "./seed-inbox";
import { seedLenses } from "./seed-lenses";
import { seedMedicalAlert } from "./seed-medical-alert";
import { seedMedicalReview } from "./seed-medical-review";
import { seedMinimumSeats } from "./seed-minimum-seats";
import { seedMixedBoat } from "./seed-mixed-boat";
import { seedMoreTrips } from "./seed-more-trips";
import { seedNitrox } from "./seed-nitrox";
import { seedOpenInvoice } from "./seed-open-invoice";
import { seedOrders } from "./seed-orders";
import { seedPartnerReferrals } from "./seed-partner-referrals";
import { seedPromos } from "./seed-promos";
import { seedRecentRecaps } from "./seed-recent-recaps";
import { seedRentalFit } from "./seed-rental-fit";
import { seedSafeCrew } from "./seed-safe-crew";
import { seedSafetyDrills } from "./seed-safety-drills";
import { seedSelfDeclaredJoiners } from "./seed-self-declared";
import { seedSharedDemoRecapPhoto } from "./seed-shared-demo-recap-photo";
import { seedSightings } from "./seed-sightings";
import { seedTides } from "./seed-tides";
import { seedTripLegs } from "./seed-trip-legs";
import { seedTripStage } from "./seed-trip-stage";
import { seedTrips } from "./seed-trips";
import { seedWaiverEvidence } from "./seed-waiver-evidence";
import { seedWaiverQuestions } from "./seed-waiver-questions";
import { seedWaiverVersions } from "./seed-waiver-versions";
import { seedWeeklyRun } from "./seed-weekly-run";
import { seedWorkOrders } from "./seed-work-orders";

/**
 * **A seeded shop is a named set of scenario groups** (issue #2760, ADR
 * 20261104-seed-is-one-context-and-named-sets). `demo` is the day every seeded
 * shop has; `history` is the trailing quarter, the lists and the paper trail
 * that give owner reporting and the desk something to read. A shape names the
 * sets it holds, and every caller names a shape: the unit-test template's
 * `lean` and `history` variants (`src/test/db-template-build.ts`), the e2e
 * fleet's canonical shop and a visitor's "Try the live demo" mint (`history`),
 * and the shop a spec takes for itself (`lean`). No step reads a flag; a step
 * is in a set or it is not.
 */
export type SeedSet = "demo" | "history";

export const SEED_SHAPES = {
  lean: ["demo"],
  history: ["demo", "history"],
} as const satisfies Record<string, readonly SeedSet[]>;

export type SeedShape = keyof typeof SEED_SHAPES;

/** Whether a shape holds a set. */
export function shapeHas(shape: SeedShape, set: SeedSet): boolean {
  return (SEED_SHAPES[shape] as readonly SeedSet[]).includes(set);
}

type Seeded<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

/**
 * **One typed context**, built once by {@link seedTheBoard} and read by every
 * later step. The values that used to be threaded from one step's return into
 * the next step's argument list are fields here, so a step names what it reads
 * (`c.bookings.wreck`, `c.staff.instructor`) instead of the orchestrator
 * re-assembling an argument object for each call. Steps still write through
 * their own modules and still return nothing a later step reads: anything a
 * later step needs is made here, in the board, before the first of them runs.
 */
export type SeedContext = {
  shopId: string;
  shape: SeedShape;
  shop: { timezone: string; isDemo: boolean; isCanonical: boolean };
  staff: {
    owner: { id: string };
    instructor: { id: string };
    reliefInstructor: { id: string };
    /** Undefined only on a shop whose crew seed found no captain. */
    captainId: string | undefined;
    divemasterId: string | undefined;
  };
  cast: Seeded<typeof seedDivers>;
  /** The cast in slot order, for the steps that walk every diver. */
  customers: Seeded<typeof seedDivers>["all"][number][];
  catalog: Seeded<typeof seedCatalog>;
  sites: Seeded<typeof seedDiveSites>;
  trips: Seeded<typeof seedTrips>["tripRows"];
  bookings: Seeded<typeof seedBookings>;
};

/**
 * One crew member's days away, so the staffing week has a blackout to draw and
 * the "informs, never gates" rule has something to demonstrate (issue #1235,
 * ADR 20260902-crew-requests-and-blackouts).
 *
 * Deliberately **one person, next week, with a note** — not a shop where
 * everybody is on holiday. It is the ordinary case: somebody said they were
 * away, the week shows it quietly, and nobody has been taken off a boat.
 *
 * **Reset-owned**, unlike the shifts beside it: the staffing week is a surface
 * specs write to, so a blackout one worker records must not survive into the
 * next test's board (`resetDemoSchedule`, ADR 20260815-per-test-private-shops).
 */
async function seedCrewAway(db: DbExecutor, shopId: string, personId: string): Promise<void> {
  // One non-teaching day inside the week the page opens on. The following
  // day has Discover Scuba and Refresher sessions that need this instructor.
  const from = shiftCalendarDate(
    calendarDateInTimezone(demoTodayDepartureStart(), DEMO_SHOP_TIMEZONE),
    3,
  );
  await db.insert(crewAvailabilityBlocks).values({
    shopId,
    personId,
    startsOn: from,
    endsOn: from,
    note: "Family trip",
    createdByPersonId: personId,
  });
}

/**
 * The board every shape shares, and the context the rest of the day reads:
 * who dives here, what the shop teaches, where it dives, what is on the board,
 * and who is booked on it. Each step reads rows the ones before it inserted, so
 * the order below is the fixture (ADR 20260803-seed-scenario-modules).
 */
async function seedTheBoard(
  db: DbExecutor,
  shopId: string,
  shape: SeedShape,
): Promise<SeedContext> {
  // Look the instructors up by **name**, not by a hardcoded email and no longer
  // by role. The name is the one key both shops share: a minted demo carries
  // per-shop-unique emails, and since DOM-M7 the shop has two instructors, so
  // `where role = 'instructor' limit 1` would return whichever row Postgres
  // felt like and move the whole seeded demo between runs. `staffDefs` is the
  // single cast both seeders insert from, so these two names always resolve.
  // The fleet by name, so a boat departure sails on an actual hull. Without it
  // every seeded trip carries a null `boat_id` and the hull above the roster
  // (ADR 20260919-one-idea, decision I · Tide) renders nowhere — an unseeded
  // feature is an untested one. By name for the same reason the instructors
  // below are: it is the one key the pinned and the minted demo shops share.
  const boatByName = new Map(
    (
      await db
        .select({ id: boats.id, name: boats.name })
        .from(boats)
        .where(eq(boats.shopId, shopId))
    ).map((row) => [row.name, row.id]),
  );
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
  // The owner, looked up the same way and for the same reason. She is the
  // relief skipper on the three departures the shop's one captain could not
  // physically be on (issue #1781); `seed-cast.ts`'s `OWNER_NAME` argues it.
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, OWNER_NAME)))
    .limit(1);
  if (!owner) throw new Error("seed: owner missing from stable staff");

  // **Reset-owned, not settings.** A blackout is a fact about one week, and the
  // staffing week is a surface specs write to — so it lives in the resettable
  // half, where `/api/test/reset` clears it before the next test rather than
  // leaking one worker's "away" into another's board.
  await seedCrewAway(db, shopId, instructor.id);

  // Only the canonical blue-mantis demo pins any primary key, and everything
  // that pins one is gated on this: the visual tests mint a recap link from a
  // fixed booking id, public sheets print a fixed departure URL, and the two
  // tied medical-review waiver rows need a fixed order (seed-medical-review.ts).
  // A freshly-minted demo shop — and the
  // `privateShop` a spec takes for itself — gets random ids, because a literal
  // one can exist only once per database and a second shop would collide on it.
  const [shopRow] = await db
    .select({ slug: shops.slug, timezone: shops.timezone, isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);

  // Before anything issues a waiver: the release's own version history, so the
  // shop's current text is version 3 with two superseded wordings behind it,
  // the way a trading shop's paperwork actually looks. Every scenario below
  // snapshots `getCurrentWaiverTemplate`, so this has to settle what "current"
  // means first (src/db/seed-waiver-versions.ts).
  await seedWaiverVersions(db, shopId);

  const cast = await seedDivers(db, shopId, instructor.id);
  const catalog = await seedCatalog(db, shopId);
  // A photo of its own on every course, none of them the cover or a site's.
  await seedCoursePhotos(db, shopId);
  // DiveDay's own catalog first: the shop's Molasses Reef records which
  // template version it came from, and the library reads that back to offer the
  // newer one.
  await seedDiveSiteCatalog(db);
  const sites = await seedDiveSites(db, shopId);
  // Which NOAA station the two Key Largo sites read their tide from; the
  // ADR 20260907-noaa-tide-predictions.
  await seedTides(db, shopId);
  const isCanonical = shopRow?.slug === DEMO_SHOP_SLUG;
  const { tripRows, captainId, divemasterId } = await seedTrips(db, shopId, {
    pinTodayTrip: isCanonical,
    boatByName,
    instructor,
    reliefInstructor,
    courseRows: catalog.courseRows,
    courseIdByTitle: catalog.courseIdByTitle,
    discoverCourse: catalog.discoverCourse,
    openWaterCourse: catalog.openWaterCourse,
    siteByName: sites.siteByName,
    benwood: sites.benwood,
    french: sites.french,
  });
  await seedSafeCrew(db, shopId);
  const bookings = await seedBookings(db, shopId, {
    cast,
    tripRows,
    pinRecapBooking: isCanonical,
    recordedById: instructor.id,
  });

  return {
    shopId,
    shape,
    shop: {
      timezone: shopRow?.timezone ?? DEMO_SHOP_TIMEZONE,
      isDemo: shopRow?.isDemo ?? false,
      isCanonical,
    },
    staff: { owner, instructor, reliefInstructor, captainId, divemasterId },
    cast,
    customers: [...cast.all],
    catalog,
    sites,
    trips: tripRows,
    bookings,
  };
}

/** Today's reef boat: the board's first departure, which several stories hang on. */
function reefTrip(c: SeedContext) {
  const [reef] = c.trips;
  if (!reef) throw new Error("seed: reef trip missing");
  return reef;
}

/**
 * The shop's weekly run: the owner skippers it and two guides lead the water,
 * enough for the twelve seats at the shop's ratio. A standing crew asked of a
 * date they are busy on is left off it, and a free instructor or divemaster
 * takes their place for that date.
 */
async function seedTheWeeklyRun(db: DbExecutor, c: SeedContext): Promise<void> {
  const { shopId } = c;
  const [assistant] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "assistant_instructor")))
    .limit(1);
  const [divemaster] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "divemaster")))
    .limit(1);
  // Everyone else on the crew, for a date a standing member is out on a
  // longer boat; the owner skippers, so she is not a relief.
  const reliefRows = await db
    .select({ id: people.id, fullName: people.fullName, role: personRoles.role })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(
      and(
        eq(people.shopId, shopId),
        ne(people.id, c.staff.owner.id),
        inArray(personRoles.role, ["instructor", "assistant_instructor", "divemaster", "captain"]),
      ),
    )
    .orderBy(people.fullName);
  const reliefPool = [...new Set(reliefRows.map((row) => row.id))].map((id) => ({
    personId: id,
    roles: reliefRows.filter((row) => row.id === id).map((row) => row.role),
  }));
  // The assistant instructor and the shop's divemaster are the standing
  // guides.
  const standing = [assistant?.id, divemaster?.id].filter((id): id is string => !!id);
  await seedWeeklyRun(db, shopId, {
    skipperId: c.staff.owner.id,
    divemasterIds: standing,
    reliefs: reliefPool.filter((relief) => !standing.includes(relief.personId)),
  });
  // Its next date sold out, with a wait list (src/db/seed-booth.ts).
  await fillWeeklyRun(db, shopId);
}

type SeedStep = {
  set: SeedSet;
  run: (db: DbExecutor, c: SeedContext) => Promise<unknown>;
};
const demo = (run: SeedStep["run"]): SeedStep => ({ set: "demo", run });
const history = (run: SeedStep["run"]): SeedStep => ({ set: "history", run });

/**
 * The rest of the day, after the board, **in the only order it makes sense
 * in**. Each entry is in one set; a shape runs the entries of the sets it holds,
 * in this order. Reordering this list changes the fixture (the `nextCreatedAt`
 * tick is shared across scenarios), so a new scenario is a new entry where its
 * reads are satisfied, usually late and adds-only.
 */
const THE_DAY: readonly SeedStep[] = [
  demo((db, c) =>
    seedMoreTrips(db, c.shopId, {
      customers: c.customers,
      siteByName: c.sites.siteByName,
      courseRows: c.catalog.courseRows,
      instructorId: c.staff.instructor.id,
      captainId: c.staff.captainId,
      divemasterId: c.staff.divemasterId,
      waiverTemplate: c.bookings.waiverTemplate,
    }),
  ),
  // The shop's trip tags, and which departure wears which
  // (ADR 20260904-reef-all-the-way-down, decision 2). After `seedMoreTrips`,
  // because it hangs the words on those departures by title.
  demo((db, c) => seedLenses(db, c.shopId)),
  demo((db, c) => seedPromos(db, c.shopId, c.bookings.promoRedemptionBooking)),
  demo((db, c) =>
    seedNitrox(
      db,
      c.shopId,
      c.cast,
      c.bookings.wreck,
      c.bookings.bookingRows,
      c.staff.instructor.id,
    ),
  ),
  demo((db, c) => seedRentalFit(db, c.shopId, c.customers)),
  // The rental fleet on the wall, after the bookings so a few units can be
  // reserved against the upcoming wreck trip (ADR 20260815-minimal-gear-register).
  demo((db, c) =>
    seedGear(db, c.shopId, {
      timezone: c.shop.timezone,
      tripRows: c.trips,
      bookingRows: c.bookings.bookingRows,
    }),
  ),
  // The bench: tickets on customers' own gear and on one of those units, so
  // after `seedGear` (ADR 20261008-gear-work-orders).
  demo((db, c) =>
    seedWorkOrders(db, c.shopId, {
      timezone: c.shop.timezone,
      customers: c.customers,
      technicianPersonId: c.staff.instructor.id,
    }),
  ),
  demo((db, c) =>
    seedCounterRental(db, c.shopId, { timezone: c.shop.timezone, divers: c.customers }),
  ),
  // Interests off the public course pages. After the catalog and the divers, so the
  // one interest that links to an existing diver has somebody to link to.
  demo((db, c) =>
    seedCourseInquiries(db, c.shopId, { courseIdByTitle: c.catalog.courseIdByTitle }),
  ),
  // The same table's other half: divers asking for a *dive* on a date the
  // board has nothing on — the rows the requests list groups by day
  // (src/lib/date-requests.ts).
  demo((db, c) => seedDateRequests(db, c.shopId)),
  // What divers wrote back — the inbox and the record thread (ADR
  // 20260907-two-way-inbox). After the divers, since every row but the
  // stranger's names one.
  demo((db, c) => seedInbox(db, c.shopId, c.customers, c.staff.instructor.id)),
  // The desk's lists — the last-minute list and the charter's wait list — then
  // the confirmations every shape carries.
  history((db, c) =>
    seedFrontDeskLists(db, c.shopId, {
      cast: c.cast,
      tripRows: c.trips,
      bookingRows: c.bookings.bookingRows,
    }),
  ),
  demo((db, c) =>
    seedFrontDesk(db, c.shopId, { tripRows: c.trips, bookingRows: c.bookings.bookingRows }),
  ),
  // The trailing quarter of already-sailed trips that gives owner reporting
  // something to report. Off for the lean unit-test template and for a spec's
  // private shop; on for the demo shop, a visitor's mint and the e2e fleet.
  history((db, c) => seedHistory(db, c.shopId, c.staff.instructor.id)),
  history((db, c) => seedRecentRecaps(db, c.shopId)),
  history(async (db, c) => {
    if (c.shop.isDemo) await seedSharedDemoRecapPhoto(db, c.shopId, reefTrip(c).id);
  }),
  // The billing states that back-fill never produces: it invoices a paid trip
  // fee or a paid deposit and nothing else, so "Refunded", "Void",
  // "Uncollectible" and every retail line kind were unreachable from a shop
  // with three hundred invoices on file. A dozen standalone counter orders
  // fill them in (src/db/seed-orders.ts). In the history set because it is the
  // same "what has this shop billed" story, and because the lean unit-test
  // template is deliberately order-free.
  history((db, c) =>
    seedOrders(db, c.shopId, { customers: c.customers, createdByPersonId: c.staff.instructor.id }),
  ),
  // The desk's own paper trail on today's reef boat: private notes against
  // three seats and the account of what has been done to the departure
  // (src/db/seed-desk-trail.ts). Both tables are otherwise written only by
  // something a visitor does, so the Guests tab opened on "No activity yet"
  // in every seeded shop. Annotation only — nothing here is read by
  // readiness, the manifest, or Today.
  history((db, c) =>
    seedDeskTrail(db, c.shopId, {
      trip: reefTrip(c),
      roster: c.bookings.bookingRows,
      divers: c.customers,
      actorPersonId: c.staff.instructor.id,
    }),
  ),
  // One unpaid seat on that same boat, so the Overview's pulse has a money
  // fact to state and the Orders index has something to be narrowed to
  // (src/db/seed-open-invoice.ts). Deliberately `open`: a booking-linked
  // paid or refunded order would cascade onto the seat's payment gate,
  // which is what seed-orders.ts's bookingId-null rule is protecting.
  history((db, c) =>
    seedOpenInvoice(db, c.shopId, {
      trip: reefTrip(c),
      roster: c.bookings.bookingRows,
      divers: c.customers,
      createdByPersonId: c.staff.instructor.id,
    }),
  ),

  // Adds-only from here, unlike every step above: four departures whose cert
  // gates each refuse for exactly one reason, and the Advanced Open Water
  // session that proves the course carve-out. Running it after everything else
  // means no row seeded before it moves, right down to its `nextCreatedAt()`
  // stamp. It reads the divers, the sites, the catalog, and the crew, and
  // nothing reads it back.
  demo((db, c) =>
    seedCertGates(db, c.shopId, {
      customers: c.customers,
      siteByName: c.sites.siteByName,
      courseRows: c.catalog.courseRows,
      instructorId: c.staff.instructor.id,
      captainId: c.staff.captainId,
      divemasterId: c.staff.divemasterId,
      ownerId: c.staff.owner.id,
      waiverTemplate: c.bookings.waiverTemplate,
    }),
  ),
  // Adds-only, like seedCertGates above: two buddy teams on today's reef
  // trip — a pair and a divemaster-led trio — plus their `formed` trail
  // entries, and no roll-call events, so nothing seeded before it moves and no
  // head-count gap opens on Today (src/db/seed-buddy-teams.ts, ADR
  // 20260804-buddy-teams).
  demo((db, c) =>
    seedBuddyPairs(db, c.shopId, {
      customers: c.customers,
      tripRows: c.trips,
      bookingRows: c.bookings.bookingRows,
      // Keiko when the crew seed found her; the instructor otherwise (the type
      // allows an undefined divemaster even though the demo cast always has one).
      pairedByPersonId: c.staff.divemasterId ?? c.staff.instructor.id,
    }),
  ),
  // Adds-only and late, for the same reason as the two above: one departure
  // tomorrow whose gates all fire at once, and one diver holding none of them,
  // so the counter has a card with five reasons on it to render
  // (src/db/seed-counter-blockers.ts). Nothing seeded before it moves, and it
  // has not sailed, so it opens no head count.
  demo((db, c) =>
    seedCounterBlockers(db, c.shopId, {
      siteByName: c.sites.siteByName,
      captainId: c.staff.captainId,
      divemasterId: c.staff.divemasterId,
      ownerId: c.staff.owner.id,
      assistingInstructorId: c.staff.instructor.id,
    }),
  ),
  // Same shape and the same reasons: its own departure, added late, four days
  // out and three of six seats sold — the long-range run a shop states a
  // minimum head count on, in the state it is worked in (short, deadline still
  // ahead). See src/db/seed-minimum-seats.ts.
  demo((db, c) =>
    seedMinimumSeats(db, c.shopId, {
      siteByName: c.sites.siteByName,
      captainId: c.staff.captainId,
      divemasterId: c.staff.divemasterId,
      ownerId: c.staff.owner.id,
    }),
  ),
  // Adds-only and late for the same reasons as the three above: two people who
  // are on the shop-wide last-minute list and nothing else, one claiming Open
  // Water and one saying they hold no card at all, so the marks a staffer reads
  // before a discount blast are actually rendered somewhere
  // (src/db/seed-self-declared.ts). Neither holds a seat, so no readiness count,
  // roster or head count moves. In the history set, like the list itself.
  history((db, c) => seedSelfDeclaredJoiners(db, c.shopId)),
  // Adds-only and late, like the two scenarios above: it stamps a column on
  // seats that already exist and gates nothing, so no readiness count, head
  // count or roster membership moves (ADR
  // 20260821-currency-is-what-catches-people).
  demo((db, c) => seedDiveRecency(db, c.shopId)),
  // Beside the recency answers and written the same way: a column on bookings
  // that already exist, so no readiness count, head count or roster membership
  // moves. Scoped to today's reef departure, which is the one board the
  // aggregate line needs in order to have a visual baseline at all (issue #1413).
  demo((db, c) => seedDiveIntents(db, c.shopId)),
  // Which partner's link sent a seat — beside the recency answers, and written
  // the same way: a column on bookings that already exist (issue #1285).
  demo((db, c) => seedPartnerReferrals(db, c.shopId)),
  // The links a shop pastes into its course materials, and one student who
  // has finished them — a column on courses and one on a booking that already
  // exist, gating nothing (src/db/seed-course-materials.ts).
  demo((db, c) => seedCourseMaterials(db, c.shopId, { instructorId: c.staff.instructor.id })),
  // Adds-only and late, like the group above: a month of the crew's own
  // sighting log on the two reefs the demo sells, so the trip page's "Seen
  // here this month" beat has something to say. It writes `trip_sightings`
  // and nothing else — a table read by that beat, the manifest's Seen group
  // and the recap's keepsake line, never by readiness, the roll call or a
  // head count — so nothing seeded before it moves.
  demo((db, c) => seedSightings(db, c.shopId)),
  demo((db, c) => seedConservation(db, c.shopId, c.staff.instructor.id)),
  demo((db, c) => seedSafetyDrills(db, c.shopId)),
  // Adds-only and late: a snorkeler and a rider on today's reef boat, into the
  // two places `seed-trips.ts` holds for them (src/db/seed-mixed-boat.ts, ADR
  // 20261007-participant-types).
  demo((db, c) =>
    seedMixedBoat(db, c.shopId, {
      reef: reefTrip(c),
      waiverTemplate: c.bookings.waiverTemplate,
      recordedById: c.staff.instructor.id,
    }),
  ),
  // Adds-only and late, like the four above: the desk's trail **per diver**,
  // so the Activity section on a diver's record opens on a real history rather
  // than an empty panel (src/db/seed-diver-trail.ts). It writes `activity_events`
  // and nothing else — a table read only by the Guests tab's collapsed log and
  // by that section, never by readiness, the manifest, or a head count — so
  // nothing seeded before it moves. Last of the adds-only group because it
  // reads every seat the earlier scenarios sold, including the cert-gate and
  // minimum-seats departures.
  demo((db, c) =>
    seedDiverTrail(db, c.shopId, {
      roster: c.bookings.bookingRows,
      divers: c.customers,
      // Instructor, then the divemaster and captain when the crew seed found
      // them — the trail rotates through the crew in that order.
      actorPersonIds: [c.staff.instructor.id, c.staff.divemasterId, c.staff.captainId].filter(
        (id): id is string => typeof id === "string",
      ),
    }),
  ),
  // The boat at sea, halfway through her roll call, whatever hour the demo is
  // seeded (src/db/seed-boat-at-sea.ts, market sheet 2026-10-22, item 1):
  // after every scenario that seats a diver, since she takes regulars with no
  // seat from today on, and before the stage taps, which she carries too.
  history((db, c) => seedBoatAtSea(db, c.shopId)),
  // What a booth visitor is shown (src/db/seed-booth.ts, market sheet
  // 2026-10-22, item 4): a dive card, a weather call, two cards the shop
  // issued, a mask left behind. After the boat at sea, which takes regulars
  // with no seat from today on, and before the course forms are worded, which
  // sign for every student already booked.
  history((db, c) => seedBoothStories(db, c.shopId)),
  // The demo's boats say where they are, with every tap stamped relative to
  // its own departure (ADR 20260904-reef-all-the-way-down, Budget rule 4;
  // `demoStageTaps`) — after the trips exist and their plans have sites on
  // them, since the tap stamps the site it reads.
  demo(async (db, c) => {
    if (c.staff.captainId) await seedTripStage(db, c.shopId, c.staff.captainId);
  }),
  // Updates-only, and writes no rows at all: how far the boat runs on the three
  // departures where the answer is not the shop's usual twenty minutes
  // (src/db/seed-trip-legs.ts). After every scenario that creates a departure,
  // since it sets a column on their dives; before the waiver seal below, which
  // nothing may write after. In the history set, so the visitor's mint gets
  // them too — the one that goes without is `privateShop`, which mints `lean`,
  // because a stated leg beats the shop's own ride-out figure and that figure
  // is exactly what a spec taking a shop of its own is usually testing.
  history((db, c) => seedTripLegs(db, c.shopId)),

  // A synthetic, status-only medical-review hold on a future departure gives
  // the demo and staff training a real fail-closed waiver path without storing
  // any health answers. It remains unresolved every time the demo resets; the
  // policy/legal decision behind production medical handling is still H-20260730-jurisdiction-waiver-text-medical, H-20260730-evidence-retention-period-deletion, H-20260724-current-typed-name-explicit.
  demo((db, c) =>
    seedMedicalReview(
      db,
      c.shopId,
      c.bookings.waiverTemplate,
      c.trips,
      c.staff.instructor.id,
      c.shop.isCanonical,
    ),
  ),
  // The morning handoff on today's reef boat: what the desk did after the
  // owner last looked, plus the two divers who said the crew may know it is
  // their first trip (src/db/seed-desk-handoff.ts, issues #1202/#1187 and
  // #1182). Written by the instructor so the owner's own login — the one a
  // demo signs in with — is the reader who is behind on them. Late, after
  // every scenario that can block a diver on this boat: its check-ins are
  // real ones, so they ask readiness the question the counter would (UX
  // review 2026-10-13, item 3). No waiver row is written, so it may sit
  // before the evidence pass below.
  history((db, c) =>
    seedDeskHandoff(db, c.shopId, {
      trip: reefTrip(c),
      roster: c.bookings.bookingRows,
      actorPersonId: c.staff.instructor.id,
    }),
  ),
  // Late, after every scenario that books a course session: the shop's own
  // words on its course forms, and a paper signature for every student
  // already booked, so no seeded seat changes readiness
  // (src/db/seed-course-form-wording.ts, fourth review, item 53). In the
  // history set, so the lean template keeps its forms empty.
  history((db, c) =>
    seedCourseFormWording(db, c.shopId, { recordedByPersonId: c.staff.instructor.id }),
  ),
  // Adds-only and late, after every scenario that crews a departure, so each
  // Saturday asks its standing crew about every other boat already on the
  // board: the shop's weekly run (src/db/seed-weekly-run.ts, fourth review,
  // item 51). In the history set, so the lean template keeps its board.
  history(seedTheWeeklyRun),
  // Updates-only, after every scenario that creates a departure: a hull on
  // every boat day and the shop's word on the ones seeded after the first pass
  // (src/db/seed-hulls.ts, src/db/seed-lenses.ts), so Reports' "By boat" and
  // "By kind of trip" add up to the month (market sheet 2026-10-22, item 2).
  history((db, c) => seedHulls(db, c.shopId)),
  history((db, c) => seedLenses(db, c.shopId)),

  // The shop's questions and one release answering them.
  demo((db, c) => seedWaiverQuestions(db, c.shopId)),
  // One diver's medical alert for the crew on tomorrow's boat.
  demo((db, c) => seedMedicalAlert(db, c.shopId)),
  // Truly last, and updates-only: what the shop's signed evidence looks like
  // once every scenario above has finished writing releases — signatures dated
  // across the weeks divers actually signed in rather than all at this instant,
  // and an integrity seal on everything signed since the shop's account got one
  // (src/db/seed-waiver-evidence.ts). A seal covers a record's final stored
  // metadata, so nothing may write a waiver row after this.
  demo((db, c) => seedWaiverEvidence(db, c.shopId)),
];

/**
 * The resettable half of the demo: customers, their cards, the course catalog,
 * trips, requirements, and bookings. This is the playground a prospective
 * customer pokes at — schedule a trip, cancel a booking, fill a boat — and the
 * exact set of rows resetDemoSchedule restores. Staff already exist (stable
 * half), so the instructor is looked up rather than passed in.
 *
 * The caller names the shape; the board runs for every shape, then each entry
 * of {@link THE_DAY} whose set the shape holds, in order.
 */
export async function seedDemoSchedule(
  db: DbExecutor,
  shopId: string,
  shape: SeedShape,
): Promise<void> {
  const context = await seedTheBoard(db, shopId, shape);
  for (const step of THE_DAY) {
    if (shapeHas(shape, step.set)) await step.run(db, context);
  }
}
