/**
 * The counter's vocabulary: a diver turned up at the desk, or that statement
 * was taken back. One append-only tap at a time, exactly like roll call and
 * the pre-departure checklist beside it (ADR
 * 20260907-the-counter-survives-offline).
 *
 * **Dependency-free, like `roll-call.ts` and `pre-departure-check.ts`.**
 * `src/lib/offline-manifests.ts` is compiled into the offline service worker,
 * and it reads this module to derive a diver's arrival state on a device with
 * no signal. Anything added here must import nothing.
 *
 * **This vocabulary cannot say "aboard", and that is the point.** Arrival and
 * boarding are two different questions asked in two different places — the
 * desk asks "are you here?", the rail asks "are you on the boat?" — and a
 * queue that could answer the second while nobody was watching the water is
 * the one failure this whole feature is built to make impossible. So the
 * offline counter's statuses are the two below and there is no third; there is
 * no checkpoint on an arrival event; and the writer these events reach
 * (`checkInBooking`/`undoCheckInBooking`, `src/db/check-in.ts`) touches
 * `bookings.status` and `booking_arrival_events` and cannot reach
 * `roll_call_events` at all. A person on the boat is a person somebody saw.
 */

/** `cleared` is the retraction — the re-tap that reopens the arrival queue. */
export type ArrivalStatus = "arrived" | "cleared";

/**
 * The refusal a `cleared` gets when the arrival it names is no longer the
 * newest one standing — the same shape and the same spelling as
 * `RETRACTION_SUPERSEDED` (`roll-call.ts`) and
 * `PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED`, written once so a server writer
 * and a service-worker-bundled reader mean the same thing by it.
 */
export const ARRIVAL_RETRACTION_SUPERSEDED = "retraction_superseded";

/**
 * Reduce one booking's queued arrival taps to its current answer: newest
 * wins, and a newest `cleared` collapses to "not here" (`undefined`) rather
 * than falling through to an older `arrived` — the same collapse
 * `latestPreDepartureCheck` applies, for the same reason. Falling through
 * would hand the mark straight back to whoever just tapped it off.
 *
 * `>=` rather than `>`, and the array order is the queue order: two taps share
 * a millisecond under a coarse or frozen clock, and the later-queued one is
 * the one somebody meant. That is the tie-break `latestQueuedAttempt`
 * (`offline-manifests.ts`) and the sync route both apply, and the three have
 * to agree or a device shows one thing and the server stores another.
 */
export function latestArrival<T extends { status: ArrivalStatus; occurredAt: string | Date }>(
  events: readonly T[],
): T | undefined {
  let latest: T | undefined;
  for (const event of events) {
    if (!latest || event.occurredAt >= latest.occurredAt) latest = event;
  }
  return latest?.status === "arrived" ? latest : undefined;
}
