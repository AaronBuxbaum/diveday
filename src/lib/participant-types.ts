/**
 * **Who is aboard, and what each of them is doing** (ADR
 * 20261007-participant-types, `docs/product/features/participant-types.md`).
 *
 * A Florida two-tank morning carries three kinds of person on one departure:
 *
 * - a **diver**, who dives;
 * - a **snorkeler**, who is in the water on the surface with no tank;
 * - a **rider**, who stays on the boat.
 *
 * All three hold a seat, are a body the crew counts at every roll-call
 * checkpoint, and sign the shop's waiver. Only a diver is asked for a card, put
 * on a buddy team, packed tanks for, or counted against a departure's divers-only
 * limit. This module is the one place those differences are stated; it holds no
 * database and no words (the UI picks those, `src/i18n/participant-labels.ts`).
 *
 * Deliberately free of imports so `src/db/schema.ts` can read the list for its
 * enum without a cycle.
 */

/** Kept in step with the `participant_type` enum in `src/db/schema.ts`. */
export const PARTICIPANT_TYPES = ["diver", "snorkeler", "rider"] as const;

export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

/** The two kinds of seat that are not a diver's. */
export type NonDiverParticipantType = Exclude<ParticipantType, "diver">;

export function isParticipantType(value: unknown): value is ParticipantType {
  return typeof value === "string" && (PARTICIPANT_TYPES as readonly string[]).includes(value);
}

/**
 * Whether this seat dives. The one question every gate asks of the type: a
 * certification requirement, a nitrox request, a buddy team, a tank and the
 * divers-only limit all belong to a diver and to nobody else.
 *
 * Absent reads as a diver, which is what every booking was before the type
 * existed and what the column defaults to — and it is the stricter reading
 * everywhere it matters: a diver is asked for more, never less.
 */
export function isDiver(type: ParticipantType | null | undefined): boolean {
  return type === undefined || type === null || type === "diver";
}

/**
 * The divers-only limit that actually binds, or null when none does.
 *
 * `trips.diver_capacity` is optional, and a value at or above the boat's own
 * capacity can never be the limit that refuses anybody — the head count reaches
 * the boat's capacity first. Read through here so that rule has one spelling.
 */
export function diverSeatLimit(trip: {
  capacity: number;
  diverCapacity?: number | null;
}): number | null {
  const limit = trip.diverCapacity;
  if (limit === null || limit === undefined) return null;
  return limit < trip.capacity ? limit : null;
}

/** How many seats are held right now, everyone and divers among them. */
export type SeatCounts = { aboard: number; divers: number };

/**
 * Whether one more seat of `type` fits on this departure.
 *
 * **Everyone counts against the boat.** A snorkeler and a rider are as much a
 * body as a diver, so `capacity` is measured against every held seat, and the
 * divers-only limit is measured against divers alone. The boat's own limit is
 * checked first, so a full boat is refused as full rather than as "no diver
 * seats left" — the cheaper answer, and the true one.
 *
 * Pure, and called from inside the booking transaction with the counts it read
 * under the trip-row lock (`createBookingRecord`, src/db/bookings.ts). Never a
 * pre-check: a count read outside that lock is advice, not a gate.
 */
export function seatRefusal(
  type: ParticipantType,
  trip: { capacity: number; diverCapacity?: number | null },
  held: SeatCounts,
): "trip_full" | "divers_full" | null {
  if (held.aboard >= trip.capacity) return "trip_full";
  const diverLimit = diverSeatLimit(trip);
  if (isDiver(type) && diverLimit !== null && held.divers >= diverLimit) return "divers_full";
  return null;
}

/**
 * The same question for a seat that is **changing** type rather than arriving:
 * it already holds its place against the boat, so only the divers-only limit
 * can refuse it, and only when it is becoming a diver's.
 */
export function typeChangeRefusal(
  from: ParticipantType,
  to: ParticipantType,
  trip: { capacity: number; diverCapacity?: number | null },
  held: SeatCounts,
): "divers_full" | null {
  if (isDiver(from) || !isDiver(to)) return null;
  const diverLimit = diverSeatLimit(trip);
  return diverLimit !== null && held.divers >= diverLimit ? "divers_full" : null;
}

/** What a departure states about each kind of seat that is not a diver's. */
export type ParticipantPricing = {
  priceCents: number | null;
  snorkelerPriceCents?: number | null;
  riderPriceCents?: number | null;
};

