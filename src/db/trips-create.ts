import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import type { Course } from "./schema";
import {
  boats,
  courses,
  diveSites,
  tripDives,
  tripRequirements,
  tripScheduleDays,
  trips,
} from "./schema";

/**
 * Materializing a departure.
 *
 * `createTrip` is the one-off door; the same primitives below are what
 * `./trips-series.ts` uses for every instance of a recurring series and what
 * `./trips-schedule.ts` uses to copy one forward. They are exported for those
 * siblings only — `@/db/trips` deliberately re-exports just `createTrip` and
 * its input types, so a caller outside these modules cannot assemble a trip
 * without the dive, schedule-day, and requirement rows that make it readable
 * as a safety document.
 */

export type NewTrip = {
  shopId: string;
  courseId?: string;
  diveSiteId?: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  plannedDives?: number;
  dives?: TripDiveDraft[];
  priceCents?: number | null;
  depositCents?: number | null;
  cancellationWindowHours?: number | null;
  minimumBookings?: number | null;
  minimumDecisionHours?: number | null;
  scheduleDays?: TripScheduleDayInput[];
  isPrivate?: boolean;
  /** The shop's own divemaster target does not apply to this departure (issue #973). */
  selfGuided?: boolean;
  diveMode?: "boat" | "shore" | "pool";
  boatId?: string | null;
};

export type TripScheduleDayInput = {
  dayNumber: number;
  startsAt: Date;
  endsAt: Date;
};

export type TripDiveDraft = {
  title?: string | null;
  diveSiteId?: string | null;
  description?: string | null;
  /**
   * How long the boat runs to reach this dive's site — from the dock for dive
   * one, from the previous dive's site after that. Null (or absent) leaves the
   * leg on the shop's own `boat_ride_minutes`
   * (ADR 20260815-per-leg-travel-minutes).
   */
  travelMinutes?: number | null;
};

const MAX_TRIP_DIVES = 4;

export function normalizedDiveCount(plannedDives?: number) {
  const count = plannedDives ?? 2;
  return Number.isInteger(count) && count >= 1 && count <= MAX_TRIP_DIVES ? count : null;
}

export function normalizedDiveDrafts(plannedDives: number, drafts: TripDiveDraft[] | undefined) {
  return Array.from({ length: plannedDives }, (_, index) => {
    const draft = drafts?.[index];
    return {
      diveNumber: index + 1,
      title: draft?.title?.trim() || null,
      diveSiteId: draft?.diveSiteId || null,
      description: draft?.description?.trim() || null,
      // `?? null`, never `|| null`: 0 is a leg a shop can mean — the same site
      // twice, or a walk-in entry — and is not the same answer as "unset".
      travelMinutes: draft?.travelMinutes ?? null,
    };
  });
}

/**
 * What goes in `trips.dive_site_id`: the first dive that *has* a site, not
 * strictly dive one's.
 *
 * That column is a denormalized pointer with two consumers — the automated
 * marine forecast's coordinate and the calendar feed's `LOCATION` — and both
 * want any real site on the day rather than nothing. Reading dive one alone
 * left it null on a departure whose second tank was the planned one, so a trip
 * that plainly visits Spiegel Grove offered no forecast and no directions.
 *
 * It is never a *gate*: readiness and the depth advisory already union this
 * pointer with every `trip_dives` site (`tripVisitedSites` in src/db/readiness.ts),
 * and every surface that answers "where does this trip go" reads the dives
 * (`summarizeTripDiveSites`, src/lib/trip-dives.ts). Widening it here can only
 * add a site the trip already visits, never change what anyone is cleared for.
 */
export function primaryDiveSiteId(drafts: Array<{ diveSiteId: string | null }>): string | null {
  return drafts.find((draft) => draft.diveSiteId)?.diveSiteId ?? null;
}

