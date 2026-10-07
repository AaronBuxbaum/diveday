import {
  type CalendarDate,
  calendarDateInTimezone,
  isCalendarDateExpired,
  isValidCalendarDate,
} from "./calendar-date";

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

/**
 * What a crew member contributes to the in-water supervision ratio.
 *
 * `certified_assistant` is the concept the ratio rules call an "assistant"
 * (`assistantBonusPerInstructor`, src/lib/course-ratios.ts): a Divemaster **or
 * an Assistant Instructor** in the water, worth extra students per instructor.
 * It had no name in `src/lib` at all before this.
 */
export type InWaterCrewRole = "instructor" | "certified_assistant" | "none";

/**
 * The two rungs a recorded rating can stop someone standing on: what
 * {@link lapsedRungs} hands back and {@link TripCrewAssignment.lapsedRungs}
 * carries.
 */
export type LapsedRung = Exclude<InWaterCrewRole, "none">;

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
  /**
   * The rungs this person's **recorded** ratings say they are off on the day
   * being counted ({@link lapsedRungs}), or undefined for "the credentials
   * were not read".
   *
   * Undefined is a deliberate answer, not a missing one. The supervision
   * claim — Today, the staffing week, the trip page — reads the credentials
   * and passes this. The money and roster paths — the booking gate's
   * `course_unstaffed` refusal and seat cap, the no-show seat hand-back, the
   * crew editor's "a course keeps an instructor" refusal — never do, because
   * H-59 closed new-sale and new-assignment refusal on a locally recorded date
   * and the 2026-09-16 ruling reopened only the ratio (issue #1853). One
   * function, two answers, and which one a caller gets is written at the call.
   */
  lapsedRungs?: readonly LapsedRung[];
};

/**
 * One recorded staff credential, as much of it as currency needs
 * (`staff_credentials.kind` / `renews_at`).
 */
export type RatingCredential = { kind: string; renewsAt: string | null };

/**
 * The credential kinds that evidence each rung. An instructor stands on an
 * instructor rating. A certified assistant stands on any dive-professional
 * rating — a Divemaster's, or the instructor-track one an Assistant Instructor
 * or an instructor working as an assistant holds — because a professional
 * whose renewal has lapsed is out of status at every rung they hold with that
 * agency, not only the top one.
 */
const RUNG_EVIDENCE: Record<LapsedRung, readonly string[]> = {
  instructor: ["instructor_rating"],
  certified_assistant: ["instructor_rating", "assistant_instructor_rating", "divemaster_rating"],
};

/**
 * **Which rungs a person's recorded ratings have lapsed off on `divesOn`**
 * (issue #1853, ruled 2026-09-16: "read the credential where the ratio is
 * computed").
 *
 * A rung is lapsed only when the shop has recorded at least one rating that
 * evidences it **and every one of them** renewed before `divesOn`:
 *
 * - **Nothing recorded is not a lapse.** Most shops record no credentials at
 *   all; reading silence as "not current" would empty every course of its
 *   instructor on the day this shipped.
 * - **No renewal date is not a lapse.** A rating with no date recorded has
 *   nothing to say about currency, so it counts as current — and so does a
 *   date that is not a real calendar date.
 * - **One current rating is enough.** An instructor holding two agencies'
 *   ratings, one lapsed, is still an instructor.
 * - **A renewal date is good through the end of its own day**
 *   (`isCalendarDateExpired`, the glossary's "Staff credential"): a rating
 *   that renews on the morning of the dive still counts for that dive.
 *
 * `divesOn` is the departure's **last** shop-local day
 * ({@link lastDayOfDeparture}), not today: the question is whether the rating
 * is current in the water, so a rating that lapses between the booking and
 * the dive is lapsed for it, and one that lapses on day two of a three-day
 * course is lapsed for the course.
 *
 * Review status is not read. "Pending" means nobody has checked the card yet,
 * which says nothing about whether it renewed.
 */
