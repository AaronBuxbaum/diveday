import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { courseRatioRefusal } from "@/lib/booking-gates";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import type { DateRequestOutcome } from "@/lib/date-requests";
import type { DiveDeclaration } from "@/lib/dive-declaration";
import { rowCanBeReactivated } from "@/lib/no-show";
import { seatRefusal } from "@/lib/participant-types";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { courseStudentSeatCap } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { findOrCreatePerson } from "./people";
import { bookings, type Lead, leads, people, personRoles, trips } from "./schema";
import { recordSelfDeclaredCards } from "./self-declared-cards";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";

/**
 * **Who wants in**, the writers and the departure reads (ADR
 * 20261017-one-lead-with-a-scope). A lead reserves nothing: `bookings.ts` never
 * reads or writes this table, "booked" is derived at read time for a departure
 * lead, and only staff seating someone *from* a lead stamps `closed_as`, after
 * the seat commits.
 */

export type DepartureAsk = {
  shopId: string;
  tripId: string;
  fullName: string;
  email: string;
  phone?: string;
  /**
   * What the joiner optionally said they can dive, recorded on the **person**
   * as a self-declared pending card (`recordSelfDeclaredCards`). It is shown to
   * the staffer working this list and never gates the join — a wait list is a
   * set of leads, and refusing one on an unverified claim would be a gate built
   * out of somebody's typing (ADR 20260813-wait-list-is-a-lead-list).
   */
  declaration?: DiveDeclaration;
  /**
   * How many seats the joiner waits for, themselves included (fourth review,
   * item 34). One when absent; held to the public form's own bounds.
   */
  partySize?: number;
};

export type DepartureAskOutcome =
  | { ok: true; leadId: string; personName: string }
  | {
      ok: false;
      reason: "trip_unavailable" | "trip_available" | "already_booked" | "already_waitlisted";
      leadId?: string;
      personName?: string;
    };

/**
 * Adds a diver to a full trip's wait list: a `departure` lead the diver asked
 * for. A lead is not a booking, must never reserve a manifest seat, and does
 * not entitle the diver to the next seat that frees: `askedAt` records when they
 * asked, and staff offer whoever fits the departure (ADR
 * 20260813-wait-list-is-a-lead-list). The copy the diver reads on joining says
 * exactly that.
 *
 * **The booking transaction does not learn about this table** (ADR
 * 20261017-one-lead-with-a-scope, R1): the trip-row lock below and the counts
 * it reads are the booking door's own, so "join the wait list" and "book" cannot
 * disagree about one boat.
 */
