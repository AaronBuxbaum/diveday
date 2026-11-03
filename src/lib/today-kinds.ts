import type { Role } from "./authz";

/**
 * **What a Today row can be, and who may act on it.** The two tables below the
 * queue's whole vocabulary: `src/features/today/today.ts` ranks and groups rows, but a
 * module that only asks "may this role act on this kind?" (`src/db/authz.ts`,
 * the weekly digest, the label bundles) reads this small file and not the
 * 2,000-line queue.
 */

export type TodayActionKind =
  | "roll_call_missing_diver"
  | "roll_call_missing_crew"
  | "roll_call_unfinished"
  | "roll_call_crew_unfinished"
  | "roll_call_departure_open"
  | "roll_call_not_started"
  | "blocked_aboard"
  | "medical_review"
  | "medical_not_cleared"
  | "identity"
  | "certification"
  | "waiver"
  | "payment"
  | "readiness_unavailable"
  | "requirements"
  | "dive_prep"
  | "help_request"
  | "nitrox_gate"
  | "emergency_card_blank"
  | "high_wind_alert"
  | "instructor_missing"
  | "uncrewed_course"
  | "uncrewed_departure"
  | "boat_clash"
  | "crew_clash"
  | "crew_clash_sailed"
  | "crew_away"
  | "crew_below_target"
  | "seat_wanted"
  | "email_delivery"
  | "emergency_contact"
  | "stuck_payment_operation"
  | "failed_photo_deletion"
  | "owed_refund"
  | "payment_dispute"
  | "payments_restricted"
  | "reviews_pending"
  | "unanswered_messages"
  | "gear_overdue"
  | "gear_due_back"
  | "gear_service_due"
  | "boat_safety_kit"
  | "boat_papers_due"
  | "boat_papers_lapsed"
  | "boat_safety_expired"
  | "boat_snag"
  | "incident_report_unfiled"
  | "work_order_late"
  | "work_order_uncollected"
  | "staff_credential_due"
  | "units_unconfirmed"
  | "lost_items_waiting"
  | "rental_fit_confirm";

/**
 * Audience per TodayActionKind (issue #715).
 * Declares which roles act on each kind:
 * - In-water, roll call, dock gear, and prep rows are for all staff — including
 *   the `assistant_instructor` rung, who is in the water with students and
 *   reads this queue at the rail (issue #1680).
 * - Instructional staffing, requirements, certs, and waivers are for instructors, owners, and
 *   managers. An Assistant Instructor is deliberately **not** in those: they are a certified
 *   assistant, and clearing a medical review or a certification is not theirs to do.
 * - Front-desk, commercial, financial, and back-office rows are for owners and managers.
 */
