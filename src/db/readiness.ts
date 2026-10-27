import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { outstandingCourseForms } from "@/lib/course-forms";
import { checkDepthCeiling, diverDepthLimit } from "@/lib/depth-ceiling";
import { type CourseSeatInTraining, courseEndedBefore, inTrainingBefore } from "@/lib/in-training";
import {
  isDiver,
  isHeldToMedical,
  type ParticipantType,
  participantPriceCents,
} from "@/lib/participant-types";
import type {
  CardUnreviewRefusal,
  CertificationLevel,
  ReadinessResult,
  SiteCertRequirement,
} from "@/lib/readiness";
import {
  BLOCKER_CATEGORY,
  calculateReadiness,
  cardUndoRefusal,
  combineSiteRequirements,
  isUnsightedSelfDeclaration,
  needsCardSighting,
  noCertificationStands,
  unavailableReadiness,
  unreviewedCardState,
} from "@/lib/readiness";
import { parseRequirement, requirementDemandsNothing, unionRequirements } from "@/lib/requirement";
import {
  type TrainingMarkState,
  trainingDiveAsksNoCard,
  trainingDiveLevel,
} from "@/lib/training-mark";
import { isUuid } from "@/lib/uuid";
import {
  effectiveReleaseForRiderSeat,
  effectiveWaiverForBooking,
  overriddenReferral,
  overriddenRefusal,
  releaseLapseForBooking,
  riderMedicalHold,
  waiverClockInstant,
} from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import { listCourseSeatsInTraining } from "./certifications-in-training";
import type { AppDb, DbExecutor } from "./client";
import { courseFormSignaturesForBookings, requiredCourseFormsForTrips } from "./course-forms";
import { publishManifestEventsForPerson } from "./manifest-events";
import { paymentsByBooking } from "./payments";
import { isUniqueConstraintViolation, queryAll } from "./query-helpers";
import type { Certification, CertificationAgency, DiveSpecialty } from "./schema";
import {
  bookings,
  certificationAgency,
  certifications,
  courses,
  diveSites,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
  tripDives,
  tripRequirements,
  trips,
} from "./schema";
import { type MarkedSeat, resolveTrainingMarks } from "./training-mark-resolve";
import { liveTrip } from "./trips-live";
import {
  getCurrentWaiverGeneration,
  listSignedWaiversByPerson,
  listTripsWaiverStatuses,
} from "./waivers";

export async function getTripRequirements(db: DbExecutor, shopId: string, tripId: string) {
  const [requirement] = await db
    .select()
    .from(tripRequirements)
    .where(and(eq(tripRequirements.shopId, shopId), eq(tripRequirements.tripId, tripId)))
    .limit(1);
  return requirement ?? null;
}

type CertLevel = "open_water" | "advanced_open_water" | "rescue" | "divemaster" | "instructor";

export async function upsertTripRequirements(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    requiresWaiver: boolean;
    minimumCertificationLevel: CertLevel | null;
    requiredSpecialties: DiveSpecialty[];
    requiresNitrox: boolean;
    requiresPayment: boolean;
  },
) {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return null;
  const [requirement] = await db
    .insert(tripRequirements)
    .values(input)
    .onConflictDoUpdate({
      target: tripRequirements.tripId,
      set: {
        requiresWaiver: input.requiresWaiver,
        minimumCertificationLevel: input.minimumCertificationLevel,
        requiredSpecialties: input.requiredSpecialties,
        requiresNitrox: input.requiresNitrox,
        requiresPayment: input.requiresPayment,
        updatedAt: nowDate(),
      },
    })
    .returning();
  return requirement ?? null;
}

/**
 * Every site a trip visits, for the cert gate — its primary site *and* every
 * site on its ordered dives. `trip_dives.dive_site_id` is nullable (a planned
 * dive with no site chosen yet is legal), and the `in (…)` simply never matches
 * those rows.
 *
 * Like `getTripMaxDepthMeters` this deliberately does not filter
 * `dive_sites.deleted_at`: a deleted briefing still governs the historical
 * trip it is attached to. The choice is inherited from the depth advisory
 * rather than decided here — change both together or neither.
 */
function tripVisitedSites(db: DbExecutor, shopId: string, tripId: string) {
  return (
    db
      .select({
        tripId: trips.id,
        minimumCertificationLevel: diveSites.minimumCertificationLevel,
        requiredSpecialties: diveSites.requiredSpecialties,
        requiresNitrox: diveSites.requiresNitrox,
      })
      .from(trips)
      .innerJoin(
        diveSites,
        sql`${diveSites.id} = ${trips.diveSiteId} or ${diveSites.id} in (
          select ${tripDives.diveSiteId} from ${tripDives} where ${tripDives.tripId} = ${trips.id}
        )`,
      )
      // `dive_sites.shop_id` as well as the trip's: the join above reaches sites
      // through two paths, so shop ownership is proven on the query rather than
      // assumed from the trip's pointer (the CR-007 house rule).
      .where(
        and(
          eq(trips.id, tripId),
          eq(trips.shopId, shopId),
          eq(diveSites.shopId, shopId),
          liveTrip(),
        ),
      )
  );
}

/**
 * The inherent cert gate of every dive site a trip visits, folded into one
 * requirement (strictest level, union of specialties, OR of nitrox), or null
 * when the trip has no site or no visited site demands anything. Composed with
 * the trip's own requirement by the readiness service — never a standalone gate.
 *
 * Reading only the primary site is how a deep second-dive site never reached
 * the gate: the depth advisory already spanned the whole itinerary, and the
 * cert/specialty/nitrox gate now matches it.
 */
