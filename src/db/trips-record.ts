import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  notInArray,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { cache } from "react";
import { STAFF_ROLES } from "@/lib/authz";
import { sellableSeats } from "@/lib/boat-safety";
import { nowDate } from "@/lib/clock";
import type { TripCrewRole } from "@/lib/crew-roles";
import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import { log } from "@/lib/log";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import type { ParticipantTermsPatch } from "@/lib/participant-terms";
import type { SpokenLanguageTag } from "@/lib/spoken-languages";
import {
  tripArrivalSnapshot,
  tripChangeSnapshotsEqual,
  tripConditionsSnapshot,
} from "@/lib/trip-change-events";
import type { TripDiveMode } from "@/lib/trip-details";
import { tripSiteList, tripSiteListChanged } from "@/lib/trip-revision";
import { hasSailed } from "@/lib/trips";
import {
  captureDepartureBoatSafety,
  departureBoatSafetySnapshot,
  rebindDepartureBoatSafetyTime,
} from "./boat-safety";
import type { AppDb, DbExecutor } from "./client";
import { clearCrewAwayAcknowledgements } from "./crew-away-acknowledgements";
import { flushUrgentCrewNotices, recordCrewCalledOff, recordCrewTimeMoved } from "./crew-notices";
import { recordDeskEvent } from "./desk-events";
import { type FlySafeCorrectionOutcome, sendFlySafeCorrections } from "./fly-safe-correction";
import { releaseUnclaimedGearReservationsForTrips } from "./gear";
import { publishManifestEvent } from "./manifest-events";
import { rearmTripReminders } from "./reminder-rearm";
import { recordedRollCallRows } from "./roll-call-history";
import type { Trip } from "./schema";
import {
  boats,
  bookings,
  courses,
  diveSites,
  executedDives,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  tripDives,
  tripScheduleDays,
  trips,
  userAccounts,
} from "./schema";
import { recordShopActivityWithin } from "./shop-activity";
import {
  recordSiteRunChange,
  recordTripChangeEvent,
  tripSiteRunSnapshot,
} from "./trip-change-events";
import {
  normalizedDiveCount,
  normalizedDiveDrafts,
  primaryDiveSiteId,
  replaceTripDives,
  type TripDiveDraft,
  type TripScheduleDayInput,
  validateDiveSites,
} from "./trips-create";
import { liveTrip, notRehearsal } from "./trips-live";
import {
  bookedDiversCount,
  bookedSnorkelersCount,
  heldSeatCounts,
  seatHeld,
  tripBoatCertifiedPassengers,
  tripBoatCertifiedTotalPersons,
} from "./trips-queries";

/**
 * One departure's own record: read it, edit its details, its dives, its
 * conditions, its status, its meeting windows.
 *
 * Everything here is scoped by `shopId` in the query itself — staff pages must
 * never cross tenants. The edits fail closed with a typed reason rather than
 * silently discarding data: capacity can never drop below the party already on
 * the manifest, and planned dives can never drop below a dive number staff have
 * recorded a roll call against (CR-006).
 */

/**
 * "Does this shop have a departure with this id?" — nothing about it, just
 * whether the row is there.
 *
 * Read by `src/proxy.ts` before the static shell of a `/s/<shop>/trips/<id>`
 * request, so that an id naming no departure answers a real 404 rather than a
 * 200 whose body says otherwise (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * **On the board, and nothing beyond that** — `liveTrip()` and no other
 * predicate. The filter is here because every public reader of a departure
 * carries it and therefore 404s a deleted one anyway (`getTripWithBooked`
 * below, which the page, the `.ics` route and the arrival card all read
 * through), so refusing a removed departure at the edge
 * matches the page rather than overruling it — and `scripts/check-live-trips.mjs`
 * exists to stop a reader of this table quietly meaning "tombstones too".
 *
 * Status and `isPrivate` are deliberately *not* here. Each is a reason a page
 * declines to render a departure that is still on the board, and the page
 * answers them at 200 on purpose: a cancelled departure gets its own soft
 * landing, and a private one is still served to whoever holds its link. The
 * edge refusing either would be stricter than the page, which is the one
 * failure this whole mechanism must not have.
 */
export async function tripExistsForShop(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    // A rehearsal is never public (ADR 20261012-rehearsal-departures): its URL
    // is refused at the edge like a departure that does not exist.
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip(), notRehearsal()))
    .limit(1);
  return rows.length > 0;
}

/**
 * Trip scoped to a shop (staff pages must never cross tenants), with booked
 * count and `sellableCapacity` — its seats on sale under the boat's
 * certificate (H-107, #2321), which every seats-left reads. `capacity` stays
 * the stated number the details form edits.
 */
export async function getTripWithBooked(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({
      trip: trips,
      course: courses,
      diveSite: diveSites,
      booked: count(bookings.id),
      bookedDivers: bookedDiversCount(),
      bookedSnorkelers: bookedSnorkelersCount(),
      certifiedPassengers: tripBoatCertifiedPassengers(),
      certifiedTotalPersons: tripBoatCertifiedTotalPersons(),
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), seatHeld))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .groupBy(trips.id, courses.id, diveSites.id)
    .limit(1);
  const row = rows[0];
  return row
    ? {
        ...row.trip,
        sellableCapacity: sellableSeats(row.trip.capacity, row.certifiedPassengers),
        // The certificate itself, for the manifest's head count (batch 6, item 2).
        certifiedPassengers: row.certifiedPassengers,
        // Total persons, crew included, for the same head count (#2302).
        certifiedTotalPersons: row.certifiedTotalPersons,
        course: row.course,
        diveSite: row.diveSite,
        booked: row.booked,
        bookedDivers: row.bookedDivers,
        /** Snorkelers holding a seat, for the snorkel-site line (domain review F8). */
        bookedSnorkelers: row.bookedSnorkelers,
      }
    : null;
}

