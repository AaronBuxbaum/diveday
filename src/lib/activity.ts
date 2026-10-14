/**
 * **What the shop's trail can say** — the closed set of things an
 * `activity_events` row records, and the names each one needs.
 *
 * Every row used to carry its own sentence, in English, built in `src/db` and
 * printed verbatim. That broke the rule this module exists to restore
 * (`.claude/rules/domain.md`: the data layer returns codes, never sentences),
 * and the guard that enforces it could not see the breach, because every one of
 * those sentences interpolated a name and `looksLikeCopy` skipped anything
 * interpolated (issue #1655). The consequence a shop met was simpler than the
 * rule: the whole trail read English whatever language the staffer had chosen,
 * on a surface a Spanish-speaking shop reads all day.
 *
 * So a row now holds a **code** and the **names** it needs, and the words are
 * picked where the trail is rendered — `src/i18n/activity-labels.ts` over the
 * `activity` staff namespace, the same shape as every other coded outcome in
 * the product.
 *
 * **The set is closed on purpose.** A writer that needs a sentence this file
 * does not have adds a code here and a line to both bundles, which is a
 * reviewable act. The alternative — one code carrying free text — is the hole
 * the old `message` column was, wearing a different name.
 */

/**
 * The parameters each code needs, by name.
 *
 * Values are **names as recorded at the time**, not ids: the trail is history,
 * and a line saying who did what in March should keep saying it after the
 * person is renamed. That is also why erasure has to reach in here — see
 * {@link ACTIVITY_REDACTED} and `src/db/anonymize.ts`.
 */
