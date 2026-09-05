import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { canPersonMergeDiver } from "@/db/authz";
import { type AppDb, type DbExecutor, isUniqueConstraintViolation } from "@/db/client";
import { bookings, people, personRoles } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { MIN_PHONE_SEARCH_DIGITS, phoneDigits } from "@/lib/person-fields";
import { normalizePersonName } from "@/lib/person-name";

/** Why a second active diver record was shown on the survivor-choice panel. */
export type DiverMergeCandidateReason = "same_phone" | "same_name";

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
  | "record_conflict";

export type DiverMergeResult =
  | { ok: true; survivorId: string; mergedPersonId: string }
  | { ok: false; reason: DiverMergeRefusal };

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
 * last-minute-list entry is a standing "tell me when a seat frees".
 */
const SINGLETON_PER_PERSON_TABLES = [
  "rental_fit_profiles",
  "dive_support_needs",
  "last_minute_list_entries",
] as const;

export const DIVER_HISTORY_TABLES = [
  "course_inquiries",
  "bookings",
  "internal_notes",
  "trip_waitlist_entries",
  "trip_invitations",
  "last_minute_list_entries",
  "person_courtesy_email_unsubscribe_tokens",
  "trip_last_minute_promo_recipients",
  "dive_package_entitlements",
  "orders",
  "waiver_records",
  "certifications",
  "specialty_certifications",
  "prior_visits",
  "imported_payment_history",
  "rental_fit_profiles",
  // The arrangements a diver stated for their dives, one row per person like
  // the fit beside it. Left behind, the survivor's prep page and manifest say
  // nothing about a hoist the diver asked for -- the silently-lost arrangement
  // the support-needs ADR names as this record's failure mode.
  "dive_support_needs",
  // A bookingless counter rental names the diver directly (the other shape
  // names a booking, which this merge moves anyway). Leaving it behind put the
  // unit on a removed diver's record: the survivor's prep page showed no gear
  // and the reservation still held the window.
  "gear_reservations",
  "prior_gear_assignments",
  "nitrox_certifications",
  "trip_reviews",
  // The private half of the same act (ADR 20260904-reef-all-the-way-down,
  // D40): the diver's own word about how the day went, on the booking they
  // sat in. It moves for the reason the review above it does — it is the
  // diver's, not the shop's — and it cannot collide, because the live-row
  // unique index is per *booking*, and the bookings move with them.
  "recap_pulses",
  "trip_blowout_divers",
] as const;

/** These rows identify a staff account or crew assignment, not a diver history. */
export const STAFF_HISTORY_TABLES = [
  "staff_shifts",
  "staff_credentials",
  "account_sessions",
  "calendar_feeds",
  "roll_call_crew_events",
  "push_subscriptions",
  // The staffing week's own two tables (issue #1235). Both are written by, and
  // about, somebody who crews boats — a days-away block or an ask for a
  // departure — so either side of a merge holding one is a staff record and the
  // merge is refused, exactly as a seeded shift refuses it.
  "crew_availability_blocks",
  "crew_assignment_requests",
  // Where a *staffer* had read up to in a departure's shift catch-up (issues
  // #1202, #1187). Same shape as `push_subscriptions` above it: written by, and
  // about, somebody who works the boats, so either side of a merge holding one
  // is a staff record and the merge is refused rather than carried across.
  "trip_read_marks",
] as const;
export const STAFF_PERSON_ONLY_TABLES = ["trip_assignments", "user_accounts"] as const;

/**
 * Every `%person_id` column that is not a bare `person_id`, keyed
 * `table.column`. **None of them move**, and stating that is the point: the
 * exhaustiveness test below asked `column_name = 'person_id'`, so a column
 * carrying a prefix — which is most of them — was invisible to the guard
 * written to stop a table being forgotten. `trip_desk_events` (slice 16d)
 * landed in that blind spot with nothing going red. The test now asks
 * `like '%person_id'`, and this map is what makes it pass on purpose rather
 * than by accident.
 *
 * Two reasons cover the whole list.
 *
 * **Attribution** — `recorded_by`, `actor`, `created_by`, `deleted_by`,
 * `issued_by`, `reviewed_by`, `called_by`, `resolved_by`, `uploaded_by`,
 * `decided_by`, `discharged_by`, `merged_by`, `anonymized_by`. Who did a thing
 * is operational evidence about the *shop*, on the same ground `anonymizeDiver`
 * refuses to erase a staff member at all. A merge involving somebody who has
 * any of it is refused by the `STAFF_*` lists long before this matters.
 *
 * **Subject on an event trail** — `activity_events.subject_person_id` and
 * `trip_desk_events.subject_person_id`. A trail records what happened, not what
 * is true now: repointing the subject would make the shop's own history claim
 * the survivor was the subject of an act performed against a record that had a
 * different name at the time. This is the pre-existing, tested answer for
 * `activity_events` ("leaves activity subjects on the original id"), and
 * `trip_desk_events` takes it for the same reason plus one of its own — it is
 * read by `trip_id`, never by person, so nothing is lost from the survivor's
 * page by leaving it.
 */