export async function askForDeparture(db: AppDb, req: DepartureAsk): Promise<DepartureAskOutcome> {
  const email = req.email.trim().toLowerCase();
  const fullName = req.fullName.trim();
  const askedParty = Math.min(
    MAX_PUBLIC_PARTY_SIZE,
    Math.max(1, Math.trunc(req.partySize ?? 1) || 1),
  );

  return db.transaction(async (tx): Promise<DepartureAskOutcome> => {
    // Same trip-row lock as createBooking: the full/not-full decision must be
    // serialized against concurrent bookings, or a waitlist join can race a
    // booking into the wrong outcome.
    const [trip] = await tx
      .select()
      .from(trips)
      // A rehearsal has no wait list (ADR 20261012-rehearsal-departures).
      .where(
        and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId), liveTrip(), notRehearsal()),
      )
      .limit(1)
      .for("update");
    if (trip?.status !== "scheduled" || trip.startsAt <= nowDate()) {
      return { ok: false, reason: "trip_unavailable" };
    }
    // The form offers "up to the boat's seats"; the server keeps that promise,
    // so a hand-posted party cannot claim more demand than the boat holds.
    const partySize = Math.max(1, Math.min(askedParty, trip.capacity));

    // `heldSeatCounts`, the same counts `createBookingRecord` reads — this
    // decision has to be the one the booking door would make, or the two
    // disagree about the same boat. A seat a staffer released at the counter
    // is free, so the honest answer to "can I join the wait list?" is
    // `trip_available`: go and book it (issue #1209).
    //
    // A wait list is for a diver's seat, so "available" means a diver could
    // book one: a boat with room aboard but every diver's seat taken is still
    // full for this person (ADR 20261007-participant-types).
    // Measured against the certificate-capped seats, as the booking door is
    // (H-107): an over-limit departure is full at its certificate.
    //
    // A party waits until the whole party fits (ADR 20260719-trip-waitlist,
    // amended): its last diver must fit beside the others, so the counts are
    // read as if the rest were already aboard.
    const capacity = await sellableCapacity(tx, trip);
    const held = await heldSeatCounts(tx, req.shopId, trip.id);
    const withParty = { aboard: held.aboard + partySize - 1, divers: held.divers + partySize - 1 };
    // A course session also seats its students at the crew's ratio, as the
    // sale and the roll measure it (issue #2679): full at the ratio is full.
    const ratioCap = await courseStudentSeatCap(tx, trip);
    if (
      seatRefusal("diver", { ...trip, capacity }, withParty) === null &&
      courseRatioRefusal(withParty.divers, ratioCap) === null
    ) {
      return { ok: false, reason: "trip_available" };
    }

    const { person, nameMatches } = await findOrCreatePerson(tx, {
      shopId: req.shopId,
      fullName,
      email,
      phone: req.phone,
    });

    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tripId, trip.id),
          eq(bookings.personId, person.id),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (booking) return { ok: false, reason: "already_booked" };

    // After the refusals, before the entry: a diver who is told "you already
    // have a seat" is not joining a list, and a declaration recorded off a
    // submission the product turned away would be data collected from a
    // conversation that did not happen. A repeat joiner (`already_waitlisted`
    // below) *does* land here, which is right — re-submitting is how they
    // update what they said.
    //
    // Gated on `nameMatches` for the same reason the last-minute list is: this
    // form is unauthenticated, and an email that matches an existing diver
    // under a different name may be a second human (H-13). Certification data
    // is a fact about a body, and writing it onto a record that might not be
    // theirs is the one thing every other write on this fork already refuses.
    // The wait-list entry itself is unaffected.
    if (nameMatches) {
      await recordSelfDeclaredCards(tx, {
        shopId: req.shopId,
        personId: person.id,
        level: req.declaration?.level,
        agency: req.declaration?.agency,
        identifier: req.declaration?.identifier,
        noCertification: req.declaration?.noCertification,
        nitrox: req.declaration?.nitrox,
      });
    }

    // One row per person per departure: a diver the shop already invited cold
    // is on the list now, and the row is theirs (they asked).
    const [existing] = await tx
      .select()
      .from(leads)
      .where(
        and(eq(leads.scope, "departure"), eq(leads.tripId, trip.id), eq(leads.personId, person.id)),
      )
      .limit(1);
    if (existing) {
      // Asking again is how a joiner updates what they said, the party too.
      if (existing.partySize !== partySize || existing.askedBy !== "diver") {
        await tx
          .update(leads)
          .set({ partySize, askedBy: "diver" })
          .where(and(eq(leads.id, existing.id), eq(leads.shopId, req.shopId)));
      }
      return {
        ok: false,
        reason: "already_waitlisted",
        leadId: existing.id,
        personName: person.fullName,
      };
    }

    const [lead] = await tx
      .insert(leads)
      .values({
        shopId: req.shopId,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize,
      })
      .returning();
    if (!lead) throw new Error("askForDeparture: lead insert returned no row");
    return { ok: true, leadId: lead.id, personName: person.fullName };
  });
}

/** The people columns a lead row renders: a name and the address an offer goes to. */
const leadPerson = { id: people.id, fullName: people.fullName, email: people.email };

/**
 * Every departure lead on one trip, in the order people asked. Leads stay
 * outside the roster because they have not booked a seat. Carries its own
 * `shop_id`, so none of these can be called safely with only a trip UUID for
 * the wrong shop. `person` is null for a row that lives on a snapshot.
 */
export async function listDepartureLeads(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ lead: leads, person: leadPerson })
    .from(leads)
    .leftJoin(people, and(eq(people.id, leads.personId), eq(people.shopId, shopId)))
    .where(and(eq(leads.scope, "departure"), eq(leads.shopId, shopId), eq(leads.tripId, tripId)))
    .orderBy(asc(leads.askedAt), asc(people.fullName), asc(leads.id));
}

export type DepartureLeadRow = Awaited<ReturnType<typeof listDepartureLeads>>[number];

/**
 * Confirmation pages render only a real lead, never an identity in the URL:
 * scoped to the shop, the trip and the departure scope.
 */