type ActivityParamShapes = {
  /** A diver arrived and a staffer recorded it. */
  counter_check_in: { diver: string };
  /** A staffer took an arrival back. */
  counter_check_in_undone: { diver: string };
  /** A staff-only note was written, on a seat or on a diver's record. */
  note_added: { actor: string; diver: string };
  /** That note was deleted. Soft, like every delete; the line stays. */
  note_deleted: { actor: string; diver: string };
  /**
   * A staffer attested that a booking flagged `identity_unconfirmed` really is
   * the diver it was attached to, **on the trip roster**. The trail is what
   * makes that tap safe: it hands a stranger a matched diver's waiver, cards
   * and prepaid dives, and every staff role can make it (`src/db/bookings.ts`,
   * `confirmBookingIdentity`).
   */
  identity_confirmed: { actor: string; diver: string };
  /**
   * …or answered "not the same person": the seat became a new diver of its
   * own, named `diver` (`splitBookingIdentity`). On the departure.
   */
  identity_split: { actor: string; diver: string };
  /** The same split, on the record the seat left; `diver` is that record's name. */
  identity_split_off: { actor: string; diver: string };
  /**
   * Two records were merged into one, on the record kept: `diver` is its name
   * after the merge, `merged` the name the other record carried
   * (`mergeDiverRecords`). The merged record's own lines stay on it.
   */
  diver_merged: { actor: string; diver: string; merged: string };
  /** A seat was taken off a departure. */
  booking_removed: { actor: string; diver: string };
  /** …and put back. */
  booking_restored: { actor: string; diver: string };
  /**
   * A staffer recorded that a diver never turned up. The tap is also the seat
   * release (issue #1209), so the trail is the only record of who released it
   * and when — the question asked when somebody else is sitting in that seat.
   */
  booking_no_show: { actor: string; diver: string };
  /** …and took it back, which puts the diver back on the expected list. */
  booking_no_show_undone: { actor: string; diver: string };
  /**
   * …or tried to and could not, because the seat was already gone.
   *
   * The only refusal in the product that gets a line of its own, and it earns
   * it: the release was real, so by the time somebody taps Undo the seat may
   * have been sold to the diver who was waiting for it, or the session may have
   * filled back up to its instructor ratio. What is left is a staffer at a desk
   * with a diver in front of them who cannot get back on, and until this code
   * existed that moment was recorded nowhere at all — the mark was on the trail,
   * the attempt to take it back was not, and the shop reconciling the departure
   * afterwards could only see that somebody was written off.
   *
   * `reason` is which limit refused, because the two ask for different next
   * acts: a sold seat means find the diver another boat, a full ratio means
   * find the session another instructor.
   */
  booking_no_show_undo_refused: {
    actor: string;
    diver: string;
    reason: "trip_full" | "divers_full" | "course_ratio_full";
  };
  /**
   * A staffer changed what a seated person is doing aboard (ADR
   * 20261007-participant-types): diving, snorkeling or riding along. Recorded
   * because the answer decides which gates the seat is asked to clear.
   */
  participant_type_changed: {
    actor: string;
    diver: string;
    from: "diver" | "snorkeler" | "rider";
    type: "diver" | "snorkeler" | "rider";
    certCheck: "none" | "cleared" | "overridden";
    cleared: string;
  };
  /**
   * …or the crew boarded them anyway, which takes it back at the rail. Its own
   * line rather than the undo above, because it says something the undo does
   * not: the boat carried somebody the desk had written off, which is exactly
   * what an owner reconciling a full departure needs to see.
   */
  booking_no_show_boarded: { actor: string; diver: string };
  /**
   * …or the crew reported them **not back aboard after a dive**, which also
   * takes the seat back — a diver who did not come back is one who sailed. Its
   * own line rather than the boarding above, because at 18:00 the two say
   * opposite things about where the person is: one was carried and walked off,
   * the other is who the day is still looking for.
   */
  booking_no_show_missing_after_dive: { actor: string; diver: string };
  /** Somebody was put on the crew for a departure. */
  crew_assigned: { actor: string; crew: string };
  /** …or taken off it. */
  crew_removed: { actor: string; crew: string };
  /** The weather called the day off. */
  blowout_called: { actor: string };
  /**
   * **An incident report was filed** on this departure (ADR
   * 20261012-incident-reports), or an addendum added to one. The actor only:
   * who was hurt and what happened stay in the report, behind its own gate.
   */
  incident_report_filed: { actor: string };
  incident_report_addendum_added: { actor: string };
  /** A staffer seated a diver. */
  seat_added: { actor: string; diver: string };
  /** …as a walk-in, which is the same act with a different story behind it. */
  seat_added_walk_in: { actor: string; diver: string };
  /** …by a diver, for a friend, from their own trip link (the actor is the lead). */
  seat_added_from_trip_link: { actor: string; diver: string };
  /** A staffer emailed a diver an invitation to this departure (the counter's "another day"). */
  departure_offered: { actor: string; diver: string };
  /**
   * …as a rider who turned up at the boat unrostered (batch 4, D6): the crew
   * added them from the manifest, so the line says where it happened.
   */
  rider_added_at_dock: { actor: string; diver: string };
  /** A staffer moved a diver's seat from this departure to another (ADR 20261013-staff-move-a-seat). */
  seat_moved_away: { actor: string; diver: string };
  /** …and the departure it moved to says where it came from. */
  seat_moved_here: { actor: string; diver: string };
  /** A staffer sent one note to everyone booked on the departure (batch 4, J4). */
  departure_note_sent: { actor: string };
  /** A diver asked for their booking link again. */
  booking_link_requested: { actor: string };
  /** A diver claimed the seat somebody else had booked for them. */
  seat_claimed: { actor: string };
  /** A diver gave up their own seat from their trip-prep link, with no card refund. */
  seat_self_cancelled: { actor: string };
  /** …and the shop's cancellation window refunded them by card. */
  seat_self_refunded: { actor: string };
  /** A party lead's own cancel took an unclaimed seat they booked with it (batch 6 item 10). */
  party_seat_self_cancelled: { actor: string; diver: string };
  /** …and the shop's cancellation window refunded that seat by card. */
  party_seat_self_refunded: { actor: string; diver: string };
  /** A staffer opened a diver's physician's evaluation. */
  medical_clearance_opened: { actor: string; diver: string };
  /** A staffer downloaded a diver's own record. */
  record_exported: { actor: string; diver: string };
  /**
   * A staffer marked a diver running late from a message they wrote (UX
   * review 2026-10-13, item 19), so the roster's "said {time}" has a name
   * behind it that is not the diver's own tap.
   */
  running_late_from_message: { actor: string; diver: string };
  /**
   * **Money a staffer decided about**, below — the lines the shop's activity
   * log (`src/db/shop-activity.ts`) exists to answer "who refunded this?"
   * with. Nothing recorded the person behind any of them before: the payment
   * trail (`booking_payment_events`) and the order row hold what moved, never
   * who moved it.
   *
   * A staff order refunded through Stripe, whole or in part. No diver name:
   * the order is the line's object (`activity_events.order_id`), and its
   * customer's name lives on that row, where an erasure scrubs it.
   */
  order_refunded: { actor: string };
  /**
   * Money a card paid on a checkout DiveDay had already closed, sent back from
   * the Orders index (issue #2335). On the departure the checkout was for.
   */
  paid_after_close_refunded: { actor: string };
  /** A removed seat's payment was refunded by card, inside the shop's window. */
  seat_refunded: { actor: string; diver: string };
  /** A seat was marked waived: a free place, the shop's call. */
  payment_waived: { actor: string; diver: string };
  /** A seat was marked refunded without moving money through DiveDay. */
  payment_marked_refunded: { actor: string; diver: string };
  /**
   * A seat was marked Paid on less than it owed, or on nothing past a hand
   * deposit: the rest of the fare written off, the shop's call (batch 6).
   */
  payment_balance_written_off: { actor: string; diver: string };
  /**
   * **Who changed the board**: the schedule builder's four acts, which wrote
   * no actor anywhere until the activity log asked. Each is recorded on the
   * departure it changed; a repeating departure is one line, on its first
   * instance, rather than one per week it repeats.
   */
  departure_added: { actor: string };
  series_added: { actor: string };
  departure_moved: { actor: string };
  departure_copied: { actor: string };
  departure_deleted: { actor: string };
  /**
   * The departure came off the board with the rest of its repeating run
   * ("Cancel every upcoming date"), through the blow-out cascade.
   */
  series_cancelled: { actor: string };
  /**
   * **The shop answered a review in public** (batch 4, K2): wrote the reply
   * under it, changed it, or took it down. Filed on the departure the review
   * is about, and naming no reviewer, like the moderation lines beside it.
   */
  review_replied: { actor: string };
  review_reply_edited: { actor: string };
  review_reply_deleted: { actor: string };
  /**
   * An erasure ran over this line.
   *
   * A code rather than a blanked payload, so the row reads the same way it
   * always has — one word, no verb, nothing about the person who asked to be
   * forgotten. See `src/db/anonymize.ts`.
   */
  redacted: Record<string, never>;
  /**
   * **The demo's own history**, below.
   *
   * These are the lines the seeded shop shows a visitor: work a real dive shop
   * does at a desk and DiveDay does not record for itself. They are codes for
   * the same reason the rest are — the demo is the surface an evaluating shop
   * reads all day, and a Spanish-speaking one should not have to read its trail
   * in English to decide whether to buy. Nothing in `src/app` writes them.
   */
  demo_charter_confirmed: { actor: string };
  demo_second_dive_moved: { actor: string };
  demo_tanks_counted: { actor: string };
  demo_crew_briefed: { actor: string };
  demo_deposit_taken: { actor: string; diver: string };
  demo_release_sent: { actor: string; diver: string };
  demo_release_returned: { actor: string; diver: string };
  demo_card_checked: { actor: string; diver: string };
  demo_kit_reserved: { actor: string; diver: string };
  demo_called_about_time: { actor: string; diver: string };
  demo_moved_to_second_boat: { actor: string; diver: string };
  demo_briefing_walked: { actor: string; diver: string };
  demo_balance_taken: { actor: string; diver: string };
  demo_driving_noted: { actor: string; diver: string };
  demo_bcd_swapped: { actor: string; diver: string };
  demo_nitrox_logged: { actor: string; diver: string };
  demo_own_computer_confirmed: { actor: string; diver: string };
  demo_paper_card_reminded: { actor: string; diver: string };
};

