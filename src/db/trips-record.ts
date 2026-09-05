import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type { TripCrewRole } from "@/lib/crew-roles";
import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import type { SpokenLanguageTag } from "@/lib/spoken-languages";
import {
  tripArrivalSnapshot,
  tripChangeSnapshotsEqual,
  tripConditionsSnapshot,
} from "@/lib/trip-change-events";
import type { TripDiveMode } from "@/lib/trip-details";
import type { AppDb, DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { releaseUnclaimedGearReservationsForTrips } from "./gear";
import type { Trip } from "./schema";
import {
  boats,
  bookings,
  courses,
  diveSites,
  people,
  personRoles,
  rollCallEvents,
  tripAssignments,
  tripDives,
  tripScheduleDays,
  trips,
  userAccounts,
} from "./schema";
import { recordTripChangeEvent } from "./trip-change-events";
import {
  normalizedDiveCount,
  normalizedDiveDrafts,
  primaryDiveSiteId,
  replaceTripDives,
  type TripDiveDraft,
  type TripScheduleDayInput,
  validateDiveSites,
} from "./trips-create";
import { liveTrip } from "./trips-live";

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

/** Trip scoped to a shop (staff pages must never cross tenants), with booked count. */
export async function getTripWithBooked(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ trip: trips, course: courses, diveSite: diveSites, booked: count(bookings.id) })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .groupBy(trips.id, courses.id, diveSites.id)
    .limit(1);
  const row = rows[0];
  return row
    ? { ...row.trip, course: row.course, diveSite: row.diveSite, booked: row.booked }
    : null;
}

/**
 * Primary-subtag languages this trip's current bookings actually signalled —
 * `people.locale`, only ever written from a request the diver themselves made
 * (`src/db/schema.ts`), never a default fallback. Feeds the quiet crew-
 * language coverage note (`crewLanguageGap`, issue #708): a diver who never
 * signalled a preference correctly contributes nothing to compare against.
 */
export async function bookedDiverLanguages(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ locale: people.locale })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.tripId, tripId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    );
  const languages = rows
    .map((row) => row.locale)
    .filter((locale): locale is string => locale !== null)
    .map((locale) => locale.split("-")[0]);
  return [...new Set(languages)];
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

/** One dive site's diver-facing preview facts — no shop-internal fields. */
export type TripSitePeek = {
  name: string;
  description: string | null;
  /** A `dive_site_difficulty` code; the surface prints a translated label. */
  difficultyLevel: DiveSiteDifficulty | null;
  depthRange: string | null;
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
};

export type UpdateTripOutcome =
  | { ok: true; trip: Trip }
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
export async function updateTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  patch: TripPatch,
): Promise<UpdateTripOutcome> {
  return db.transaction(async (tx) => {
    const plannedDives = normalizedDiveCount(patch.plannedDives);
    if (!plannedDives) return { ok: false, reason: "invalid" };

    const [existing] = await tx
      .select({
        id: trips.id,
        // Read so `selfGuided` can be refused against it below. A trip's course
        // is fixed at creation and `UpdateTripPatch` carries no `courseId`, so
        // the row's own value is the only place to learn it.
        courseId: trips.courseId,
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

    const [{ bookedCount }] = await tx
      .select({ bookedCount: count() })
      .from(bookings)
      .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
    if (patch.capacity < bookedCount) {
      return { ok: false, reason: "capacity_below_booked", detail: { bookedCount } };
    }

    const checkpointRows = await tx
      .select({
        bookingId: rollCallEvents.bookingId,
        checkpoint: rollCallEvents.checkpoint,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
        createdAt: rollCallEvents.createdAt,
        // Selected so a mis-tap and its `cleared` written in one transaction
        // resolve to the retraction rather than to heap order — see
        // `maxRecordedDiveNumber`'s `seq` doc.
        seq: rollCallEvents.seq,
      })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, tripId));
    const recordedDiveCount = maxRecordedDiveNumber(checkpointRows);
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
    if (patch.boatId !== undefined && patch.boatId !== null) {
      const [hull] = await tx
        .select({ id: boats.id })
        .from(boats)
        .where(and(eq(boats.shopId, shopId), eq(boats.id, patch.boatId), isNull(boats.deletedAt)))
        .limit(1);
      if (!hull) return { ok: false, reason: "boat_not_found" };
    }
    const changedAt = nowDate();
    const beforeArrival = tripArrivalSnapshot(existing);
    const [trip] = await tx
      .update(trips)
      .set({
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
        priceCents: patch.priceCents ?? null,
        depositCents: patch.depositCents ?? null,
        cancellationWindowHours: patch.cancellationWindowHours ?? null,
        minimumBookings: patch.minimumBookings ?? null,
        minimumDecisionHours: patch.minimumBookings ? (patch.minimumDecisionHours ?? null) : null,
        plannedDives,
        // Each omitted rather than defaulted: a caller that did not send the
        // field is not asking for a change.
        ...(patch.diveMode === undefined ? {} : { diveMode: patch.diveMode }),
        ...(patch.boatId === undefined ? {} : { boatId: patch.boatId }),
        ...(patch.lensId === undefined ? {} : { lensId: patch.lensId }),
        ...(patch.isPrivate === undefined ? {} : { isPrivate: patch.isPrivate }),
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
        ...(patch.diveSiteId === undefined
          ? {}
          : { diveSiteId: patch.diveSiteId ?? (drafts ? primaryDiveSiteId(drafts) : null) }),
      })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (!trip) return { ok: false, reason: "not_found" };
    if (drafts) await replaceTripDives(tx, tripId, drafts);
    if (patch.scheduleDays) {
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
    return { ok: true, trip };
  });
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

/** Forecasts belong to the dated charter and are explicitly timestamped. */
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

export async function setTripStatus(
  // Also callable inside a transaction: the blow-out cascade flips the status
  // through this same seam while holding the trip row lock (src/db/blowouts.ts).
  db: DbExecutor,
  shopId: string,
  tripId: string,
  status: "scheduled" | "cancelled",
  now: Date = nowDate(),
) {
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