export async function getTripSiteRequirement(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<SiteCertRequirement | null> {
  const rows = await tripVisitedSites(db, shopId, tripId);
  return combineSiteRequirements(rows);
}

/**
 * **The gate every departure on a page imposes**, composed the same way
 * `getTripRequirements` + `getTripSiteRequirement` compose it for one trip —
 * the trip's own requirement folded with every site it visits — but in two
 * reads for the whole page instead of two per card.
 *
 * A trip appears in the returned map only when it demands *something*. That is
 * the contract the caller needs, because the rule on the public schedule is
 * that a departure asking nothing of anybody renders nothing at all: "no card
 * needed" on every ordinary reef charter is the absence of a rule dressed up as
 * a rule, which is what got "Payment: not required" deleted from the staff
 * summary (issue #695, docs/design/principles.md).
 *
 * The site half reaches through both paths a trip can name a site by — the
 * `trips.dive_site_id` pointer and its ordered dives — for the reason
 * `combineSiteRequirements` exists at all: reading only the primary site goes
 * quiet on exactly the two-tank day where dive two is the one that needs the
 * card. Shop ownership is proven on the query rather than inherited from the
 * trip's pointer (the CR-007 house rule), and `dive_sites.deleted_at` is
 * deliberately not filtered, inherited from the depth advisory — change all
 * three together or none.
 */
export async function tripRequirementSummaries(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, SiteCertRequirement>> {
  if (tripIds.length === 0) return new Map();
  // `queryAll`, not `Promise.all`: this takes a `DbExecutor`, so it may be
  // handed a transaction — one pinned client, where a fan-out is queued rather
  // than parallel (src/db/client.ts).
  const [ownRows, siteRows] = await queryAll(db, [
    () =>
      db
        .select({
          tripId: tripRequirements.tripId,
          minimumCertificationLevel: tripRequirements.minimumCertificationLevel,
          requiredSpecialties: tripRequirements.requiredSpecialties,
          requiresNitrox: tripRequirements.requiresNitrox,
        })
        .from(tripRequirements)
        .where(and(eq(tripRequirements.shopId, shopId), inArray(tripRequirements.tripId, tripIds))),
    () =>
      db
        .select({
          tripId: trips.id,
          minimumCertificationLevel: diveSites.minimumCertificationLevel,
          requiredSpecialties: diveSites.requiredSpecialties,
          requiresNitrox: diveSites.requiresNitrox,
        })
        .from(trips)
        .innerJoin(
          diveSites,
          sql`${diveSites.id} = ${trips.diveSiteId} or ${diveSites.id} in (
            select ${tripDives.diveSiteId} from ${tripDives} where ${tripDives.tripId} = ${trips.id}
          )`,
        )
        .where(
          and(
            inArray(trips.id, tripIds),
            eq(trips.shopId, shopId),
            eq(diveSites.shopId, shopId),
            liveTrip(),
          ),
        ),
  ]);

  const byTrip = new Map<string, SiteCertRequirement>();
  for (const row of [...ownRows, ...siteRows]) {
    byTrip.set(row.tripId, unionRequirements(byTrip.get(row.tripId), parseRequirement(row)));
  }

  const demanding = new Map<string, SiteCertRequirement>();
  for (const [tripId, requirement] of byTrip) {
    if (!requirementDemandsNothing(requirement)) demanding.set(tripId, requirement);
  }
  return demanding;
}

/**
 * The deepest recorded site the trip actually visits — its primary site *and*
 * every site on its ordered dives, because a warning that only looked at the
 * first one would go quiet on exactly the two-tank day where dive two is the
 * deep one.
 *
 * Null when no visited site has a depth on file. `max()` over a nullable column
 * ignores nulls in SQL, which is the behavior we want: one unrecorded site does
 * not erase the depth of the site next to it.
 */
export async function getTripMaxDepthMeters(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number | null> {
  const [row] = await db
    .select({
      maxDepth: sql<number | null>`max(${diveSites.maxDepthMeters})`,
    })
    .from(trips)
    .innerJoin(
      diveSites,
      sql`${diveSites.id} = ${trips.diveSiteId} or ${diveSites.id} in (
        select ${tripDives.diveSiteId} from ${tripDives} where ${tripDives.tripId} = ${trips.id}
      )`,
    )
    // `dive_sites.shop_id` as well as the trip's: the join above reaches sites
    // through two paths, and proving the row belongs to this shop on the query
    // beats relying on the invariant that a trip never points at a foreign
    // site (the CR-007 house rule).
    .where(
      and(eq(trips.id, tripId), eq(trips.shopId, shopId), eq(diveSites.shopId, shopId), liveTrip()),
    );
  return row?.maxDepth ?? null;
}

export type NewCertification = {
  shopId: string;
  personId: string;
  agency: CertificationAgency;
  level: "open_water" | "advanced_open_water" | "rescue" | "divemaster" | "instructor";
  identifier: string;
  /**
   * **The diver typed this about themselves.** Set only by the diver-facing
   * entry form on `/ready/[token]`; a staff capture leaves it unset, because a
   * staffer is looking at the card.
   *
   * It is not decoration. `reviewCertification` asks for the agency and number
   * off the physical card before it will promote a row `isUnsightedSelfDeclaration`
   * is true of, and without this stamp a number typed on a phone would inherit
   * the one-tap "Mark certified" a colleague's transcription gets — laundering
   * an invented card into `verified`, which is the state readiness, the fill
   * gate and every depth ceiling read (`security-reviewer`, 2026-08-20).
   */
  selfDeclaredAt?: Date;
};

/**
 * Resolve the person whose name a certification review may carry. A review is
 * evidence that opens a safety gate, so its accountable name must be a live
 * staff member of this same shop — never a stale session, deleted staff row,
 * or arbitrary UUID supplied to a low-level caller.
 */
export async function activeCertificationReviewerId(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  return roles && isStaff(roles) ? personId : null;
}

/**
 * Evidence is captured pending; a separate, explicit review makes it usable for
 * readiness. Refuses (returns null) rather than throwing when a live card
 * already holds the same shop/agency/identifier in any case — the
 * case-insensitive partial unique index would reject it anyway (CR-009).
 */
export async function createCertification(db: AppDb, input: NewCertification) {
  try {
    return await db.transaction(async (tx) => {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        // diveday:allow-deleted-people: removed records retain cards for restoration.
        .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
        .limit(1)
        .for("no key update");
      if (!person) return null;
      const [certification] = await tx
        .insert(certifications)
        .values({ ...input, identifier: input.identifier.trim() })
        .returning();
      return certification ?? null;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

/**
 * `courses.agency` is shop-typed free text (`normalizeAgency` in
 * src/lib/course-ratios.ts is its lowercase/trim twin for ratio matching);
 * `certifications.agency` is the fixed enum every readiness gate reads. A
 * shop that typed "PADI ", a typo, or an agency DiveDay's enum does not carry
 * (SEI, for one) must still get a real row rather than an uncaught cast
 * failure — `other` is the enum's own bucket for exactly this (see its
 * "Other agency" glossary entry), and the roster still shows the shop's own
 * spelling in `courses.agency` itself.
 */
function agencyFromCourseAgency(courseAgency: string | null): CertificationAgency {
  // A course with no stated agency yields "other", the same answer an
  // unrecognised one gets — never a throw, and never a guess at PADI.
  const normalized = (courseAgency ?? "").trim().toLowerCase();
  return (certificationAgency.enumValues.find((value) => value === normalized) ??
    "other") as CertificationAgency;
}

export type NewShopIssuedCertification = {
  shopId: string;
  personId: string;
  /** The course session that earned this card. Must be a live course trip of this shop. */
  tripId: string;
  /**
   * Picked by the instructor at the moment of the tap, never derived from
   * `courses.minimumCertificationLevel` — that field is the course's
   * *prerequisite* ("what do you need to get in"), not its *outcome* ("what
   * do you get for finishing"). The outcome is `courses.certifies_level`
   * (issue #2059), which only pre-selects the roster's choice; the tap decides.
   * Deriving one from the other would silently mint an Advanced Open Water
   * graduate an Open Water card (`minimumCertificationLevel` on an AOW
   * session), or fail outright on an entry-level course, whose prerequisite
   * is null.
   */
  level: CertificationLevel;
  /** The instructor (or any active staff member — the same H-48 trust boundary `reviewCertification` uses) whose tap this is. */
  issuedByPersonId: string;
};

/**
 * **This shop's own instructor certifies a diver, from the course session's
 * own roster** (issue #717) — the one path from "this shop taught and ran
 * this course" to "this shop's booking gate stops treating its own graduate
 * like a stranger's."
 *
 * Lands `verified` immediately, with no card number required —
 * `certifications.issuedByShopAt`'s doc comment carries the full reasoning
 * and the dive-domain-expert sign-off. A card number, when the agency's own
 * processing produces one, has no path back onto this row yet — this only
 * ever inserts, and today's other capture path (`createCertification`) only
 * ever inserts its own new row too, so a later-typed number lands as a
 * second, separate live card at the same level rather than completing this
 * one. Harmless for gating (either satisfies `validVerifiedCertification`)
 * but worth knowing before assuming this row grows a number in place.
 *
 * **Never automatic.** This is the only writer of `issuedByShopAt`, and it
 * is reached from exactly one place: an explicit per-student tap on that
 * session's own roster. A trip's status changing, a roll call closing, or
 * any other lifecycle event must never call this.
 *
 * Refuses (returns `null`) rather than throwing for every way the request
 * could be describing something other than what its own roster shows:
 * `issuedByPersonId` is not a live staff member of this shop, `tripId` does
 * not name a live course session of this shop, or `personId` does not hold a
 * live, non-cancelled booking on it. The last check is what ties this to the
 * *roster* rather than to any person id a caller might supply — the surface
 * this is reached from already only ever shows the tap beside a name on the
 * session's own list, and the write proves that rather than trusting it.
 * Also refuses a level the diver already holds a live `verified` card for
 * (any provenance) — a numberless row is invisible to the unique index that
 * would otherwise catch a repeat tap. That guard is a plain read inside the
 * same transaction as the write, serialized by locking the person's own row
 * `for("no key update")` first, which still conflicts with itself — without
 * it, two genuinely concurrent taps (a second tab, a retried submit over flaky
 * boat wifi) could both pass the check before either insert commits, since a
 * numberless row has no unique index to catch the duplicate the way every
 * other write to this table does.
 */
/**
 * Whether a trip's course can certify anyone: `not_a_certifying_course` for a
 * live course session whose course is an intro (a DSD, a Try Scuba, a
 * refresher), which issues no card. Shop-scoped like every read here; a trip
 * that is not a live course session of this shop answers `unknown` and is
 * left to the writers' own refusals.
 */
export async function courseCertifiesOnTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<"certifies" | "not_a_certifying_course" | "unknown"> {
  if (!isUuid(tripId)) return "unknown";
  const [row] = await db
    .select({ isIntroCourse: courses.isIntroCourse })
    .from(trips)
    .innerJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, trips.shopId)))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!row) return "unknown";
  return row.isIntroCourse ? "not_a_certifying_course" : "certifies";
}

/**
 * **The student this seat holds**, or null (issue #2226, reviews G4/Y2): the
 * person on a live diver's seat of this shop's session, whose identity is not
 * held (H-13). A snorkeler or a rider on a course session is a passenger, and
 * the session's roster never certifies one. The roster's Certify reads the
 * person from here, never from what the form posted.
 */
export async function studentOnSeat(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<string | null> {
  if (!isUuid(bookingId) || !isUuid(tripId) || !isUuid(shopId)) return null;
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        eq(bookings.participantType, "diver"),
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    .limit(1);
  return row?.personId ?? null;
}

export async function issueShopCertification(
  db: AppDb,
  input: NewShopIssuedCertification,
): Promise<Certification | null> {
  const issuedByPersonId = await activeCertificationReviewerId(
    db,
    input.shopId,
    input.issuedByPersonId,
  );
  if (!issuedByPersonId) return null;
  return db.transaction(async (tx) => {
    // Locked first and held for the rest of this transaction: two concurrent
    // calls for the same person now serialize here, so the "already holds
    // this level" check below and the insert that follows it act as one
    // atomic unit rather than a race either could win.
    // `no key update`, as `recordSelfDeclaredCards` takes it: a booking insert
    // naming this diver holds a `KEY SHARE` here, and `update` would conflict.
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      // diveday:allow-deleted-people: tenant proof for a card write; a removed record keeps its cards and may be restored.
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
      .limit(1)
      .for("no key update");
    if (!person) return null;
    const [trip] = await tx
      .select({ id: trips.id, courseId: trips.courseId })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip?.courseId) return null;
    const [course] = await tx
      .select({ agency: courses.agency, isIntroCourse: courses.isIntroCourse })
      .from(courses)
      .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, input.shopId)))
      .limit(1);
    // An intro session issues no card, whatever level the caller names.
    if (!course || course.isIntroCourse) return null;
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tripId, input.tripId),
          eq(bookings.personId, input.personId),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
          // A student's seat: a passenger is never certified, and a seat held
          // over who is on it certifies nobody (reviews G4/Y2 of #2226).
          eq(bookings.participantType, "diver"),
          isNull(bookings.identityUnconfirmedAt),
        ),
      )
      .limit(1);
    if (!booking) return null;
    // A numberless row is invisible to the unique index (CR-009's own "nulls
    // never collide" reasoning) — a second tap would otherwise mint a second
    // live row at the same level rather than refusing, unlike every other
    // path into this table. Checked by level alone, any provenance: re-issuing
    // a rung the diver already holds — verified, imported, or shop-issued
    // earlier — is redundant regardless of how the existing one arrived.
    const [existing] = await tx
      .select({ id: certifications.id })
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, input.shopId),
          eq(certifications.personId, input.personId),
          eq(certifications.level, input.level),
          eq(certifications.status, "verified"),
          isNull(certifications.deletedAt),
        ),
      )
      .limit(1);
    if (existing) return null;
    const now = nowDate();
    try {
      const [certification] = await tx
        .insert(certifications)
        .values({
          shopId: input.shopId,
          personId: input.personId,
          agency: agencyFromCourseAgency(course.agency),
          level: input.level,
          identifier: null,
          status: "verified",
          issuedByShopAt: now,
          issuedFromTripId: input.tripId,
          issuedByPersonId,
          // The instructor's own tap is the review — see issuedByShopAt's doc
          // comment. Stamping these too is what makes "Certified by {name} on
          // {date}" (the same line every other verified card carries) true for
          // this one rather than blank.
          reviewedAt: now,
          reviewedByPersonId: issuedByPersonId,
        })
        .returning();
      return certification ?? null;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return null;
      throw error;
    }
  });
}

