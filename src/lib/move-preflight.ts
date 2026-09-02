/**
 * **What moving a departure will cost, said before it is moved.**
 *
 * The schedule builder's Move panel asks for a date and a time and then does
 * it. Everything the move touches beyond those two fields is invisible until
 * afterwards — and one of them, the gear it has to let go of, was only ever
 * reported *after the fact* in a `?gear=N` notice (`moveTrip`). This composes
 * the consequences into something a staff member can read while the form is
 * still empty (issue #1203, D43).
 *
 * **Read-only, and never a pre-check the mutation trusts.** Nothing here
 * writes, and nothing the real path does is conditioned on what this said. The
 * gear line is the reason that distinction matters rather than being pedantry:
 * availability is enforced by the `gear_reservations_no_overlap` exclusion
 * constraint and raced for real in `gear-reservations.postgres.test.ts`, so a
 * read taken while a panel is open can be stale by the time the move commits.
 * The line therefore says what *travels*, and that collisions get released —
 * never that a particular unit is safe.
 *
 * **What it does not say is most of it.** The board row the panel opens under
 * already shows the departure's title, time, seat count, crew names and boat,
 * and a caption restating what the surface shows earns nothing (AGENTS.md). So
 * this carries only what the board cannot: who has already been *told* the
 * date, the kit that silently travels, and the money already taken. A departure
 * with none of those produces no sections at all, and the panel renders nothing
 * — never three empty headings.
 *
 * **Crew is the deliberate omission**, and the ticket names it. A count would
 * duplicate the row: measured against the demo shop's board, every departure
 * but one rosters the same two people, which is the identical failure issue
 * #757 fixed on the crew line itself. The consequence worth stating is not how
 * many are on it but whether they are free on the *new* date, and nothing in
 * this app models a crew member's availability yet — so this says nothing
 * rather than something true and useless.
 *
 * **No judgement of its own.** The one thing that stops a move is roll-call
 * evidence, and that question is asked by `countRollCallEvidence` — the same
 * function `moveTrip`'s guard calls — so the preview and the refusal cannot
 * disagree. There is deliberately no "has this sailed" test here: `moveTrip`
 * refuses on evidence, not on the clock, and inventing a second, time-based
 * rule is how a preview starts lying about an outcome it does not decide.
 */

/**
 * The facts a preview is composed from, all of them counts already queryable.
 * Deliberately flat and framework-free: the reader that fills this in lives in
 * `src/db/move-preflight.ts`, and the words live in the staff bundle.
 */
export type MovePreflightFacts = {
  /**
   * Bookings that have already been sent a message stating this departure's
   * date — its confirmation, or one of the two pre-trip reminders. Those divers
   * have the old date in their inbox and the move sends nothing:
   * `notification_deliveries` is unique on (booking, kind), so a confirmation
   * or a cadence already spent is never re-sent for the new one. The list of
   * which messages state a date is in `src/db/move-preflight.ts`.
   */
  toldSeats: number;
  /**
   * Open gear reservations riding on the departure — the exact set
   * `rewindowTripGearReservations` will try to carry across.
   */
  gearReserved: number;
  /**
   * Orders against this departure's bookings that are **paid** — money already
   * taken against the date that is about to change. Deliberately not the unpaid
   * ones: an open invoice is unaffected by a move, so counting it here would be
   * a number with no consequence attached to it.
   */
  paidOrders: number;
  /** The departure's own cancellation window, in hours; null when it sets none. */
  cancellationWindowHours: number | null;
  /**
   * Roll-call rows — divers' and crew's alike — recorded against the
   * departure. Any at all and `moveTrip` refuses with `already_sailed`.
   */
  rollCallEvidence: number;
  /** False for a cancelled departure, which `moveTrip` refuses too. */
  scheduled: boolean;
};

/**
 * One thing the move will do. A section exists only when it has something to
 * report, so an untouched departure composes to none.
 */
export type MovePreflightSection =
  | {
      /** Seats that have already had a reminder naming the current date. */
      kind: "told";
      reminded: number;
    }
  | { kind: "gear"; count: number }
  | { kind: "money"; paid: number; cancellationWindowHours: number | null };

/**
 * `blocked` mirrors `MoveTripOutcome`'s refusal codes rather than inventing a
 * vocabulary, so the panel can say up front what the redirect would have said
 * afterwards. `sections` is empty for a departure nothing has happened to.
 */
export type MovePreflight = {
  blocked: "already_sailed" | "not_scheduled" | null;
  sections: MovePreflightSection[];
};

/**
 * The preview for one departure. Pure, total, and ordered: people first, then
 * the kit, then the money — widest consequence to narrowest.
 *
 * A blocked departure still reports its sections. The move is refused, but the
 * facts are the reason it is worth knowing, and blanking them would leave a
 * refusal with nothing behind it.
 */
export function composeMovePreflight(facts: MovePreflightFacts): MovePreflight {
  const sections: MovePreflightSection[] = [];

  // Silence when nobody has been told. A departure whose divers have heard
  // nothing yet costs no letters, and saying "0 have been told" is the empty
  // heading this exists not to render.
  if (facts.toldSeats > 0) sections.push({ kind: "told", reminded: facts.toldSeats });
  if (facts.gearReserved > 0) sections.push({ kind: "gear", count: facts.gearReserved });
  // The window alone is not a consequence — it is a term the departure has
  // always carried, and it only becomes worth printing beside money that has
  // actually moved.
  if (facts.paidOrders > 0) {
    sections.push({
      kind: "money",
      paid: facts.paidOrders,
      cancellationWindowHours: facts.cancellationWindowHours,
    });
  }

  return { blocked: blockedReason(facts), sections };
}

/**
 * The same two questions `moveTrip` asks, in the same order, so a preview can
 * never promise a move the mutation refuses. Evidence outranks status because
 * the mutation checks status first and evidence second — a cancelled trip that
 * also has a roll call is refused as `not_scheduled` there, and this says so.
 */
function blockedReason(facts: MovePreflightFacts): MovePreflight["blocked"] {
  if (!facts.scheduled) return "not_scheduled";
  if (facts.rollCallEvidence > 0) return "already_sailed";
  return null;
}
