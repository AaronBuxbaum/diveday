import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { checkDepthCeiling, diverDepthLimit } from "@/lib/depth-ceiling";
import type { CertificationLevel, SiteCertRequirement } from "@/lib/readiness";
import {
  BLOCKER_CATEGORY,
  calculateReadiness,
  combineSiteRequirements,
  isUnsightedSelfDeclaration,
  unavailableReadiness,
} from "@/lib/readiness";
import { effectiveWaiverForBooking } from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import { type AppDb, type DbExecutor, isUniqueConstraintViolation, queryAll } from "./client";
import { paymentsByBooking } from "./payments";
import type { Certification, CertificationAgency, DiveSpecialty } from "./schema";
import {
  bookings,
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
import { liveTrip } from "./trips-live";
import {
  getCurrentWaiverTemplate,
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
  db: AppDb,
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
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  try {
    const [certification] = await db
      .insert(certifications)
      .values({ ...input, identifier: input.identifier.trim() })
      .returning();
    return certification ?? null;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

/**
 * **What a staffer is looking at**, when the row they are verifying is only a
 * diver's word so far.
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
  if (isUnsightedSelfDeclaration(existing) && !sighting?.identifier.trim()) {
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
    return certification ? { ok: true, certification } : { ok: false, reason: "not_found" };
  } catch (error) {
    // The sighted number collides with a live card this shop already holds —
    // the same partial unique index `createCertification` refuses on (CR-009).
    if (isUniqueConstraintViolation(error)) return { ok: false, reason: "duplicate_card" };
    throw error;
  }
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
  const [conflict] = await db
    .select({ id: certifications.id })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, input.shopId),
        eq(certifications.agency, deleted.agency),
        sql`lower(${certifications.identifier}) = lower(${deleted.identifier})`,
        isNull(certifications.deletedAt),
      ),
    )
    .limit(1);
  if (conflict) return false;
  const [row] = await db
    .update(certifications)
    .set({ deletedAt: null, deletedByPersonId: null })
    .where(
      and(eq(certifications.id, input.certificationId), eq(certifications.shopId, input.shopId)),
    )
    .returning({ id: certifications.id });
  return Boolean(row);
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

  // A card the diver typed is not a card anybody has seen. Same guard as the
  // nitrox review beside it, and for a stronger reason: this one opens a depth
  // gate past 18 m.
  const sighting = isUnsightedSelfDeclaration(existing) ? input.sighting : undefined;
  if (isUnsightedSelfDeclaration(existing) && !sighting?.identifier.trim()) {
    return { ok: false, reason: "card_sighting_required" };
  }

  const [certification] = await db
    .update(specialtyCertifications)
    .set({
      status: input.status,
      reviewNote: reviewNoteFor(input.reviewNote),
      reviewedAt: nowDate(),
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
  return certification ? { ok: true, certification } : { ok: false, reason: "not_found" };
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
) {
  // `queryAll`, not `Promise.all`: this reader runs both on the pool (every
  // roster and manifest render) and inside `checkInBooking`'s transaction,
  // where a `Promise.all` is concurrent queries on one pinned client. See its
  // comment in `src/db/client.ts`.
  const [rows, shopRow, tripMaxDepthMeters, tripRow] = await queryAll(db, [
    () => listTripsReadiness(db, shopId, [tripId], now),
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
    // certification blocker *is* already raised, the depth line would only
    // repeat it, so it is suppressed: the "no redundant warning" argument holds
    // exactly where a redundant warning actually exists.
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
      depthAdvisory: certificationBlocked
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

export type BookingReadinessDetail = {
  shop: { name: string; timezone: string };
  trip: { id: string; title: string; startsAt: Date; endsAt: Date };
  person: { fullName: string };
  requirement: Awaited<ReturnType<typeof getTripRequirements>>;
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
    readiness,
    cancelled: row.status === "cancelled",
  };
}

export async function listTripsReadiness(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
  now: Date = nowDate(),
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
            and(inArray(trips.id, tripIds), eq(trips.shopId, shopId), eq(diveSites.shopId, shopId)),
          ),
      () => listTripsWaiverStatuses(db, shopId, tripIds),
      () => getCurrentWaiverTemplate(db, shopId),
      () =>
        db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, shopId)).limit(1),
      () =>
        db
          .select({ id: trips.id, startsAt: trips.startsAt, minimumAge: courses.minimumAge })
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
  const paymentByBooking = await paymentsByBooking(db, shopId, bookingIds);
  const personIds = waiverRows.map((row) => row.person.id);

  const [certificationRows, specialtyRows, nitroxRows, signedWaiversByPerson] =
    personIds.length === 0
      ? [[], [], [], new Map<string, never[]>()]
      : await queryAll(db, [
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
        ]);

  const currentTemplateVersion = currentTemplate?.version ?? null;

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
    const courseMinimumAge = courseRow?.minimumAge ?? null;
    const courseDate = courseRow?.startsAt
      ? calendarDateInTimezone(courseRow.startsAt, timezone)
      : null;

    const effectiveWaiver = effectiveWaiverForBooking({
      bookingWaiver: row.waiver,
      personSignedWaivers: signedWaiversByPerson.get(row.person.id) ?? [],
      currentTemplateVersion,
      now,
    });

    return {
      ...row,
      bookingWaiver: row.waiver,
      waiver: effectiveWaiver,
      requirement,
      siteRequirement,
      certifications: certificationsByPerson.get(row.person.id) ?? [],
      specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
      nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
      paymentStatus: paymentByBooking.get(row.booking.id)?.status ?? null,
      paymentProvider: paymentByBooking.get(row.booking.id)?.provider ?? null,
      readiness: calculateReadiness({
        requirement,
        siteRequirement,
        waiver: effectiveWaiver,
        certifications: certificationsByPerson.get(row.person.id) ?? [],
        specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
        nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
        paymentStatus: paymentByBooking.get(row.booking.id)?.status ?? null,
        identityUnconfirmed: row.booking.identityUnconfirmedAt !== null,
        courseMinimumAge,
        courseDate,
        dateOfBirth: row.person.dateOfBirth,
        now,
      }),
    };
  });
}