/**
 * **What a staffer is looking at**, when the row they are verifying is only a
 * unverified so far.
 *
 * Every other pending card got here because a staffer already held something
 * and typed its number, so one tap ("Mark certified") is the whole review. A
 * self-declared row (`certifications.selfDeclaredAt`) has no number at all and
 * would otherwise inherit that one tap — promoting a stranger's typing to
 * `verified`, which is what readiness and the fill gate read.
 *
 * So verifying one asks for the agency and the card number in front of the
 * staffer. That is the same act as capturing a card, and it is the point at
 * which the diver's claim stops being the evidence.
 */
export type CardSighting = { agency: CertificationAgency; identifier: string };

/**
 * A **level** card's sighting also names the rung printed on it.
 *
 * The diver typed a level, and the likeliest reason a claim is wrong is that
 * they overstated it — so a sighting that copied the agency and number off a
 * genuine Open Water card while silently keeping "Instructor" from the claim
 * would launder the one field nobody checked into a `verified` row. Capturing a
 * card has always asked for the level; sighting one now asks the same question,
 * prefilled with the claim so the staffer has to look at it to leave it alone.
 *
 * The nitrox twin keeps the bare {@link CardSighting}: that table has no level.
 */
export type LevelCardSighting = CardSighting & { level: CertificationLevel };

export async function reviewCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified";
    reviewNote?: string;
    /** The active staffer who made this certification decision, if this is a live review. */
    reviewedByPersonId?: string;
    /** Required for, and only meaningful on, a still-unsighted self-declaration. */
    sighting?: LevelCardSighting;
    /**
     * The review is the agency's own lookup page naming this diver at this
     * level (H-105), read by `judgeAgencyPage`. Stamps `agencyCheckedAt`; a
     * still-unsighted self-declaration is never certified this way.
     */
    agencyChecked?: boolean;
  },
): Promise<
  { ok: true; certification: Certification } | { ok: false; reason: CertificationReviewRefusal }
> {
  const reviewedByPersonId = input.reviewedByPersonId
    ? await activeCertificationReviewerId(db, input.shopId, input.reviewedByPersonId)
    : null;
  if (input.reviewedByPersonId && !reviewedByPersonId) {
    return { ok: false, reason: "staff_not_found" };
  }
  // Read first: whether this row needs a sighting is a property of the row, and
  // an update that silently matched nothing is a different failure to report.
  const [existing] = await db
    .select({
      id: certifications.id,
      status: certifications.status,
      selfDeclaredAt: certifications.selfDeclaredAt,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        // A deleted card never comes back through a review, matching both
        // siblings (`reviewSpecialtyCertification`, `reviewNitroxCertification`
        // — a prior `security-reviewer` finding). It matters more now that the
        // self-declaration surface tells staff the right answer to a bad claim
        // is often to delete it: without this, replaying that form's POST would
        // restore the deleted row to the roster as `verified`.
        isNull(certifications.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };

  const sighting = isUnsightedSelfDeclaration(existing) ? input.sighting : undefined;
  if (
    isUnsightedSelfDeclaration(existing) &&
    (input.agencyChecked || !sighting?.identifier.trim())
  ) {
    // Also enforced by `certifications_identifier_present_unless_self_declared`
    // in the database, which would reject the update outright. This refusal
    // exists so the surface can say *what to do* instead of surfacing a
    // constraint violation.
    //
    // That sentence used to overstate the constraint: it read
    // `identifier is not null`, and `''` satisfies that, so the *blank* half of
    // this check was the application's alone. The constraint now tests
    // `length(btrim(identifier)) > 0` and the two agree (2026-08-15).
    return { ok: false, reason: "card_sighting_required" };
  }

  try {
    const [certification] = await db
      .update(certifications)
      .set({
        status: input.status,
        reviewNote: reviewNoteFor(input.reviewNote),
        reviewedAt: nowDate(),
        agencyCheckedAt: input.agencyChecked ? nowDate() : null,
        ...(reviewedByPersonId ? { reviewedByPersonId } : undefined),
        // Only ever written on the sighting path: a normal review must not be
        // able to rewrite the agency, number or level already on a captured
        // card. `level` rides with the other two because all three are read off
        // the same card in the staffer's hand, and promoting the diver's typed
        // rung while transcribing a genuine number is the one way a sighting
        // could certify something nobody looked at.
        ...(sighting
          ? {
              agency: sighting.agency,
              identifier: sighting.identifier.trim(),
              level: sighting.level,
            }
          : undefined),
      })
      .where(
        and(
          eq(certifications.id, input.certificationId),
          eq(certifications.shopId, input.shopId),
          isNull(certifications.deletedAt),
        ),
      )
      .returning();
    if (!certification) return { ok: false, reason: "not_found" };
    // Open and primed manifests re-read (issue #2613).
    await publishManifestEventsForPerson(db, input.shopId, certification.personId);
    return { ok: true, certification };
  } catch (error) {
    // The sighted number collides with a live card this shop already holds —
    // the same partial unique index `createCertification` refuses on (CR-009).
    if (isUniqueConstraintViolation(error)) return { ok: false, reason: "duplicate_card" };
    throw error;
  }
}

/**
 * **Take back a "Mark certified" tap.** The inverse of {@link reviewCertification}
 * for the one-tap path, driving the land-then-undo toast that replaced the
 * "Certification marked verified" banner.
 *
 * `unreviewedCardState` (src/lib/readiness.ts) owns the decision — including
 * the refusal on a card that needed a sighting, whose review rewrote the row
 * from the card in the staffer's hand and cannot be put back. Shop-scoped and
 * live-rows-only like every other write in this file, so a replayed submit can
 * neither reach another shop's evidence nor resurrect a deleted card.
 */
export async function unreviewCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string; reviewedAt: Date },
): Promise<{ ok: true } | { ok: false; reason: CardUnreviewRefusal }> {
  const undone = await reverseCertificationReview(db, input);
  if (!undone.ok) return undone;
  // Open and primed manifests re-read, so a clearance taken back is not shown
  // on the dock (issue #2613).
  await publishManifestEventsForPerson(db, input.shopId, undone.personId);
  return { ok: true };
}

/**
 * The write behind {@link unreviewCertification}, with no manifest event, for a
 * caller inside a transaction (`undoAgencyCheck`): the event goes out after the
 * commit, never before it, or a device could re-read the old evidence.
 */
