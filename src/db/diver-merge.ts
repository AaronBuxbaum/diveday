import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { canPersonMergeDiver } from "@/db/authz";
import type { AppDb, DbExecutor } from "@/db/client";
import {
  movedPersonTables,
  refusedPersonOnlyTables,
  refusedPersonTables,
  singletonPersonTables,
} from "@/db/person-columns";
import { isUniqueConstraintViolation } from "@/db/query-helpers";
import {
  activityEvents,
  bookingCapabilities,
  bookings,
  cards,
  notificationSendQueue,
  people,
  personRoles,
  rentalFitProfiles,
  trips,
  waiverRecords,
} from "@/db/schema";
import { forgetTrainingPlanPeople } from "@/db/training-plan-privacy";
import { nowDate } from "@/lib/clock";
import {
  type DiverDuplicateReason,
  diverDuplicateReasons,
  emailMatchKey,
  matchRestsOnNameAlone,
  phoneMatchKey,
} from "@/lib/diver-duplicates";
import { normalizePersonName, personNamesMatch } from "@/lib/person-name";
import { hasReturned } from "@/lib/trips";
import { isStandingRefusal, isUnresolvedMedicalHold } from "@/lib/waivers";
import { seatCheckedIn } from "./arrival-provenance";
import {
  lockBoardingCertificationEvidence,
  rewriteBoardingSnapshotReviewer,
} from "./boarding-certification-snapshot";
import { refileCourseFormRecords } from "./course-forms";
import { liveTrip } from "./trips-live";
import { seatNotCancelled } from "./trips-queries";
import { refileWaiverRecords } from "./waiver-refile";

/**
 * Why a second active diver record was offered as a likely duplicate.
 *
 * `same_name_and_birth_date` is the strong form of a name match and replaces
 * `same_name` when both records carry the same date. Two records under one
 * name with two *different* dates of birth are not offered on the name at all:
 * that is two people, and the parent booking a namesake child is exactly the
 * case a merge must not invite. Nor is a name with a date missing on one side
 * unless an email or phone agrees too: the child's record is the one that
 * often has no date (`diverDuplicateReasons`).
 */
export type DiverMergeCandidateReason = DiverDuplicateReason;

export type DiverMergeCandidate = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  reasons: DiverMergeCandidateReason[];
};

export type DiverMergeRefusal =
  | "not_found"
  | "not_authorized"
  | "anonymized"
  | "already_merged"
  | "already_removed"
  | "staff_record"
  | "booking_conflict"
  | "departure_underway"
  | "record_conflict"
  | "different_people_unacknowledged"
  | "assessment_changed";

/**
 * The fields a staffer picks a winner for when the two records disagree.
 * `emergencyContact` is the name and phone as one pair, and `rentalFit` is the
 * whole sizes profile: half of one person's contact beside half of another's,
 * or one record's BCD beside the other's boots, describes nobody.
 */
export const DIVER_MERGE_FIELDS = [
  "fullName",
  "dateOfBirth",
  "email",
  "phone",
  "emergencyContact",
  "rentalFit",
] as const;
export type DiverMergeField = (typeof DIVER_MERGE_FIELDS)[number];
export type DiverMergeSideChoice = "survivor" | "source";
export type DiverMergeChoices = Partial<Record<DiverMergeField, DiverMergeSideChoice>>;

/**
 * Why the merge might be joining two *different* people's legal records, or
 * hiding a medical answer under someone else's signature. Any one of them
 * makes the merge ask for an explicit acknowledgement, in the preview and
 * again in the transaction (`different_people_unacknowledged`), and the
 * acknowledgement names exactly the set the staffer read
 * ({@link diverMergeAcknowledgement}): a warning that appears between the
 * preview and the click refuses as `assessment_changed`.
 *
 * - `different_birth_dates`: both records hold a date of birth and they differ.
 * - `birth_date_unknown_on_one_record`: one record has a date of birth, the
 *   other has none, and no email or phone agrees, so the pair rests on the
 *   name alone. A parent and a child booked under one name is the case: the
 *   child's record often has no date at all.
 * - `both_hold_cards_or_releases`: each record holds a certification card or a
 *   signed release. Merged, one person's cards and paper describe the other.
 * - `releases_under_different_names`: a signed release is on file, and the
 *   names it was signed under and the two records' own names do not all match.
 *   A signature is refused unless the typed name matches the record's diver
 *   (issue #2080), so a release names the person who signed it, and a merge
 *   moves it onto the kept record whatever that record is called: one
 *   "Maya Rivera" release moving onto a "Carmen Diaz" record is exactly the
 *   case, with no second release anywhere.
 * - `open_medical_hold` / `declined_clearance`: a record holds a medical answer
 *   still waiting on a physician, or one a physician declined to clear. On one
 *   record, a newer clean release on the *other* record stands over it once
 *   they are merged (`effectiveWaiverForBooking`), which is right for one
 *   person and wrong for two.
 */
export type DiverMergeWarning =
  | "different_birth_dates"
  | "birth_date_unknown_on_one_record"
  | "both_hold_cards_or_releases"
  | "releases_under_different_names"
  | "open_medical_hold"
  | "declined_clearance";

export type DiverMergeResult =
  | { ok: true; survivorId: string; mergedPersonId: string }
  | {
      ok: false;
      reason: DiverMergeRefusal;
      /** The first departure a `booking_conflict` collided on, so the notice can name it (issue #2333). */
      conflictTripId?: string;
    };

/**
 * One row per person by construction, so the blanket repoint below cannot move
 * them: a diver fitted at the counter under each of their two records -- an
 * ordinary way to end up with duplicates in the first place -- made
 * `update ... set person_id = survivor` raise 23505 and rolled the whole merge
 * back to `record_conflict`. The merge was then permanently impossible through
 * the UI, with nothing telling the staffer which row to delete to unblock it.
 *
 * The survivor is the record the shop chose to keep, so the survivor's row
 * wins and the source's is dropped. Both are current-state rows a staffer can
 * re-enter, not history: a fit profile is the diver's sizes today, and a
 * last-minute-list interest is a standing "tell me when a seat frees" (it is
 * handled with the other interests below, because it shares their table).
 */
