import { z } from "zod";
import { DEPARTURE_NOTE_MAX, departureNoteProblem, foldDepartureNote } from "./departure-notes";

/**
 * A send you can take back (ADR 20260906-before-you-ask, decision 2).
 *
 * The four sends that used to ask "are you sure?" before the tap now take an
 * eight-second hold after it: the row says what is about to happen and by
 * when, Undo stands where Send was, and the mail leaves when the hold drains.
 * The hold is a row on the server (`held_sends`), so closing the tab does not
 * stop the mail and a reload shows the hold still draining; Undo deletes the
 * row, and nothing was sent, nothing is logged.
 *
 * This module is the framework-free half: the hold length, the kinds, their
 * payload shapes (ids only, never a name or an address — the executor joins
 * those at send time, so an erasure needs no sweep here; a departure note
 * also carries the staffer's one line about the departure), and the
 * arithmetic.
 */
export const SEND_HOLD_MS = 8_000;

/**
 * How early a release may run. The client counts down on its own clock and
 * asks the server to send at zero; a half-second of skew must not turn that
 * into "not yet" and a second round trip.
 */
export const SEND_HOLD_TOLERANCE_MS = 750;

export const HELD_SEND_KINDS = [
  "waiver_send",
  "seat_offer",
  "trip_rescheduled",
  "departure_note",
  "counter_payment",
] as const;
export type HeldSendKind = (typeof HELD_SEND_KINDS)[number];

export const WAIVER_SEND_SURFACES = ["today", "roster", "diver", "counter"] as const;

const waiverSendPayload = z
  .object({
    kind: z.literal("waiver_send"),
    bookingIds: z.array(z.uuid()).max(200),
    personId: z.uuid().optional(),
    /** The channel the staffer tapped. `link` never holds — it is a copy, not a send. */
    channel: z.enum(["email", "text", "link"]),
    surface: z.enum(WAIVER_SEND_SURFACES),
    tripId: z.uuid().optional(),
    /** The counter rental's ticket a `counter` send was made from, when there is one yet. */
    ticketId: z.uuid().optional(),
  })
  // A send with nobody to send to is not a send; refused here so no row is
  // ever held for it.
  .refine((payload) => payload.bookingIds.length > 0 || payload.personId !== undefined, {
    message: "empty_batch",
  });

/**
 * **Offer a seat** (ADR 20261017-one-interest-with-a-scope): the one held act on a
 * departure's interests. Ids only, never a name or an address; the executor joins
 * those at send time. `interestIds` may name departure interests or anytime interests (the
 * last-minute list). A `discount` makes it the last-minute deal: a percent off,
 * or a fixed amount in minor units, and exactly one of the two.
 */
const seatOfferPayload = z.object({
  kind: z.literal("seat_offer"),
  tripId: z.uuid(),
  interestIds: z.array(z.uuid()).min(1).max(500),
  discount: z
    .union([
      z.strictObject({ percent: z.number().int().min(1).max(100) }),
      z.strictObject({ amountCents: z.number().int().positive() }),
    ])
    .optional(),
});

/**
 * **Telling the booked divers a departure moved** (ux review 2026-10-11, item
 * 1). Held by the move itself (the board's move and the trip page's retime),
 * not by a button: the staffer sees "Telling 6 divers the new time" with Undo
 * where the saved notice stands. `previousStartsAt` is the time the divers
 * were last told, written by the server from `trips.divers_told_starts_at`
 * and never read off a form; the executor reads everything else, the recipients
 * included, off the trip at send time.
 */
const tripRescheduledPayload = z.object({
  kind: z.literal("trip_rescheduled"),
  tripId: z.uuid(),
  previousStartsAt: z.iso.datetime({ offset: true }),
  /**
   * Whether the meeting point moved, so the message says where. With
   * `previousStartsAt` equal to the departure's start, it is all that moved.
   */
  meetingPointMoved: z.boolean(),
});

/**
 * A note to everyone on a departure (batch 4, J4). The one payload that
 * carries words: the staffer's own line about the departure, which names no
 * diver and is checked here as it is at the send (`departureNoteProblem`).
 */
const departureNotePayload = z.object({
  kind: z.literal("departure_note"),
  tripId: z.uuid(),
  body: z
    .string()
    .max(DEPARTURE_NOTE_MAX * 4)
    .transform(foldDepartureNote)
    .refine((body) => departureNoteProblem(body) === null, { message: "note_refused" }),
});

/**
 * **Cash or the card machine at the counter** (issue #3030, decided
 * 2026-10-25: one tap with an eight-second Undo hold, H-68). Not a message:
 * the same hold, so a mis-tap on the wrong order is taken back before any
 * money is recorded. Ids only; the amount is the order's own balance, read by
 * the executor at record time, never a number off the form.
 */
const counterPaymentPayload = z.object({
  kind: z.literal("counter_payment"),
  orderId: z.uuid(),
  collection: z.enum(["cash", "card_machine"]),
});

export const heldSendPayloadSchema = z.discriminatedUnion("kind", [
  waiverSendPayload,
  seatOfferPayload,
  tripRescheduledPayload,
  departureNotePayload,
  counterPaymentPayload,
]);

export type HeldSendPayload = z.infer<typeof heldSendPayloadSchema>;
export type WaiverSendPayload = z.infer<typeof waiverSendPayload>;
export type TripRescheduledPayload = z.infer<typeof tripRescheduledPayload>;
export type CounterPaymentPayload = z.infer<typeof counterPaymentPayload>;

/**
 * Two moves of one departure inside one hold are one message: the divers were
 * last told the *earliest* of the held "before" times, and the meeting point
 * moved if either move moved it. Null when the departure is back where the
 * divers were last told it was and the meeting point did not move, so there is
 * nothing to say. A meeting-point move with the time where it was is a
 * place-only notice (#2443).
 */
export function mergeRescheduleHolds(
  pending: TripRescheduledPayload[],
  next: TripRescheduledPayload,
  currentStartsAt: Date,
): TripRescheduledPayload | null {
  const all = [...pending.filter((held) => held.tripId === next.tripId), next];
  const told = all.reduce((earliest, held) =>
    Date.parse(held.previousStartsAt) < Date.parse(earliest.previousStartsAt) ? held : earliest,
  );
  const meetingPointMoved = all.some((held) => held.meetingPointMoved);
  if (Date.parse(told.previousStartsAt) === currentStartsAt.getTime() && !meetingPointMoved) {
    return null;
  }
  return {
    kind: "trip_rescheduled",
    tripId: next.tripId,
    previousStartsAt: told.previousStartsAt,
    meetingPointMoved,
  };
}

/** When a send held at `now` leaves. A `link` channel never waits. */
export function heldSendRunAt(payload: HeldSendPayload, now: Date, holdMs = SEND_HOLD_MS): Date {
  const immediate = payload.kind === "waiver_send" && payload.channel === "link";
  return new Date(now.getTime() + (immediate ? 0 : holdMs));
}

/** Whether a held send may leave now — its hold has drained, give or take skew. */
export function isHeldSendDue(
  runAt: Date,
  now: Date,
  toleranceMs = SEND_HOLD_TOLERANCE_MS,
): boolean {
  return runAt.getTime() - toleranceMs <= now.getTime();
}

/** Whole seconds left on a hold, for the row's countdown; never below zero. */
/** Seconds still to count, from a hold's length and how much of it has run. */
export function heldSendSecondsLeft(holdMs: number, elapsedMs: number): number {
  return Math.max(0, Math.ceil((holdMs - elapsedMs) / 1000));
}