export async function reverseCertificationReview(
  db: DbExecutor,
  input: {
    shopId: string;
    certificationId: string;
    /** The `reviewedAt` the Undo was offered for: a later review is `stale` (issue #2612). */
    reviewedAt: Date;
    /** Only the agency check's own Undo (`undoAgencyCheck`) reverses an agency-checked review. */
    reversingAgencyCheck?: boolean;
  },
): Promise<{ ok: true; personId: string } | { ok: false; reason: CardUnreviewRefusal }> {
  const [existing] = await db
    .select({
      personId: certifications.personId,
      status: certifications.status,
      reviewedAt: certifications.reviewedAt,
      agencyCheckedAt: certifications.agencyCheckedAt,
      selfDeclaredAt: certifications.selfDeclaredAt,
      issuedByShopAt: certifications.issuedByShopAt,
      importedAt: certifications.importedAt,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        isNull(certifications.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  const target = unreviewedCardState(existing);
  if (!target.ok) return target;
  const refusal = cardUndoRefusal(existing, input.reviewedAt, {
    reversingAgencyCheck: input.reversingAgencyCheck,
  });
  if (refusal) return { ok: false, reason: refusal };
  const [row] = await db
    .update(certifications)
    .set({
      status: target.status,
      reviewNote: null,
      reviewedAt: null,
      reviewedByPersonId: null,
      agencyCheckedAt: null,
    })
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        isNull(certifications.deletedAt),
        // The review that was offered, still: a review landing between the read
        // above and this write matches no row (issue #2612).
        eq(certifications.reviewedAt, input.reviewedAt),
        ...(input.reversingAgencyCheck ? [] : [isNull(certifications.agencyCheckedAt)]),
      ),
    )
    .returning({ id: certifications.id });
  return row ? { ok: true, personId: existing.personId } : { ok: false, reason: "stale" };
}

/** The specialty twin of {@link unreviewCertification}; same decision, same guards. */
export async function unreviewSpecialtyCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string; reviewedAt: Date },
): Promise<{ ok: true } | { ok: false; reason: CardUnreviewRefusal }> {
  const undone = await reverseSpecialtyReview(db, input);
  if (!undone.ok) return undone;
  await publishManifestEventsForPerson(db, input.shopId, undone.personId);
  return { ok: true };
}

/**
 * The write behind {@link unreviewSpecialtyCertification}, with no manifest
 * event, for a caller inside a transaction (`undoAgencyCheck`). See
 * {@link reverseCertificationReview}, whose guards it keeps.
 */
export async function reverseSpecialtyReview(
  db: DbExecutor,
  input: {
    shopId: string;
    certificationId: string;
    reviewedAt: Date;
    reversingAgencyCheck?: boolean;
  },
): Promise<{ ok: true; personId: string } | { ok: false; reason: CardUnreviewRefusal }> {
  const [existing] = await db
    .select({
      personId: specialtyCertifications.personId,
      status: specialtyCertifications.status,
      reviewedAt: specialtyCertifications.reviewedAt,
      agencyCheckedAt: specialtyCertifications.agencyCheckedAt,
      selfDeclaredAt: specialtyCertifications.selfDeclaredAt,
      issuedByShopAt: specialtyCertifications.issuedByShopAt,
      importedAt: specialtyCertifications.importedAt,
      // A listed card (layer 3): its note is the agency's words, never the
      // review's, and stays; and at an agency that numbers each card its
      // number may be a sighting (`unreviewedCardState`).
      listedFromCertificationId: specialtyCertifications.listedFromCertificationId,
      agency: specialtyCertifications.agency,
      reviewNote: specialtyCertifications.reviewNote,
    })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  // See `reverseNitroxReview`: an agency check never certifies a card that
  // needed a sighting, so its Undo puts back the number it was checked by.
  const target = unreviewedCardState(
    input.reversingAgencyCheck ? { ...existing, listedFromCertificationId: null } : existing,
  );
  if (!target.ok) return target;
  const refusal = cardUndoRefusal(existing, input.reviewedAt, {
    reversingAgencyCheck: input.reversingAgencyCheck,
  });
  if (refusal) return { ok: false, reason: refusal };
  const [row] = await db
    .update(specialtyCertifications)
    .set({
      status: target.status,
      reviewNote: existing.listedFromCertificationId ? existing.reviewNote : null,
      reviewedAt: null,
      reviewedByPersonId: null,
      agencyCheckedAt: null,
    })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        isNull(specialtyCertifications.deletedAt),
        eq(specialtyCertifications.reviewedAt, input.reviewedAt),
      ),
    )
    .returning({ id: specialtyCertifications.id });
  return row ? { ok: true, personId: existing.personId } : { ok: false, reason: "stale" };
}

/**
 * Delete a level card: it drops out of every readiness/roster read but the row
 * is kept for safety history (ADR 20260820-every-delete-is-soft, extending
 * 20260719-crud-archive-semantics). Shop-scoped so one shop can never touch
 * another's evidence; a no-op on a card already deleted.
 */
export async function deleteCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string; deletedByPersonId?: string },
) {
  const [row] = await db
    .update(certifications)
    .set({
      deletedAt: nowDate(),
      ...(input.deletedByPersonId ? { deletedByPersonId: input.deletedByPersonId } : {}),
    })
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        isNull(certifications.deletedAt),
      ),
    )
    .returning({ id: certifications.id });
  return Boolean(row);
}

/**
 * Undo a delete: bring a level card back into every readiness/roster read.
 * The inverse of `deleteCertification`, powering the land-then-undo affordance.
 * Refuses (returns false) when a live card already holds the same
 * shop/agency/identifier — the partial unique index would reject it, and a
 * re-entered card must never be clobbered by an undo.
 */
export async function restoreCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [deleted] = await db
    .select()
    .from(certifications)
    .where(
      and(eq(certifications.id, input.certificationId), eq(certifications.shopId, input.shopId)),
    )
    .limit(1);
  if (!deleted || deleted.deletedAt === null) return false;
  try {
    return await db.transaction(async (tx) => {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        // diveday:allow-deleted-people: deleted divers retain their cards for restoration.
        .where(and(eq(people.id, deleted.personId), eq(people.shopId, input.shopId)))
        .for("no key update");
      if (!person) return false;
      const [current] = await tx
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.id, input.certificationId),
            eq(certifications.shopId, input.shopId),
            eq(certifications.personId, person.id),
          ),
        )
        .limit(1);
      if (!current || current.deletedAt === null) return false;
      const [conflict] = await tx
        .select({ id: certifications.id })
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, input.shopId),
            eq(certifications.agency, current.agency),
            sql`lower(${certifications.identifier}) = lower(${current.identifier})`,
            isNull(certifications.deletedAt),
          ),
        )
        .limit(1);
      if (conflict) return false;
      const [row] = await tx
        .update(certifications)
        .set({ deletedAt: null, deletedByPersonId: null })
        .where(and(eq(certifications.id, current.id), eq(certifications.shopId, input.shopId)))
        .returning({ id: certifications.id });
      return Boolean(row);
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return false;
    throw error;
  }
}

export type NewSpecialtyCertification = {
  shopId: string;
  personId: string;
  agency: CertificationAgency;
  specialty: DiveSpecialty;
  identifier: string;
  /**
   * The diver typed this about themselves — see the column's own note in
   * `src/db/schema.ts`. Set only by the entry form on `/ready/[token]`; a staff
   * capture leaves it unset, because a staffer is looking at the card.
   */
  selfDeclaredAt?: Date;
};

/**
 * Same capture→verify contract as a level card: evidence starts pending.
 * Refuses (returns null) on a same-shop/agency/identifier collision in any
 * case, mirroring `createCertification` (CR-009).
 */
export async function createSpecialtyCertification(db: AppDb, input: NewSpecialtyCertification) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    // diveday:allow-deleted-people: tenant proof for a card write; a removed record keeps its cards and may be restored.
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  try {
    const [certification] = await db
      .insert(specialtyCertifications)
      .values({ ...input, identifier: input.identifier.trim() })
      .returning();
    return certification ?? null;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

/**
 * What a shop-issued **specialty or nitrox** card needs, beside the level
 * card's own {@link NewShopIssuedCertification}.
 *
 * No `identifier`, deliberately: the whole point is that the agency number has
 * not arrived yet. No `agency` either — it is read off the course the session
 * teaches, exactly as the level card's is, so an instructor cannot type one.
 */
export type NewShopIssuedSpecialty = {
  shopId: string;
  personId: string;
  /** The course session that earned this card. Must be a live course trip of this shop. */
  tripId: string;
  /** Which specialty this shop's class certifies. Chosen at the tap, never derived. */
  specialty: DiveSpecialty;
  /** The staff member whose tap this is — same H-48 trust boundary as `reviewCertification`. */
  issuedByPersonId: string;
};

/**
 * **This shop's own instructor records a specialty they just taught** (issue
 * #975) — and the row lands `pending`, clearing nothing.
 *
 * The level card's twin (`issueShopCertification` above) lands `verified` on
 * this same tap, because for a level card the instructor *is* the evidence
 * (ADR 20260824-shop-issued-certification-is-verified). This one does not, and
 * the difference is the point rather than an oversight:
 *
 * - This table's own precedent is stricter and was set deliberately. Even an
 *   **imported** specialty row — which the codebase trusts enough to clear a
 *   *level* gate on arrival — is held back from clearing its own gate until a
 *   staffer confirms it by hand ("a spreadsheet cell is not a card sighting",
 *   ADR 20260725-import-specialty-cards).
 * - A specialty is a yes/no gate on a materially riskier dive, and the nitrox
 *   twin authorizes a gas fill, which is the highest-consequence failure in
 *   this app.
 *
 * So what the tap buys is that the **record exists**: the diver who finished a
 * Deep class on Saturday is no longer invisible to their own shop on Sunday,
 * and the confirm is one tap away on their record instead of a card nobody
 * knows to look for. What it does not buy is the gate. Promoting the row asks
 * for the agency and the number off the physical card, exactly as an unsighted
 * self-declaration's confirm does (`needsCardSighting`).
 *
 * Structured like `issueShopCertification` throughout — the person row is
 * locked first so two concurrent taps serialize, the trip must be a live
 * course session of this shop, the diver must hold a live booking on it, and a
 * specialty the diver already holds is refused rather than duplicated. That
 * last check matters more here than there: a numberless row is invisible to the
 * unique index (nulls never collide), so nothing else would stop a second tap
 * minting a second live row.
 *
 * `null` on every refusal — the caller has one thing to say either way, and
 * there is no partial success to report.
 */
export async function issueShopSpecialtyCertification(
  db: AppDb,
  input: NewShopIssuedSpecialty,
): Promise<typeof specialtyCertifications.$inferSelect | null> {
  const issuedByPersonId = await activeCertificationReviewerId(
    db,
    input.shopId,
    input.issuedByPersonId,
  );
  if (!issuedByPersonId) return null;
  return db.transaction(async (tx) => {
    const context = await shopIssuedCourseContext(tx, input);
    if (!context) return null;
    // Any live row for this specialty, whatever its provenance or status:
    // re-issuing one the diver already has is redundant, and a second pending
    // row would give a staffer two identical things to confirm.
    const [existing] = await tx
      .select({ id: specialtyCertifications.id })
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, input.shopId),
          eq(specialtyCertifications.personId, input.personId),
          eq(specialtyCertifications.specialty, input.specialty),
          isNull(specialtyCertifications.deletedAt),
        ),
      )
      .limit(1);
    if (existing) return null;
    try {
      const [certification] = await tx
        .insert(specialtyCertifications)
        .values({
          shopId: input.shopId,
          personId: input.personId,
          agency: agencyFromCourseAgency(context.courseAgency),
          specialty: input.specialty,
          identifier: null,
          // **Not `verified`.** See this function's own doc comment; the
          // database's check constraint enforces the pairing from underneath,
          // so a future edit that flips this to `verified` fails the insert
          // rather than silently opening a depth gate.
          status: "pending",
          issuedByShopAt: nowDate(),
          issuedFromTripId: input.tripId,
          issuedByPersonId,
          // Deliberately **not** stamped `reviewedAt`/`reviewedByPersonId`,
          // unlike the level card's twin. Nobody has reviewed this; a staffer
          // still has to, and those columns are what "Confirmed by {name} on
          // {date}" reads from.
        })
        .returning();
      return certification ?? null;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return null;
      throw error;
    }
  });
}