const SINGLETON_PER_PERSON_TABLES = singletonPersonTables();

/**
 * Every list below is read off `person-columns.ts` (issue #2724), where each
 * column that references `people` has one row saying what a merge does with it.
 */
export const DIVER_HISTORY_TABLES = movedPersonTables();

/** These rows identify a staff account or crew assignment, not a diver history. */
export const STAFF_HISTORY_TABLES = refusedPersonTables();
export const STAFF_PERSON_ONLY_TABLES = refusedPersonOnlyTables();

function quotedTable(identifier: string) {
  // The only callers pass names from the static person-columns registry; the
  // shape check keeps a future registry edit from ever reaching raw SQL.
  if (!/^[a-z_]+$/.test(identifier)) throw new Error(`Not a SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function hasPersonRow(
  db: DbExecutor,
  refused: { table: string; column: string },
  shopId: string,
  personId: string,
): Promise<boolean> {
  // `crew_person_id` on the roll-call ledger, `person_id` everywhere else: the
  // registry row names the column, so a staff column with another name is
  // still asked about rather than queried under the wrong one.
  const result = await db.execute(
    sql`select 1 from ${sql.raw(quotedTable(refused.table))} where "shop_id" = ${shopId} and ${sql.raw(quotedTable(refused.column))} = ${personId} limit 1`,
  );
  return result.rows.length > 0;
}

async function hasPersonOnlyRow(db: DbExecutor, tableName: string, personId: string) {
  const result = await db.execute(
    sql`select 1 from ${sql.raw(quotedTable(tableName))} where "person_id" = ${personId} limit 1`,
  );
  return result.rows.length > 0;
}

const duplicateSignals = {
  id: people.id,
  fullName: people.fullName,
  email: people.email,
  phone: people.phone,
  dateOfBirth: people.dateOfBirth,
};

/** Active, unmerged, unerased diver records in one shop: the only ones a merge may touch. */
function activeDiverWhere(shopId: string) {
  return and(
    eq(people.shopId, shopId),
    eq(personRoles.role, "diver"),
    isNull(people.deletedAt),
    isNull(people.anonymizedAt),
    isNull(people.mergedIntoPersonId),
  );
}

/**
 * Find active diver records that look like the same person
 * (`diverDuplicateReasons`: one mailbox, one phone, or one name with no
 * disagreeing birth date). Never crosses a shop and never includes removed,
 * erased, or already-merged rows.
 */
export async function listDiverMergeCandidates(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<DiverMergeCandidate[]> {
  const [source] = await db
    .select(duplicateSignals)
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.id, personId), activeDiverWhere(shopId)))
    .limit(1);
  if (!source) return [];

  const candidates = await db
    .select(duplicateSignals)
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(ne(people.id, personId), activeDiverWhere(shopId)))
    .orderBy(asc(people.fullName), asc(people.id));

  const found = candidates.flatMap((person) => {
    const reasons = diverDuplicateReasons(source, person);
    return reasons.length === 0
      ? []
      : [
          {
            id: person.id,
            fullName: person.fullName,
            email: person.email,
            phone: person.phone,
            reasons,
          },
        ];
  });
  // Strongest first, so a capped panel shows the likeliest pairs: a stable
  // sort keeps name order among equals.
  return found.sort((a, b) => candidateStrength(b.reasons) - candidateStrength(a.reasons));
}

/** How much a set of reasons says, for ordering candidates: contact beats name. */
const REASON_WEIGHT: Record<DiverDuplicateReason, number> = {
  same_email: 4,
  same_phone: 4,
  same_name_and_birth_date: 2,
  same_name: 1,
};

function candidateStrength(reasons: readonly DiverDuplicateReason[]): number {
  return reasons.reduce((total, reason) => total + REASON_WEIGHT[reason], 0);
}

/**
 * Mark the active roster rows that have a likely duplicate. The roster only
 * needs the ids: the record page does the candidate query with the reasons and
 * contact details. Rows are bucketed by each exact key first, so the pairwise
 * check (which is what lets two different birth dates veto a name match) only
 * runs inside a bucket, never across the whole roster.
 */
export async function listDiverMergeDuplicateIds(db: AppDb, shopId: string): Promise<string[]> {
  const rows = await db
    .select(duplicateSignals)
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(activeDiverWhere(shopId))
    .orderBy(asc(people.fullName), asc(people.id));

  const buckets = new Map<string, (typeof rows)[number][]>();
  const file = (key: string | null, person: (typeof rows)[number]) => {
    if (!key) return;
    buckets.set(key, [...(buckets.get(key) ?? []), person]);
  };
  for (const person of rows) {
    file(phoneMatchKey(person.phone) && `phone:${phoneMatchKey(person.phone)}`, person);
    file(emailMatchKey(person.email) && `email:${emailMatchKey(person.email)}`, person);
    const name = normalizePersonName(person.fullName);
    file(name && `name:${name}`, person);
  }

  const duplicateIds = new Set<string>();
  for (const group of buckets.values()) {
    for (const [index, left] of group.entries()) {
      for (const right of group.slice(index + 1)) {
        if (diverDuplicateReasons(left, right).length > 0) {
          duplicateIds.add(left.id);
          duplicateIds.add(right.id);
        }
      }
    }
  }
  return [...duplicateIds].sort();
}

type NoCertificationStamp = {
  noCertificationDeclaredAt: Date | null;
  noCertificationClearedAt: Date | null;
  noCertificationClearedByPersonId: string | null;
};

/** Whichever record declared more recently, with that record's own clear. */
function noCertificationStamp(
  survivor: NoCertificationStamp,
  source: NoCertificationStamp,
): NoCertificationStamp {
  const pick =
    survivor.noCertificationDeclaredAt && source.noCertificationDeclaredAt
      ? survivor.noCertificationDeclaredAt >= source.noCertificationDeclaredAt
        ? survivor
        : source
      : survivor.noCertificationDeclaredAt
        ? survivor
        : source;
  return {
    noCertificationDeclaredAt: pick.noCertificationDeclaredAt,
    noCertificationClearedAt: pick.noCertificationClearedAt,
    noCertificationClearedByPersonId: pick.noCertificationClearedByPersonId,
  };
}

type DrysuitExperienceSeen = {
  drysuitExperienceSeenAt: Date | null;
  drysuitExperienceSeenByPersonId: string | null;
  drysuitExperienceSeenNote: string | null;
};

/** Whichever record has the earlier "seen diving dry", with that record's author. */
function drysuitExperienceSeen(
  survivor: DrysuitExperienceSeen,
  source: DrysuitExperienceSeen,
): DrysuitExperienceSeen {
  const pick =
    survivor.drysuitExperienceSeenAt &&
    (!source.drysuitExperienceSeenAt ||
      survivor.drysuitExperienceSeenAt <= source.drysuitExperienceSeenAt)
      ? survivor
      : source;
  return {
    drysuitExperienceSeenAt: pick.drysuitExperienceSeenAt,
    drysuitExperienceSeenByPersonId: pick.drysuitExperienceSeenAt
      ? pick.drysuitExperienceSeenByPersonId
      : null,
    drysuitExperienceSeenNote: pick.drysuitExperienceSeenAt ? pick.drysuitExperienceSeenNote : null,
  };
}

function latestCalendarDate(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function oldestDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

type PersonRow = typeof people.$inferSelect;

/** A departure both records hold a seat on, cancelled or not. */
export type DiverMergeSharedDeparture = {
  tripId: string;
  title: string;
  startsAt: Date;
  /**
   * The kept record's seat here is cancelled, and the merged-away
   * record's is live. Nothing on the departure needs resolving: keeping the
   * other record instead leaves the cancelled seat behind (issue #2177).
   */
  keptSeatOver: boolean;
};

type MergeAssessment =
  | { ok: false; reason: DiverMergeRefusal; sharedDepartures: DiverMergeSharedDeparture[] }
  | {
      ok: true;
      /**
       * The merged-away record's seats that stay on it: each is cancelled, on a
       * departure the kept record
       * also holds a seat on, so the `(trip_id, person_id)` key has no room for
       * it under the kept record (issue #2177).
       */
      seatsLeftBehind: string[];
      warnings: DiverMergeWarning[];
      /** The distinct names in play when a release is on file: signed names and both records' names. */
      releaseNames: string[];
    };

/** What a record's releases say about its medical answers, per side of the preview. */
export type DiverMergeMedicalFlags = {
  /** A medical answer still waiting on a physician (`isUnresolvedMedicalHold`). */
  openMedicalHold: boolean;
  /** A physician declined to clear it, and nothing newer has (`isStandingRefusal`). */
  declinedClearance: boolean;
};

async function medicalFlags(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<DiverMergeMedicalFlags> {
  const parked = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "medical_review"),
        isNull(waiverRecords.anonymizedAt),
      ),
    );
  return {
    openMedicalHold: parked.some(isUnresolvedMedicalHold),
    declinedClearance: parked.some(isStandingRefusal),
  };
}

/**
 * A live card of any kind, or a signed, unerased release, on this record. Every
 * kind counts: a nitrox card is as much "this record is somebody's file" as a
 * level card is.
 */
async function holdsCardOrRelease(db: DbExecutor, shopId: string, personId: string) {
  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.shopId, shopId), eq(cards.personId, personId), isNull(cards.deletedAt)))
    .limit(1);
  if (card) return true;
  const [release] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        isNotNull(waiverRecords.signedAt),
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .limit(1);
  return Boolean(release);
}

/**
 * The acknowledgement a staffer gives is for the warnings they read, not for
 * "whatever is true when the click lands". The preview posts this, and the
 * transaction recomputes it from a fresh assessment and refuses on any
 * difference (`assessment_changed`): a release signed, or a medical answer
 * parked, between the two must be read before it is merged.
 */
export function diverMergeAcknowledgement(
  warnings: readonly DiverMergeWarning[],
  releaseNames: readonly string[],
): string {
  const canonical = JSON.stringify([
    [...warnings].sort(),
    releaseNames.map((name) => normalizePersonName(name)).sort(),
  ]);
  return createHash("sha256").update(canonical).digest("base64url").slice(0, 32);
}

/**
 * Everything that decides whether two records may become one, asked once for
 * the preview and again inside the merge's own transaction with both rows
 * locked. One function so the page can never promise a merge the transaction
 * then refuses for a reason the page did not show, or the reverse.
 */
async function assessMerge(
  db: DbExecutor,
  shopId: string,
  source: PersonRow,
  survivor: PersonRow,
): Promise<MergeAssessment> {
  const refuse = (reason: DiverMergeRefusal, sharedDepartures: DiverMergeSharedDeparture[] = []) =>
    ({ ok: false, reason, sharedDepartures }) as const;
  if (source.anonymizedAt || survivor.anonymizedAt) return refuse("anonymized");
  if (source.mergedIntoPersonId || survivor.mergedIntoPersonId) return refuse("already_merged");
  if (source.deletedAt || survivor.deletedAt) return refuse("already_removed");

  const ids = [source.id, survivor.id];
  const roles = await db
    .select({ personId: personRoles.personId, role: personRoles.role })
    .from(personRoles)
    .where(inArray(personRoles.personId, ids));
  if (
    !roles.some((row) => row.personId === source.id && row.role === "diver") ||
    !roles.some((row) => row.personId === survivor.id && row.role === "diver") ||
    roles.some((row) => row.role !== "diver")
  ) {
    return refuse("staff_record");
  }

  // The unique `(trip_id, person_id)` booking key makes a shared departure a
  // safety decision, not a generic data collision: two *live* seats on one
  // boat usually mean two people, and silently choosing one would rewrite who
  // was aboard. Staff resolve that on the departure first; the preview names
  // each one so they know where to go.
  //
  // A *cancelled* seat is not that (issue #2177). Nothing can resolve it any further (a cancelled
  // booking cannot be removed), so refusing on it blocked the merge forever.
  // The merged-away record's over seat simply stays on that record, keeping
  // its pointer and the departure log intact, and the kept record's seat is
  // untouched. The one shape that still refuses is a live seat on the
  // merged-away record beside an over seat on the kept one: the key has room
  // for one seat, and the live seat must not be left on a removed record.
  // Merged the other way round, that same pair is the first shape and merges.
  //
  // Fail closed: only the seat's own `cancelled` status makes it over. A seat
  // on a deleted departure still counts as live here — `deleteTrip` refuses a
  // departure with bookings today, but this check does not lean on that.
  const bookingRows = await db
    .select({
      id: bookings.id,
      personId: bookings.personId,
      tripId: bookings.tripId,
      status: bookings.status,
    })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.personId, ids)));
  const seatIsOver = (row: (typeof bookingRows)[number]) => row.status === "cancelled";
  const seatsByTrip = new Map<
    string,
    { source?: (typeof bookingRows)[number]; survivor?: (typeof bookingRows)[number] }
  >();
  for (const row of bookingRows) {
    const pair = seatsByTrip.get(row.tripId) ?? {};
    if (row.personId === source.id) pair.source = row;
    else pair.survivor = row;
    seatsByTrip.set(row.tripId, pair);
  }
  const seatsLeftBehind: string[] = [];
  const conflicts = new Map<string, boolean>();
  for (const [tripId, pair] of seatsByTrip) {
    if (!pair.source || !pair.survivor) continue;
    if (seatIsOver(pair.source)) seatsLeftBehind.push(pair.source.id);
    else conflicts.set(tripId, seatIsOver(pair.survivor));
  }
  if (conflicts.size > 0) {
    const departures = await db
      .select({ tripId: trips.id, title: trips.title, startsAt: trips.startsAt })
      .from(trips)
      // diveday:allow-deleted-trips: the ids come from the seats above, and a live seat's departure is named whatever its state
      .where(and(eq(trips.shopId, shopId), inArray(trips.id, [...conflicts.keys()])))
      .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
    const sharedDepartures = departures.map((departure) => ({
      ...departure,
      keptSeatOver: conflicts.get(departure.tripId) === true,
    }));
    return refuse("booking_conflict", sharedDepartures);
  }

  // A seat on a departure that is out right now: the boat has been boarded and
  // not everyone is home. Roll call, the manifest and the dock are all reading
  // the seat's diver by record, and a merge mid-water repoints the seat under
  // them. Started counts from the scheduled time or the first check-in,
  // whichever says so first; home is `hasReturned`, the evening's own rule.
  const now = nowDate();
  const live = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.personId, ids),
        seatNotCancelled,
        eq(trips.status, "scheduled"),
        liveTrip(),
        or(lte(trips.startsAt, now), seatCheckedIn),
      ),
    );
  if (live.some((trip) => !hasReturned(trip.endsAt, now))) return refuse("departure_underway");

  for (const refused of STAFF_HISTORY_TABLES) {
    if (
      (await hasPersonRow(db, refused, shopId, source.id)) ||
      (await hasPersonRow(db, refused, shopId, survivor.id))
    ) {
      return refuse("staff_record");
    }
  }
  for (const tableName of STAFF_PERSON_ONLY_TABLES) {
    if (
      (await hasPersonOnlyRow(db, tableName, source.id)) ||
      (await hasPersonOnlyRow(db, tableName, survivor.id))
    ) {
      return refuse("staff_record");
    }
  }

  const warnings: DiverMergeWarning[] = [];
  if (source.dateOfBirth && survivor.dateOfBirth && source.dateOfBirth !== survivor.dateOfBirth) {
    warnings.push("different_birth_dates");
  }
  if (Boolean(source.dateOfBirth) !== Boolean(survivor.dateOfBirth)) {
    if (matchRestsOnNameAlone(source, survivor)) warnings.push("birth_date_unknown_on_one_record");
  }
  if (
    (await holdsCardOrRelease(db, shopId, source.id)) &&
    (await holdsCardOrRelease(db, shopId, survivor.id))
  ) {
    warnings.push("both_hold_cards_or_releases");
  }
  const sourceMedical = await medicalFlags(db, shopId, source.id);
  const survivorMedical = await medicalFlags(db, shopId, survivor.id);
  if (sourceMedical.openMedicalHold || survivorMedical.openMedicalHold) {
    warnings.push("open_medical_hold");
  }
  if (sourceMedical.declinedClearance || survivorMedical.declinedClearance) {
    warnings.push("declined_clearance");
  }
  const signed = await db
    .select({ signedName: waiverRecords.signedName })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.personId, ids),
        isNotNull(waiverRecords.signedAt),
        isNull(waiverRecords.anonymizedAt),
      ),
    );
  // The names a release can be checked against: each one's signed name, and
  // both records' own names, since the kept record ends up under one of the
  // two and every release lands on it. Only when a signed release exists: two
  // spellings of a name with no legal paper behind either are a field
  // conflict, not two people's records.
  const releaseNames: string[] = [];
  const note = (raw: string | null | undefined) => {
    const name = raw?.trim();
    if (name && !releaseNames.some((known) => personNamesMatch(known, name))) {
      releaseNames.push(name);
    }
  };
  if (signed.length > 0) {
    for (const { signedName } of signed) note(signedName);
    note(survivor.fullName);
    note(source.fullName);
  }
  if (releaseNames.length > 1) warnings.push("releases_under_different_names");
  return { ok: true, seatsLeftBehind, warnings, releaseNames };
}

/** The sizes half of a rental fit profile: what the preview compares and shows. */
export type DiverMergeRentalFit = {
  bcdSize: string | null;
  wetsuitSize: string | null;
  drysuitSize: string | null;
  bootSize: string | null;
  finSize: string | null;
  weightPreference: string | null;
};

const rentalFitColumns = {
  personId: rentalFitProfiles.personId,
  bcdSize: rentalFitProfiles.bcdSize,
  wetsuitSize: rentalFitProfiles.wetsuitSize,
  drysuitSize: rentalFitProfiles.drysuitSize,
  bootSize: rentalFitProfiles.bootSize,
  finSize: rentalFitProfiles.finSize,
  weightPreference: rentalFitProfiles.weightPreference,
};

function sameRentalFit(a: DiverMergeRentalFit, b: DiverMergeRentalFit): boolean {
  return (
    a.bcdSize === b.bcdSize &&
    a.wetsuitSize === b.wetsuitSize &&
    a.drysuitSize === b.drysuitSize &&
    a.bootSize === b.bootSize &&
    a.finSize === b.finSize &&
    a.weightPreference === b.weightPreference
  );
}

/**
 * What each side holds, grouped the way a staffer thinks about a diver's file
 * rather than table by table. Every table the merge moves is in exactly one
 * group (`diver-merge.test.ts` holds that), so the preview's counts are the
 * whole of what moves.
 */
export const DIVER_MERGE_COUNT_GROUPS = {
  bookings: ["bookings"],
  // A signed course form is the same kind of paper as the release (ADR
  // 20261008-course-forms), so the preview counts it with them.
  releases: ["waiver_records", "course_form_records"],
  cards: ["cards"],
  orders: ["orders", "dive_package_entitlements", "imported_payment_history"],
  notes: ["internal_notes"],
  messages: ["inbound_messages", "staff_replies", "customer_gear_notices"],
  reviews: ["trip_reviews", "recap_pulses"],
  gear: [
    "gear_reservations",
    "prior_gear_assignments",
    "rental_fit_profiles",
    "customer_gear_items",
    "work_orders",
    "lost_items",
  ],
  history: ["prior_visits", "certification_junior_reviews"],
  lists: ["interests", "capabilities", "trip_blowout_divers"],
} as const satisfies Record<string, readonly (typeof DIVER_HISTORY_TABLES)[number][]>;
export type DiverMergeCountGroup = keyof typeof DIVER_MERGE_COUNT_GROUPS;

export type DiverMergeSide = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  rentalFit: DiverMergeRentalFit | null;
  counts: Record<DiverMergeCountGroup, number>;
  /** Signed releases carrying medical answers: never dropped, always moved. */
  medicalAnswers: number;
  medical: DiverMergeMedicalFlags;
  /** When the record was made: what tells two records under one name apart. */
  createdAt: Date;
};

export type DiverMergePreview = {
  /** The record merged away (the route's diver). */
  source: DiverMergeSide;
  /** The record kept. */
  survivor: DiverMergeSide;
  /** Fields where both records hold a value and the values differ. */
  conflicts: DiverMergeField[];
  /** Why the merge cannot run, or null. A refusal the transaction would reach too. */
  refusal: DiverMergeRefusal | null;
  /** Departures both records hold a seat on; non-empty only with `booking_conflict`. */
  sharedDepartures: DiverMergeSharedDeparture[];
  warnings: DiverMergeWarning[];
  releaseNames: string[];
  /** What the acknowledgement checkbox posts: {@link diverMergeAcknowledgement} of the above. */
  acknowledgement: string;
};

async function countRows(
  db: DbExecutor,
  tableName: string,
  shopId: string,
  personId: string,
): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as n from ${sql.raw(quotedTable(tableName))} where "shop_id" = ${shopId} and "person_id" = ${personId}`,
  );
  return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

async function mergeSide(
  db: DbExecutor,
  shopId: string,
  person: PersonRow,
): Promise<DiverMergeSide> {
  const counts = {} as Record<DiverMergeCountGroup, number>;
  // Sequential: one checked-out client inside a transaction never fans out
  // (`scripts/check-db-concurrency.mjs`), and this runs on a preview page, once.
  for (const [group, tables] of Object.entries(DIVER_MERGE_COUNT_GROUPS)) {
    let total = 0;
    for (const tableName of tables) total += await countRows(db, tableName, shopId, person.id);
    counts[group as DiverMergeCountGroup] = total;
  }
  const [fit] = await db
    .select(rentalFitColumns)
    .from(rentalFitProfiles)
    .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, person.id)))
    .limit(1);
  const [medical] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, person.id),
        isNotNull(waiverRecords.medicalAnswers),
        isNotNull(waiverRecords.signedAt),
      ),
    );
  return {
    id: person.id,
    fullName: person.fullName,
    email: person.email,
    phone: person.phone,
    dateOfBirth: person.dateOfBirth,
    emergencyContactName: person.emergencyContactName,
    emergencyContactPhone: person.emergencyContactPhone,
    rentalFit: fit
      ? {
          bcdSize: fit.bcdSize,
          wetsuitSize: fit.wetsuitSize,
          drysuitSize: fit.drysuitSize,
          bootSize: fit.bootSize,
          finSize: fit.finSize,
          weightPreference: fit.weightPreference,
        }
      : null,
    counts,
    medicalAnswers: Number(medical?.n ?? 0),
    medical: await medicalFlags(db, shopId, person.id),
    createdAt: person.createdAt,
  };
}