/**
 * The per-person price this departure states for a seat of `type`, in minor
 * units, or null when it states none.
 *
 * A diver's seat is the trip's own `price_cents`, exactly as before. A
 * snorkeler's and a rider's are their own columns, and **never fall back to the
 * diver's price**: a shop that has not named a snorkel price has not decided to
 * charge a snorkeler the full dive fare, and reading it that way would put a
 * rider through checkout for two tanks they will never breathe.
 */
export function participantPriceCents(
  trip: ParticipantPricing,
  type: ParticipantType,
): number | null {
  if (type === "snorkeler") return trip.snorkelerPriceCents ?? null;
  if (type === "rider") return trip.riderPriceCents ?? null;
  return trip.priceCents;
}

/**
 * The kinds of seat the public form offers on this departure.
 *
 * A diver's seat always. A snorkeler's or a rider's only where the shop has
 * named a price for it (zero included — a rider who comes free), and never on a
 * course session: a training dive is diving, and a student recorded as a rider
 * to get aboard would be a lie in the record the crew reads at the rail.
 *
 * Staff can seat any kind on a charter whether or not it is offered here; this
 * is what the public is sold, not what the boat may carry.
 */
export function offeredParticipantTypes(
  trip: ParticipantPricing & { courseId?: string | null },
): ParticipantType[] {
  if (trip.courseId) return ["diver"];
  const offered: ParticipantType[] = ["diver"];
  if (trip.snorkelerPriceCents !== null && trip.snorkelerPriceCents !== undefined) {
    offered.push("snorkeler");
  }
  if (trip.riderPriceCents !== null && trip.riderPriceCents !== undefined) offered.push("rider");
  return offered;
}

/**
 * **A seat that was sold to dive and is not diving now** — the type it is
 * doing instead, or null.
 *
 * Changing a diver to a snorkeler or a rider is the one door that clears a
 * certification block without a card (`setBookingParticipantType`), so every
 * crew surface says it in warning tone beside the name: "Snorkeling, booked as
 * diver". Only an explicit `bookedAs` of diver counts; a row that does not
 * carry the column says nothing rather than guessing.
 */
export function leftDiving(seat: {
  participantType?: ParticipantType | null;
  bookedAs?: ParticipantType | null;
}): NonDiverParticipantType | null {
  const now = seat.participantType;
  if (seat.bookedAs !== "diver" || now === null || now === undefined || now === "diver") {
    return null;
  }
  return now;
}

/**
 * **A seat that was sold as a snorkeler or a rider and is diving now** — what it
 * was booked as, or null.
 *
 * The other direction of {@link leftDiving}, and the one a "Change anyway"
 * writes past a missing card: the crew at the rail should see "Diving, booked
 * as snorkeler" beside a diver whose card the desk never saw at booking.
 */
export function joinedDiving(seat: {
  participantType?: ParticipantType | null;
  bookedAs?: ParticipantType | null;
}): NonDiverParticipantType | null {
  const booked = seat.bookedAs;
  if (seat.participantType !== "diver" || booked === null || booked === undefined) return null;
  return booked === "diver" ? null : booked;
}

/**
 * The register's own kinds a snorkeler may hold, expanded from
 * {@link SNORKELER_RENTABLE_KINDS} the way `gearAssignmentNeeds` splits a
 * mask-and-fins or hood-and-gloves answer into tagged units.
 */
export const SNORKELER_REGISTER_KINDS: readonly string[] = [
  "mask",
  "fins",
  "wetsuit",
  "boots",
  "hood",
  "gloves",
  "gopro",
];

/** Whether a seat of this type may hold a tagged register unit of `kind`. */
export function holdsRegisterKind(type: ParticipantType | null | undefined, kind: string): boolean {
  if (isDiver(type)) return true;
  if (type === "snorkeler") return SNORKELER_REGISTER_KINDS.includes(kind);
  return false;
}

/** A head count split by what each person is doing. Every type, always present. */
export type ParticipantCounts = Record<ParticipantType, number>;

export function emptyParticipantCounts(): ParticipantCounts {
  return { diver: 0, snorkeler: 0, rider: 0 };
}

/**
 * Count people by type. Absent reads as a diver, matching {@link isDiver}, so a
 * row assembled before the type existed is counted — never dropped.
 */
export function countParticipants(
  rows: ReadonlyArray<{ participantType?: ParticipantType | null }>,
): ParticipantCounts {
  const counts = emptyParticipantCounts();
  for (const row of rows) counts[row.participantType ?? "diver"] += 1;
  return counts;
}

/** Whether a count holds anybody who is not a diver — the cue to show the split at all. */
export function hasNonDivers(counts: ParticipantCounts): boolean {
  return counts.snorkeler > 0 || counts.rider > 0;
}

