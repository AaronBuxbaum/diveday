"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { findSimilarDivers } from "@/db/divers";
import { discardFormDraft } from "@/db/form-drafts";
import { busyOnLockWait } from "@/db/lock-bounds";
import {
  type SeatDiverPerson,
  type SeatDiverRefusal,
  type SeatPartyMember,
  seatDiver,
  seatParty,
} from "@/db/seat-diver";
import { getTripWithBooked } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { blankAsAbsent, formValue, parseForm, readForm, single } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { walkInDoorOpen } from "@/lib/operational-window";
import { PARTICIPANT_TYPES, type ParticipantType } from "@/lib/participant-types";
import { blankableDiverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { TripAdmissionRefusal } from "@/lib/trip-admission";
import { signTripAdmissionGate } from "@/lib/trip-admission-gate";
import { uuidParam } from "@/lib/uuid";
import { readWalkInParty, WALK_IN_FIRST_ROW, WALK_IN_NEW_PERSON } from "@/lib/walk-in-party";
import {
  SEAT_BUSY_NOTICE,
  SEAT_SURFACES,
  type SeatLanding,
  type SeatSurface,
  type SeatSurfaceId,
  seatSurfaceFor,
} from "./seat-diver-surfaces";

/**
 * The two staff seat-a-diver submissions — pick a returning diver, or type a
 * new one — as one implementation each, shared by both doors (from a
 * departure, from a diver).
 *
 * Shared rather than per-page because they were once the same code four
 * times over and had drifted apart in the copying (see `src/db/seat-diver.ts`).
 * `src/app/actions/` is exactly the home AGENTS.md reserves for an action used
 * across pages. What a door still chooses is its `SeatSurfaceId`, bound
 * server-side; everything that follows from it is table-driven
 * (`./seat-diver-surfaces.ts`).
 *
 * Both read `tripId` from the form, so a trip-first door (the roster, the
 * counter walk-in, the global Add booking) and a diver-first one (a diver's
 * record) submit the same shape. The counter is the `"walk-in"` door, bound
 * server-side and honoured only while the boat's walk-in door is open
 * (`holdsWalkInOpen`).
 */

const existingDiverSchema = z.object({
  tripId: single(z.uuid()),
  personId: single(z.uuid()),
  /**
   * Present only on the candidate forms of the "is this the same diver?"
   * prompt (issue #1556). A literal rather than a boolean because a form field
   * is a string and absence is the ordinary case: every other door submits
   * nothing here, and nothing must read as "this was a real pick".
   */
  fromNameMatch: single(z.literal("true").optional()),
  /**
   * What the staffer typed to raise that prompt. The prompt also fires on an
   * exact spelling, so the tap by itself says nothing about whether the
   * identity is in doubt — `createBooking` compares this against the matched
   * diver's name on file. Unbounded on purpose: it is compared and discarded,
   * never stored.
   */
  nameMatchQuery: single(z.string().optional()),
  /** What the seat is for (ADR 20261007-participant-types); absent is a diver's. */
  participantType: blankAsAbsent(z.enum(PARTICIPANT_TYPES)),
});

/**
 * The fields a refused seating lands back by, read raw: the staffer must get
 * back to the page they submitted from even when what they submitted was
 * unusable.
 */
const landingFields = z.object({
  tripId: formValue(),
  personId: formValue(),
  force: formValue(),
});

/**
 * Email optional here and required by refinement per surface, rather than two
 * schemas: `""` is what an untouched optional input actually submits, and the
 * required surfaces need that to read as "missing", not as an invalid address.
 */
const newDiverSchema = z.object({
  tripId: single(z.uuid()),
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: single(diverNameSchema),
  email: blankAsAbsent(blankableDiverEmailSchema),
  phone: blankAsAbsent(diverPhoneSchema),
  participantType: blankAsAbsent(z.enum(PARTICIPANT_TYPES)),
});

/** {@link landingFields}, which cannot refuse: every field is optional. */
function rawLanding(formData: FormData): z.infer<typeof landingFields> {
  const parsed = parseForm(landingFields, formData);
  return parsed.ok ? parsed.data : { tripId: null, personId: null, force: null };
}

/**
 * The door a server action is bound to: a surface, or the departure door in
 * its counter mode (`"walk-in"`). The mode rides the encrypted bound argument,
 * like the surface itself, never a form field a client could add; it is still
 * checked against the boat by {@link holdsWalkInOpen} before any seat is made.
 */
export type SeatDoorId = SeatSurfaceId | "walk-in";

function doorFor(doorId: SeatDoorId): { surface: SeatSurface; walkIn: boolean } {
  // The id arrives as an encrypted bound argument, so it cannot be forged from
  // the client — checked anyway, because a bad lookup here would build a
  // redirect path out of `undefined`.
  if (doorId === "walk-in") return { surface: SEAT_SURFACES.departure, walkIn: true };
  if (!Object.hasOwn(SEAT_SURFACES, doorId)) throw new Error("unknown seat surface");
  return { surface: SEAT_SURFACES[doorId], walkIn: false };
}

function surfaceFor(surfaceId: SeatSurfaceId): SeatSurface {
  return doorFor(surfaceId).surface;
}

/**
 * **A walk-in is only for a boat the counter can still seat.** The counter door is a claim like any other, so the
 * boat is read again here: scheduled, inside the counter's window and not yet
 * sailed (`walkInDoorOpen`). A boat that has gone, or one a week away, cannot
 * be walk-in seated by a typed URL or a stale page; the staffer is told the
 * trip cannot take divers and nothing is written.
 */
async function holdsWalkInOpen(landing: SeatLanding, shopId: string): Promise<boolean> {
  if (!landing.walkIn) return true;
  if (!uuidParam(landing.tripId)) return false;
  const trip = await getTripWithBooked(await getDb(), shopId, landing.tripId);
  return trip?.status === "scheduled" && walkInDoorOpen(trip.startsAt, nowDate());
}

/**
 * Land back on the door that submitted, saying why nothing happened.
 *
 * Revalidated even though a refused seating wrote nothing: a refusal means the
 * door was working from stale facts — `trip_full` is precisely "the seats you
 * were shown are gone" — so the page it lands back on must be re-read rather
 * than served from the cache that misled the staffer.
 *
 * A refusal must also land on a URL that differs from the current one by more
 * than an appended query param: a server-action redirect to the page it was
 * already on, with a second query param, left the client router on the page it
 * held and the submit button spinning. Every door's refusal lands on a route
 * with a path segment of its own (the boat, the diver) and a query-less URL.
 */
function refuse(
  surface: SeatSurface,
  landing: SeatLanding,
  notice: string,
  /**
   * The `trip_prerequisite` refusal's structured detail, flattened into the one
   * `gate=` param. Codes only, and only on a staff URL — the banner turns it
   * into the sentence that says *which* requirement failed and what the diver
   * holds, instead of the one static line that used to point every refusal at
   * the certifications form.
   *
   * **Signed, and bound to the landing route's own id**
   * (`signTripAdmissionGate`). Unsigned, the param was an instruction anyone
   * could write: a hand-made link rendered a specific, fabricated refusal, and
   * the specific ones are exactly what send a staffer to the certifications
   * form (security review finding).
   */
  gate?: TripAdmissionRefusal,
): never {
  const back = surface.refusedPath(landing);
  const scope = gate ? surface.gateScope(landing) : null;
  return revalidateAndRedirect(
    back,
    // `gate` drops out of the query entirely when there is no signature to
    // carry — `noticeUrl` omits an `undefined` extra rather than writing the
    // word, which is what the `? … : ""` concatenation here used to guard.
    noticeUrl(back, notice, {
      gate: gate && scope ? signTripAdmissionGate(gate, scope) : undefined,
    }),
  );
}

/**
 * The date request this seating answers, when the door was opened from one
 * (`bookings/new?request=`). A uuid or nothing; the writer scopes it to the
 * session's shop, so a forged id reaches no other tenant's interest.
 */
const answeredRequestForm = z.object({ request: formValue() });

function answeredRequestId(formData: FormData): string | null {
  const value = readForm(answeredRequestForm, formData).request;
  return typeof value === "string" && uuidParam(value) ? value : null;
}

/** Everything after "who and which trip" — identical for every door. */
async function seat(
  surface: SeatSurface,
  landing: SeatLanding,
  diver: SeatDiverPerson,
  actor: { shopId: string; personId: string },
  participantType?: ParticipantType,
  requestId?: string | null,
): Promise<void> {
  // A seat transaction waits five seconds for a held departure and then gives
  // up with `55P03` (`src/db/lock-bounds.ts`). That is a busy boat, not a
  // fault: the staffer reads "tap again" on the page they were on, rather than
  // a crash page with the diver still at the counter. Anything else still
  // throws. The redirect is outside the `try`, since `redirect` throws too.
  if (!(await holdsWalkInOpen(landing, actor.shopId))) {
    refuse(surface, landing, surface.refusalNotice.trip_unavailable);
  }
  const door = seatSurfaceFor(surface, landing);
  const db = await getDb();
  const outcome = await seatDiver(db, {
    shopId: actor.shopId,
    tripId: landing.tripId,
    actorPersonId: actor.personId,
    diver,
    entry: door.entry,
    refusals: door.refusals,
    participantType,
    dateRequestInterestId: requestId ?? undefined,
  }).catch(busyOnLockWait);
  if (outcome === "busy") refuse(surface, landing, SEAT_BUSY_NOTICE);
  const result = outcome;
  if (!result.ok) refuse(surface, landing, surface.refusalNotice[result.reason], result.refusal);
  // Keep the request context in front of the staffer until every requested
  // seat has been linked to this offered departure. The booking transaction
  // serializes the count and closes the parent on the final seat.
  if (requestId && result.dateRequestPartyComplete === false) {
    const requestPath = shopPath(landing.shopSlug, "bookings", "new", landing.tripId);
    return revalidateAndRedirect(
      requestPath,
      noticeUrl(requestPath, "party-seat-added", { request: requestId }),
    );
  }
  const settled: SeatLanding = { ...landing, personId: result.personId };
  const path = surface.seatedPath(settled);
  // The seat happened either way; what differs is whether the staffer can walk
  // away.
  //
  // A **held seat** first: `createBooking` attached this booking to an existing
  // person on something short of proof, so the boarding gate refuses it until
  // someone confirms the identity (H-20260724-one-person-per-email, issue #1556). "Added" hid that, and
  // the staffer met it on the next tap — `checkInBooking` refusing `not_ready`
  // with the diver at the counter and the confirm control on the trip roster
  // (`dive-domain-expert`, 2026-09-11).
  //
  // Then a waiver that was issued but never mailed — no address on file, no
  // provider, a bounced test recipient — which leaves work at the desk, so the
  // notice says so instead of letting "Added…" imply an email is on its way
  // while the diver's readiness waits for a signature nobody asked for. The
  // link itself stays off the URL and on the diver's row
  // (`seatedWaiverUndeliveredNotice`).
  //
  // Held outranks undelivered because a held seat withholds the matched
  // person's particulars, the waiver control among them (`RosterSection.tsx`'s
  // `showsPersonDetail`) — the link the waiver notice sends a staffer to fetch
  // is one of the things the confirm releases.
  //
  // Last, a seat whose confirmation went out says so (fourth
  // UX review, item 3): "Diver added. Their confirmation is on its way."
  const notice = result.identityUnconfirmed
    ? door.seatedIdentityUnconfirmedNotice
    : result.waiver === "not_delivered" || result.waiver === "failed"
      ? door.seatedWaiverUndeliveredNotice
      : result.confirmation === "sent"
        ? door.seatedConfirmationSentNotice
        : door.seatedNotice;
  revalidateAndRedirect(
    path,
    noticeUrl(path, notice, {
      bid: surface.carriesBookingId ? result.bookingId : undefined,
    }),
  );
}

/**
 * The counter's hold, asked on its own: a walk-in on a boat the counter can no
 * longer seat lands back on the boat with the "cannot take divers" notice and
 * nothing is looked up or written. The new-diver form asks it before its
 * name-match lookup, so a closed boat is refused before anyone is searched for.
 * Returns when the door is open.
 */
export async function refuseClosedWalkIn(shopSlug: string, formData: FormData) {
  const { surface } = doorFor("walk-in");
  const session = (await requireShopSurface(shopSlug)).session;
  const raw = rawLanding(formData);
  const landing: SeatLanding = {
    shopSlug,
    tripId: String(raw.tripId ?? ""),
    personId: "",
    walkIn: true,
  };
  if (!(await holdsWalkInOpen(landing, session.user.shopId))) {
    refuse(surface, landing, surface.refusalNotice.trip_unavailable);
  }
}

/**
 * Seat a diver already on file — the "enter once, reuse everywhere" path. No
 * name or email is re-typed: the existing person row carries their certs,
 * waivers, rental fit, and history straight onto the trip.
 */
export async function seatExistingDiverAction(
  doorId: SeatDoorId,
  shopSlug: string,
  formData: FormData,
) {
  const { surface, walkIn } = doorFor(doorId);
  const session = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(existingDiverSchema, formData);
  const raw = rawLanding(formData);
  const landing: SeatLanding = {
    shopSlug,
    tripId: parsed.ok ? parsed.data.tripId : String(raw.tripId ?? ""),
    personId: parsed.ok ? parsed.data.personId : String(raw.personId ?? ""),
    walkIn,
  };
  if (!parsed.ok) refuse(surface, landing, surface.invalidNotice);
  await seat(
    surface,
    landing,
    // A tap on the name prompt carries the name it was guessing from through to
    // the booking, which is what decides whether the seat may quietly inherit
    // this person's certifications and waiver (issue #1556). A missing query
    // stays an empty string rather than dropping the field: it reads as
    // disagreement there, and the blocker is the safe side of this.
    {
      personId: parsed.data.personId,
      fromNameMatch:
        parsed.data.fromNameMatch === "true"
          ? { typedName: parsed.data.nameMatchQuery ?? "" }
          : undefined,
    },
    { shopId: session.user.shopId, personId: session.user.personId },
    parsed.data.participantType,
    answeredRequestId(formData),
  );
}

/**
 * Seat a diver typed in by hand — a genuine first-timer, or someone tracked in
 * another system. Whether an email is required is the surface's call, and
 * walk-in mode waives it: the counter can add a diver on a name alone and collect the rest later.
 */
export async function seatNewDiverAction(doorId: SeatDoorId, shopSlug: string, formData: FormData) {
  const { surface, walkIn } = doorFor(doorId);
  const session = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(newDiverSchema, formData);
  const raw = rawLanding(formData);
  const email = parsed.ok ? parsed.data.email || undefined : undefined;
  const landing: SeatLanding = {
    shopSlug,
    tripId: parsed.ok ? parsed.data.tripId : String(raw.tripId ?? ""),
    personId: "",
    walkIn,
  };
  if (!parsed.ok || (surface.email === "required" && !landing.walkIn && !email)) {
    refuse(surface, landing, surface.invalidNotice);
  }
  if (!(await holdsWalkInOpen(landing, session.user.shopId))) {
    refuse(surface, landing, surface.refusalNotice.trip_unavailable);
  }

  const force = raw.force === "true";
  if (!force) {
    const db = await getDb();
    const matches = await findSimilarDivers(db, session.user.shopId, parsed.data.fullName);
    if (matches.length > 0) {
      const back = surface.refusedPath(landing);
      const search = new URLSearchParams();
      search.set("confirmName", parsed.data.fullName);
      if (parsed.data.email) search.set("confirmEmail", parsed.data.email);
      if (parsed.data.phone) search.set("confirmPhone", parsed.data.phone);

      const [path, query] = back.split("?");
      const existingParams = new URLSearchParams(query);
      for (const [k, v] of search.entries()) {
        existingParams.set(k, v);
      }
      revalidateAndRedirect(path, `${path}?${existingParams.toString()}#hand-entry`);
    }
  }

  await seat(
    surface,
    landing,
    { fullName: parsed.data.fullName, email, phone: parsed.data.phone },
    { shopId: session.user.shopId, personId: session.user.personId },
    parsed.data.participantType,
    answeredRequestId(formData),
  );
}

/**
 * The new-diver form's own code for each refusal, so a refused party lands
 * back on the form it was typed on (with its rows, `KeepTypedOnRefusal`)
 * rather than on the walk-in search, which would show none of them.
 */
const PARTY_REFUSAL_NOTICE: Record<SeatDiverRefusal, string> = {
  trip_full: "diver-full",
  divers_full: "diver-divers-full",
  participant_type_unavailable: "diver-type-unavailable",
  already_booked: "diver-already",
  course_unstaffed: "diver-course-unstaffed",
  course_prerequisite: "diver-course-prerequisite",
  course_ratio_full: "diver-course-ratio-full",
  course_min_age: "diver-course-min-age",
  trip_prerequisite: "diver-trip-prerequisite",
  trip_unavailable: "diver-unavailable",
  date_request_offer_unavailable: "diver-date-request-unavailable",
  date_request_departure_conflict: "diver-date-request-conflict",
  date_request_party_full: "diver-date-request-full",
  person_not_found: "diver-unavailable",
  unavailable: "diver-unavailable",
};

/**
 * **A walk-in family, seated in one pass** (fifth loop, item 9): the form's
 * own fields are the first person and each party row one more, booked
 * together on the departure or not at all (`seatParty`). Each row says what
 * that person is coming as, and an "Under 18" (the first person's too) may
 * carry a date of birth the counter asked for.
 *
 * **Nobody here is seated on a guess.** A name that reads like somebody on
 * file brings the form back naming that row (`onFile-<row>`), and the page
 * lists its candidates the way the single walk-in's prompt does (H-20260724-one-person-per-email, issue
 * #1556). The staffer then settles each such row on its own: "Use the record
 * on file" (that record's id) or "New person". A row settled either way is not
 * asked about again; one still unsettled is.
 */
export async function seatWalkInPartyAction(shopSlug: string, formData: FormData) {
  const door = seatSurfaceFor(surfaceFor("departure"), {
    shopSlug,
    tripId: "",
    personId: "",
    walkIn: true,
  });
  const session = (await requireShopSurface(shopSlug)).session;
  const parsed = parseForm(newDiverSchema, formData);
  const raw = rawLanding(formData);
  const tripId = parsed.ok ? parsed.data.tripId : String(raw.tripId ?? "");
  const formPath = `${shopPath(shopSlug, "divers", "new")}?${new URLSearchParams({
    surface: "departure",
    walkIn: "true",
    tripId,
  }).toString()}`;
  function back(notice: string, extra?: Record<string, string>): never {
    return revalidateAndRedirect(formPath, noticeUrl(formPath, notice, extra));
  }
  if (!parsed.ok || !uuidParam(tripId)) back("diver-invalid");
  // The same hold the single walk-in keeps: a boat the counter can no longer
  // seat takes nobody, whatever page the form came from.
  if (
    !(await holdsWalkInOpen({ shopSlug, tripId, personId: "", walkIn: true }, session.user.shopId))
  ) {
    back(PARTY_REFUSAL_NOTICE.trip_unavailable);
  }

  const party = readWalkInParty(formData.entries());
  if (party.invalid) back("diver-invalid");
  if (party.rows.some((row) => !diverNameSchema.safeParse(row.fullName).success)) {
    back("diver-invalid");
  }
  const everyone = [
    {
      ...party.first,
      row: WALK_IN_FIRST_ROW,
      fullName: parsed.data.fullName,
      email: parsed.data.email || undefined,
      phone: parsed.data.phone,
      participantType: parsed.data.participantType,
    },
    ...party.rows,
  ];

  const db = await getDb();
  const unsettled = everyone.filter((member) => member.match === undefined);
  const matched = await Promise.all(
    unsettled.map((member) => findSimilarDivers(db, session.user.shopId, member.fullName)),
  );
  const onFile = unsettled.filter((_, index) => (matched[index]?.length ?? 0) > 0);
  if (onFile.length > 0) {
    back(
      "party-on-file",
      Object.fromEntries(onFile.map((member) => [`onFile-${member.row}`, member.fullName])),
    );
  }

  // A chosen record must be one the row's own name reads like: a posted id is
  // never trusted to name somebody the staffer was not shown.
  const chosen = everyone.filter(
    (member) => member.match !== undefined && member.match !== WALK_IN_NEW_PERSON,
  );
  const shown = await Promise.all(
    chosen.map((member) => findSimilarDivers(db, session.user.shopId, member.fullName)),
  );
  if (chosen.some((member, index) => !shown[index]?.some((diver) => diver.id === member.match))) {
    back("diver-invalid");
  }

  const members: SeatPartyMember[] = everyone.map((member) => {
    const facts = {
      minor: member.minor,
      participantType: member.participantType,
      dateOfBirth: member.dateOfBirth,
    };
    if (member.match !== undefined && member.match !== WALK_IN_NEW_PERSON) {
      return { ...facts, personId: member.match, typedName: member.fullName };
    }
    return "email" in member
      ? { ...facts, fullName: member.fullName, email: member.email, phone: member.phone }
      : { ...facts, fullName: member.fullName };
  });

  const outcome = await seatParty(db, {
    shopId: session.user.shopId,
    tripId,
    actorPersonId: session.user.personId,
    members,
    entry: door.entry,
    refusals: door.refusals,
  }).catch(busyOnLockWait);
  if (outcome === "busy") back(SEAT_BUSY_NOTICE);
  if (!outcome.ok) back(PARTY_REFUSAL_NOTICE[outcome.reason]);
  // The lead's name, email and phone were kept as a draft while typing; the
  // party is seated, so the draft is finished with (security review N2).
  await discardFormDraft(db, session.user.shopId, session.user.personId, "new_diver");

  const lead = outcome.seats[0];
  if (!lead) throw new Error("seatParty returned no lead seat");
  const departurePath = door.seatedPath({ shopSlug, tripId, personId: "" });
  const queuePath = shopPath(shopSlug, "trips", tripId, "party", lead.bookingId, "waivers");
  revalidateAndRedirect(departurePath, queuePath);
}