function differs<T>(a: T | null, b: T | null, same: (a: T, b: T) => boolean = Object.is): boolean {
  return a !== null && b !== null && !same(a, b);
}

/** The fields a staffer has to choose between: both sides hold a value and they differ. */
function conflictingFields(source: DiverMergeSide, survivor: DiverMergeSide): DiverMergeField[] {
  const contact = (side: DiverMergeSide) =>
    side.emergencyContactName || side.emergencyContactPhone
      ? `${side.emergencyContactName ?? ""}\u0000${side.emergencyContactPhone ?? ""}`
      : null;
  const conflicts: DiverMergeField[] = [];
  if (source.fullName.trim() !== survivor.fullName.trim()) conflicts.push("fullName");
  if (differs(source.dateOfBirth, survivor.dateOfBirth)) conflicts.push("dateOfBirth");
  if (
    differs(
      source.email?.trim().toLowerCase() ?? null,
      survivor.email?.trim().toLowerCase() ?? null,
    )
  ) {
    conflicts.push("email");
  }
  if (differs(source.phone?.trim() ?? null, survivor.phone?.trim() ?? null))
    conflicts.push("phone");
  if (differs(contact(source), contact(survivor))) conflicts.push("emergencyContact");
  if (differs(source.rentalFit, survivor.rentalFit, sameRentalFit)) conflicts.push("rentalFit");
  return conflicts;
}