/**
 * The nitrox twin of {@link issueShopSpecialtyCertification}, with the same
 * `pending` landing and for the sharper version of the same reason: a
 * `verified` nitrox card authorizes an enriched-air fill, and nothing an
 * instructor taps is a substitute for somebody reading a card.
 */
export async function issueShopNitroxCertification(
  db: AppDb,
  input: Omit<NewShopIssuedSpecialty, "specialty">,
): Promise<typeof nitroxCertifications.$inferSelect | null> {
  const issuedByPersonId = await activeCertificationReviewerId(
    db,
    input.shopId,
    input.issuedByPersonId,
  );
  if (!issuedByPersonId) return null;
  return db.transaction(async (tx) => {
    const context = await shopIssuedCourseContext(tx, input);
    if (!context) return null;
    const [existing] = await tx
      .select({ id: nitroxCertifications.id })
      .from(nitroxCertifications)
      .where(
        and(
          eq(nitroxCertifications.shopId, input.shopId),
          eq(nitroxCertifications.personId, input.personId),
          isNull(nitroxCertifications.deletedAt),
        ),
      )
      .limit(1);
    if (existing) return null;
    try {
      const [certification] = await tx
        .insert(nitroxCertifications)
        .values({
          shopId: input.shopId,
          personId: input.personId,
          agency: agencyFromCourseAgency(context.courseAgency),
          identifier: null,
          status: "pending",
          issuedByShopAt: nowDate(),
          issuedFromTripId: input.tripId,
          issuedByPersonId,
        })
        .returning();
      return certification ?? null;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return null;
      throw error;
    }
  });
}

/**
 * The four facts a shop-issued card's write needs to establish, shared by the
 * specialty and nitrox paths so neither can drift from the other or from
 * `issueShopCertification`: the person is this shop's, the trip is a live
 * course session of this shop, the diver holds a live booking on it, and the
 * course names the agency the card will carry.
 *
 * The person row is locked and stays locked for the rest of the caller's
 * transaction, so two concurrent taps for the same diver serialize and the
 * "already holds this" check that follows acts as one atomic unit with its
 * insert rather than a race either could win. `for no key update`, as
 * `recordSelfDeclaredCards` takes it, so a foreign key naming the diver is
 * never queued behind it.
 */
async function shopIssuedCourseContext(
  tx: DbExecutor,
  input: { shopId: string; personId: string; tripId: string },
): Promise<{ courseAgency: string | null } | null> {
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    // diveday:allow-deleted-people: tenant proof for a card write; a removed record keeps its cards and may be restored.
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1)
    .for("no key update");
  if (!person) return null;
  const [trip] = await tx
    .select({ id: trips.id, courseId: trips.courseId })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip?.courseId) return null;
  const [course] = await tx
    .select({ agency: courses.agency })
    .from(courses)
    .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, input.shopId)))
    .limit(1);
  if (!course) return null;
  const [booking] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.tripId, input.tripId),
        eq(bookings.personId, input.personId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
        eq(bookings.participantType, "diver"),
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    .limit(1);
  if (!booking) return null;
  return { courseAgency: course.agency };
}

/**
 * Why a review was refused, so a caller can say something specific. One case
 * today; the discriminated result stays because a refusal must never be
 * mistaken for a miss.
 */
export type ReviewRefusal = "not_found";

/**
 * A level card's review can refuse for two more reasons than a specialty's:
 * the row is a self-declaration nobody has sighted yet, or the number the
 * staffer read off the card is already on another live card at this shop.
 */
export type CertificationReviewRefusal =
  | ReviewRefusal
  | "card_sighting_required"
  | "duplicate_card"
  | "staff_not_found";

/**
 * Confirming a specialty card — the tap that opens a specialty gate, depth past
 * 18 m for Deep.
 *
 * An **imported** card's confirm used to additionally require the staffer to
 * tick a card-sighting attestation, which was recorded in `reviewNote`. That
 * asymmetry is gone (H-24, revised 2026-08-14): every imported card now
 * confirms on the same bare tap, including the *level* card that opens the same
 * depth on every gated boat in the shop. The gate is still per-card and still
 * needs a human act; what it no longer asks for is a second statement of why.
 * See ADR 20260814-one-tap-imported-card-confirm.
 */
export async function reviewSpecialtyCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified";
    reviewNote?: string;
    /** The active staffer who made this certification decision, if this is a live review. */
    reviewedByPersonId?: string;
    /**
     * Required for, and only meaningful on, a still-unsighted self-declaration
     * — the same contract the nitrox and level reviews carry. This tap opens a
     * depth gate past 18 m, and a diver's typing is not a card sighting.
     */
    sighting?: CardSighting;
    /**
     * The review is the agency's own lookup page listing this specialty for
     * this diver (H-105, issue #2592), read by `judgeAgencyListedCard`. Stamps
     * `agencyCheckedAt`; a card that needs a sighting is never certified this
     * way, as for the level and nitrox reviews.
     */
    agencyChecked?: boolean;
  },
): Promise<
  | { ok: true; certification: typeof specialtyCertifications.$inferSelect }
  | { ok: false; reason: CertificationReviewRefusal }
> {
  const reviewedByPersonId = input.reviewedByPersonId
    ? await activeCertificationReviewerId(db, input.shopId, input.reviewedByPersonId)
    : null;
  if (input.reviewedByPersonId && !reviewedByPersonId) {
    return { ok: false, reason: "staff_not_found" };
  }
  // Read first so a missing or deleted card is a `not_found` refusal rather
  // than an update that silently matched no rows.
  const [existing] = await db
    .select({
      id: specialtyCertifications.id,
      status: specialtyCertifications.status,
      selfDeclaredAt: specialtyCertifications.selfDeclaredAt,
      // A shop-issued row is numberless too, and its confirm is the tap that
      // opens the depth gate — so it asks for the card exactly as a
      // self-declaration's does (issue #975).
      issuedByShopAt: specialtyCertifications.issuedByShopAt,
      // The agency's words a check filed the card with (layer 3), kept by a
      // confirm that brings none of its own.
      reviewNote: specialtyCertifications.reviewNote,
      // A card an agency check listed with no number of its own is confirmed
      // through the sighting too (`needsCardSighting`).
      identifier: specialtyCertifications.identifier,
      listedFromCertificationId: specialtyCertifications.listedFromCertificationId,
    })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };

  // A card nobody has seen is not evidence, whether the diver typed it or this
  // shop's own instructor issued it from a class. Same guard as the nitrox
  // review beside it, and for a stronger reason: this one opens a depth gate
  // past 18 m.
  const sighting = needsCardSighting(existing) ? input.sighting : undefined;
  if (needsCardSighting(existing) && (input.agencyChecked || !sighting?.identifier.trim())) {
    return { ok: false, reason: "card_sighting_required" };
  }

  const [certification] = await db
    .update(specialtyCertifications)
    .set({
      status: input.status,
      reviewNote: reviewNoteFor(input.reviewNote) ?? existing.reviewNote,
      reviewedAt: nowDate(),
      agencyCheckedAt: input.agencyChecked ? nowDate() : null,
      ...(reviewedByPersonId ? { reviewedByPersonId } : undefined),
      ...(sighting
        ? { agency: sighting.agency, identifier: sighting.identifier.trim() }
        : undefined),
    })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        // Never re-verify a deleted card: this is the mutation that opens a
        // specialty (depth) gate, and a deleted card is out of every readiness
        // read by design (`security-reviewer` finding).
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .returning();
  if (!certification) return { ok: false, reason: "not_found" };
  await publishManifestEventsForPerson(db, input.shopId, certification.personId);
  return { ok: true, certification };
}