/**
 * {@link getTripWithBooked}, read once per request (#2487): `/ready` reads the
 * departure for its readiness data and again for the thread's trip card, two
 * statements for one fact. Keyed on the executor, shop and trip, and outside a
 * render (an action, a route handler, a test) `cache()` calls straight
 * through, so every call there reads live. Pages only; a writer reads fresh.
 */
export const getTripWithBookedOnce = cache(getTripWithBooked);

/**
 * Primary-subtag languages this trip's current bookings actually signalled —
 * `people.locale`, only ever written from a request the diver themselves made
 * (`src/db/schema/`), never a default fallback. Feeds the quiet crew-
 * language note (`crewLanguageBriefings`, issue #708): a diver who never
 * signalled a preference correctly contributes nothing to compare against.
 */
export async function bookedDiverLanguages(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<{ name: string; language: string }[]> {
  const rows = await db
    .selectDistinct({ name: people.fullName, locale: people.locale })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.tripId, tripId),
        eq(bookings.shopId, shopId),
        notInArray(bookings.status, ["cancelled", "no_show"]),
        // A held seat's language is the matched record's, who may not be the
        // person aboard (#2082; dive-domain review of layer r5-4, note 9).
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    .orderBy(asc(people.fullName));
  // Each diver with the language they read, so the crew note can name them
  // (fifth-loop ideas, item 48). The codes alone are `[...new Set(languages)]`.
  return rows.flatMap((row) =>
    row.locale === null ? [] : [{ name: row.name, language: row.locale.split("-")[0] }],
  );
}

/**
 * Languages currently represented by a departure's active, assigned crew.
 *
 * This is intentionally an aggregate public read: it names no crew member and
 * makes no promise about a particular guide. The extra active/deleted filters
 * match `listShopSpokenLanguages`, so removing a staff account also stops a
 * stale assignment advertising a language on every trip it once covered.
 */
export async function tripCrewSpokenLanguages(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ language: sql<string>`jsonb_array_elements_text(${people.spokenLanguages})` })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(tripAssignments.tripId, tripId),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        liveTrip(),
        isNull(people.deletedAt),
        eq(userAccounts.status, "active"),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    );
  return rows.map((row) => row.language);
}

/** One crew member a diver may be told about by name (issue #1181, D21). */
export type PublicCrewMember = {
  personId: string;
  /** First name only. The surname is not part of what anybody consented to. */
  firstName: string;
  /** What they are doing on *this* boat, or null when the roster did not say. */
  tripRole: TripCrewRole | null;
  languages: SpokenLanguageTag[];
  /**
   * Away on a day this departure meets (`diverCrewWithAway`, fourth UX review
   * item 12). Then the diver reads the role and "to be confirmed", never the
   * name: we do not promise a person who will not be there.
   */
  away?: boolean;
};

/**
 * **The crew of one departure who have agreed to be named to divers** (issue
 * #1181, delight report D21).
 *
 * The sibling of `tripCrewSpokenLanguages` above, and the difference between
 * them is the whole feature. That one answers *"what can this shop say to
 * me?"* and names nobody — an anonymous claim about capability, which is what
 * a shop may make about its own staff. This one answers *"who am I diving
 * with?"*, which is a fact about a person on a page anyone on the internet can
 * read, so it is filtered by `crew_public_consent_at` and returns nothing at
 * all for a shop whose staff have not switched it on. Every row here is
 * somebody's own decision.
 *
 * Same live-staff proof as its sibling — a shop's roster, alive, with an
 * active account and a staff role — because somebody taken off the team should
 * stop being introduced to divers the moment they are, not when the next
 * departure is edited.
 *
 * First names only, and never a photo: D21's boundary is role, first name and
 * languages, and the surname is not part of what a "today with" line needs.
 *
 * The name comes off `people.crew_public_name` — the string the person typed
 * beside the consent — rather than from splitting `full_name` on whitespace.
 * That split assumed the shop had typed the given name first, so a row entered
 * "Tanaka Keiko" published the surname to an indexed page, which is not what
 * anybody agreed to (issue #1351).
 */