/**
 * The side-by-side a staffer reads before merging `personId` into
 * `survivorId`: both records' particulars, what each holds, the fields they
 * disagree on, and anything that would refuse or should give pause.
 *
 * Null when the pair is not two records of this shop (or is one record twice),
 * which the page answers with a 404 exactly like a stranger's id: it never
 * says whether another shop has that diver. Null too when either record is not
 * a plain diver (`staff_record`): the page would otherwise lay a staffer's
 * date of birth, phone and emergency contact out beside a diver's, for a merge
 * the transaction refuses anyway.
 */
export async function getDiverMergePreview(
  db: AppDb,
  shopId: string,
  personId: string,
  survivorId: string,
): Promise<DiverMergePreview | null> {
  if (personId === survivorId) return null;
  const rows = await db
    .select()
    .from(people)
    // diveday:allow-deleted-people: both records as they stand; the merge's own checks decide what may merge.
    .where(and(eq(people.shopId, shopId), inArray(people.id, [personId, survivorId])));
  const source = rows.find((row) => row.id === personId);
  const survivor = rows.find((row) => row.id === survivorId);
  if (!source || !survivor) return null;

  const assessment = await assessMerge(db, shopId, source, survivor);
  if (!assessment.ok && assessment.reason === "staff_record") return null;
  const sourceSide = await mergeSide(db, shopId, source);
  const survivorSide = await mergeSide(db, shopId, survivor);
  // "What moves" counts what moves: a seat left behind stays where it is.
  if (assessment.ok) sourceSide.counts.bookings -= assessment.seatsLeftBehind.length;
  return {
    source: sourceSide,
    survivor: survivorSide,
    conflicts: conflictingFields(sourceSide, survivorSide),
    refusal: assessment.ok ? null : assessment.reason,
    sharedDepartures: assessment.ok ? [] : assessment.sharedDepartures,
    warnings: assessment.ok ? assessment.warnings : [],
    releaseNames: assessment.ok ? assessment.releaseNames : [],
    acknowledgement: assessment.ok
      ? diverMergeAcknowledgement(assessment.warnings, assessment.releaseNames)
      : "",
  };
}

