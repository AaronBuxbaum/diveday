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
  /** A diver recorded their own arrival on the lobby tablet. */
  kiosk_check_in: { diver: string };
  /** A staffer took an arrival back. */
  counter_check_in_undone: { diver: string };
  /** A staff-only note was written, on a seat or on a diver's record. */
  note_added: { actor: string; diver: string };
  /** That note was deleted. Soft, like every delete; the line stays. */
  note_deleted: { actor: string; diver: string };
  /** What to set up for a diver's dives was answered, by staff or by the diver. */
  support_needs_updated: { actor: string; diver: string; self: "yes" | "no" };
  /** The same answers were cleared. */
  support_needs_cleared: { actor: string; diver: string; self: "yes" | "no" };
  /**
   * A staffer attested that a booking flagged `identity_unconfirmed` really is
   * the diver it was attached to. The trail is what makes that tap safe: it
   * hands a stranger a matched diver's waiver, cards and prepaid dives, and
   * every staff role can make it (`src/db/bookings.ts`, `confirmBookingIdentity`).
   */
  identity_confirmed: { actor: string; diver: string };
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
  /** Somebody was put on the crew for a departure. */
  crew_assigned: { actor: string; crew: string };
  /** …or taken off it. */
  crew_removed: { actor: string; crew: string };
  /** The weather called the day off. */
  blowout_called: { actor: string };
  /** A staffer seated a diver. */
  seat_added: { actor: string; diver: string };
  /** …as a walk-in, which is the same act with a different story behind it. */
  seat_added_walk_in: { actor: string; diver: string };
  /** A diver asked for their booking link again. */
  booking_link_requested: { actor: string };
  /** A diver claimed the seat somebody else had booked for them. */
  seat_claimed: { actor: string };
  /** A staffer opened a diver's physician's evaluation. */
  medical_clearance_opened: { actor: string; diver: string };
  /** A staffer downloaded a diver's own record. */
  record_exported: { actor: string; diver: string };
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
  "kiosk_check_in",
  "counter_check_in_undone",
  "note_added",
  "note_deleted",
  "support_needs_updated",
  "support_needs_cleared",
  "booking_removed",
  "booking_restored",
  "booking_no_show",
  "booking_no_show_undone",
  "identity_confirmed",
  "crew_assigned",
  "crew_removed",
  "blowout_called",
  "seat_added",
  "seat_added_walk_in",
  "booking_link_requested",
  "seat_claimed",
  "medical_clearance_opened",
  "record_exported",
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