export async function tripPublicCrew(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<PublicCrewMember[]> {
  const rows = await db
    .selectDistinct({
      personId: people.id,
      // Nothing below reads this, and it still has to be selected: this is a
      // `SELECT DISTINCT`, and Postgres refuses an ORDER BY expression that is
      // not in the select list. The ordering stays on the shop's own record so
      // it does not shuffle when somebody edits their public name.
      fullName: people.fullName,
      publicName: people.crewPublicName,
      tripRole: tripAssignments.tripRole,
      languages: people.spokenLanguages,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(tripAssignments.tripId, tripId),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        liveTrip(),
        isNull(people.deletedAt),
        isNotNull(people.crewPublicConsentAt),
        eq(userAccounts.status, "active"),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(people.fullName));
  // A row with a stamp but no stored name cannot exist — the two are paired by
  // a check constraint on `people` — so this drops nothing in practice. It is
  // written as a filter rather than a `?? <derivation>` on purpose: falling
  // back to the old split is exactly the version-tolerance AGENTS.md refuses,
  // and it would quietly restore the surname bug for any row that reached it.
  // Dropping the member is also the safe direction if the pairing were ever
  // broken: a missing name renders one fewer person, never the wrong one.
  return rows.flatMap((row) =>
    row.publicName === null
      ? []
      : [
          {
            personId: row.personId,
            firstName: row.publicName,
            tripRole: row.tripRole,
            languages: row.languages,
          },
        ],
  );
}

/**
 * One departure's title, or null — the bounded lookup a page uses when it is
 * *filtered* to a trip and has to name it.
 *
 * The Orders index reads this rather than the title on `rows[0]`, for the same
 * reason it looks a pinned diver's name up (`getShopPersonName`): a filter that
 * matches nothing still has to say what it filtered for, and a row-derived
 * title vanishes on exactly the empty screen that needed the explanation most.
 * Shop-scoped in the query, so a `?tripId=` from another tenant reads as null
 * rather than leaking a title.
 */
export async function getShopTripTitle(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ title: trips.title })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  return row?.title ?? null;
}

/**
 * The columns {@link meetingPointOfRows} reads off one departure, for a staff
 * page that states where the boat meets without loading the whole row (the
 * manifest's plan; UX review 2026-10-13, item 18). Shop-scoped and live-only,
 * so another tenant's id or a departure off the board reads as null.
 */