/**
 * The rental kinds a snorkeler can be packed or sold: what goes on at the
 * surface. A BCD, a regulator, weights, a computer, a drysuit, a torch and an
 * SMB are scuba kit; offering them to a snorkeler would sell and pack gear the
 * crew then has to explain away at the rail. Kept as plain strings so this file
 * stays import-free; the caller's `RentableItemKind` narrows them.
 */
export const SNORKELER_RENTABLE_KINDS: readonly string[] = [
  "mask_fins",
  "wetsuit",
  // Rides along with a wetsuit on the prep list (src/lib/dive-prep.ts), and
  // a snorkeler on a rocky entry wants them as much as a diver does.
  "boots",
  "hood",
  "gloves",
  "gopro",
];

/**
 * Whether a seat of this type may rent `kind` at all (ADR
 * 20261007-participant-types). A diver may rent anything the shop offers; a
 * snorkeler the surface kit above; a rider nothing, since they stay aboard.
 */
export function rentsKind(type: ParticipantType | null | undefined, kind: string): boolean {
  if (isDiver(type)) return true;
  if (type === "snorkeler") return SNORKELER_RENTABLE_KINDS.includes(kind);
  return false;
}

/**
 * The shop's rental catalog as one seat's fit form offers it: everything for a
 * diver, the surface kit for a snorkeler (so no nitrox and no tanks), nothing
 * for a rider.
 */
export function seatRentalItems(
  type: ParticipantType | null | undefined,
  rentalItems: readonly string[],
): string[] {
  return rentalItems.filter((kind) => rentsKind(type, kind));
}

/**
 * A fit form's answer for one piece, read for the seat that posted it: "on" or
 * not for a piece this seat may rent, and nothing at all for one it may not,
 * since the form never showed it. Nothing is what `saveRentalFit` reads as
 * "leave the stored answer alone", so one snorkel trip never rewrites the
 * person's own dive kit.
 */
export function seatRentalAnswer(
  type: ParticipantType | null | undefined,
  kind: string,
  posted: string | undefined,
): boolean | undefined {
  return rentsKind(type, kind) ? posted === "on" : undefined;
}

/** Whether a seat of this type gets a rental step at all: a rider does not. */
export function rentsGear(type: ParticipantType | null | undefined): boolean {
  return type !== "rider";
}

/**
 * Read a public party's "Joining as" answers, one per person, against what this
 * departure actually sells (ADR 20261007-participant-types).
 *
 * An absent or empty answer is a diver's seat, which is what a form that asked
 * nothing (a dive-only departure) posts. Anything else must be a known type
 * that {@link offeredParticipantTypes} offers here; a hand-built post naming a
 * rider on a departure that sells no rider seat is refused at the index it
 * arrived on, never quietly booked as something else. With no trip to read,
 * only a diver's seat is accepted.
 */
export function parsePartyTypes(
  answers: ReadonlyArray<unknown>,
  trip: (ParticipantPricing & { courseId?: string | null }) | null,
): { ok: true; types: ParticipantType[] } | { ok: false; index: number } {
  const offered = trip ? offeredParticipantTypes(trip) : (["diver"] as ParticipantType[]);
  const types: ParticipantType[] = [];
  for (const [index, answer] of answers.entries()) {
    const value = answer === null || answer === undefined || answer === "" ? "diver" : answer;
    if (!isParticipantType(value) || !offered.includes(value)) return { ok: false, index };
    types.push(value);
  }
  return { ok: true, types };
}

/**
 * **The passenger split, saying only the types aboard**: "8 divers · 3
 * snorkelers", never "· 0 riders". `word` picks each term's words from the
 * caller's own bundle; this owns which terms appear and their order.
 */
export function joinPassengerSplit(
  counts: ParticipantCounts,
  word: (type: ParticipantType, count: number) => string,
): string {
  return PARTICIPANT_TYPES.filter((type) => counts[type] > 0)
    .map((type) => word(type, counts[type]))
    .join(" · ");
}

/**
 * Who the buddy-team builder may still offer: divers on no team yet. A buddy
 * team is divers who look after each other underwater, so a snorkeler or a
 * rider is never offered and never counted as "not on a team"
 * (`resolveMembers` refuses them too).
 */
export function unteamedDivers<
  Seat extends { bookingId: string; participantType?: ParticipantType | null },
>(seats: readonly Seat[], teamedBookingIds: ReadonlySet<string>): Seat[] {
  return seats.filter(
    (seat) => isDiver(seat.participantType) && !teamedBookingIds.has(seat.bookingId),
  );
}