export const PERSON_COLUMNS_DELIBERATELY_UNMOVED: Readonly<Record<string, string>> = {
  "activity_events.actor_person_id": "who did it — attribution, not diver history",
  "activity_events.subject_person_id": "an event trail records who it happened to at the time",
  "buddy_pair_members.crew_person_id": "a crew member on a team, refused as a staff record",
  "buddy_pair_members.paired_by_person_id": "who built the team",
  "buddy_team_events.recorded_by_person_id": "who recorded the team change",
  "certifications.deleted_by_person_id": "who removed the card",
  "certifications.issued_by_person_id": "who entered the card",
  "certifications.reviewed_by_person_id": "who confirmed the card",
  "closeout_leftover_decisions.actor_person_id": "who decided what happened to the leftover",
  "crew_assignment_requests.decided_by_person_id": "who answered the ask",
  "crew_availability_blocks.created_by_person_id": "who blocked the days",
  "day_closeouts.actor_person_id": "who closed the day",
  "dive_packages.created_by_person_id": "who wrote the package",
  "executed_dives.deleted_by_person_id": "who deleted the logged dive",
  "executed_dives.recorded_by_person_id": "who logged the dive",
  "gear_items.deleted_by_person_id": "who retired the unit",
  "gear_service_events.recorded_by_person_id": "who serviced the unit",
  "internal_notes.created_by_person_id": "who wrote the note",
  "marine_life_requests.requested_by_person_id": "which staffer asked for the species",
  "nitrox_certifications.deleted_by_person_id": "who removed the card",
  "nitrox_certifications.issued_by_person_id": "who entered the card",
  "nitrox_certifications.reviewed_by_person_id": "who confirmed the card",
  "orders.created_by_person_id": "who took the order",
  "people.anonymized_by_person_id": "provenance for an erasure, and anonymized rows never merge",
  "people.merged_by_person_id": "who ran a merge",
  "people.merged_into_person_id":
    "the merge pointer itself — structural, and what makes the shell resolve",
  "people.no_certification_cleared_by_person_id": "who cleared the no-card stamp",
  "pre_departure_check_events.recorded_by_person_id": "who ticked the check",
  "pre_departure_checklist_items.deleted_by_person_id": "who removed the check",
  "processor_erasure_obligations.discharged_by_person_id": "who discharged the obligation",
  "recap_pulses.addressed_by_person_id": "which staffer picked the pulse up",
  "review_moderation_events.recorded_by_person_id": "who published or withheld the review",
  "roll_call_crew_events.recorded_by_person_id": "who called the crew roll",
  "roll_call_events.recorded_by_person_id": "who called the roll",
  "shop_promo_codes.created_by_person_id": "who wrote the code",
  "specialty_certifications.deleted_by_person_id": "who removed the card",
  "specialty_certifications.issued_by_person_id": "who entered the card",
  "specialty_certifications.reviewed_by_person_id": "who confirmed the card",
  "staff_credentials.deleted_by_person_id": "who removed the credential",
  "staff_credentials.reviewed_by_person_id": "who confirmed the credential",
  "staff_shifts.created_by_person_id": "who wrote the shift",
  "trip_blowouts.called_by_person_id": "who called the blow-out",
  "trip_change_events.actor_person_id": "who changed the departure",
  "trip_desk_events.actor_person_id": "who did it at the desk",
  "trip_desk_events.subject_person_id": "an event trail records who it happened to at the time",
  "trip_help_requests.resolved_by_person_id": "who answered the ask",
  "trip_invitations.created_by_person_id": "who sent the invitation",
  "trip_last_minute_promos.created_by_person_id": "who wrote the deal",
  "trip_recap_photos.uploaded_by_person_id": "who uploaded the photo",
  "trip_stage_events.recorded_by_person_id": "who said where the boat was",
  "waiver_materiality_decisions.actor_person_id": "who judged the answer material",
  "waiver_records.anonymized_by_person_id": "provenance for an erasure on a signed release",
  "waiver_records.medical_clearance_declined_by_person_id": "who declined the clearance",
  "waiver_records.medical_cleared_by_person_id": "who cleared the medical answer",
  "waiver_records.recorded_by_person_id": "who witnessed the signature",
};

/**
 * The rest of the bare `person_id` columns in the schema, each left where it is
 * on purpose. Stated rather than merely absent so `diver-merge.test.ts` can hold
 * the lists above exhaustive against the live database: a table added tomorrow
 * with a `person_id` fails that test until somebody decides which of these
 * answers it deserves.
 */