export async function validateDiveSites(
  db: DbExecutor,
  shopId: string,
  drafts: Array<{ diveSiteId: string | null }>,
) {
  const siteIds = drafts.map((draft) => draft.diveSiteId).filter((id): id is string => Boolean(id));
  if (siteIds.length === 0) return true;
  const sites = await db
    .select({ id: diveSites.id })
    .from(diveSites)
    .where(
      and(
        eq(diveSites.shopId, shopId),
        inArray(diveSites.id, siteIds),
        isNull(diveSites.deletedAt),
      ),
    );
  return sites.length === new Set(siteIds).size;
}

export async function replaceTripDives(
  db: DbExecutor,
  tripId: string,
  drafts: ReturnType<typeof normalizedDiveDrafts>,
) {
  await db.delete(tripDives).where(eq(tripDives.tripId, tripId));
  await db.insert(tripDives).values(drafts.map((draft) => ({ tripId, ...draft })));
}

/** Resolve and validate an optional course reference inside a transaction. */
/**
 * **Is this hull actually this shop's?**
 *
 * The sibling of `validateDiveSites` above, and it did not exist:
 * `trips.boat_id` was written straight through to the insert unread, while the
 * course and every dive site beside it were checked. The column's foreign key
 * is `references(() => boats.id)` — global, with no shop in it — and the board
 * parses the field as a bare `z.uuid()`, so submitting another shop's boat id
 * was one devtools edit on a `<select>`.
 *
 * Everything that follows is cross-tenant: the other shop's vessel **name**
 * renders on this board's card and anywhere the departure names its boat, the
 * row travels in this shop's export bundle, and the other shop deleting that
 * hull reaches into this one's departure. `duplicateTrip` then copies the id
 * forward on every copy.
 *
 * Scoped to the shop and nothing else. Refusing a *deleted* hull belongs here
 * too — assigning one is a new departure naming a boat the shop has retired,
 * not history — but `boats` has no `deleted_at` on this branch; it arrives with
 * the soft-delete change (issue #680), and the clause goes in with it.
 */
export async function validateBoat(
  db: DbExecutor,
  shopId: string,
  boatId: string | null | undefined,
) {
  if (!boatId) return true;
  const [boat] = await db
    .select({ id: boats.id })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
    .limit(1);
  return Boolean(boat);
}

export async function resolveCourse(
  tx: AppTransaction,
  shopId: string,
  courseId: string | undefined,
): Promise<{ ok: boolean; course: Course | null }> {
  if (!courseId) return { ok: true, course: null };
  const course = (
    await tx
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId), eq(courses.isActive, true)))
      .limit(1)
  )[0];
  return course ? { ok: true, course } : { ok: false, course: null };
}

/**
 * Insert one trip plus its dives and readiness requirements. The single source
 * of truth for materializing a trip so a one-off and every instance of a series
 * share identical dive and requirement wiring — a missing requirement row is a
 * readiness blocker, never an accidental pass, and a course session snapshots
 * its catalog baseline against later catalog edits.
 */