export async function getDepartureLeadForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  leadId: string,
) {
  const [row] = await db
    .select({ lead: leads, person: people })
    .from(leads)
    .leftJoin(people, and(eq(people.id, leads.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(leads.id, leadId),
        eq(leads.scope, "departure"),
        eq(leads.tripId, tripId),
        eq(leads.shopId, shopId),
      ),
    )
    .limit(1);
  return row ?? null;
}

type StaffDepartureLead = {
  shopId: string;
  tripId: string;
  personId: string;
  createdByPersonId: string;
  partySize?: number;
};

/**
 * **A shop-asked departure lead for an existing diver** (the Invite button, the
 * counter's offer, the suggestions list): outreach that changes no booking
 * state. One row per person per departure, so a diver who is already waiting
 * keeps the row they have and the call answers with it. Null when the trip, the
 * author or the diver is not this shop's live record, or the diver holds a seat
 * that cannot be reactivated.
 */
export async function ensureDepartureLead(
  tx: DbExecutor,
  input: StaffDepartureLead,
): Promise<{ leadId: string; created: boolean } | null> {
  const [trip] = await tx
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (!trip) return null;

  const [author] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId), livePerson()),
    )
    .limit(1);
  if (!author) return null;

  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        eq(personRoles.role, "diver"),
        // Removed, erased or merged people get no lead row (security review N4):
        // `people_anonymized_stays_removed` and `people_merged_stays_removed`
        // make the last two removed as well.
        livePerson(),
      ),
    )
    .limit(1);
  if (!person) return null;

  const [booking] = await tx
    .select({ status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        eq(bookings.personId, input.personId),
      ),
    )
    .limit(1);
  if (booking && !rowCanBeReactivated(booking.status, trip.startsAt)) return null;

  const [inserted] = await tx
    .insert(leads)
    .values({
      shopId: input.shopId,
      scope: "departure",
      askedBy: "shop",
      tripId: input.tripId,
      personId: input.personId,
      createdByPersonId: input.createdByPersonId,
      partySize: input.partySize ?? 1,
    })
    .onConflictDoNothing()
    .returning({ id: leads.id });
  if (inserted) return { leadId: inserted.id, created: true };

  const [standing] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.scope, "departure"),
        eq(leads.shopId, input.shopId),
        eq(leads.tripId, input.tripId),
        eq(leads.personId, input.personId),
      ),
    )
    .limit(1);
  return standing ? { leadId: standing.id, created: false } : null;
}

/** Normalizes an optional free-text field to trimmed text or null, never an empty string. */
function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The shop's live diver holding exactly this address, or null.
 *
 * Exact and case-insensitive, never fuzzy, and never on the phone number: a
 * household number is genuinely shared, and a link written from one would point
 * a future erasure at a partner's or a child's lead. `people_shop_email_unique`
 * is a partial unique index on `lower(email)` over this shop's live rows, so
 * there is at most one candidate and no "first match wins" ordering to reason
 * about. Deleted and erased records are excluded on purpose: a soft-deleted
 * duplicate sits outside the unique index, which is exactly where a second row
 * holding the same address could hide, and linking to it would send a later
 * erasure at the wrong record.
 */
async function livePersonIdForEmail(
  db: DbExecutor,
  shopId: string,
  email: string,
): Promise<string | null> {
  const [match] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        sql`lower(${people.email}) = ${email}`,
      ),
    )
    .limit(1);
  return match?.id ?? null;
}

export type DateAsk = {
  shopId: string;
  /** Null for an ordinary dive request, which names `interest` instead. */
  courseId?: string | null;
  /** What a dive request is about; required when there is no course. */
  interest?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  experienceLevel?: CourseInquiryExperience | null;
  timing?: string | null;
  preferredDate?: CalendarDate | null;
  alternateDate?: CalendarDate | null;
  dateFlexible?: boolean;
  /** The asker and whoever dives with them; clamped to the column's 1 to 20. */
  partySize?: number | null;
  message?: string | null;
  /** The staffer who wrote down a phone call; absent for the diver's own form. */
  createdByPersonId?: string | null;
};

/**
 * Records one diver asking for a date: a `date` lead. Insert-only, there is no
 * edit or withdraw path (a diver just asks again).
 *
 * **No person row is made** (H-13): this form is unauthenticated, and creating
 * a person from a stranger's typing is how a second human's record gets
 * written. The contact is a snapshot on the lead. When the writer left an email
 * that a live diver of this shop already holds, the `person_id` link is
 * snapshotted onto the row. That is not a convenience: it is the only handle
 * diver erasure has once the diver changes their address (`scrubLeads`, ADR
 * 20260802-diver-data-erasure). A lead with no email, or an address nobody here
 * holds, is stored unlinked, the honest answer.
 *
 * `courseId` and `shopId` are derived server-side from the URL's slugs, never
 * accepted from the caller.
 */