export const PERSON_TABLES_DELIBERATELY_UNMOVED: Readonly<Record<string, string>> = {
  // Each identity keeps its own roles. The source row survives soft-deleted
  // and still reads as a diver, which is what lets the pointer resolve.
  person_roles: "a role belongs to the identity, not to its history",
  // Minted seconds before an OAuth callback consumes it, and staff-only.
  integration_oauth_states: "ephemeral staff OAuth state, consumed within minutes",
  // Names an already-anonymized person as provenance for an erasure that is
  // still owed. `mergeDiverRecords` refuses an anonymized person outright, so
  // no row here can ever belong to either side of a merge.
  processor_erasure_obligations: "provenance for an erasure, and anonymized rows never merge",
};

function quotedTable(tableName: string) {
  // The only callers pass the two static lists above; quoting here keeps the
  // raw SQL identifier separate from all user-controlled values.
  return `"${tableName}"`;
}

async function hasPersonRow(
  db: DbExecutor,
  tableName: string,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const result = await db.execute(
    sql`select 1 from ${sql.raw(quotedTable(tableName))} where "shop_id" = ${shopId} and "person_id" = ${personId} limit 1`,
  );
  return result.rows.length > 0;
}

async function hasPersonOnlyRow(db: DbExecutor, tableName: string, personId: string) {
  const result = await db.execute(
    sql`select 1 from ${sql.raw(quotedTable(tableName))} where "person_id" = ${personId} limit 1`,
  );
  return result.rows.length > 0;
}

function mergeReasons(
  source: { fullName: string; phone: string | null },
  candidate: { fullName: string; phone: string | null },
): DiverMergeCandidateReason[] {
  const reasons: DiverMergeCandidateReason[] = [];
  const sourcePhone = phoneDigits(source.phone ?? "");
  const candidatePhone = phoneDigits(candidate.phone ?? "");
  if (sourcePhone.length >= MIN_PHONE_SEARCH_DIGITS && sourcePhone === candidatePhone) {
    reasons.push("same_phone");
  }
  const sourceName = normalizePersonName(source.fullName);
  if (sourceName && sourceName === normalizePersonName(candidate.fullName)) {
    reasons.push("same_name");
  }
  return reasons;
}

/**
 * Find active diver records that deserve an owner/manager's deliberate
 * survivor choice. Matching is intentionally narrow: exact normalized phone
 * digits or exact normalized name. It never crosses a shop and never includes
 * removed, erased, or already-merged rows.
 */