export type ActivityCode = keyof ActivityParamShapes;

/**
 * A code and exactly the names it needs — the shape a writer hands the table
 * and a renderer reads back.
 *
 * Written as a discriminated union rather than `{ code: ActivityCode; params:
 * Record<string, string> }` so a writer that forgets `diver` is a compile
 * error at the call site rather than an empty gap in a sentence on a shop's
 * screen.
 */
export type ActivityEntry = {
  [Code in ActivityCode]: { code: Code; params: ActivityParamShapes[Code] };
}[ActivityCode];

/** Every code, for the guard tests that hold the union and the bundles together. */
export const ACTIVITY_CODES = [
  "counter_check_in",
  "counter_check_in_undone",
  "note_added",
  "note_deleted",
  "booking_removed",
  "booking_restored",
  "booking_no_show",
  "booking_no_show_undone",
  "booking_no_show_undo_refused",
  "participant_type_changed",
  "booking_no_show_boarded",
  "booking_no_show_missing_after_dive",
  "identity_confirmed",
  "identity_split",
  "identity_split_off",
  "crew_assigned",
  "crew_removed",
  "blowout_called",
  "incident_report_filed",
  "incident_report_addendum_added",
  "seat_added",
  "seat_added_walk_in",
  "seat_added_from_trip_link",
  "departure_offered",
  "rider_added_at_dock",
  "seat_moved_away",
  "seat_moved_here",
  "departure_note_sent",
  "booking_link_requested",
  "seat_claimed",
  "seat_self_cancelled",
  "seat_self_refunded",
  "party_seat_self_cancelled",
  "party_seat_self_refunded",
  "medical_clearance_opened",
  "record_exported",
  "running_late_from_message",
  "order_refunded",
  "paid_after_close_refunded",
  "seat_refunded",
  "payment_waived",
  "payment_marked_refunded",
  "payment_balance_written_off",
  "departure_added",
  "series_added",
  "departure_moved",
  "departure_copied",
  "departure_deleted",
  "series_cancelled",
  "review_replied",
  "review_reply_edited",
  "review_reply_deleted",
  "redacted",
  "demo_charter_confirmed",
  "demo_second_dive_moved",
  "demo_tanks_counted",
  "demo_crew_briefed",
  "demo_deposit_taken",
  "demo_release_sent",
  "demo_release_returned",
  "demo_card_checked",
  "demo_kit_reserved",
  "demo_called_about_time",
  "demo_moved_to_second_boat",
  "demo_briefing_walked",
  "demo_balance_taken",
  "demo_driving_noted",
  "demo_bcd_swapped",
  "demo_nitrox_logged",
  "demo_own_computer_confirmed",
  "demo_paper_card_reminded",
] as const satisfies readonly ActivityCode[];

/** What an erased line becomes. One statement in the erasure transaction sets both. */
export const ACTIVITY_REDACTED = {
  code: "redacted",
  params: {},
} as const satisfies ActivityEntry;

/**
 * Whether a stored value is a code this build knows.
 *
 * The column is text rather than an enum — a new code should not need a
 * migration — so a row written by a newer build and read by an older one is
 * possible in the seconds a deploy takes. The renderer answers that with the
 * one sentence it can honestly write rather than a crash or a raw code on
 * screen; see `src/i18n/activity-labels.ts`.
 */
export function isActivityCode(value: string): value is ActivityCode {
  return (ACTIVITY_CODES as readonly string[]).includes(value);
}

/**
 * The names in an entry, as stored: a flat map of strings.
 *
 * The column is `jsonb` and Postgres will hand back whatever was written, so
 * the renderer reads through this rather than trusting the type. A missing name
 * renders as an empty placeholder, which is a gap in a sentence — bad, but
 * bounded, and better than a thrown error taking a whole page down over one
 * line of history.
 */
export function activityParams(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