export async function getTripMeetingPointFields(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
  arrivalLandmark: string | null;
  arrivalParkingNote: string | null;
} | null> {
  const [row] = await db
    .select({
      meetingPointLabel: trips.meetingPointLabel,
      meetingPointAddress: trips.meetingPointAddress,
      arrivalLandmark: trips.arrivalLandmark,
      arrivalParkingNote: trips.arrivalParkingNote,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  return row ?? null;
}

/** One dive site's diver-facing preview facts — no shop-internal fields. */
export type TripSitePeek = {
  name: string;
  description: string | null;
  /** A `dive_site_difficulty` code; the surface prints a translated label. */
  difficultyLevel: DiveSiteDifficulty | null;
  /** The shop's own depth note, shown only where no depth is recorded. */
  depthRange: string | null;
  /** The recorded range in metres; the surface prints it in the shop's unit. */
  depthMinMeters: number | null;
  maxDepthMeters: number | null;
  imageUrls: string[];
};

/**
 * Every distinct dive site a trip touches, diver-facing preview shape only —
 * the trip's own single `diveSiteId` plus any per-dive sites recorded on
 * `tripDives` for a multi-dive trip, deduped by name (primary site first).
 * Shared by every diver-facing page that shows "what you'll explore" (the
 * waiver success page and `/ready`), so the two surfaces can't drift apart
 * on what counts as the trip's site list.
 */
export async function getTripDiveSitesPeek(
  db: DbExecutor,
  tripId: string,
): Promise<TripSitePeek[]> {
  const peekColumns = {
    name: diveSites.name,
    description: diveSites.description,
    difficultyLevel: diveSites.difficultyLevel,
    depthRange: diveSites.depthRange,
    depthMinMeters: diveSites.depthMinMeters,
    maxDepthMeters: diveSites.maxDepthMeters,
    imageUrls: diveSites.imageUrls,
  };
  const primarySite = await db
    .select(peekColumns)
    .from(trips)
    .innerJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .where(and(eq(trips.id, tripId), liveTrip()))
    .limit(1);
  const multiDiveSites = await db
    .select(peekColumns)
    .from(tripDives)
    .innerJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
    .where(eq(tripDives.tripId, tripId));

  const seenNames = new Set<string>();
  const sites: TripSitePeek[] = [];
  for (const site of [...primarySite, ...multiDiveSites]) {
    if (!seenNames.has(site.name)) {
      seenNames.add(site.name);
      sites.push(site);
    }
  }
  return sites;
}

export type TripPatch = {
  title: string;
  description?: string;
  /** Where this departure meets, when it isn't the shop's own front door (issue #704 slice 2). */
  meetingPointLabel?: string | null;
  meetingPointAddress?: string | null;
  arrivalLandmark?: string | null;
  arrivalParkingNote?: string | null;
  arrivalTransitNote?: string | null;
  arrivalLookFor?: string | null;
  arrivalFirstInteraction?: string | null;
  arrivalPhotoUrl?: string | null;
  /** The staffer who authored a material public change, when known. */
  changeActorPersonId?: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  plannedDives: number;
  dives?: TripDiveDraft[];
  diveSiteId?: string | null;
  priceCents?: number | null;
  depositCents?: number | null;
  cancellationWindowHours?: number | null;
  minimumBookings?: number | null;
  minimumDecisionHours?: number | null;
  /**
   * The trip's meeting days, replaced wholesale. Omit to leave the existing
   * rows alone; pass them whenever `startsAt`/`endsAt` move, because a day row
   * that still points at last week's dates is what the manifest, the crew
   * double-booking check, and the trip page's meeting-day list all read.
   */
  scheduleDays?: TripScheduleDayInput[];
  /**
   * The hull, the mode and whether the departure is on public sale — all three
   * `undefined` when the caller is not changing them, so a form that does not
   * carry a field cannot write a default over the shop's own answer.
   *
   * They were writable only at creation until 2026-08-22, which made the
   * commonest real edit — "the boat that was going to run this is in for
   * service, move it to the other hull" — impossible, with no
   * delete-and-recreate available because `deleteTrip` refuses a departure
   * carrying bookings (issue #681).
   */
  diveMode?: TripDiveMode;
  boatId?: string | null;
  /**
   * The shop's own word for this kind of day (ADR
   * 20260904-reef-all-the-way-down, decision 2). `null` clears it, `undefined`
   * leaves it alone. Tenancy is checked by the caller against
   * `getTripLens`, the same way the hull above is checked.
   */
  lensId?: string | null;
  isPrivate?: boolean;
  /** The shop's own divemaster target stops applying to this departure (issue #973). */
  selfGuided?: boolean;
  /** The dives went past no-decompression limits, so the recap says nothing about flying (H-84). */
  exceedsNoDecoLimits?: boolean;
  /** Lunch is served aboard, so the Day-of form asks for a lunch preference (ideas item 56). */
  lunchAboard?: boolean;
  /**
   * The wetsuit the boat is running today, in whole millimetres (issue
   * #2206). `null` clears it, `undefined` leaves it alone.
   */
  wetsuitThicknessMm?: number | null;
};

export type UpdateTripOutcome =
  | {
      ok: true;
      trip: Trip;
      /**
       * Whether the departure instant changed: the edit moved the boat. The
       * caller writes the activity log's "moved the departure" line on it,
       * the same line the schedule builder's move writes (issue #2313).
       */
      startMoved: boolean;
      /**
       * The fly-safe corrections this save sent (#2927), present whenever the
       * departure is marked as decompression diving after it; `"failed"` when
       * sending threw. The save stands either way: what is owed is kept owed
       * and the next save tries again.
       */
      flySafe?: FlySafeCorrectionOutcome | "failed";
    }
  | { ok: false; reason: "invalid" | "not_found" }
  | { ok: false; reason: "capacity_below_booked"; detail: { bookedCount: number } }
  | { ok: false; reason: "boat_not_found" }
  | { ok: false; reason: "planned_dives_below_history"; detail: { recordedDiveCount: number } };

/**
 * Edits a trip's own details/schedule/dives. Locks the trip row (mirroring
 * the booking-creation lock in `createBookingRecord`) so a concurrent
 * booking can't land between the active-booking count read and this
 * update — capacity can never end up below the party actually on the
 * manifest, and planned dives can never drop below a dive number staff have
 * already recorded a roll call against (CR-006). Both invariants fail
 * closed with a typed reason instead of silently discarding data.
 */
/** An integer column's new value, or null on a rehearsal (ADR 20261012-rehearsal-departures). */
function unlessRehearsal(value: number | null) {
  return sql<number | null>`case when ${trips.isRehearsal} then null else ${value}::integer end`;
}

export async function updateTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  patch: TripPatch,
): Promise<UpdateTripOutcome> {
  let timeMoved = false;
  let timesChanged = false;
  const outcome = await db.transaction(async (tx): Promise<UpdateTripOutcome> => {
    const plannedDives = normalizedDiveCount(patch.plannedDives, true);
    if (!plannedDives) return { ok: false, reason: "invalid" };

    const [existing] = await tx
      .select({
        id: trips.id,
        // Read so `selfGuided` can be refused against it below. A trip's course
        // is fixed at creation and `UpdateTripPatch` carries no `courseId`, so
        // the row's own value is the only place to learn it.
        courseId: trips.courseId,
        boatId: trips.boatId,
        // Both read for the revision rule below (issue #1165): the two facts a
        // calendar client re-alerts on are when the boat leaves and where it
        // goes, so both have to be compared against what the patch asks for.
        startsAt: trips.startsAt,
        // Read so a moved start time is told to the crew of a running
        // departure only (#2283).
        status: trips.status,
        // Read so a changed return time files the activity line too (#2313).
        endsAt: trips.endsAt,
        diveSiteId: trips.diveSiteId,
        meetingPointLabel: trips.meetingPointLabel,
        meetingPointAddress: trips.meetingPointAddress,
        arrivalLandmark: trips.arrivalLandmark,
        arrivalParkingNote: trips.arrivalParkingNote,
        arrivalTransitNote: trips.arrivalTransitNote,
        arrivalLookFor: trips.arrivalLookFor,
        arrivalFirstInteraction: trips.arrivalFirstInteraction,
        arrivalPhotoUrl: trips.arrivalPhotoUrl,
      })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "not_found" };
    if (!normalizedDiveCount(plannedDives, existing.courseId !== null)) {
      return { ok: false, reason: "invalid" };
    }

    // `seatHeld`, the same predicate `getTripWithBooked` above shows the
    // staffer and `createBookingRecord` enforces capacity with. Counting every
    // non-cancelled row instead made this floor argue with the page that opened
    // it: the trip read "3 booked", capacity 3 was refused as "below the 4
    // divers already booked", and the fourth was a seat the desk had already
    // released — one nothing on screen showed and nobody could cancel
    // (`dive-domain-expert` review, 2026-09-11).
    const [{ bookedCount }] = await tx
      .select({ bookedCount: count() })
      .from(bookings)
      .where(and(eq(bookings.tripId, tripId), seatHeld));
    if (patch.capacity < bookedCount) {
      return { ok: false, reason: "capacity_below_booked", detail: { bookedCount } };
    }

    // Divers and crew alike (`recordedRollCallRows`): a crew member counted
    // after a dive is history this edit may not orphan either.
    const checkpointRows = await recordedRollCallRows(tx, shopId, [tripId]);
    const [executed] = await tx
      .select({ lastDive: max(executedDives.diveNumber) })
      .from(executedDives)
      .where(
        and(
          eq(executedDives.shopId, shopId),
          eq(executedDives.tripId, tripId),
          isNull(executedDives.deletedAt),
        ),
      );
    const recordedDiveCount = Math.max(
      maxRecordedDiveNumber(checkpointRows),
      executed?.lastDive ?? 0,
    );
    if (plannedDives < recordedDiveCount) {
      return { ok: false, reason: "planned_dives_below_history", detail: { recordedDiveCount } };
    }

    const drafts = patch.dives ? normalizedDiveDrafts(plannedDives, patch.dives) : undefined;
    const sitesToValidate = drafts ?? (patch.diveSiteId ? [{ diveSiteId: patch.diveSiteId }] : []);
    if (!(await validateDiveSites(tx, shopId, sitesToValidate))) {
      return { ok: false, reason: "invalid" };
    }
    // The same tenant rule creating a departure applies: a hull named on an
    // edit has to be this shop's own live one, or this form becomes the
    // cross-tenant door `createTrip` closes (issue #679, PR #709). Written
    // here rather than imported because that PR is still open; once it lands
    // this is `validateBoat(tx, shopId, patch.boatId)` and the query goes.
    let replacementBoatName: string | null = null;
    if (patch.boatId !== undefined && patch.boatId !== null) {
      const [hull] = await tx
        .select({ id: boats.id, name: boats.name })
        .from(boats)
        .where(and(eq(boats.shopId, shopId), eq(boats.id, patch.boatId), isNull(boats.deletedAt)))
        .limit(1);
      if (!hull) return { ok: false, reason: "boat_not_found" };
      replacementBoatName = hull.name;
    }
    const changedAt = nowDate();
    const beforeArrival = tripArrivalSnapshot(existing);

    // **Does this edit move the calendar?** (issue #1165.) `trips.revision` is
    // published as RFC 5545 `SEQUENCE`, so it has to rise for the two facts a
    // subscribed client must re-alert on — the departure instant and the list
    // of sites the day visits — and for nothing else. A title, a price, a
    // capacity and a meeting-point note all leave it alone; the rule itself is
    // `src/lib/trip-revision.ts`, with no database in it.
    //
    // Read sequentially rather than fanned out: this is inside a transaction,
    // which is one checked-out client (`scripts/check-db-concurrency.mjs`).
    const existingDives = await tx
      .select({ diveNumber: tripDives.diveNumber, diveSiteId: tripDives.diveSiteId })
      .from(tripDives)
      .where(eq(tripDives.tripId, tripId));
    const beforeSites = tripSiteList(existingDives);
    // A patch with no `dives` leaves the plan exactly as it was, so its "after"
    // is its "before" — the dive rows are only replaced when `drafts` exists.
    const afterSites = drafts ? tripSiteList(drafts) : beforeSites;
    const nextDiveSiteId =
      patch.diveSiteId === undefined
        ? existing.diveSiteId
        : (patch.diveSiteId ?? (drafts ? primaryDiveSiteId(drafts) : null));
    const startMoved = patch.startsAt.getTime() !== existing.startsAt.getTime();
    const revisionMoved =
      startMoved ||
      tripSiteListChanged(beforeSites, afterSites) ||
      // The denormalized pointer counts on its own: it is what the feed reads
      // for `LOCATION` when the trip has no meeting point of its own.
      nextDiveSiteId !== existing.diveSiteId;

    const [trip] = await tx
      .update(trips)
      .set({
        ...(revisionMoved ? { revision: sql`${trips.revision} + 1` } : {}),
        title: patch.title,
        description: patch.description ?? null,
        meetingPointLabel: patch.meetingPointLabel ?? null,
        meetingPointAddress: patch.meetingPointAddress ?? null,
        ...(patch.arrivalLandmark === undefined ? {} : { arrivalLandmark: patch.arrivalLandmark }),
        ...(patch.arrivalParkingNote === undefined
          ? {}
          : { arrivalParkingNote: patch.arrivalParkingNote }),
        ...(patch.arrivalTransitNote === undefined
          ? {}
          : { arrivalTransitNote: patch.arrivalTransitNote }),
        ...(patch.arrivalLookFor === undefined ? {} : { arrivalLookFor: patch.arrivalLookFor }),
        ...(patch.arrivalFirstInteraction === undefined
          ? {}
          : { arrivalFirstInteraction: patch.arrivalFirstInteraction }),
        ...(patch.arrivalPhotoUrl === undefined ? {} : { arrivalPhotoUrl: patch.arrivalPhotoUrl }),
        startsAt: patch.startsAt,
        endsAt: patch.endsAt,
        capacity: patch.capacity,
        // **A rehearsal keeps no price, deposit or minimum** (ADR
        // 20261012-rehearsal-departures), whatever the details form posts: the
        // same coercion `insertTripInstance` applies at creation, held here in
        // SQL against the row's own flag so no edit can make one chargeable.
        priceCents: unlessRehearsal(patch.priceCents ?? null),
        depositCents: unlessRehearsal(patch.depositCents ?? null),
        cancellationWindowHours: unlessRehearsal(patch.cancellationWindowHours ?? null),
        minimumBookings: unlessRehearsal(patch.minimumBookings ?? null),
        minimumDecisionHours: unlessRehearsal(
          patch.minimumBookings ? (patch.minimumDecisionHours ?? null) : null,
        ),
        plannedDives,
        // Each omitted rather than defaulted: a caller that did not send the
        // field is not asking for a change.
        ...(patch.diveMode === undefined ? {} : { diveMode: patch.diveMode }),
        ...(patch.boatId === undefined ? {} : { boatId: patch.boatId }),
        ...(patch.lensId === undefined ? {} : { lensId: patch.lensId }),
        // A rehearsal stays private (`trips_rehearsal_is_private`): unticking
        // Private on one is a no-op rather than a constraint error.
        ...(patch.isPrivate === undefined
          ? {}
          : { isPrivate: sql<boolean>`(${trips.isRehearsal} or ${patch.isPrivate})` }),
        // **A course session is never self-guided** (issue #1342), the same
        // rule `insertTripInstance` applies to every creation door and for the
        // reason written out there: the mark silences only the shop's own
        // advisory divemaster target, and a departure running a course has an
        // instructor of record whether or not they are in the water. Coercing
        // to false can only add an advisory, never suppress one.
        //
        // Refused against the row's own course rather than the patch's,
        // because a trip's course is fixed at creation and `UpdateTripPatch`
        // carries none — which makes this unbypassable rather than merely
        // convenient. The detector is deliberately untouched: a course session
        // short of its instructor still raises the instructor gap (ADR
        // 20260827-self-guided-departures).
        ...(patch.selfGuided === undefined
          ? {}
          : { selfGuided: existing.courseId ? false : patch.selfGuided }),
        ...(patch.exceedsNoDecoLimits === undefined
          ? {}
          : { exceedsNoDecoLimits: patch.exceedsNoDecoLimits }),
        ...(patch.lunchAboard === undefined ? {} : { lunchAboard: patch.lunchAboard }),
        ...(patch.wetsuitThicknessMm === undefined
          ? {}
          : { wetsuitThicknessMm: patch.wetsuitThicknessMm }),
        ...(patch.diveSiteId === undefined
          ? {}
          : { diveSiteId: patch.diveSiteId ?? (drafts ? primaryDiveSiteId(drafts) : null) }),
      })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (!trip) return { ok: false, reason: "not_found" };
    if (startMoved) {
      await rebindDepartureBoatSafetyTime(
        tx,
        shopId,
        tripId,
        existing.startsAt,
        trip.startsAt,
        changedAt,
      );
    }
    // The existing snapshot is mutable until sailing. Keep the replacement
    // hull under the same trip lock as the swap, without deleting evidence.
    // Clearing the boat retains its named record; the log labels the mismatch.
    if (patch.boatId !== undefined && patch.boatId !== existing.boatId) {
      const kept = await departureBoatSafetySnapshot(tx, shopId, tripId);
      let snapshot: "refreshed" | "kept" | "none" = kept ? "kept" : "none";
      if (kept && patch.boatId !== null && !hasSailed(existing.startsAt, changedAt)) {
        const captured = await captureDepartureBoatSafety(tx, shopId, tripId, changedAt);
        if (captured === "captured") snapshot = "refreshed";
      }
      if (patch.changeActorPersonId) {
        // Historical identity, including a hull the center has since deleted.
        const [previousBoat] = existing.boatId
          ? await tx
              .select({ name: boats.name })
              .from(boats)
              .where(and(eq(boats.shopId, shopId), eq(boats.id, existing.boatId)))
              .limit(1)
          : [];
        await recordShopActivityWithin(tx, {
          shopId,
          actorPersonId: patch.changeActorPersonId,
          write: {
            code: "departure_boat_changed",
            tripId,
            fromBoat: previousBoat?.name ?? null,
            toBoat: replacementBoatName,
            snapshot,
          },
        });
      }
    }
    if (drafts) await replaceTripDives(tx, tripId, drafts);
    // The diver's "What changed" says the day's sites moved (issue #3060), in
    // this transaction, so the ledger never disagrees with the dives it names.
    if (revisionMoved) {
      await recordSiteRunChange(tx, {
        shopId,
        tripId,
        before: await tripSiteRunSnapshot(tx, shopId, beforeSites),
        after: await tripSiteRunSnapshot(tx, shopId, afterSites),
        actorPersonId: patch.changeActorPersonId,
        occurredAt: changedAt,
      });
    }
    let scheduleDaysMoved = false;
    if (patch.scheduleDays) {
      const before = await tx
        .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, tripId))
        .orderBy(asc(tripScheduleDays.dayNumber));
      const after = patch.scheduleDays;
      scheduleDaysMoved =
        before.length !== after.length ||
        before.some(
          (day, index) =>
            day.startsAt.getTime() !== after[index]?.startsAt.getTime() ||
            day.endsAt.getTime() !== after[index]?.endsAt.getTime(),
        );
      await tx.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, tripId));
      await tx
        .insert(tripScheduleDays)
        .values(patch.scheduleDays.map((day, index) => ({ tripId, ...day, dayNumber: index + 1 })));
    }
    const afterArrival = tripArrivalSnapshot(trip);
    if (!tripChangeSnapshotsEqual(beforeArrival, afterArrival)) {
      await recordTripChangeEvent(tx, {
        shopId,
        tripId,
        kind: "meeting_point",
        source: "shop",
        beforeValue: beforeArrival,
        afterValue: afterArrival,
        actorPersonId: patch.changeActorPersonId,
        occurredAt: changedAt,
      });
      // The crew-facing twin of the line above, written in the same
      // transaction so the diver's ledger and the manifest's catch-up strip
      // cannot disagree about whether the dock moved (#1202: "the dock point
      // moved"). The two tables are separate on purpose — one is publicly safe,
      // one is internal — and this is the only fact written to both.
      await recordDeskEvent(tx, {
        shopId,
        tripId,
        kind: "meeting_point",
        actorPersonId: patch.changeActorPersonId,
        occurredAt: changedAt,
      });
    }
    // The divers' reminders fire again for the new date (#2444).
    if (startMoved) await rearmTripReminders(tx, { shopId, tripId });
    // The crew hear a moved start time (#2283), the same notice the schedule
    // board's move records (`moveTrip`).
    if (existing.status === "scheduled" && startMoved) {
      await recordCrewTimeMoved(tx, {
        shopId,
        tripId,
        previousStartsAt: existing.startsAt,
        actorPersonId: patch.changeActorPersonId ?? null,
        now: changedAt,
      });
      timeMoved = true;
    }
    // The line the schedule builder's move files, for the same act made from
    // the departure's own form (#2313). Only when the times actually moved, in
    // this transaction, and in its own savepoint so the line can never undo the
    // edit.
    const timesMoved =
      existing.startsAt.getTime() !== patch.startsAt.getTime() ||
      existing.endsAt.getTime() !== patch.endsAt.getTime();
    timesChanged = timesMoved;
    // "Working it anyway" was said about the old days (#2678 reviews).
    if (timesMoved || scheduleDaysMoved) {
      await clearCrewAwayAcknowledgements(tx, { shopId, tripId });
    }
    if (timesMoved && patch.changeActorPersonId) {
      await recordShopActivityWithin(tx, {
        shopId,
        actorPersonId: patch.changeActorPersonId,
        write: { code: "departure_moved", tripId },
      });
    }
    return { ok: true, trip, startMoved };
  });
  // Late news goes now, not on the hour (`flushUrgentCrewNotices`).
  if (timeMoved) await flushUrgentCrewNotices(db, { shopId, tripIds: [tripId] });
  // Its manifest, and any charter whose training mark rests on its times.
  if (timesChanged) await publishManifestEvent(db, shopId, tripId);
  // **Marked as decompression diving: correct the fly-safe figure** (#2927).
  // Here, after the commit, so every door that sets the flag fires it, and a
  // send that throws never turns a saved departure into a failed save.
  if (outcome.ok && outcome.trip.exceedsNoDecoLimits) {
    return { ...outcome, flySafe: await flySafeCorrectionsAfterSave(db, shopId, tripId) };
  }
  return outcome;
}