export function lapsedRungs(
  credentials: readonly RatingCredential[],
  divesOn: CalendarDate,
): LapsedRung[] {
  const lapsed: LapsedRung[] = [];
  for (const rung of ["instructor", "certified_assistant"] as const) {
    const evidence = credentials.filter((credential) =>
      RUNG_EVIDENCE[rung].includes(credential.kind),
    );
    const allLapsed =
      evidence.length > 0 &&
      evidence.every(
        ({ renewsAt }) =>
          renewsAt !== null &&
          isValidCalendarDate(renewsAt) &&
          isCalendarDateExpired(renewsAt, divesOn),
      );
    if (allLapsed) lapsed.push(rung);
  }
  return lapsed;
}

/**
 * The shop-local calendar day a departure is last in the water on — the day
 * {@link lapsedRungs} asks about. A millisecond is taken off the end so a
 * departure ending exactly at local midnight belongs to the day it ran on.
 */
export function lastDayOfDeparture(endsAt: Date, timeZone: string): CalendarDate {
  return calendarDateInTimezone(new Date(endsAt.getTime() - 1), timeZone);
}

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
  // A rung whose every recorded rating has lapsed is a rung not held, and the
  // rest of this function never learns otherwise — so a lapse narrows exactly
  // the way a missing role does, and property 2 covers it for free: nothing
  // here can make a lapsed rating worth *more*.
  const lapsed = member.lapsedRungs ?? [];
  const holdsInstructor = member.shopRoles.includes("instructor") && !lapsed.includes("instructor");
  /**
   * **The two rungs that are worth an assistant and not an instructor.**
   *
   * `assistant_instructor` was added because a shop with an AI on staff had
   * nowhere to file them but `instructor`, and this function then returned a
   * full `"instructor"` — a full student allowance under the Open Water cap,
   * and enough on its own to clear a course's "unstaffed" gap. Under PADI an AI
   * counts as a certified assistant for training-dive ratios and is not the
   * rated professional of record for the **open-water** dive of a Discover
   * Scuba experience — which is the only kind of session DiveDay models, since
   * a trip is one dated open-water outing. So the DSD cap (which grants an
   * assistant nothing) is where the difference bites hardest, and it is exactly
   * the distinction the product was getting wrong (issue #1680).
   *
   * Scoped to the open-water dive on purpose: PADI grants an AI real
   * prerogatives around intro-level activity in confined water and on land, and
   * a comment overstating a standard is how the next reader stops trusting the
   * rest of them.
   *
   * Mapping the rung here rather than teaching the arithmetic a third rank is
   * the whole of the fix: `countInWaterCrew` and every ratio gate above it are
   * unchanged, because an AI *is* the thing those rules already call an
   * assistant.
   */
  //
  // `instructor` is in the list for the lapse alone: without one, it changes
  // nothing, because every branch below asks `holdsInstructor` first. With an
  // instructor rating lapsed and a Divemaster rating still current, it is what
  // lets the current card count for what it is.
  const holdsCertifiedAssistant =
    (member.shopRoles.includes("divemaster") ||
      member.shopRoles.includes("assistant_instructor") ||
      member.shopRoles.includes("instructor")) &&
    !lapsed.includes("certified_assistant");
  // No per-trip role: exactly the shop-wide inference, unchanged.
  if (!member.tripRole) {
    if (holdsInstructor) return "instructor";
    return holdsCertifiedAssistant ? "certified_assistant" : "none";
  }
  // Rostered off the ratio entirely. The captain is driving the boat and the
  // deckhand is handling lines; neither is supervising students in the water,
  // whatever they are qualified to do on another day. This is the case that
  // was silently inflating capacity.
  if (member.tripRole === "captain" || member.tripRole === "crew") return "none";
  if (member.tripRole === "instructor") {
    if (holdsInstructor) return "instructor";
    // Rostered as the instructor without holding the qualification: fall back
    // to what they *are* qualified for rather than honouring the roster. An
    // Assistant Instructor rostered in the instructor slot lands here, which is
    // property 2 doing its job — the roster cannot promote them.
    return holdsCertifiedAssistant ? "certified_assistant" : "none";
  }
  // `divemaster`: an assistant, and an instructor working as one is one.
  return holdsInstructor || holdsCertifiedAssistant ? "certified_assistant" : "none";
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
  /**
   * Certified assistants in the water — Divemasters and Assistant Instructors
   * alike. Each buys `assistantBonusPerInstructor` students.
   */
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
 * Whether a recorded lapse is what took this person down a rung — the count
 * with their credentials read differs from the roster's claim. The surfaces
 * that inherit the narrowed count name these people, so a gap that a lapse
 * opened is explained rather than shown as one more shortfall.
 */