/**
 * A staffer's own words about a card review, or nothing. Shared by the two
 * review paths so "typed only spaces" and "typed nothing" land the same way —
 * an empty note is absence, never an empty string on the row.
 *
 * Cards reviewed before 2026-08-14 may carry a `CARD_SIGHTING_NOTE` sentence
 * written by the attestation this replaced. Those rows are left exactly as they
 * are: the note records what a staffer asserted at the time, and rewriting
 * history to match a later policy would be the one thing an audit trail must
 * never do (ADR 20260814-one-tap-imported-card-confirm).
 */
export function reviewNoteFor(note: string | undefined): string | null {
  return note?.trim() || null;
}

/** Delete a specialty card. Shop-scoped, mirroring `deleteCertification`. */
export async function deleteSpecialtyCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string; deletedByPersonId?: string },
) {
  const [row] = await db
    .update(specialtyCertifications)
    .set({
      deletedAt: nowDate(),
      ...(input.deletedByPersonId ? { deletedByPersonId: input.deletedByPersonId } : {}),
    })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .returning({ id: specialtyCertifications.id });
  return Boolean(row);
}

/** Undo a specialty-card delete, mirroring `restoreCertification`. */
export async function restoreSpecialtyCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [deleted] = await db
    .select()
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!deleted || deleted.deletedAt === null) return false;
  const [conflict] = await db
    .select({ id: specialtyCertifications.id })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.shopId, input.shopId),
        eq(specialtyCertifications.agency, deleted.agency),
        sql`lower(${specialtyCertifications.identifier}) = lower(${deleted.identifier})`,
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (conflict) return false;
  const [row] = await db
    .update(specialtyCertifications)
    .set({ deletedAt: null, deletedByPersonId: null })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
      ),
    )
    .returning({ id: specialtyCertifications.id });
  return Boolean(row);
}

/**
 * The exact same result drives staff rosters today and diver/manifest views
 * later. The single-trip form of `listTripsReadiness`: it delegates the whole
 * evidence pipeline to the batched implementation and adds only the depth
 * advisory (H-08), which the roster and manifest read but the multi-trip
 * surfaces don't. One pipeline, not two — a readiness input added to a
 * separate single-trip copy and not the batch (or vice versa) would let Today
 * and the trip roster disagree about who is blocked.
 */
export async function listTripReadiness(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
  options: ReadinessAsOf = {},
) {
  // `queryAll`, not `Promise.all`: this reader runs both on the pool (every
  // roster and manifest render) and inside `checkInBooking`'s transaction,
  // where a `Promise.all` is concurrent queries on one pinned client. See its
  // comment in `src/db/client.ts`.
  const [rows, shopRow, tripMaxDepthMeters, tripRow] = await queryAll(db, [
    () => listTripsReadiness(db, shopId, [tripId], now, options),
    () =>
      db
        .select({ timezone: shops.timezone, depthUnit: shops.depthUnit })
        .from(shops)
        .where(eq(shops.id, shopId))
        .limit(1),
    () => getTripMaxDepthMeters(db, shopId, tripId),
    () =>
      db
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
        .limit(1),
  ]);
  const [shop] = shopRow;
  if (!shop) throw new Error(`listTripReadiness: shop ${shopId} not found`);
  const timezone = shop.timezone;
  const depthUnit = shop.depthUnit;
  // The trip's shop-local calendar date: the junior depth band is measured on
  // the day the diver is in the water, not today.
  const tripDate = tripRow[0]?.startsAt
    ? calendarDateInTimezone(tripRow[0].startsAt, timezone)
    : null;
  return rows.map((row) => {
    const depthLimit = diverDepthLimit(
      row.certifications,
      row.specialtyCertifications,
      row.person.dateOfBirth,
      tripDate,
    );
    // An uncertified diver falls to the entry-level ceiling rather than to
    // silence — on a trip with no `minimum_certification_level` (a DSD session,
    // an all-levels charter) nothing else says a word about them. But when a
    // certification blocker *is* already raised, the numeric no-card line
    // would repeat it. Keep age and supervision verification visible even
    // then: those questions are not answered by a missing-card blocker.
    const certificationBlocked =
      depthLimit.basis === "no_card" &&
      row.readiness.blockers.some((blocker) => BLOCKER_CATEGORY[blocker.code] === "certification");

    return {
      ...row,
      /**
       * Whether the deepest site on this trip goes past what this diver's card
       * (and junior age band) is trained for — H-08, decided as a **warning,
       * not a block**. Deliberately a sibling of `readiness` rather than a
       * blocker inside it: an instructor may keep a diver shallower than the
       * site's maximum, so this must never be able to flip a `ready` diver to
       * `blocked`. Nothing downstream treats it as a gate.
       */
      // A snorkeler or a rider is not going to the site's depth, so a ceiling
      // has nothing to say about them — silence, not "within".
      depthAdvisory: !isDiver(row.booking.participantType)
        ? ({ status: "unknown" } as const)
        : certificationBlocked && depthLimit.verificationReasons?.length
          ? ({
              status: "verification_required",
              verificationReasons: depthLimit.verificationReasons,
            } as const)
          : certificationBlocked
            ? ({ status: "unknown" } as const)
            : checkDepthCeiling(tripMaxDepthMeters, depthLimit, depthUnit),
    };
  });
}

export async function getBookingReadiness(db: DbExecutor, shopId: string, bookingId: string) {
  const [booking] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!booking) return null;
  const readiness = await listTripReadiness(db, shopId, booking.tripId);
  return readiness.find((row) => row.booking.id === bookingId)?.readiness ?? null;
}

/**
 * `getBookingReadiness` for several seats at once, in one pass of the batched
 * pipeline (`listTripsReadiness`) instead of one whole-roster read per seat
 * (issue #2058: a diver record on a long package). The same `readiness` each
 * seat's roster row carries, so a page reading this cannot disagree with the
 * boat. A seat that is not this shop's, or not on a live roster, is absent.
 */