export async function listDiverMergeCandidates(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<DiverMergeCandidate[]> {
  const [source] = await db
    .select({ person: people })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!source) return [];

  const candidates = await db
    .select({ person: people })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        ne(people.id, personId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id));

  return candidates.flatMap(({ person }) => {
    const reasons = mergeReasons(source.person, person);
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
}

/**
 * Mark the active roster rows that have an exact normalized phone or name
 * collision. The roster only needs the ids: the record page does the
 * survivor-choice query with the reasons and contact details. Keeping this
 * scan separate also lets the list show the problem without making every row
 * render a second query.
 */
export async function listDiverMergeDuplicateIds(db: AppDb, shopId: string): Promise<string[]> {
  const rows = await db
    .select({ id: people.id, fullName: people.fullName, phone: people.phone })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id));

  const phones = new Map<string, string[]>();
  const names = new Map<string, string[]>();
  for (const person of rows) {
    const phone = phoneDigits(person.phone ?? "");
    if (phone.length >= MIN_PHONE_SEARCH_DIGITS) {
      phones.set(phone, [...(phones.get(phone) ?? []), person.id]);
    }
    const name = normalizePersonName(person.fullName);
    if (name) names.set(name, [...(names.get(name) ?? []), person.id]);
  }

  const duplicateIds = new Set<string>();
  for (const group of [...phones.values(), ...names.values()]) {
    if (group.length > 1) {
      for (const personId of group) duplicateIds.add(personId);
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

function oldestDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

/**
 * Move a diver's owned history and leave a pointer on the old row. The
 * transaction locks both identities in stable id order, refuses the two
 * safety-sensitive states up front, and lets database unique constraints turn
 * every other collision into one atomic refusal. Activity events are absent
 * from this list on purpose: their actor/subject ids are an audit trail and
 * must continue to name the original person (issue #730).
 */
export async function mergeDiverRecords(input: {
  db: DbExecutor;
  shopId: string;
  personId: string;
  survivorId: string;
  actorPersonId: string;
}): Promise<DiverMergeResult> {
  try {
    return await input.db.transaction(async (tx): Promise<DiverMergeResult> => {
      if (!(await canPersonMergeDiver(tx, input.shopId, input.actorPersonId))) {
        return { ok: false, reason: "not_authorized" };
      }
      if (input.personId === input.survivorId) {
        return { ok: false, reason: "not_found" };
      }

      const ids = [input.personId, input.survivorId];
      const lockedIds = [...ids].sort();
      const locked = await tx
        .select()
        .from(people)
        .where(inArray(people.id, lockedIds))
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
      if (source.anonymizedAt || survivor.anonymizedAt) {
        return { ok: false, reason: "anonymized" };
      }
      if (source.mergedIntoPersonId || survivor.mergedIntoPersonId) {
        return { ok: false, reason: "already_merged" };
      }
      if (source.deletedAt || survivor.deletedAt) {
        return { ok: false, reason: "already_removed" };
      }

      const roles = await tx
        .select({ personId: personRoles.personId, role: personRoles.role })
        .from(personRoles)
        .where(inArray(personRoles.personId, ids));
      const sourceRoles = roles.filter((row) => row.personId === source.id);
      const survivorRoles = roles.filter((row) => row.personId === survivor.id);
      if (
        !sourceRoles.some((row) => row.role === "diver") ||
        !survivorRoles.some((row) => row.role === "diver") ||
        roles.some((row) => row.role !== "diver")
      ) {
        return { ok: false, reason: "staff_record" };
      }

      // The unique `(trip_id, person_id)` booking key makes a shared trip a
      // safety decision, not a generic data collision. Refuse it explicitly
      // even when one of the two seats is cancelled: both records are still
      // evidence about the same departure and silently choosing one would
      // rewrite the booking history.
      const bookingRows = await tx
        .select({ personId: bookings.personId, tripId: bookings.tripId })
        .from(bookings)
        .where(and(eq(bookings.shopId, input.shopId), inArray(bookings.personId, ids)));
      const tripOwners = new Map<string, Set<string>>();
      for (const row of bookingRows) {
        const owners = tripOwners.get(row.tripId) ?? new Set<string>();
        owners.add(row.personId);
        tripOwners.set(row.tripId, owners);
      }
      if ([...tripOwners.values()].some((owners) => owners.size > 1)) {
        return { ok: false, reason: "booking_conflict" };
      }

      for (const tableName of STAFF_HISTORY_TABLES) {
        if (
          (await hasPersonRow(tx, tableName, input.shopId, source.id)) ||
          (await hasPersonRow(tx, tableName, input.shopId, survivor.id))
        ) {
          return { ok: false, reason: "staff_record" };
        }
      }
      for (const tableName of STAFF_PERSON_ONLY_TABLES) {
        if (await hasPersonOnlyRow(tx, tableName, source.id)) {
          return { ok: false, reason: "staff_record" };
        }
        if (await hasPersonOnlyRow(tx, tableName, survivor.id)) {
          return { ok: false, reason: "staff_record" };
        }
      }

      const mergedAt = nowDate();
      const mergedSpokenLanguages = [
        ...new Set([...survivor.spokenLanguages, ...source.spokenLanguages]),
      ];
      await tx
        .update(people)
        .set({
          deletedAt: mergedAt,
          mergedIntoPersonId: survivor.id,
          mergedAt,
          mergedByPersonId: input.actorPersonId,
        })
        .where(eq(people.id, source.id));

      await tx
        .update(people)
        .set({
          email: survivor.email ?? source.email,
          phone: survivor.phone ?? source.phone,
          emergencyContactName: survivor.emergencyContactName ?? source.emergencyContactName,
          emergencyContactPhone: survivor.emergencyContactPhone ?? source.emergencyContactPhone,
          dateOfBirth: survivor.dateOfBirth ?? source.dateOfBirth,
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
          courtesyEmailOptOutAt: oldestDate(
            survivor.courtesyEmailOptOutAt,
            source.courtesyEmailOptOutAt,
          ),
        })
        .where(eq(people.id, survivor.id));

      // Drop the source's singleton where the survivor already holds one, so
      // the repoint below has room. Sequential, never a fan-out: this is one
      // checked-out client (`scripts/check-db-concurrency.mjs`).
      for (const tableName of SINGLETON_PER_PERSON_TABLES) {
        if (await hasPersonRow(tx, tableName, input.shopId, survivor.id)) {
          await tx.execute(
            sql`delete from ${sql.raw(quotedTable(tableName))} where "shop_id" = ${input.shopId} and "person_id" = ${source.id}`,
          );
        }
      }

      for (const tableName of DIVER_HISTORY_TABLES) {
        await tx.execute(
          sql`update ${sql.raw(quotedTable(tableName))} set "person_id" = ${survivor.id} where "shop_id" = ${input.shopId} and "person_id" = ${source.id}`,
        );
      }

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