/** The staffer's pick where they chose one, else the kept record's value, else the other's. */
function chosen<T>(
  choice: DiverMergeSideChoice | undefined,
  survivorValue: T | null,
  sourceValue: T | null,
): T | null {
  if (choice === "source" && sourceValue !== null) return sourceValue;
  return survivorValue ?? sourceValue;
}

/**
 * Move a diver's owned history and leave a pointer on the old row. The
 * transaction locks both identities in stable id order, refuses the
 * safety-sensitive states up front (`assessMerge`), and lets database unique
 * constraints turn every other collision into one atomic refusal. Activity
 * events are absent from the moved tables on purpose: their actor/subject ids
 * are an audit trail and must continue to name the original person (issue
 * #730); the merge appends one line of its own on the kept record instead.
 *
 * `choices` settles each field the two records disagree on; a field with no
 * choice keeps the kept record's value and falls back to the other's only when
 * the kept record has none. `acknowledged` is the staffer's explicit "yes,
 * still one person" when `assessMerge` found a reason to doubt it, carried as
 * the {@link diverMergeAcknowledgement} of the warnings they read: without it
 * such a merge is refused, and with a stale one it is refused as
 * `assessment_changed`.
 */
export async function mergeDiverRecords(input: {
  db: DbExecutor;
  shopId: string;
  personId: string;
  survivorId: string;
  actorPersonId: string;
  choices?: DiverMergeChoices;
  acknowledged?: string;
}): Promise<DiverMergeResult> {
  const choices = input.choices ?? {};
  try {
    return await input.db.transaction(async (tx): Promise<DiverMergeResult> => {
      if (!(await canPersonMergeDiver(tx, input.shopId, input.actorPersonId))) {
        return { ok: false, reason: "not_authorized" };
      }
      if (input.personId === input.survivorId) {
        return { ok: false, reason: "not_found" };
      }

      await lockBoardingCertificationEvidence(tx, input.shopId, "rewrite");
      const lockedIds = [input.personId, input.survivorId].sort();
      const locked = await tx
        .select()
        .from(people)
        // diveday:allow-deleted-people: both records locked as they stand; the merge's own checks decide.
        // diveday:allow-update-lock: the merge soft-deletes the source and repoints every key at the survivor; nothing may hold either row meanwhile.
        .where(and(eq(people.shopId, input.shopId), inArray(people.id, lockedIds)))
        .orderBy(asc(people.id))
        .for("update");
      const byId = new Map(locked.map((person) => [person.id, person]));
      const source = byId.get(input.personId);
      const survivor = byId.get(input.survivorId);
      if (
        !source ||
        !survivor ||
        source.shopId !== input.shopId ||
        survivor.shopId !== input.shopId
      ) {
        return { ok: false, reason: "not_found" };
      }

      const assessment = await assessMerge(tx, input.shopId, source, survivor);
      if (!assessment.ok) {
        const conflictTripId = assessment.sharedDepartures[0]?.tripId;
        return conflictTripId
          ? { ok: false, reason: assessment.reason, conflictTripId }
          : { ok: false, reason: assessment.reason };
      }
      if (assessment.warnings.length > 0) {
        if (!input.acknowledged) return { ok: false, reason: "different_people_unacknowledged" };
        if (
          input.acknowledged !==
          diverMergeAcknowledgement(assessment.warnings, assessment.releaseNames)
        ) {
          return { ok: false, reason: "assessment_changed" };
        }
      }

      await rewriteBoardingSnapshotReviewer(tx, input.shopId, source.id, survivor.id);
      // A new identity must not inherit an unconfirmed instructor plan.
      await forgetTrainingPlanPeople(tx, input.shopId, [source.id]);
      const mergedAt = nowDate();
      const mergedSpokenLanguages = [
        ...new Set([...survivor.spokenLanguages, ...source.spokenLanguages]),
      ];
      // The source goes first so its email leaves the live unique index
      // (`people_shop_email_unique` is partial on `deleted_at is null`) before
      // the kept record takes it, when the staffer chose the source's address.
      await tx
        .update(people)
        .set({
          deletedAt: mergedAt,
          mergedIntoPersonId: survivor.id,
          mergedAt,
          mergedByPersonId: input.actorPersonId,
        })
        .where(eq(people.id, source.id));

      const fullName =
        choices.fullName === "source" && source.fullName.trim()
          ? source.fullName
          : survivor.fullName;
      const dateOfBirth = chosen(choices.dateOfBirth, survivor.dateOfBirth, source.dateOfBirth);
      const survivorHasContact = Boolean(
        survivor.emergencyContactName || survivor.emergencyContactPhone,
      );
      const sourceHasContact = Boolean(source.emergencyContactName || source.emergencyContactPhone);
      // One pair, never a name from one record beside the other's number.
      const contactFrom =
        (choices.emergencyContact === "source" && sourceHasContact) || !survivorHasContact
          ? source
          : survivor;

      await tx
        .update(people)
        .set({
          fullName,
          email: chosen(choices.email, survivor.email, source.email),
          phone: chosen(choices.phone, survivor.phone, source.phone),
          emergencyContactName: contactFrom.emergencyContactName,
          emergencyContactPhone: contactFrom.emergencyContactPhone,
          dateOfBirth,
          // A record that took in another is no longer one a single booking
          // made, whichever way the merge went: the parent's door
          // (`seatPersonIsThisBookings`) stays shut for it (security review
          // 2026-10-17, issue #2665).
          createdByBookingId: null,
          // A staffer's "18 or older" (H-20261007-held-seat-split-into) travels as a pair with its author,
          // from whichever record has one, survivor first, and only while no
          // date answers the question instead.
          ...(dateOfBirth
            ? { adultAttestedAt: null, adultAttestedByPersonId: null }
            : survivor.adultAttestedAt
              ? {
                  adultAttestedAt: survivor.adultAttestedAt,
                  adultAttestedByPersonId: survivor.adultAttestedByPersonId,
                }
              : {
                  adultAttestedAt: source.adultAttestedAt,
                  adultAttestedByPersonId: source.adultAttestedByPersonId,
                }),
          diveInsurance: survivor.diveInsurance ?? source.diveInsurance,
          locale: survivor.locale ?? source.locale,
          spokenLanguages: mergedSpokenLanguages,
          // Carried as a unit, never column by column. Readers ask this pair
          // structurally -- `declared is not null and cleared is null` means
          // the diver's "I hold no card" stamp still stands -- and
          // `recordNoCertification` keeps that true by nulling `cleared_at`
          // whenever a fresh declaration arrives. Maxing the two columns
          // separately could pair a survivor's live declaration with the
          // *other* record's older clear, which reads as no declaration at
          // all: the stamp vanishes from the record, the certification send
          // lists and the export, with nothing saying so.
          ...noCertificationStamp(survivor, source),
          // A staffer's "seen diving dry" (#2136) travels with its author and
          // note: the earliest record wins, survivor on a tie.
          ...drysuitExperienceSeen(survivor, source),
          // The later recorded last dive: both are true, and the later one
          // is the one that says when they last dived.
          lastDiveOn: latestCalendarDate(survivor.lastDiveOn, source.lastDiveOn),
          courtesyEmailOptOutAt: oldestDate(
            survivor.courtesyEmailOptOutAt,
            source.courtesyEmailOptOutAt,
          ),
        })
        .where(eq(people.id, survivor.id));

      // Make room for the singleton the repoint below moves. Where both records
      // hold one, the kept record's wins unless the staffer chose the other's
      // sizes, in which case the kept record's own profile is the one that
      // goes. Sequential, never a fan-out: this is one checked-out client
      // (`scripts/check-db-concurrency.mjs`).
      for (const tableName of SINGLETON_PER_PERSON_TABLES) {
        const singleton = { table: tableName, column: "person_id" };
        const survivorHasOne = await hasPersonRow(tx, singleton, input.shopId, survivor.id);
        if (!survivorHasOne) continue;
        const sourceWins =
          tableName === "rental_fit_profiles" &&
          choices.rentalFit === "source" &&
          (await hasPersonRow(tx, singleton, input.shopId, source.id));
        await tx.execute(
          sql`delete from ${sql.raw(quotedTable(tableName))} where "shop_id" = ${input.shopId} and "person_id" = ${sourceWins ? survivor.id : source.id}`,
        );
      }

      // Interests are unique per person per departure (both records on one
      // departure's wait list, or both offered it, would collide on the
      // repoint) and per person for the last-minute list. The kept record's row
      // stands and the merged-away duplicate goes, as the singletons above.
      // Now reachable, because a cancelled seat no longer refuses a merge on a
      // departure both records share (issue #2177).
      await tx.execute(
        sql`delete from "interests" where "shop_id" = ${input.shopId} and "person_id" = ${source.id} and "scope" = 'departure' and "trip_id" in (select "trip_id" from "interests" where "shop_id" = ${input.shopId} and "person_id" = ${survivor.id} and "scope" = 'departure')`,
      );
      // The last-minute list is one interest per person: the source's goes. Before
      // it does, what it carries moves to the kept record's interest (security
      // review of #2656, minor 5). Both records are one person, so an
      // unsubscribe either made is that person's and stands: the kept interest takes
      // the source's `unsubscribed` close unless it is unsubscribed already. The
      // links already mailed, and the offer rows the list made, point at the
      // kept interest, so an old link still unsubscribes and still stops them.
      const survivorList = sql`(select "id" from "interests" where "shop_id" = ${input.shopId} and "person_id" = ${survivor.id} and "scope" = 'anytime')`;
      const sourceList = sql`(select "id" from "interests" where "shop_id" = ${input.shopId} and "person_id" = ${source.id} and "scope" = 'anytime')`;
      await tx.execute(
        sql`update "interests" as kept set "closed_at" = gone."closed_at", "closed_as" = 'unsubscribed' from "interests" as gone where kept."id" = ${survivorList} and gone."id" = ${sourceList} and gone."closed_as" = 'unsubscribed' and kept."closed_as" is distinct from 'unsubscribed'`,
      );
      await tx.execute(
        sql`update "capabilities" set "interest_id" = ${survivorList} where "shop_id" = ${input.shopId} and "interest_id" = ${sourceList} and exists ${survivorList}`,
      );
      await tx.execute(
        sql`update "interests" set "parent_interest_id" = ${survivorList} where "shop_id" = ${input.shopId} and "parent_interest_id" = ${sourceList} and exists ${survivorList}`,
      );
      await tx.execute(
        sql`delete from "interests" where "shop_id" = ${input.shopId} and "person_id" = ${source.id} and "scope" = 'anytime' and exists (select 1 from "interests" where "shop_id" = ${input.shopId} and "person_id" = ${survivor.id} and "scope" = 'anytime')`,
      );

      // Releases through the one path that keeps their seals honest: a bare
      // repoint would make every sealed release read as tampered, `person_id`
      // being inside the seal. An erased release stays on the record it was
      // erased under, its version 2 seal covering that record, so the blanket
      // repoint below skips the table rather than undo that.
      await refileWaiverRecords(tx, {
        shopId: input.shopId,
        fromPersonId: source.id,
        toPersonId: survivor.id,
        actorPersonId: input.actorPersonId,
      });
      // Course forms the same way, for the same reason (issue #2266).
      await refileCourseFormRecords(tx, {
        shopId: input.shopId,
        fromPersonId: source.id,
        toPersonId: survivor.id,
      });
      const transferredBookings = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.shopId, input.shopId), eq(bookings.personId, source.id)));
      if (transferredBookings.length > 0) {
        const transferredAt = nowDate();
        await tx
          .update(bookingCapabilities)
          .set({ revokedAt: transferredAt, expiresAt: transferredAt, tokenSealed: null })
          .where(
            and(
              eq(bookingCapabilities.shopId, input.shopId),
              inArray(
                bookingCapabilities.bookingId,
                transferredBookings.map(({ id }) => id),
              ),
              isNull(bookingCapabilities.revokedAt),
            ),
          );
      }
      await tx
        .delete(notificationSendQueue)
        .where(
          and(
            eq(notificationSendQueue.shopId, input.shopId),
            eq(notificationSendQueue.recipientPersonId, source.id),
          ),
        );
      for (const tableName of DIVER_HISTORY_TABLES) {
        if (tableName === "waiver_records" || tableName === "course_form_records") continue;
        // A seat that is already over, on a departure the kept record also
        // sits on, stays on this record (`assessMerge`, issue #2177). Only the
        // seat: what hangs off it (its release, order, notes) is the person's
        // and follows them like everything else.
        const leftBehind =
          tableName === "bookings" && assessment.seatsLeftBehind.length > 0
            ? sql` and "id" not in (${sql.join(
                assessment.seatsLeftBehind.map((id) => sql`${id}`),
                sql`, `,
              )})`
            : sql``;
        await tx.execute(
          sql`update ${sql.raw(quotedTable(tableName))} set "person_id" = ${survivor.id} where "shop_id" = ${input.shopId} and "person_id" = ${source.id}${leftBehind}`,
        );
      }

      const [actor] = await tx
        .select({ name: people.fullName })
        .from(people)
        // diveday:allow-deleted-people: the actor's name for the activity line.
        .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
        .limit(1);
      await tx.insert(activityEvents).values({
        shopId: input.shopId,
        tripId: null,
        bookingId: null,
        actorPersonId: input.actorPersonId,
        subjectPersonId: survivor.id,
        code: "diver_merged",
        params: { actor: actor?.name ?? "", diver: fullName, merged: source.fullName },
        occurredAt: mergedAt,
      });

      return { ok: true, survivorId: survivor.id, mergedPersonId: source.id };
    });
  } catch (error) {
    // Every history table is moved inside the same transaction. A collision on
    // any of its unique keys rolls the whole transaction back, then becomes a
    // deliberate refusal rather than a partial merge or a 500.
    if (isUniqueConstraintViolation(error)) {
      return { ok: false, reason: "record_conflict" };
    }
    throw error;
  }
}