export const KIND_AUDIENCE: Record<TodayActionKind, readonly Role[]> = {
  roll_call_missing_diver: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  roll_call_missing_crew: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  roll_call_unfinished: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  roll_call_crew_unfinished: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  roll_call_departure_open: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  roll_call_not_started: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  dive_prep: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  help_request: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  nitrox_gate: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  high_wind_alert: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
  ],
  // The boat roles too: whoever is at the rail is who can act on a diver
  // already aboard. **Wider than `medical_review`'s audience, on purpose**: an
  // aboard row whose headline is a medical hold reaches the divemaster and the
  // captain, because the departure card's line it replaced named the diver and
  // "a medical hold" to every Today viewer, and the roster already shows any
  // staff member which prompts flagged (`authz.ts`). Signed off by
  // `dive-domain-expert` and `security-reviewer` on 2026-10-05; pinned in
  // `today.test.ts`.
  blocked_aboard: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
  ],
  uncrewed_departure: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
  ],
  // The crew rows' audience: the divemaster and captain at the rail are as
  // likely to notice they are on two boats as the office is to fix it.
  boat_clash: ["owner", "manager", "instructor", "assistant_instructor", "divemaster", "captain"],
  crew_clash: ["owner", "manager", "instructor", "assistant_instructor", "divemaster", "captain"],
  // The clash's audience, for the clash's reason: the person away is as likely
  // to read it as the office that fixes it.
  crew_away: ["owner", "manager", "instructor", "assistant_instructor", "divemaster", "captain"],
  crew_clash_sailed: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
  ],
  // The wider of its two parents' audiences. `instructor_missing` is
  // owner/manager/instructor because only they can close it; this row says the
  // boat has nobody in the water, which the divemaster and captain reading the
  // queue at the rail are exactly the people to notice.
  uncrewed_course: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
  ],
  crew_below_target: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
  ],
  instructor_missing: ["owner", "manager", "instructor"],
  medical_review: ["owner", "manager", "instructor"],
  medical_not_cleared: ["owner", "manager", "instructor"],
  identity: ["owner", "manager", "instructor"],
  certification: ["owner", "manager", "instructor"],
  requirements: ["owner", "manager", "instructor"],
  waiver: ["owner", "manager", "instructor"],
  emergency_contact: ["owner", "manager"],
  payment: ["owner", "manager"],
  readiness_unavailable: ["owner", "manager"],
  seat_wanted: ["owner", "manager"],
  // Every staff role (issue #2066, decided 2026-10-05). The resend retries only
  // mail already on the failed-delivery list, so it puts nothing new in front of
  // anyone — the same reasoning that leaves the invoice and waiver resends open
  // to all staff (ADR 20260803-invoicing-role-gate). The desk fixes a bounce.
  email_delivery: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  stuck_payment_operation: ["owner", "manager"],
  failed_photo_deletion: ["owner", "manager"],
  owed_refund: ["owner", "manager"],
  payment_dispute: ["owner", "manager"],
  payments_restricted: ["owner", "manager"],
  reviews_pending: ["owner", "manager"],
  // Every staff role, since the inbox stopped carrying a gate of its own on
  // 2026-09-10 (issues #1505/#1518). A row pointing at a page its reader
  // cannot open is a dead end — and the other way round, a role that may
  // answer a waiting diver is a role that has to be told one is waiting.
  unanswered_messages: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  gear_overdue: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  gear_due_back: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  // Every role: the crew loading the boat are the people who can swap the
  // flares or fetch the other AED before it leaves, and a crew-scoped Today
  // leads with its own departure's rows.
  boat_safety_kit: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  // Owner rows: renewing a boat's insurance or buying new flares is the
  // owner's errand, and the row's link is Settings. The crew read the same
  // facts on the departure's own pre-departure check.
  boat_papers_due: ["owner", "manager"],
  boat_papers_lapsed: ["owner", "manager"],
  boat_safety_expired: ["owner", "manager"],
  // The owner's and the captain's: one gets it fixed, the other skippers it.
  boat_snag: ["owner", "manager", "captain"],
  // The two roles that may read every report (`canReadEveryIncidentReport`):
  // the line names who started a draft, so nobody else is told of it.
  incident_report_unfiled: ["owner", "manager"],
  gear_service_due: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  // Whoever is at the bench or the counter: the same audience as the gear
  // register's rows, since the same people take the gear in and hand it back.
  work_order_late: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  work_order_uncollected: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  staff_credential_due: ["owner", "manager"],
  units_unconfirmed: ["owner", "manager"],
  // The card is the owner's to fill in (Settings > Emergency reference).
  emergency_card_blank: ["owner", "manager"],
  // Whoever is at the counter when the diver comes back hands it over, which
  // is why Lost and found is ungated (`staff-destinations.ts`).
  lost_items_waiting: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
  // The same audience the other gear rows have, and for the same reason: the
  // person who handed the diver a different BCD is whoever was at the counter.
  rental_fit_confirm: [
    "owner",
    "manager",
    "instructor",
    "assistant_instructor",
    "divemaster",
    "captain",
    "crew",
  ],
};

/**
 * Whether any of these roles is in a kind's Today audience. The server-side
 * twin of `filterActionsForRoles`, for an action that does what a row offers:
 * what Today hides from a role, the action behind it refuses (issue #2134).
 * Unlike the filter, an empty list is nobody, not everybody.
 */
