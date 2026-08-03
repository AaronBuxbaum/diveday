/**
 * Who counts as what on **one trip's** crew list.
 *
 * Roles in DiveDay are shop-wide (`person_roles`): "Ana is a divemaster" is a
 * standing fact about Ana, not a statement about the boat she is on today. The
 * in-water supervision ratio needs the other thing — what a person is doing on
 * *this* sailing — and until `trip_assignments.trip_role` existed there was no
 * way to say it. So a divemaster rostered as this trip's boat captain still
 * counted as an in-water certified assistant and raised the ratio capacity by
 * two per head, and a shop-wide instructor rostered as deck crew counted as an
 * instructor, worth eight and enough on its own to clear a course's
 * "unstaffed" gap (DOM-M3, review 20260803).
 *
 * That rule — instructor = holds `instructor`; certified assistant = holds
 * `divemaster` and not `instructor`; `captain`/`crew` count as neither — was
 * written out five times in three idioms (two SQL, three in-memory) and named
 * nowhere. This module is the one definition; every counting site routes
 * through {@link countInWaterCrew}. It is a safety number, so it gets one home.
 */

/**
 * The jobs a person can be rostered to do on one trip. A deliberate subset of
 * `person_role`: `owner`, `manager`, and `diver` are standing facts about a
 * person in the shop, never a job on a boat.
 *
 * Keep aligned with the `trip_assignment_role` pg enum in src/db/schema.ts.
 */
export const TRIP_CREW_ROLES = ["instructor", "divemaster", "captain", "crew"] as const;

export type TripCrewRole = (typeof TRIP_CREW_ROLES)[number];

export function isTripCrewRole(value: string): value is TripCrewRole {
  return (TRIP_CREW_ROLES as readonly string[]).includes(value);
}

/**
 * What a crew member contributes to the in-water supervision ratio.
 *
 * `certified_assistant` is the concept the ratio rules call an "assistant"
 * (`assistantBonusPerInstructor`, src/lib/course-ratios.ts): a Divemaster in
 * the water, worth extra students per instructor. It had no name in `src/lib`
 * at all before this.
 */
export type InWaterCrewRole = "instructor" | "certified_assistant" | "none";

export type TripCrewAssignment = {
  /**
   * What this person is rostered to do on **this** trip, or null/undefined for
   * "not specified".
   *
   * Unspecified is the **status quo, not a safety claim**: every row written
   * before the column existed has no role, and must keep counting exactly as
   * it did — by shop-wide inference. It says nothing about whether the person
   * is in the water; it says nobody has told us yet.
   */
  tripRole?: TripCrewRole | null;
  /** The standing roles this person holds in the shop (`person_roles`). */
  shopRoles: readonly string[];
};

/**
 * The single rule. Two properties hold, and both are load-bearing:
 *
 * 1. **An unspecified per-trip role changes nothing.** It falls through to the
 *    shop-wide inference every call site used before this column existed, so
 *    the migration is behaviour-preserving for every existing row.
 * 2. **A per-trip role never raises what a person is worth.** It can only
 *    narrow. The role says which job someone is doing; their shop-wide roles
 *    stay the evidence of what they are *qualified* to do, and the count takes
 *    the lesser of the two. Rostering an unqualified deckhand as "instructor"
 *    therefore buys a course session nothing — the roster is a scheduling
 *    document, and it must never be able to mint a credential.
 *
 * So: an instructor working this trip as its divemaster counts as a certified
 * assistant (a real and common downgrade); a divemaster rostered as captain
 * counts as neither; and a person with no in-water credential counts as
 * neither whatever the roster says.
 */
export function inWaterCrewRole(member: TripCrewAssignment): InWaterCrewRole {
  const holdsInstructor = member.shopRoles.includes("instructor");
  const holdsDivemaster = member.shopRoles.includes("divemaster");
  // No per-trip role: exactly the shop-wide inference, unchanged.
  if (!member.tripRole) {
    if (holdsInstructor) return "instructor";
    return holdsDivemaster ? "certified_assistant" : "none";
  }
  // Rostered off the ratio entirely. The captain is driving the boat and the
  // deckhand is handling lines; neither is supervising students in the water,
  // whatever they are qualified to do on another day. This is the case that
  // was silently inflating capacity.
  if (member.tripRole === "captain" || member.tripRole === "crew") return "none";
  if (member.tripRole === "instructor") {
    if (holdsInstructor) return "instructor";
    // Rostered as the instructor without holding the qualification: fall back
    // to what they *are* qualified for rather than honouring the roster.
    return holdsDivemaster ? "certified_assistant" : "none";
  }
  // `divemaster`: an assistant, and an instructor working as one is one.
  return holdsInstructor || holdsDivemaster ? "certified_assistant" : "none";
}

/**
 * Fold `(person, per-trip role, shop-wide role)` join rows — one row per role a
 * person holds — into one entry per person.
 *
 * The fan-out is the trap this closes: counting join rows instead of people
 * double-counts anyone holding two roles, and the per-trip role repeats on
 * every one of their rows. Pass the rows for **one trip**.
 */
export function groupCrewAssignments(
  rows: Iterable<{ personId: string; tripRole: TripCrewRole | null; role: string | null }>,
): (TripCrewAssignment & { personId: string; shopRoles: string[] })[] {
  const byPerson = new Map<
    string,
    TripCrewAssignment & { personId: string; shopRoles: string[] }
  >();
  for (const row of rows) {
    const entry = byPerson.get(row.personId) ?? {
      personId: row.personId,
      tripRole: row.tripRole,
      shopRoles: [],
    };
    if (row.role && !entry.shopRoles.includes(row.role)) entry.shopRoles.push(row.role);
    byPerson.set(row.personId, entry);
  }
  return [...byPerson.values()];
}

export type InWaterCrewCount = {
  instructorCount: number;
  /** Divemasters in the water — each buys `assistantBonusPerInstructor` students. */
  assistantCount: number;
};

/**
 * Count a trip's crew into the two numbers every ratio gate takes. One person
 * is counted once: a member who resolves to `instructor` is never also their
 * own assistant.
 *
 * Callers pass one entry per **person**, with that person's roles already
 * gathered — never one entry per `(person, role)` join row, which is how a
 * fan-out would double-count somebody who holds two roles.
 */
export function countInWaterCrew(members: Iterable<TripCrewAssignment>): InWaterCrewCount {
  let instructorCount = 0;
  let assistantCount = 0;
  for (const member of members) {
    const role = inWaterCrewRole(member);
    if (role === "instructor") instructorCount += 1;
    else if (role === "certified_assistant") assistantCount += 1;
  }
  return { instructorCount, assistantCount };
}

/**
 * What to *show* beside a crew member's name on a trip surface: the job they
 * are rostered to do here when there is one, otherwise their standing roles.
 *
 * A manifest is a document about one sailing, so "Captain" on the boat she is
 * driving beats "Divemaster, Instructor" — the standing list is true and
 * misleading at the same time on exactly the surface where a reader is asking
 * "who is doing what today".
 */
export function effectiveCrewRoles(member: TripCrewAssignment): string[] {
  return member.tripRole ? [member.tripRole] : [...member.shopRoles];
}
