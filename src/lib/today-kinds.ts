import type { Role } from "./authz";

/**
 * **What a Today row can be, and who may act on it.** The two tables below the
 * queue's whole vocabulary: `src/lib/today.ts` ranks and groups rows, but a
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