export function rolesMayActOnKind(kind: TodayActionKind, roles: readonly Role[]): boolean {
  const audience = KIND_AUDIENCE[kind];
  return roles.some((role) => audience.includes(role));
}

/**
 * Severity breaks ties inside a single departure. It ranks by how long the fix
 * takes to land, not by how bad it looks: evidence that has to come from the
 * diver or a physician outranks anything staff can settle at the dock.
 */
export const KIND_SEVERITY: Record<TodayActionKind, number> = {
  // A diver was counted at an after-dive checkpoint and was **not** back aboard.
  // Somebody said so out loud; this is the closest thing the app has to a
  // missing-person report, so nothing outranks it (DOM-H3).
  roll_call_missing_diver: 0,
  // The same statement about a **crew member**: somebody tapped "not back
  // aboard" against a named divemaster, captain or deckhand. It sits beside
  // the diver row rather than below the clerical ones because the crew are the
  // people most reliably in the water — the DM who goes back down for a lost
  // weight belt is the scenario, and before this it reached no surface at all
  // (review 20260803, D1).
  roll_call_missing_crew: 1,
  // An after-dive head count that never closed: nobody said the diver is
  // missing, but nobody said they are aboard either. Every other kind below
  // describes someone who cannot board; these describe someone who may still
  // be in the water.
  roll_call_unfinished: 2,
  /** The same, for a crew member who boarded and has no result after a dive. */
  roll_call_crew_unfinished: 3,
  // **A blocked diver who is already on the boat** (issue #791). The gate is
  // behind them, not in front: whatever the blocker is, it is now a question
  // about somebody aboard, so it outranks every boarding-time blocker below.
  // It was a sentence on the departure card until 2026-10-05, beside a Needs
  // you row that told the same diver's blocker as if they were still ashore.
  // Its own step under the crew count, never a tie a sort could reverse.
  blocked_aboard: 3.5,
  // **A boat that left with somebody also rostered on another departure at
  // those hours** (H-20260916-may-one-hull-carry, issue #1814). Nobody has said anyone is missing, so it
  // sits under every roll-call row and under a blocked diver already aboard,
  // which is a named person with a known problem; but the manifest may name a
  // crew member who is on the other boat, and souls-on-board is read over the
  // radio, so it sits above every boarding-time blocker. Severity only breaks
  // ties: Needs you ranks tone first (`sortStationRows`), and every after-dive
  // roll-call row is danger where this is a warning, so a missing diver always
  // leads it (dive-domain-expert review, 2026-10-06). Read from the roster
  // (`crewClashesByTrip`), never from roll-call events: the subject rule above
  // is untouched.
  crew_clash_sailed: 3.7,
  medical_review: 4,
  // Tied with the hold it settles, deliberately. This table ranks by how long a
  // fix takes to land, and both answers put the same diver off the same boat —
  // the difference is what the shop does next, not how soon it must start.
  // `help_request` and `payment` already share a rank for the same reason.
  medical_not_cleared: 4,
  readiness_unavailable: 5,
  // An unconfirmed identity can hide a missing medical/cert for a different
  // human, so it ranks with the other hard safety gates, above card/waiver work.
  identity: 6,
  certification: 7,
  requirements: 8,
  waiver: 9,
  // **The three crew rows, worst first.** All of them ask one question — "is
  // anyone qualified assigned to supervise this water time" — and all three
  // rank above `nitrox_gate`, because nobody in the water outranks a single
  // diver's tank fill. They still sit below every kind above them: those
  // describe one diver's own evidence (a medical flag, an unconfirmed
  // identity, a card) which can take days to resolve, while a shop that
  // notices one of these can fix it in one tap on the crew editor if it has
  // anyone free to roster.
  //
  // A course session with nobody in the water is both of the other two at once
  // (issue #1338): the boat cannot run *and* the session cannot enrol. Nothing
  // else here is two gates.
  uncrewed_course: 10,
  // Divers booked, nobody in the water, fun dive (issue #732). Above
  // `instructor_missing` as of #1338, which reversed the order the two had
  // carried since #732 — that ordering was written when a zero-crew course
  // session took `instructor_missing`, so the row above it *was* this
  // situation and the rank was reading the right severity off the wrong code.
  // With `uncrewed_course` carrying that case, what is left at
  // `instructor_missing` is a session whose divers **are** supervised and
  // which cannot certify or enrol them — a sale and a signature, not a boat.
  uncrewed_departure: 11,
  // **One person rostered on two departures at once** (H-20260916-may-one-hull-carry, issue #1776). One
  // of the two boats will sail without them, so it sits beside the zero-crew
  // row rather than with the advisory ones; it ranks just under it because the
  // boat it names does have somebody rostered, and the fix is one call.
  // **Two departures on one hull at once** (H-20260916-may-one-hull-carry, issue #2135). The same fault
  // as the crew clash seen from the boat, and the move that makes one usually
  // makes the other, so it sits just above it: a hull cannot sail twice, a
  // person at least can be swapped.
  boat_clash: 11.25,
  crew_clash: 11.5,
  // **Rostered on a departure and away on a day it meets** (fourth review,
  // item 12). The person told the shop; the roster did not hear. Just under a
  // clash: a clash is the roster contradicting itself, this is the roster
  // contradicting somebody's note, and both are one call to fix.
  crew_away: 11.6,
  // A course session short of its instructor with somebody else in the water.
  // It refuses a sale (`course_unstaffed`, src/db/bookings.ts) and no
  // certification can be issued from it, which is why it is not merely
  // advisory — but its divers have a supervisor, so it ranks below the two
  // rows where nobody does.
  instructor_missing: 12,
  nitrox_gate: 13,
  // **The boat's own emergency kit, on a departure sailing today** (roadmap
  // N-08, dive-domain review 2026-10-09): no O2 kit or AED aboard, or oxygen,
  // AED or flares run out or about to. Beside the weather row, above every
  // dock count and desk chore: it is about the minutes after somebody is hurt
  // in the water, and it is fixed before the lines come off, not after.
  boat_safety_kit: 13.5,
  // **The shop's emergency card has no number on it** (fifth loop, item 3),
  // with a boat sailing inside the 48 hours the offline manifest is saved in.
  // Beside the boat's own kit: both are about the minutes after somebody is
  // hurt, and both are fixed ashore before the lines come off.
  emergency_card_blank: 13.6,
  high_wind_alert: 14,
  // **A boat's paper has lapsed** (H-20261015-lapsed-boat-papers-loud): hull insurance, registration or the
  // safety inspection past its date — the fact that makes a claim uncovered.
  // Loud, under the kit and the weather, and still never a gate.
  boat_papers_lapsed: 14.5,
  // The dock-side counts. An unfinished *departure* count is paperwork — the
  // boat is home and nobody was ever unaccounted for in the water — so it
  // deliberately sits far below the after-dive kinds above. Collapsing the
  // two into one row is what turns the red row into wallpaper (DOM-H3).
  roll_call_departure_open: 15,
  roll_call_not_started: 16,
  // **An incident report started and never filed** (safety sheet 2026-10-15,
  // item 3): somebody was hurt or nearly was, and the record sits as a private
  // draft while the insurer's notice window runs. Nobody is in the water, so it
  // ranks under every roll-call and boarding row; a written account of the
  // worst day outranks the desk's chores and every money row below.
  incident_report_unfiled: 16.5,
  // **No emergency contact on file** (visual review 2026-10-24, A43). Never a
  // boarding gate, and still the number somebody rings from the dock when a
  // diver is hurt, so it ranks above the prep and every money row below it:
  // a missing contact must not sit under "and N more" while an unpaid order
  // shows. It was 22, "dock-settleable", which put it under payment; the
  // order the station draws (`rankBoatRows`) already said contact first.
  emergency_contact: 16.75,
  dive_prep: 17,
  help_request: 18,
  payment: 18,
  email_delivery: 19,
  // A revenue opportunity (the wait list and the last-minute list as one row),
  // not anything blocking or dock-settleable.
  seat_wanted: 20,
  // Below-target crewing (issue #732): `divemasterRatioGap`'s own docblock
  // is explicit that the target "binds nothing" and is advice a shop may act
  // on or not, unlike `uncrewed_departure` above, which describes a
  // departure with nobody in the water at all. Ranked with the other purely
  // advisory, non-blocking rows so it reads as a nudge, not a problem.
  crew_below_target: 23,
  // Platform-health chores (task 157) — never a departure blocker, so they
  // sink below every per-diver row when severity is what breaks a tie.
  stuck_payment_operation: 24,
  failed_photo_deletion: 25,
  // Somebody is owed their money back for a departure the shop called off.
  // Ranked above the other two platform-health rows: a diver is waiting on
  // this one, and has already been told the shop would be in touch.
  owed_refund: 26,
  // A diver's bank is taking a charge back, and the shop has a deadline to
  // answer it (ADR 20261009-stripe-reversals-reach-diveday). Level with the
  // owed refund: both are money with somebody waiting on the shop.
  payment_dispute: 26,
  // Stripe turned the shop's card payments off (batch 6 item 8). Level with
  // the other money rows: nobody is in danger, but every booking from now on
  // is a seat paid for at the shop until the owner answers Stripe.
  payments_restricted: 26,
  // A diver wrote and nobody has written back (ADR 20260907-two-way-inbox).
  // Above the reviews queue and below the money rows: somebody asked the shop
  // a question and is waiting on the answer, which is more than a review asks
  // for and less than a refund owes.
  unanswered_messages: 27,
  // Divers said something worth publishing; nothing sails or refunds on it.
  reviews_pending: 28,
  // The gear register's rows (ADR 20260815-minimal-gear-register). All
  // counter work, never a boarding blocker — a unit that never came home
  // outranks one due back tonight, and both outrank a bench clock, because
  // that is the order the desk actually chases them in.
  gear_overdue: 29,
  gear_due_back: 30,
  gear_service_due: 31,
  // The owner's boat errands (roadmap N-08, N-10): a paper inside its window
  // (a lapsed one is `boat_papers_lapsed`, ranked with the boat's kit), and kit that ran out
  // ashore or on a boat not sailing today. Never a boarding blocker — the dock
  // decides — so they ride with the register's rows, ahead of the bench clock
  // because a dead AED pad is the boat's, not a rental's.
  boat_safety_expired: 31,
  boat_papers_due: 31.5,
  // **A snag the crew wrote against a boat's checklist** (fifth-loop ideas,
  // item 1): the radio that crackles, the ladder bolt. The owner's errand
  // beside the boat's papers; the crew read it on the boat check itself.
  boat_snag: 31.6,
  // The bench's two rows (ADR 20261008-work-order-follow-up). Below the
  // register's own chase list: a customer's regulator a day past its promise
  // is a phone call to make, not a unit missing from the racks, and a ticket
  // ready for a week is the gentlest chase of all.
  work_order_late: 32,
  work_order_uncollected: 33,
  staff_credential_due: 34,
  // Bottom of the queue, and rightly: this is a question nobody has answered
  // rather than anything that has gone wrong. It is here at all because the
  // first-run checklist that asked it stops rendering at the shop's first
  // departure — step 4 of that same checklist — so a shop that scheduled a
  // trip before opening the Units row would never be asked again, and currency
  // decides what a diver's card is charged in (issue #835).
  units_unconfirmed: 35,
  // **Something found aboard is waiting to go home** (fifth loop, item 7). A
  // courtesy the desk pays when the owner walks in; nothing has gone wrong.
  lost_items_waiting: 36,
  // Lower still, because it is a question about *yesterday's* boat rather than
  // anything today wants: a unit came home in a size the fit does not record,
  // and the shop may keep it or leave it (issue #1174, D14).
  rental_fit_confirm: 37,
};