export function narrowedByLapse(member: TripCrewAssignment): boolean {
  return rungLostToLapse(member) !== null;
}

/**
 * The rung a recorded lapse took this person off — what the roster says they
 * are worth, when the count with their credentials read is less — or null.
 *
 * Which rung matters to the sentence a surface may say: only somebody who lost
 * the **instructor** rung can be why a session reads "no instructor". A
 * divemaster's lapse beside a session nobody rostered an instructor on is a
 * different fact, and saying it in place of "No instructor assigned" hid the
 * real gap (dive-domain review of issue #1853).
 */
export function rungLostToLapse(member: TripCrewAssignment): LapsedRung | null {
  if (!member.lapsedRungs || member.lapsedRungs.length === 0) return null;
  const roster = inWaterCrewRole({ ...member, lapsedRungs: undefined });
  if (roster === "none" || inWaterCrewRole(member) === roster) return null;
  return roster;
}

/**
 * The same count twice: the supervision claim (credentials read) and the
 * roster's claim (none read). A surface flags a gap as a lapse's only when the
 * two claims disagree about that gap, never merely because somebody aboard has
 * a lapsed card.
 */
export function countBothClaims(members: readonly TripCrewAssignment[]): {
  supervision: InWaterCrewCount;
  roster: InWaterCrewCount;
} {
  return {
    supervision: countInWaterCrew(members),
    roster: countInWaterCrew(members.map((member) => ({ ...member, lapsedRungs: undefined }))),
  };
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

/**
 * The standing roles that are a professional rating — a dive teaching or
 * leadership rung, or a vessel licence — most senior first. Owner, manager and
 * crew are offices or a general hand, not a rating anybody reading an incident
 * document is asking about.
 */
export const PROFESSIONAL_RATINGS = [
  "instructor",
  "assistant_instructor",
  "divemaster",
  "captain",
] as const;

/**
 * **The rating beside the job, on the documents read after something went
 * wrong** (issue #1852).
 *
 * `effectiveCrewRoles` answers "who is doing what today" and is right for the
 * boat. The departure log and the incident export are also asked "what rating
 * did each professional hold", and the narrowed job cannot answer it: an
 * Assistant Instructor rostered as the day's divemaster read "Divemaster", and
 * the only way to keep the rating on the sheet was to leave the job unset,
 * which also turns off narrowing.
 *
 * Only what the job does not already say: a divemaster rostered as divemaster
 * carries nothing beside it, and a job left unset already prints the standing
 * roles, so it carries nothing either. Somebody whose roles were stripped after
 * they sailed carries nothing at all, never an empty bracket. A rating is never
 * added to `trip_assignment_role`: a rating in a list of jobs has nothing to
 * narrow (the glossary's "Per-trip crew role").
 */
export function standingRatingsBesideJob(member: TripCrewAssignment): string[] {
  if (!member.tripRole) return [];
  const job = member.tripRole;
  return PROFESSIONAL_RATINGS.filter(
    (rating) => rating !== job && member.shopRoles.includes(rating),
  );
}