export async function insertTripInstance(
  tx: AppTransaction,
  params: {
    shopId: string;
    seriesId?: string;
    /** The cadence slot a series instance fills — see `trips.series_occurrence_date`. */
    seriesOccurrenceDate?: string;
    courseId?: string;
    course: Course | null;
    title: string;
    description?: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    plannedDives: number;
    priceCents?: number | null;
    depositCents?: number | null;
    cancellationWindowHours?: number | null;
    minimumBookings?: number | null;
    minimumDecisionHours?: number | null;
    drafts: ReturnType<typeof normalizedDiveDrafts>;
    scheduleDays?: TripScheduleDayInput[];
    isPrivate?: boolean;
    /** The shop's own divemaster target does not apply to this departure (issue #973). */
    selfGuided?: boolean;
    diveMode?: "boat" | "shore" | "pool";
    boatId?: string | null;
  },
) {
  const [trip] = await tx
    .insert(trips)
    .values({
      shopId: params.shopId,
      seriesId: params.seriesId,
      seriesOccurrenceDate: params.seriesOccurrenceDate,
      courseId: params.courseId,
      title: params.title,
      description: params.description,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      capacity: params.capacity,
      priceCents: params.priceCents,
      depositCents: params.depositCents,
      cancellationWindowHours: params.cancellationWindowHours,
      minimumBookings: params.minimumBookings,
      minimumDecisionHours: params.minimumDecisionHours,
      plannedDives: params.plannedDives,
      diveSiteId: primaryDiveSiteId(params.drafts),
      isPrivate: params.isPrivate ?? false,
      // **A course session is never self-guided** (issue #1342). Self-guided
      // means the divers go in unguided in buddy pairs; a certification dive
      // requires the instructor present and supervising, under every agency the
      // glossary lists. The two cannot both be true of one departure.
      //
      // Coerced here rather than in `createTrip` because this is the one
      // function all three creation doors pass through: `createTrip`,
      // `duplicateTrip` (which copies `source.selfGuided` straight in) and the
      // series horizon roll (which copies `template.trip.selfGuided`, nightly,
      // forever — so one bad template would re-mint the state indefinitely).
      //
      // This refuses the *input*. It deliberately does not change the output
      // for a row that already holds it: `courseCrewGap` takes no `selfGuided`
      // parameter and must never grow one, so a course session short of its
      // instructor still raises the instructor gap (ADR
      // 20260827-self-guided-departures).
      selfGuided: params.courseId ? false : (params.selfGuided ?? false),
      diveMode: params.diveMode ?? "boat",
      boatId: params.boatId ?? null,
    })
    .returning();
  if (!trip) throw new Error("insertTripInstance: insert returned no row");
  await tx.insert(tripDives).values(params.drafts.map((draft) => ({ tripId: trip.id, ...draft })));
  await tx
    .insert(tripScheduleDays)
    .values(
      (params.scheduleDays?.length
        ? params.scheduleDays
        : [{ dayNumber: 1, startsAt: params.startsAt, endsAt: params.endsAt }]
      ).map((day, index) => ({ tripId: trip.id, ...day, dayNumber: index + 1 })),
    );
  await tx.insert(tripRequirements).values({
    tripId: trip.id,
    shopId: params.shopId,
    // Every trip starts waiver-gated; staff can lift it per trip, but nothing
    // in the catalog schedules an unsigned session by default.
    requiresWaiver: true,
    // A course session inherits its catalog baseline verbatim, including a
    // deliberate null: uncertified students are the whole point of Discover
    // Scuba and Open Water. `??` cannot tell "no course" from "a course open to
    // uncertified divers", and collapsing the two put an Open Water gate on
    // every entry-level class — which staff then clear by blanking the trip's
    // requirements, taking the waiver gate down with it.
    minimumCertificationLevel: params.course
      ? params.course.minimumCertificationLevel
      : "open_water",
  });
  return trip;
}

export async function createTrip(db: AppDb, input: NewTrip) {
  return db.transaction(async (tx) => {
    const plannedDives = normalizedDiveCount(input.plannedDives);
    if (!plannedDives) return null;
    const drafts = normalizedDiveDrafts(
      plannedDives,
      input.dives ?? (input.diveSiteId ? [{ diveSiteId: input.diveSiteId }] : undefined),
    );
    if (!(await validateDiveSites(tx, input.shopId, drafts))) return null;
    if (!(await validateBoat(tx, input.shopId, input.boatId))) return null;
    const { ok, course } = await resolveCourse(tx, input.shopId, input.courseId);
    if (!ok) return null;
    return insertTripInstance(tx, {
      shopId: input.shopId,
      courseId: input.courseId,
      course,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      plannedDives,
      priceCents: input.priceCents,
      depositCents: input.depositCents,
      cancellationWindowHours: input.cancellationWindowHours,
      minimumBookings: input.minimumBookings,
      minimumDecisionHours: input.minimumDecisionHours,
      drafts,
      scheduleDays: input.scheduleDays,
      isPrivate: input.isPrivate,
      selfGuided: input.selfGuided,
      diveMode: input.diveMode,
      boatId: input.boatId,
    });
  });
}