async function flySafeCorrectionsAfterSave(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<FlySafeCorrectionOutcome | "failed"> {
  try {
    return await sendFlySafeCorrections(db, { shopId, tripId });
  } catch (error) {
    log("fly_safe.correction_failed", "error", {
      shopId,
      tripId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}

/** Ordered dive details for a trip, scoped through the owning shop. */
export async function listTripDives(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ dive: tripDives, diveSite: diveSites })
    .from(tripDives)
    .innerJoin(trips, eq(trips.id, tripDives.tripId))
    .leftJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
    .where(and(eq(tripDives.tripId, tripId), eq(trips.shopId, shopId), liveTrip()))
    .orderBy(asc(tripDives.diveNumber));
}

export type TripConditionsPatch = {
  conditionsHold?: boolean;
  conditionsSummary?: string;
  waterTemperatureC?: number;
  visibilityMeters?: number;
  surfaceConditions?: string;
  /** The staffer who published this conditions update, when known. */
  changeActorPersonId?: string | null;
};

export type SetParticipantTermsOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "invalid" }
  /** Fewer diver seats than divers already booked: the seats already sold stand. */
  | { ok: false; reason: "diver_seats_below_booked"; detail: { divers: number } };

/**
 * Save a departure's snorkeler price, rider price and divers-only limit (ADR
 * 20261007-participant-types; parsed by `parseParticipantTerms`).
 *
 * Under the trip-row lock every seat-granting write takes, for the reason
 * `updateTrip` refuses a capacity below the booked count: a divers-only limit
 * lowered beneath the divers already aboard would leave a manifest no rule
 * agrees with. Refused, typed, never silently clamped. The limit is also held
 * to the boat's own capacity here, against the row as it is now rather than as
 * the form saw it.
 */
export async function setTripParticipantTerms(
  db: AppDb,
  shopId: string,
  tripId: string,
  patch: ParticipantTermsPatch,
): Promise<SetParticipantTermsOutcome> {
  const outcome = await db.transaction(async (tx): Promise<SetParticipantTermsOutcome> => {
    const [trip] = await tx
      .select({ id: trips.id, capacity: trips.capacity })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return { ok: false, reason: "not_found" };
    if (patch.diverCapacity !== null && patch.diverCapacity > trip.capacity) {
      return { ok: false, reason: "invalid" };
    }
    if (patch.diverCapacity !== null) {
      const held = await heldSeatCounts(tx, shopId, trip.id);
      if (held.divers > patch.diverCapacity) {
        return { ok: false, reason: "diver_seats_below_booked", detail: { divers: held.divers } };
      }
    }
    await tx
      .update(trips)
      .set({
        snorkelerPriceCents: patch.snorkelerPriceCents,
        riderPriceCents: patch.riderPriceCents,
        diverCapacity: patch.diverCapacity,
      })
      .where(and(eq(trips.id, trip.id), eq(trips.shopId, shopId)));
    return { ok: true };
  });
  return outcome;
}

/**
 * Forecasts belong to the dated charter and are explicitly timestamped.
 *
 * **Deliberately never touches `trips.revision`** (issue #1165). A conditions
 * note is published as `SEQUENCE` by nothing: bumping the counter here would
 * re-alert every diver's calendar every time the crew typed "vis is 40ft
 * today", which is the exact notification noise the calendar boundary rules
 * out. `setTripStatus` is the same — a cancelled departure leaves the feed by
 * losing its UID, not by being re-issued at a higher revision.
 */
export async function updateTripConditions(
  db: AppDb,
  shopId: string,
  tripId: string,
  patch: TripConditionsPatch,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        conditionsHold: trips.conditionsHold,
        conditionsSummary: trips.conditionsSummary,
        waterTemperatureC: trips.waterTemperatureC,
        visibilityMeters: trips.visibilityMeters,
        surfaceConditions: trips.surfaceConditions,
      })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!before) return { trip: null, holdStarted: false };

    const changedAt = nowDate();
    const beforeConditions = tripConditionsSnapshot(before);
    const [trip] = await tx
      .update(trips)
      .set({
        // Undefined means this conditions-only edit does not change the hold.
        conditionsHold: patch.conditionsHold,
        conditionsSummary: patch.conditionsSummary || null,
        waterTemperatureC: patch.waterTemperatureC ?? null,
        visibilityMeters: patch.visibilityMeters ?? null,
        surfaceConditions: patch.surfaceConditions || null,
        conditionsUpdatedAt: changedAt,
      })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (trip && !tripChangeSnapshotsEqual(beforeConditions, tripConditionsSnapshot(trip))) {
      await recordTripChangeEvent(tx, {
        shopId,
        tripId,
        kind: "conditions",
        source: "crew",
        beforeValue: beforeConditions,
        afterValue: tripConditionsSnapshot(trip),
        actorPersonId: patch.changeActorPersonId,
        occurredAt: changedAt,
      });
    }
    return {
      trip: trip ?? null,
      holdStarted: patch.conditionsHold === true && !before.conditionsHold,
    };
  });
}

