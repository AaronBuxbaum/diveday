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

const DIVER_HISTORY_TABLES = [
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
  "prior_gear_assignments",
  "nitrox_certifications",
  "trip_reviews",
  "trip_blowout_divers",
] as const;

/** These rows identify a staff account or crew assignment, not a diver history. */
const STAFF_HISTORY_TABLES = [
  "staff_shifts",
  "account_sessions",
  "calendar_feeds",
  "roll_call_crew_events",
  "push_subscriptions",
] as const;
const STAFF_PERSON_ONLY_TABLES = ["trip_assignments", "user_accounts"] as const;

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

function newestDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
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
          noCertificationDeclaredAt: newestDate(
            survivor.noCertificationDeclaredAt,
            source.noCertificationDeclaredAt,
          ),
          noCertificationClearedAt: newestDate(
            survivor.noCertificationClearedAt,
            source.noCertificationClearedAt,
          ),
          noCertificationClearedByPersonId:
            survivor.noCertificationClearedByPersonId ?? source.noCertificationClearedByPersonId,
          courtesyEmailOptOutAt: oldestDate(
            survivor.courtesyEmailOptOutAt,
            source.courtesyEmailOptOutAt,
          ),
        })
        .where(eq(people.id, survivor.id));

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
