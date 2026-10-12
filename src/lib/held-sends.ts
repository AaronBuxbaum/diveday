import { z } from "zod";

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
 * those at send time, so an erasure needs no sweep here), and the arithmetic.
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
  "last_minute_deal",
  "waitlist_invite",
  "trip_rescheduled",
] as const;
export type HeldSendKind = (typeof HELD_SEND_KINDS)[number];

export const WAIVER_SEND_SURFACES = ["today", "roster", "diver"] as const;

const waiverSendPayload = z
  .object({
    kind: z.literal("waiver_send"),
    bookingIds: z.array(z.uuid()).max(200),
    personId: z.uuid().optional(),
    /** The channel the staffer tapped. `link` never holds — it is a copy, not a send. */
    channel: z.enum(["email", "text", "link"]),
    surface: z.enum(WAIVER_SEND_SURFACES),
    tripId: z.uuid().optional(),
  })
  // A send with nobody to send to is not a send; refused here so no row is
  // ever held for it.
  .refine((payload) => payload.bookingIds.length > 0 || payload.personId !== undefined, {
    message: "empty_batch",
  });

const lastMinuteDealPayload = z
  .object({
    kind: z.literal("last_minute_deal"),
    tripId: z.uuid(),
    /** Percent off, or a fixed amount in minor units: exactly one of the two. */
    discountPercent: z.number().int().min(1).max(100).optional(),
    discountAmountCents: z.number().int().positive().optional(),
    recipientPersonIds: z.array(z.uuid()).min(1).max(500),
  })
  .refine(
    (payload) =>
      (payload.discountPercent === undefined) !== (payload.discountAmountCents === undefined),
    { message: "one_discount" },
  );

const waitlistInvitePayload = z.object({
  kind: z.literal("waitlist_invite"),
  tripId: z.uuid(),
  entryId: z.uuid(),
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
  /** Whether the meeting point moved with the time, so the message says where too. */
  meetingPointMoved: z.boolean(),
});

export const heldSendPayloadSchema = z.discriminatedUnion("kind", [
  waiverSendPayload,
  lastMinuteDealPayload,
  waitlistInvitePayload,
  tripRescheduledPayload,
]);

export type HeldSendPayload = z.infer<typeof heldSendPayloadSchema>;
export type WaiverSendPayload = z.infer<typeof waiverSendPayload>;
export type TripRescheduledPayload = z.infer<typeof tripRescheduledPayload>;

/**
 * Two moves of one departure inside one hold are one message: the divers were
 * last told the *earliest* of the held "before" times, and the meeting point
 * moved if either move moved it. Null when the departure is back where the
 * divers were last told it was, so there is nothing to say.
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
  if (Date.parse(told.previousStartsAt) === currentStartsAt.getTime()) return null;
  return {
    kind: "trip_rescheduled",
    tripId: next.tripId,
    previousStartsAt: told.previousStartsAt,
    meetingPointMoved: all.some((held) => held.meetingPointMoved),
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