export async function askForDate(
  db: DbExecutor,
  input: DateAsk,
): Promise<{ id: string; askedAt: Date }> {
  const email = normalizeOptional(input.email)?.toLowerCase() ?? null;
  const courseId = input.courseId ?? null;
  const interest = normalizeOptional(input.interest);
  // A request must be about something. The check constraint says the same, and
  // the server action refuses it in the diver's own words before reaching here;
  // this is the layer that must not depend on either having run.
  if (!courseId && !interest) {
    throw new Error("askForDate: a request names either a course or an interest");
  }
  const personId = email ? await livePersonIdForEmail(db, input.shopId, email) : null;
  const partySize =
    input.partySize == null ? null : Math.min(20, Math.max(1, Math.trunc(input.partySize) || 1));
  const [inserted] = await db
    .insert(leads)
    .values({
      shopId: input.shopId,
      scope: "date",
      askedBy: "diver",
      courseId,
      interest,
      personId,
      name: normalizeOptional(input.name),
      email,
      phone: normalizeOptional(input.phone),
      experienceLevel: input.experienceLevel ?? null,
      timing: normalizeOptional(input.timing),
      preferredDate: input.preferredDate ?? null,
      alternateDate: input.alternateDate ?? null,
      dateFlexible: input.dateFlexible ?? false,
      partySize,
      message: normalizeOptional(input.message),
      createdByPersonId: input.createdByPersonId ?? null,
    })
    .returning({ id: leads.id, askedAt: leads.askedAt });
  if (!inserted) throw new Error("askForDate: insert returned no row");
  return inserted;
}

/**
 * **Close a date lead, or open it again** (third UX review, item 13). `booked`
 * is the seat a staffer made from the request; `done` is the staffer's tick;
 * `null` is Reopen. Scoped by shop and scope, so an id from a form reaches
 * nothing outside this shop's date leads. A `booked` stamp never overwrites an
 * earlier close: the first answer is the one the page shows. Returns whether a
 * row changed.
 *
 * **Closing a date lead never closes its departure children**: a diver offered
 * Saturday keeps that offer standing.
 */
export async function setDateLeadOutcome(
  db: DbExecutor,
  input: { shopId: string; leadId: string; outcome: DateRequestOutcome | null; now: Date },
): Promise<boolean> {
  const scope = and(
    eq(leads.id, input.leadId),
    eq(leads.shopId, input.shopId),
    eq(leads.scope, "date"),
  );
  const rows = await db
    .update(leads)
    .set(
      input.outcome
        ? { closedAt: input.now, closedAs: input.outcome }
        : { closedAt: null, closedAs: null },
    )
    .where(input.outcome === "booked" ? and(scope, isNull(leads.closedAt)) : scope)
    .returning({ id: leads.id });
  return rows.length > 0;
}

/**
 * **Attach date leads to a new departure** (the schedule builder's hand-off):
 * one departure child row per lead, `parent_lead_id` pointing back,
 * `asked_by = 'diver'` and `offered_at` null, so the departure's own panel shows
 * them and staff offer the seat from there. Nothing is sent and nothing is
 * reserved. The lead is only a contact source, so the child copies its
 * snapshot (or its person link, when the lead matched a diver), its party and
 * its original `askedAt`.
 *
 * Idempotent: a unique `(trip, parent)` index makes a retried submit harmless,
 * and a diver already on this departure's list (`(trip, person)`) keeps the row
 * they have. A rehearsal answers nobody's request, so it gets none. Returns how
 * many rows were written.
 */
export async function attachDateLeadsToDeparture(
  db: AppDb,
  input: { shopId: string; tripId: string; leadIds: string[]; createdByPersonId: string },
): Promise<number> {
  const leadIds = [...new Set(input.leadIds)];
  if (leadIds.length === 0) return 0;

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
      )
      .limit(1);
    if (!trip) return 0;

    const [author] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(eq(people.id, input.createdByPersonId), eq(people.shopId, input.shopId), livePerson()),
      )
      .limit(1);
    if (!author) return 0;

    const parents = await tx
      .select()
      .from(leads)
      .where(
        and(eq(leads.shopId, input.shopId), eq(leads.scope, "date"), inArray(leads.id, leadIds)),
      );
    if (parents.length === 0) return 0;

    const inserted = await tx
      .insert(leads)
      .values(
        parents.map((parent) => ({
          shopId: input.shopId,
          scope: "departure" as const,
          askedBy: "diver" as const,
          tripId: input.tripId,
          parentLeadId: parent.id,
          personId: parent.personId,
          // The snapshot is only for a lead with no person: a linked one reads
          // its name and address from the person, and erasure deletes the row.
          name: parent.personId ? null : parent.name,
          email: parent.personId ? null : parent.email,
          phone: parent.personId ? null : parent.phone,
          partySize: Math.min(20, Math.max(1, parent.partySize ?? 1)),
          askedAt: parent.askedAt,
          createdByPersonId: input.createdByPersonId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: leads.id });
    return inserted.length;
  });
}

export type { Lead };