export async function getBookingsReadiness(
  db: DbExecutor,
  shopId: string,
  bookingIds: readonly string[],
): Promise<Map<string, ReadinessResult>> {
  if (bookingIds.length === 0) return new Map();
  const seats = await db
    .select({ id: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .where(and(inArray(bookings.id, [...bookingIds]), eq(bookings.shopId, shopId)));
  const wanted = new Set(seats.map((seat) => seat.id));
  const rows = await listTripsReadiness(db, shopId, [...new Set(seats.map((seat) => seat.tripId))]);
  return new Map(
    rows.flatMap((row) => (wanted.has(row.booking.id) ? [[row.booking.id, row.readiness]] : [])),
  );
}

export type BookingReadinessDetail = {
  shop: { name: string; timezone: string };
  trip: { id: string; title: string; startsAt: Date; endsAt: Date };
  person: { fullName: string };
  requirement: Awaited<ReturnType<typeof getTripRequirements>>;
  /**
   * The gate the trip's *itinerary* adds — every site it visits folded into
   * one (`combineSiteRequirements`), or null when no site demands anything.
   *
   * Carried beside `requirement` rather than pre-merged into it because the two
   * answer different questions: `requirement` is what the shop set on this
   * departure, and callers that state the rule to a diver want the stricter of
   * the pair (`unionRequirements`). The readiness engine already composes
   * both; without this, a surface naming the required level off `requirement`
   * alone would understate a gate the site imposes and the engine enforces.
   */
  siteRequirement: SiteCertRequirement | null;
  /** This seat's kind is stated free on the departure, so it owes no payment. */
  statedFree: boolean;
  /** A standing training mark lowered the card the departure asks to nothing: the checklist says so. */
  trainingNoCardAsked: boolean;
  readiness: NonNullable<Awaited<ReturnType<typeof getBookingReadiness>>>;
  cancelled: boolean;
};

/**
 * Everything the no-login diver readiness page needs, keyed only by a booking
 * id (the signed link is the capability, so there is no shop scope to pass).
 * Fails closed to null when the booking, trip, or shop is missing.
 */
export async function getBookingReadinessDetail(
  db: DbExecutor,
  bookingId: string,
): Promise<BookingReadinessDetail | null> {
  const [row] = await db
    .select({
      shopId: bookings.shopId,
      tripId: bookings.tripId,
      status: bookings.status,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      personName: people.fullName,
      shopName: shops.name,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;

  const readinessRows = await listTripReadiness(db, row.shopId, row.tripId);
  const match = readinessRows.find((entry) => entry.booking.id === bookingId);
  // A cancelled booking still resolves (so the page can say so plainly) but the
  // readiness engine only knows non-cancelled roster rows; fail closed if it's
  // gone from the roster for any other reason.
  const readiness = match?.readiness ?? unavailableReadiness();
  const requirement = match?.requirement ?? (await getTripRequirements(db, row.shopId, row.tripId));

  return {
    shop: { name: row.shopName, timezone: row.timezone },
    trip: { id: row.tripId, title: row.tripTitle, startsAt: row.startsAt, endsAt: row.endsAt },
    person: { fullName: row.personName },
    requirement,
    // Null on the fallback path above: a booking the roster no longer knows has
    // already fallen through to `unavailableReadiness()`, so there is no gate
    // to state either way.
    siteRequirement: match?.siteRequirement ?? null,
    statedFree: match?.statedFree ?? false,
    trainingNoCardAsked: match?.trainingNoCardAsked ?? false,
    readiness,
    cancelled: row.status === "cancelled",
  };
}

/**
 * The seats on these rows that carry a training mark (issue #2275), as the
 * resolver reads them. A seat whose departure `courseByTrip` lacks is read as
 * a course seat, which the rule refuses: never a mark that stands.
 */
function markedSeatsOf(
  rows: readonly { booking: typeof bookings.$inferSelect; person: { id: string } }[],
  courseByTrip: ReadonlyMap<string, { courseId: string | null; startsAt: Date }>,
): MarkedSeat[] {
  const seats: MarkedSeat[] = [];
  for (const { booking, person } of rows) {
    if (booking.trainingEnrollmentBookingId === null) continue;
    const trip = courseByTrip.get(booking.tripId);
    seats.push({
      bookingId: booking.id,
      tripId: booking.tripId,
      enrollmentBookingId: booking.trainingEnrollmentBookingId,
      seat: {
        personId: person.id,
        participantType: booking.participantType,
        onCourseSession: !trip || trip.courseId !== null,
        departureStartsAt: trip?.startsAt ?? new Date(0),
      },
    });
  }
  return seats;
}

/**
 * Whose forms a seat is asked, and whose records satisfy them: a training
 * mark that stands is its enrollment's (`signatureSatisfies` is keyed on that
 * booking), anything else is the seat's own. A mark that does not stand asks
 * nothing here; it raises `training_mark_invalid` instead.
 */
function formsBookingOf(
  bookingId: string,
  tripId: string,
  mark: TrainingMarkState | undefined,
): { bookingId: string; tripId: string } {
  return mark?.valid
    ? { bookingId: mark.enrollmentBookingId, tripId: mark.enrollmentTripId }
    : { bookingId, tripId };
}

type SeatReleaseInput = Parameters<typeof releaseLapseForBooking>[0];

/**
 * **The release a seat stands on, and whether it lapsed**, for
 * {@link listTripsReadiness}.
 *
 * **The release's clocks run at the departure** (issue #2611): while the trip
 * has not started, at its end; once under way, at now. The night-before
 * roster, Today and the reminder then agree with the dock, a night dive's
 * release that lapses mid-dive blocks before it sails, and a liveaboard guest
 * on day two reads at now. Cards, payment and age keep their own instants.
 *
 * A rider is held to the release and never to its medical (H-109), so a hold
 * does not outrank their signatures and a held record is a signed one — read
 * only while it is itself current, never the hold's own standing. `asOf` is
 * the departure log's alone (issue #3002).
 */
function seatRelease(input: {
  booking: { participantType: ParticipantType };
  bookingWaiver: SeatReleaseInput["bookingWaiver"];
  personSignedWaivers: SeatReleaseInput["personSignedWaivers"];
  currentTemplateVersion: number | null;
  now: Date;
  startsAt: Date | null;
  endsAt: Date | null;
  asOf: Date | undefined;
}) {
  const heldToMedical = isHeldToMedical(input.booking.participantType);
  const waiverNow = waiverClockInstant(input);
  const effectiveWaiver = (
    heldToMedical ? effectiveWaiverForBooking : effectiveReleaseForRiderSeat
  )({ ...input, now: waiverNow });
  const releaseLapse = releaseLapseForBooking({ ...input, heldToMedical });
  return { effectiveWaiver, releaseLapse };
}

/**
 * **Reading a roster as it stood, for the departure log only** (issue #3002).
 * Live readers pass nothing and see every record however fresh. The log reads
 * each seat's release as it stood when that diver boarded (`recordsAsOf`, by
 * booking id) and the release terms in force when the boat left (`termsAsOf`).
 */
export type ReadinessAsOf = {
  recordsAsOf?: (bookingId: string) => Date | undefined;
  termsAsOf?: Date;
};

/**
 * The guardian rule's "Under 18" for a seat: its own booker's, or — on a seat
 * whose training mark stands — the course seat's too, so the charter and the
 * enrollment never disagree about whether a parent signs (fail closed).
 */
function minorDeclaredOf(
  booking: { minorDeclaredAt: Date | null },
  mark: TrainingMarkState | undefined,
): boolean {
  return booking.minorDeclaredAt !== null || (mark?.valid === true && mark.enrollmentMinorDeclared);
}

export async function listTripsReadiness(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
  now: Date = nowDate(),
  options: ReadinessAsOf = {},
) {
  if (tripIds.length === 0) return [];

  const [requirements, siteRequirements, waiverRows, currentTemplate, shopRow, courseRows] =
    await queryAll(db, [
      () =>
        db
          .select()
          .from(tripRequirements)
          .where(
            and(eq(tripRequirements.shopId, shopId), inArray(tripRequirements.tripId, tripIds)),
          ),
      // Every site every trip visits — see `tripVisitedSites` for why the join
      // reaches through `trip_dives` too, and why `dive_sites.shop_id` is
      // re-proven here.
      () =>
        db
          .select({
            tripId: trips.id,
            minimumCertificationLevel: diveSites.minimumCertificationLevel,
            requiredSpecialties: diveSites.requiredSpecialties,
            requiresNitrox: diveSites.requiresNitrox,
          })
          .from(trips)
          .innerJoin(
            diveSites,
            sql`${diveSites.id} = ${trips.diveSiteId} or ${diveSites.id} in (
            select ${tripDives.diveSiteId} from ${tripDives} where ${tripDives.tripId} = ${trips.id}
          )`,
          )
          .where(
            and(
              inArray(trips.id, tripIds),
              eq(trips.shopId, shopId),
              eq(diveSites.shopId, shopId),
              liveTrip(),
            ),
          ),
      () => listTripsWaiverStatuses(db, shopId, tripIds),
      // The live terms; for the departure log, the ones the boat left under
      // (issue #3002).
      () => getCurrentWaiverGeneration(db, shopId, options.termsAsOf),
      () =>
        db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, shopId)).limit(1),
      () =>
        db
          .select({
            id: trips.id,
            startsAt: trips.startsAt,
            endsAt: trips.endsAt,
            courseId: trips.courseId,
            minimumAge: courses.minimumAge,
            priceCents: trips.priceCents,
            snorkelerPriceCents: trips.snorkelerPriceCents,
            riderPriceCents: trips.riderPriceCents,
          })
          .from(trips)
          .leftJoin(courses, eq(courses.id, trips.courseId))
          .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId), liveTrip())),
    ]);

  const [shop] = shopRow;
  if (!shop) throw new Error(`listTripsReadiness: shop ${shopId} not found`);
  const timezone = shop.timezone;

  const requirementsByTrip = new Map(requirements.map((r) => [r.tripId, r]));
  // A fold, not `new Map(rows.map(...))`: the join returns one row per site a
  // trip visits, so building the map by construction would be last-write-wins
  // and would silently drop every site but one.
  const siteRowsByTrip = new Map<string, SiteCertRequirement[]>();
  for (const sr of siteRequirements) {
    const current = siteRowsByTrip.get(sr.tripId) ?? [];
    current.push({
      minimumCertificationLevel: sr.minimumCertificationLevel,
      requiredSpecialties: sr.requiredSpecialties,
      requiresNitrox: sr.requiresNitrox,
    });
    siteRowsByTrip.set(sr.tripId, current);
  }
  const siteRequirementsByTrip = new Map<string, SiteCertRequirement | null>(
    [...siteRowsByTrip].map(([tripId, sites]) => [tripId, combineSiteRequirements(sites)]),
  );
  const courseByTrip = new Map(courseRows.map((c) => [c.id, c]));

  const bookingIds = waiverRows.map((row) => row.booking.id);
  const personIds = waiverRows.map((row) => row.person.id);
  const courseTripIds = courseRows.filter((c) => c.courseId !== null).map((c) => c.id);
  // **One wave after the roster** (code review 2026-10-11, item 13): the
  // payments, the course forms and the evidence each take only ids the first
  // read returned, so none waits on another. They used to run as three steps,
  // and every surface sharing this pass — the badge, Today, the roster,
  // `/ready` — paid each one.
  //
  // The forms each course session asks its students to sign, and every
  // signature on these seats (ADR 20261008-course-forms), chained so the
  // signatures read is still skipped while no session here asks for a form,
  // and both are skipped when no trip here is a course session: a fun-dive
  // render pays nothing for forms (`staff-render-cost.test.ts`).
  //
  // `queryAll`, not `Promise.all`: inside `checkInBooking`'s transaction these
  // run one after another on its one client (`./query-helpers`).
  const evidence = () =>
    queryAll(db, [
      () =>
        db
          .select()
          .from(certifications)
          .where(
            and(
              eq(certifications.shopId, shopId),
              inArray(certifications.personId, personIds),
              isNull(certifications.deletedAt),
            ),
          ),
      () =>
        db
          .select()
          .from(specialtyCertifications)
          .where(
            and(
              eq(specialtyCertifications.shopId, shopId),
              inArray(specialtyCertifications.personId, personIds),
              isNull(specialtyCertifications.deletedAt),
            ),
          ),
      () =>
        db
          .select()
          .from(nitroxCertifications)
          .where(
            and(
              eq(nitroxCertifications.shopId, shopId),
              inArray(nitroxCertifications.personId, personIds),
              isNull(nitroxCertifications.deletedAt),
            ),
          ),
      () => listSignedWaiversByPerson(db, shopId, personIds),
      () => listCourseSeatsInTraining(db, shopId, personIds),
    ]);
  const noEvidence: Awaited<ReturnType<typeof evidence>> = [[], [], [], new Map(), []];
  // Seats staff marked as a training dive (issue #2275): read only when a
  // mark exists, so an ordinary fun dive still pays nothing here.
  const markedSeats = markedSeatsOf(waiverRows, courseByTrip);
  const [
    paymentByBooking,
    [courseFormsByTrip, courseFormSignatures, trainingMarks],
    [certificationRows, specialtyRows, nitroxRows, signedWaiversByPerson, courseSeatRows],
  ] = await queryAll(db, [
    () => paymentsByBooking(db, shopId, bookingIds),
    async () => {
      const marks = await resolveTrainingMarks(db, shopId, markedSeats);
      const enrollments = [...marks.values()].filter((mark) => mark.valid);
      const forms = await requiredCourseFormsForTrips(
        db,
        shopId,
        [...new Set([...courseTripIds, ...enrollments.map((mark) => mark.enrollmentTripId)])],
        now,
      );
      const signatures =
        forms.size === 0
          ? []
          : await courseFormSignaturesForBookings(db, shopId, [
              ...bookingIds,
              ...enrollments.map((mark) => mark.enrollmentBookingId),
            ]);
      return [forms, signatures, marks] as const;
    },
    () => (personIds.length === 0 ? Promise.resolve(noEvidence) : evidence()),
  ]);

  const currentTemplateGeneration = currentTemplate?.materialGeneration ?? null;

  const certificationsByPerson = new Map<string, typeof certificationRows>();
  for (const certification of certificationRows) {
    const current = certificationsByPerson.get(certification.personId) ?? [];
    current.push(certification);
    certificationsByPerson.set(certification.personId, current);
  }
  const specialtiesByPerson = new Map<string, typeof specialtyRows>();
  for (const specialty of specialtyRows) {
    const current = specialtiesByPerson.get(specialty.personId) ?? [];
    current.push(specialty);
    specialtiesByPerson.set(specialty.personId, current);
  }
  const courseSeatsByPerson = new Map<string, CourseSeatInTraining[]>();
  for (const seat of courseSeatRows) {
    const current = courseSeatsByPerson.get(seat.personId) ?? [];
    current.push(seat);
    courseSeatsByPerson.set(seat.personId, current);
  }
  const nitroxByPerson = new Map<string, typeof nitroxRows>();
  for (const card of nitroxRows) {
    const current = nitroxByPerson.get(card.personId) ?? [];
    current.push(card);
    nitroxByPerson.set(card.personId, current);
  }

  return waiverRows.map((row) => {
    const tripId = row.booking.tripId;
    const requirement = requirementsByTrip.get(tripId) ?? null;
    const siteRequirement = siteRequirementsByTrip.get(tripId) ?? null;
    const courseRow = courseByTrip.get(tripId);
    // A kind of seat the shop states as free has no payment to clear. Read
    // off the departure's own price for that kind, never inferred from a
    // missing one (`paymentGateIsUnclearable`).
    const statedFree =
      !isDiver(row.booking.participantType) &&
      courseRow !== undefined &&
      participantPriceCents(courseRow, row.booking.participantType) === 0;
    const courseMinimumAge = courseRow?.minimumAge ?? null;
    const courseDate = courseRow?.startsAt
      ? calendarDateInTimezone(courseRow.startsAt, timezone)
      : null;

    const { effectiveWaiver, releaseLapse } = seatRelease({
      booking: row.booking,
      bookingWaiver: row.waiver,
      personSignedWaivers: signedWaiversByPerson.get(row.person.id) ?? [],
      currentTemplateVersion: currentTemplateGeneration,
      now,
      startsAt: courseRow?.startsAt ?? null,
      endsAt: courseRow?.endsAt ?? null,
      asOf: options.recordsAsOf?.(row.booking.id),
    });
    const referral = overriddenReferral(
      effectiveWaiver,
      signedWaiversByPerson.get(row.person.id) ?? [],
    );

    const trainingMark = trainingMarks.get(row.booking.id);
    const formsBooking = formsBookingOf(row.booking.id, tripId, trainingMark);
    const requiredCourseForms = courseFormsByTrip.get(formsBooking.tripId);
    const courseForms = requiredCourseForms
      ? {
          shopId,
          bookingId: formsBooking.bookingId,
          personId: row.person.id,
          required: requiredCourseForms,
          signatures: courseFormSignatures,
          timezone,
        }
      : undefined;

    return {
      ...row,
      /**
       * The course forms this seat still owes, whatever
       * `COURSE_FORMS_BLOCK_BOARDING` says — the rosters show them either way,
       * as a blocker while the switch blocks and as a warning when it does not.
       */
      owedCourseForms: courseForms
        ? outstandingCourseForms({
            ...courseForms,
            signer: {
              dateOfBirth: row.person.dateOfBirth,
              minorDeclared: minorDeclaredOf(row.booking, trainingMark),
              timezone,
            },
          })
        : [],
      bookingWaiver: row.waiver,
      waiver: effectiveWaiver,
      // Carried on the row because the manifest needs it and only this function
      // holds both halves — the governing record and the diver's whole signed
      // history. Deriving it a second time downstream from one of the two would
      // be a second answer to a safety question (issue #1282).
      overriddenReferralAt: referral?.at ?? null,
      // The referral itself, so the roster and the manifest can link the
      // warning to it (issue #2195, amending H-98).
      overriddenReferral: referral,
      // The physician's "no" a clean new release stands over (issue #2158):
      // the seat boards, and every surface warns with a link to the refusal.
      overriddenRefusal: overriddenRefusal(
        effectiveWaiver,
        signedWaiversByPerson.get(row.person.id) ?? [],
      ),
      // A rider boards on a release a medical holds (H-109), and the crew
      // still reads it as a "riding only" warning, from the same record the
      // rider path chose (dive-domain review of #2212).
      riderMedicalHold: isHeldToMedical(row.booking.participantType)
        ? null
        : riderMedicalHold(effectiveWaiver, signedWaiversByPerson.get(row.person.id) ?? []),
      requirement,
      siteRequirement,
      statedFree,
      trainingNoCardAsked:
        isDiver(row.booking.participantType) &&
        trainingDiveAsksNoCard(
          unionRequirements(requirement, siteRequirement),
          trainingDiveLevel(trainingMark),
        ),
      certifications: certificationsByPerson.get(row.person.id) ?? [],
      specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
      nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
      paymentStatus: paymentByBooking.get(row.booking.id)?.status ?? null,
      paymentProvider: paymentByBooking.get(row.booking.id)?.provider ?? null,
      readiness: calculateReadiness({
        requirement,
        siteRequirement,
        waiver: effectiveWaiver,
        releaseLapse,
        certifications: certificationsByPerson.get(row.person.id) ?? [],
        // Measured against this departure: only a course that finishes before
        // it sails can be the card this diver boards on.
        certificationsInTraining: courseRow
          ? inTrainingBefore(
              courseSeatsByPerson.get(row.person.id) ?? [],
              {
                id: tripId,
                startsAt: courseRow.startsAt,
              },
              now,
            )
          : [],
        // Sessions already over without a card: named on the blocker so the
        // record points at that roster (issue #2058). Clears nothing.
        coursesEnded: courseRow
          ? courseEndedBefore(
              courseSeatsByPerson.get(row.person.id) ?? [],
              { id: tripId, startsAt: courseRow.startsAt },
              now,
            )
          : [],
        // The diver's own "I'm not certified yet", said on their link or a
        // public form: it names why the gate is unmet, and clears nothing.
        noCertificationDeclared: noCertificationStands(row.person),
        specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
        nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
        paymentStatus: paymentByBooking.get(row.booking.id)?.status ?? null,
        identityUnconfirmed: row.booking.identityUnconfirmedAt !== null,
        courseMinimumAge,
        courseDate,
        dateOfBirth: row.person.dateOfBirth,
        // The booker's "Under 18" on this seat, for the guardian rule alone.
        minorDeclared: minorDeclaredOf(row.booking, trainingMark),
        // The guardian rule measures the diver's age on the shop-local day
        // they signed (src/lib/guardian.ts), so the engine needs the zone.
        timezone,
        // What this seat is doing aboard: a snorkeler or a rider is asked for
        // no card (ADR 20261007-participant-types).
        participantType: row.booking.participantType,
        statedFree,
        courseForms,
        trainingMarkInvalid: trainingMark !== undefined && !trainingMark.valid,
        // A standing mark with the course's instructor aboard takes the
        // course's own minimum level (issue #2731).
        trainingDive: trainingDiveLevel(trainingMark),
        now,
      }),
    };
  });
}