/** Whether anybody, diver or crew, has a roll-call or boarding event on this trip. */
export function rollCallStartedOn(tripId: SQLWrapper | string): SQL<boolean> {
  return sql<boolean>`(exists (select 1 from ${rollCallEvents} where ${rollCallEvents.tripId} = ${tripId}) or exists (select 1 from ${rollCallCrewEvents} where ${rollCallCrewEvents.tripId} = ${tripId}))`.mapWith(
    Boolean,
  );
}

export async function setTripStatus(
  // Also callable inside a transaction: the blow-out cascade flips the status
  // through this same seam while holding the trip row lock (src/db/blowouts.ts).
  db: DbExecutor,
  shopId: string,
  tripId: string,
  status: "scheduled" | "cancelled",
  now: Date = nowDate(),
  options: { actorPersonId?: string | null } = {},
) {
  // Only a real call-off is news to the crew: a departure already cancelled
  // being cancelled again tells nobody twice.
  const [before] =
    status === "cancelled"
      ? await db
          .select({ status: trips.status })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
          .limit(1)
      : [];
  const [trip] = await db
    .update(trips)
    // Stamped on the way into `cancelled` and **cleared** on the way back to
    // `scheduled`: an un-cancelled departure that kept a stale cancellation date
    // would tell the owed-refund queue it had been owed since the day the shop
    // changed its mind, and would put a date on a trip that is sailing.
    .set({ status, cancelledAt: status === "cancelled" ? now : null })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .returning();
  // A cancelled departure keeps its bookings, so the booking cascade never
  // frees the gear reserved against it — release the un-collected units here,
  // on the same executor (and so inside the blow-out's transaction when there
  // is one). Reinstating does not resurrect them: the units went back on the
  // wall, and prep re-assigns from what is actually free.
  if (trip && status === "cancelled") {
    await releaseUnclaimedGearReservationsForTrips(db, { shopId, tripIds: [tripId] });
    // The crew hear it was called off (ADR 20261009-crew-hear-about-their-boats);
    // the caller tells them once this commits (`flushUrgentCrewNotices`).
    if (before?.status === "scheduled") {
      await recordCrewCalledOff(db, {
        shopId,
        tripIds: [tripId],
        actorPersonId: options.actorPersonId ?? null,
        now,
      });
    }
  }
  return trip ?? null;
}

export async function listTripScheduleDays(db: DbExecutor, shopId: string, tripId: string) {
  const rows = await db
    .select({ day: tripScheduleDays })
    .from(tripScheduleDays)
    .innerJoin(trips, eq(trips.id, tripScheduleDays.tripId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .orderBy(asc(tripScheduleDays.dayNumber));
  return rows.map((row) => row.day);
}
