/**
 * **Every column that references `people`, and what a diver merge does with it**
 * (issue #2724).
 *
 * One row per column, so the person's data story reads in one place and a column
 * added tomorrow fails one guard with one message
 * (`person-columns.test.ts`: every foreign key to `people`, and every column
 * named `%person_id`, has a row; every row names a live column). `kind` says who
 * the column names, and `merge` says what `mergeDiverRecords` does with it. The
 * erasure (`anonymize.ts`), the export and the reap each keep their own lists
 * for now and follow into this registry one at a time; this is the first slice.
 *
 * ## `kind`
 *
 * - `subject`: the person the row is about; a diver's own history.
 * - `actor`: who did a thing (`recorded_by`, `created_by`, `deleted_by`, `issued_by`,
 *   `reviewed_by`, `decided_by`, ...). Operational evidence about the *shop*, on the
 *   same ground `anonymizeDiver` refuses to erase a staff member at all.
 * - `crew`: somebody who works the boats, named by what they do on one.
 * - `login`: a sign-in or device that belongs to a staff account.
 *
 * ## `merge`
 *
 * - `move`: a bare `person_id` repointed at the survivor, in the order the rows
 *   appear. `singleton` marks a table that is one row per person, where the kept
 *   record's row wins (or the chosen one) and the other is deleted first so the
 *   repoint cannot raise 23505 and roll the whole merge back to `record_conflict`.
 * - `refuse`: a staff record. A row on either side stops the merge
 *   (`staff_record`). `withoutShop` marks a table with no `shop_id` to scope by.
 * - `leave`: stays on the id it had, and `why` says why. Two reasons cover most
 *   of the list. **Attribution**: who did a thing is evidence about the shop, and a
 *   merge involving somebody who has any of it is refused by the `refuse` rows
 *   long before it matters. **Subject on an event trail**
 *   (`activity_events.subject_person_id`, `trip_desk_events.subject_person_id`):
 *   a trail records what happened, not what is true now, and repointing the
 *   subject would make the shop's history claim the survivor was the subject of an
 *   act performed against a record that had a different name at the time.
 * - `delete`: dropped on merge. A sealed retry that names the source cannot
 *   transfer its authority to the survivor.
 *
 * Every erasure-, export- and reap-shaped fate stays in its own module until its
 * slice lands; adding one here before then would be a second list nobody reads.
 */

export type PersonColumnKind = "subject" | "actor" | "crew" | "login";
export type PersonColumnMerge = "move" | "refuse" | "leave" | "delete";

export type PersonColumn = {
  table: string;
  column: string;
  kind: PersonColumnKind;
  merge: PersonColumnMerge;
  /** Required for `leave` and `delete`: the reason the merge does not move it. */
  why?: string;
  /** `move` only: one row per person, so the survivor's wins before the repoint. */
  singleton?: true;
  /** `refuse` only: the table has no `shop_id`, so the check is by person alone. */
  withoutShop?: true;
};

const rows = [
  // ---- Moved: the diver's own history, repointed at the survivor (bare `person_id`, in this order).
  // What the bench told this diver about their own gear (ADR
  // 20261008-work-order-follow-up). It follows the gear and the tickets to the
  // survivor, or the survivor's ticket would read as never announced and the
  // next pass would remind them a second time about a date already covered.
  { table: "customer_gear_notices", column: "person_id", kind: "subject", merge: "move" },
  { table: "bookings", column: "person_id", kind: "subject", merge: "move" },
  { table: "internal_notes", column: "person_id", kind: "subject", merge: "move" },
  { table: "interests", column: "person_id", kind: "subject", merge: "move" },
  // A courtesy-email unsubscribe link (`purpose = 'courtesy_email_unsubscribe'`)
  // follows the person, so a link the source was mailed still opts the kept
  // record out. Rows of other purposes leave `person_id` null.
  { table: "capabilities", column: "person_id", kind: "subject", merge: "move" },
  { table: "dive_package_entitlements", column: "person_id", kind: "subject", merge: "move" },
  { table: "orders", column: "person_id", kind: "subject", merge: "move" },
  { table: "waiver_records", column: "person_id", kind: "subject", merge: "move" },
  // A signed course form, on the booking that moves with it (ADR
  // 20261008-course-forms). `person_id` is inside its seal, so it moves
  // through `refileCourseFormRecords`, which re-seals only a record that
  // verified before the move; its unique key is per booking, so the two
  // sides cannot collide.
  { table: "course_form_records", column: "person_id", kind: "subject", merge: "move" },
  { table: "certifications", column: "person_id", kind: "subject", merge: "move" },
  { table: "certification_junior_reviews", column: "person_id", kind: "subject", merge: "move" },
  { table: "specialty_certifications", column: "person_id", kind: "subject", merge: "move" },
  { table: "prior_visits", column: "person_id", kind: "subject", merge: "move" },
  { table: "imported_payment_history", column: "person_id", kind: "subject", merge: "move" },
  {
    table: "rental_fit_profiles",
    column: "person_id",
    kind: "subject",
    merge: "move",
    singleton: true,
  },
  // A bookingless counter rental names the diver directly (the other shape
  // names a booking, which this merge moves anyway). Leaving it behind put the
  // unit on a removed diver's record: the survivor's prep page showed no gear
  // and the reservation still held the window.
  { table: "gear_reservations", column: "person_id", kind: "subject", merge: "move" },
  // A diver's own gear on file, and the service tickets about it (ADR
  // 20261008-gear-work-orders). Both name the diver directly, and both are
  // the diver's — the shop is holding the regulator of whoever the survivor
  // is. Leaving them behind would hide a ticket the shop is still working
  // from the record the counter now opens.
  { table: "customer_gear_items", column: "person_id", kind: "subject", merge: "move" },
  { table: "work_orders", column: "person_id", kind: "subject", merge: "move" },
  { table: "prior_gear_assignments", column: "person_id", kind: "subject", merge: "move" },
  { table: "nitrox_certifications", column: "person_id", kind: "subject", merge: "move" },
  { table: "trip_reviews", column: "person_id", kind: "subject", merge: "move" },
  // The private half of the same act (ADR 20260904-reef-all-the-way-down,
  // D40): the diver's own word about how the day went, on the booking they
  // sat in. It moves for the reason the review above it does — it is the
  // diver's, not the shop's — and it cannot collide, because the live-row
  // unique index is per *booking*, and the bookings move with them.
  { table: "recap_pulses", column: "person_id", kind: "subject", merge: "move" },
  { table: "trip_blowout_divers", column: "person_id", kind: "subject", merge: "move" },
  // The diver's own messages and the shop's answers to them (ADR
  // 20260907-two-way-inbox). A merge is the shop saying two records are one
  // person, and a conversation with that person belongs on the record that
  // survives — otherwise the survivor's thread opens on silence while the
  // "running late" the crew acted on sits on a record nobody opens.
  { table: "inbound_messages", column: "person_id", kind: "subject", merge: "move" },
  { table: "staff_replies", column: "person_id", kind: "subject", merge: "move" },
  // Something the crew found aboard with this diver's name on it (batch 4,
  // J2). It is the diver's, so it follows them: the survivor is who gets told.
  { table: "lost_items", column: "person_id", kind: "subject", merge: "move" },
  // ---- Refused: a staff record on either side stops the merge.
  { table: "staff_shifts", column: "person_id", kind: "crew", merge: "refuse" },
  { table: "staff_credentials", column: "person_id", kind: "crew", merge: "refuse" },
  { table: "account_sessions", column: "person_id", kind: "login", merge: "refuse" },
  { table: "calendar_feeds", column: "person_id", kind: "login", merge: "refuse" },
  { table: "roll_call_events", column: "crew_person_id", kind: "crew", merge: "refuse" },
  // Retired by issue #2700 (no reader or writer); dropped next release.
  { table: "roll_call_crew_events", column: "person_id", kind: "crew", merge: "refuse" },
  { table: "push_subscriptions", column: "person_id", kind: "login", merge: "refuse" },
  // The staffing week's own two tables (issue #1235). Both are written by, and
  // about, somebody who crews boats — a days-away block or an ask for a
  // departure — so either side of a merge holding one is a staff record and the
  // merge is refused, exactly as a seeded shift refuses it.
  { table: "crew_availability_blocks", column: "person_id", kind: "crew", merge: "refuse" },
  { table: "crew_assignment_requests", column: "person_id", kind: "crew", merge: "refuse" },
  // "Working it anyway" on a departure (issue #2678): its subject is somebody
  // on a crew, so a record holding one is a staff record and the merge is refused.
  { table: "crew_away_acknowledgements", column: "person_id", kind: "crew", merge: "refuse" },
  // Where a *staffer* had read up to in a departure's shift catch-up (issues
  // #1202, #1187). Same shape as `push_subscriptions` above it: written by, and
  // about, somebody who works the boats, so either side of a merge holding one
  // is a staff record and the merge is refused rather than carried across.
  { table: "trip_read_marks", column: "person_id", kind: "crew", merge: "refuse" },
  { table: "today_read_marks", column: "person_id", kind: "crew", merge: "refuse" },
  // The Monday email's claims (`src/db/weekly-digest.ts`). Only somebody with
  // a staff login is ever sent one, so a record holding one is a staff record
  // and the merge is refused, like the calendar feed above.
  { table: "weekly_digest_sends", column: "person_id", kind: "crew", merge: "refuse" },
  // Crew news waiting to be told (ADR 20261009-crew-hear-about-their-boats).
  // Only somebody on a crew is ever its subject, so either side of a merge
  // holding one is a staff record and the merge is refused.
  { table: "crew_notices", column: "person_id", kind: "crew", merge: "refuse" },
  // A staffer named in an incident report (ADR 20261012-incident-reports). A
  // diver is named there by booking, which moves with the seat; only staff are
  // named by person, so a record holding one is a staff record.
  { table: "incident_report_people", column: "person_id", kind: "crew", merge: "refuse" },
  // A repeating trip's standing crew (`trip_series_crew`): only staff sail on
  // it, so a record holding one is a staff record and the merge is refused.
  { table: "trip_series_crew", column: "person_id", kind: "crew", merge: "refuse" },
  {
    table: "trip_assignments",
    column: "person_id",
    kind: "crew",
    merge: "refuse",
    withoutShop: true,
  },
  {
    table: "user_accounts",
    column: "person_id",
    kind: "login",
    merge: "refuse",
    withoutShop: true,
  },
  // ---- Left where it is, on purpose: bare `person_id` columns the merge does not touch.
  {
    table: "person_roles",
    column: "person_id",
    kind: "subject",
    merge: "leave",
    why: "a role belongs to the identity, not to its history",
  },
  {
    table: "integration_oauth_states",
    column: "person_id",
    kind: "login",
    merge: "leave",
    why: "ephemeral staff OAuth state, consumed within minutes",
  },
  {
    table: "processor_erasure_obligations",
    column: "person_id",
    kind: "subject",
    merge: "leave",
    why: "provenance for an erasure, and anonymized rows never merge",
  },
  {
    table: "form_drafts",
    column: "person_id",
    kind: "actor",
    merge: "leave",
    why: "a staffer's own half-typed form, gone in a day",
  },
  // ---- Left where it is, on purpose: attribution and event-trail columns.
  {
    table: "certification_junior_reviews",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "the staff member who sighted the card",
  },
  {
    table: "certifications",
    column: "junior_status_verified_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "the staff member who sighted the card",
  },
  {
    table: "activity_events",
    column: "actor_person_id",
    kind: "actor",
    merge: "leave",
    why: "who did it \u2014 attribution, not diver history",
  },
  {
    table: "activity_events",
    column: "subject_person_id",
    kind: "subject",
    merge: "leave",
    why: "an event trail records who it happened to at the time",
  },
  {
    table: "bookings",
    column: "fly_safe_acknowledged_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer resolved the flying-guidance follow-up",
  },
  {
    table: "bookings",
    column: "course_next_step_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which instructor wrote the student their next step",
  },
  {
    table: "bookings",
    column: "course_materials_done_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer marked the materials done",
  },
  {
    table: "bookings",
    column: "training_plan_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "planning records involving a merged person are cleared",
  },
  {
    table: "bookings",
    column: "training_plan_instructor_person_id",
    kind: "actor",
    merge: "leave",
    why: "planning records involving a merged person are cleared",
  },
  {
    table: "trip_assignments",
    column: "training_plan_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "planning records involving a merged person are cleared",
  },
  {
    table: "trip_assignments",
    column: "training_plan_instructor_person_id",
    kind: "actor",
    merge: "leave",
    why: "planning records involving a merged person are cleared",
  },
  {
    table: "bookings",
    column: "training_marked_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer marked the dive as training",
  },
  {
    table: "bookings",
    column: "training_cleared_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer cleared a training mark with forms owed",
  },
  {
    table: "trip_assignments",
    column: "assigned_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer rostered the crew member",
  },
  {
    table: "buddy_team_members",
    column: "crew_person_id",
    kind: "crew",
    merge: "leave",
    why: "a crew member on a team, refused as a staff record",
  },
  {
    table: "booking_arrival_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who checked the diver in at the counter",
  },
  {
    table: "booking_payment_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who marked the payment by hand",
  },
  {
    table: "booking_payments",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who marked the payment by hand",
  },
  {
    table: "boat_snags",
    column: "fixed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who said the boat's snag was fixed",
  },
  {
    table: "boat_snags",
    column: "noted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the boat's snag",
  },
  {
    table: "boat_snags",
    column: "still_there_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who found the boat's snag still there",
  },
  {
    table: "buddy_team_members",
    column: "paired_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who built the team",
  },
  {
    table: "buddy_team_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who recorded the team change",
  },
  {
    table: "certifications",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who removed the card",
  },
  {
    table: "certifications",
    column: "issued_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who entered the card",
  },
  {
    table: "certifications",
    column: "processed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who told the agency about the card",
  },
  {
    table: "certifications",
    column: "reviewed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who confirmed the card",
  },
  {
    table: "crew_assignment_requests",
    column: "decided_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who answered the ask",
  },
  {
    table: "crew_away_acknowledgements",
    column: "acknowledged_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who said the crew member is working it anyway",
  },
  {
    table: "crew_away_acknowledgements",
    column: "cleared_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who said they are no longer working it",
  },
  {
    table: "crew_notices",
    column: "actor_person_id",
    kind: "actor",
    merge: "leave",
    why: "who made the crew change",
  },
  {
    table: "crew_availability_blocks",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who blocked the days",
  },
  {
    table: "dive_packages",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the package",
  },
  {
    table: "dive_sites",
    column: "planning_note_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote down what the site was like",
  },
  {
    table: "executed_dives",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who deleted the logged dive",
  },
  {
    table: "executed_dives",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who logged the dive",
  },
  {
    table: "customer_gear_items",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who removed the piece from the record",
  },
  {
    table: "gear_items",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who retired the unit",
  },
  {
    table: "gear_reservations",
    column: "released_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who let go of the hold",
  },
  {
    table: "gear_reservations",
    column: "fill_recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who recorded a counter tank's gas",
  },
  {
    table: "gear_service_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who serviced the unit",
  },
  {
    table: "incident_report_addenda",
    column: "author_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the addendum",
  },
  {
    table: "incident_reports",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who started the incident report",
  },
  {
    table: "incident_reports",
    column: "filed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who filed the incident report",
  },
  {
    table: "incident_reports",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who deleted the unfiled incident draft",
  },
  {
    table: "incident_reports",
    column: "missing_alert_raised_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who alerted the owners from the roll call",
  },
  {
    table: "incident_reports",
    column: "missing_found_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who marked the missing person found",
  },
  {
    table: "internal_notes",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the note",
  },
  {
    table: "marine_life_requests",
    column: "requested_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer asked for the species",
  },
  {
    table: "nitrox_certifications",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who removed the card",
  },
  {
    table: "nitrox_certifications",
    column: "issued_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who entered the card",
  },
  {
    table: "nitrox_certifications",
    column: "processed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who told the agency about the card",
  },
  {
    table: "nitrox_certifications",
    column: "reviewed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who confirmed the card",
  },
  {
    table: "orders",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who took the order",
  },
  {
    table: "people",
    column: "anonymized_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "provenance for an erasure, and anonymized rows never merge",
  },
  {
    table: "people",
    column: "merged_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who ran a merge",
  },
  {
    table: "people",
    column: "merged_into_person_id",
    kind: "subject",
    merge: "leave",
    why: "the merge pointer itself \u2014 structural, and what makes the shell resolve",
  },
  {
    table: "people",
    column: "no_certification_cleared_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who cleared the no-card stamp",
  },
  {
    table: "people",
    column: "drysuit_experience_seen_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who saw the diver dive dry (#2136)",
  },
  {
    table: "people",
    column: "adult_attested_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who said the diver is 18 or older (H-20261007-held-seat-split-into)",
  },
  {
    table: "shops",
    column: "shore_alert_consent_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who recorded the shore contact's consent (H-20261014-stale-roll-call-recipients)",
  },
  {
    table: "shops",
    column: "bookkeeper_email_set_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who set the bookkeeper's address (item 35)",
  },
  {
    table: "pre_departure_check_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who ticked the check",
  },
  {
    table: "pre_departure_checklist_items",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who removed the check",
  },
  {
    table: "notification_send_queue",
    column: "actor_person_id",
    kind: "actor",
    merge: "leave",
    why: "who tapped Send on a held send; the hold lives eight seconds and settles to null",
  },
  {
    table: "processor_erasure_obligations",
    column: "discharged_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who discharged the obligation",
  },
  {
    table: "recap_pulses",
    column: "addressed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer picked the pulse up",
  },
  {
    table: "staff_replies",
    column: "sent_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer wrote the reply",
  },
  {
    table: "email_bounces",
    column: "sent_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer's action sent the mail that bounced",
  },
  {
    table: "review_moderation_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who published or withheld the review",
  },
  {
    table: "review_replies",
    column: "written_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer wrote the shop's reply",
  },
  {
    table: "roll_call_crew_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who called the crew roll",
  },
  {
    table: "roll_call_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who called the roll",
  },
  {
    table: "shop_promo_codes",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the code",
  },
  {
    table: "specialty_certifications",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who removed the card",
  },
  {
    table: "specialty_certifications",
    column: "issued_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who entered the card",
  },
  {
    table: "specialty_certifications",
    column: "processed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who told the agency about the card",
  },
  {
    table: "specialty_certifications",
    column: "reviewed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who confirmed the card",
  },
  {
    table: "staff_credentials",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who removed the credential",
  },
  {
    table: "staff_credentials",
    column: "reviewed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who confirmed the credential",
  },
  {
    table: "staff_shifts",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the shift",
  },
  {
    table: "trip_blowouts",
    column: "called_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who called the blow-out",
  },
  {
    table: "trip_change_events",
    column: "actor_person_id",
    kind: "actor",
    merge: "leave",
    why: "who changed the departure",
  },
  {
    table: "trip_desk_events",
    column: "actor_person_id",
    kind: "actor",
    merge: "leave",
    why: "who did it at the desk",
  },
  {
    table: "trip_desk_events",
    column: "subject_person_id",
    kind: "subject",
    merge: "leave",
    why: "an event trail records who it happened to at the time",
  },
  {
    table: "trip_help_requests",
    column: "helper_person_id",
    kind: "crew",
    merge: "leave",
    why: "which crew member the desk confirmed would help; staff assignment attribution stays with that person",
  },
  {
    table: "trip_help_requests",
    column: "resolved_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who answered the ask",
  },
  {
    table: "interests",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who raised the interest or sent the offer",
  },
  {
    table: "trip_last_minute_promos",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the deal",
  },
  {
    table: "trip_recap_photos",
    column: "uploaded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who uploaded the photo",
  },
  {
    table: "trip_sightings",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who took the mis-tapped sighting back",
  },
  {
    table: "trip_sightings",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which crew member tapped the chip",
  },
  {
    table: "trip_stage_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who said where the boat was",
  },
  {
    table: "customer_gear_notices",
    column: "sent_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who pressed Resend on a ready message",
  },
  {
    table: "customer_gear_reminder_settings",
    column: "changed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who switched a piece's reminders",
  },
  {
    table: "work_order_bills",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who sent the bill",
  },
  {
    table: "work_order_events",
    column: "actor_person_id",
    kind: "actor",
    merge: "leave",
    why: "who moved the ticket",
  },
  {
    table: "work_order_events",
    column: "technician_person_id",
    kind: "crew",
    merge: "leave",
    why: "which technician the ticket was handed to",
  },
  {
    table: "work_orders",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who deleted the ticket",
  },
  {
    table: "work_orders",
    column: "outcome_recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which technician recorded the work done",
  },
  {
    table: "work_orders",
    column: "technician_person_id",
    kind: "crew",
    merge: "leave",
    why: "which technician is working it \u2014 a staff assignment",
  },
  {
    table: "waiver_materiality_decisions",
    column: "actor_person_id",
    kind: "actor",
    merge: "leave",
    why: "who judged the answer material",
  },
  {
    table: "waiver_records",
    column: "anonymized_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "provenance for an erasure on a signed release",
  },
  {
    table: "waiver_records",
    column: "medical_clearance_declined_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who declined the clearance",
  },
  {
    table: "waiver_records",
    column: "guardian_email_erased_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who erased the guardian's address; inside its seal",
  },
  {
    table: "waiver_records",
    column: "medical_cleared_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who cleared the medical answer",
  },
  {
    table: "waiver_records",
    column: "moved_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who refiled the release with its split seat",
  },
  {
    table: "waiver_records",
    column: "moved_from_person_id",
    kind: "actor",
    merge: "leave",
    why: "where a refiled release sat before; inside its seal",
  },
  {
    table: "waiver_records",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who witnessed the signature",
  },
  {
    table: "course_form_records",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who recorded the paper form",
  },
  {
    table: "lost_items",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which crew member found the item",
  },
  {
    table: "lost_items",
    column: "resolved_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who handed it back or let it go",
  },
  {
    table: "departure_notes",
    column: "sent_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who sent the note to the departure",
  },
  {
    table: "course_form_records",
    column: "anonymized_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who erased the signer's names from the form",
  },
  {
    table: "course_form_versions",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote that version of the form",
  },
  {
    table: "rental_fit_profiles",
    column: "fit_confirmed_by",
    kind: "actor",
    merge: "leave",
    why: "who confirmed the fit at the counter",
  },
  {
    table: "rental_fit_profiles",
    column: "needs_staff_fit_by",
    kind: "actor",
    merge: "leave",
    why: "who asked for a hands-on fitting",
  },
  // ---- Deleted: a sealed retry that names the source cannot be handed to the survivor.
  {
    table: "notification_send_queue",
    column: "recipient_person_id",
    kind: "subject",
    merge: "delete",
    why: "sealed retries retain the source subject and cannot transfer authority",
  },
] as const satisfies readonly PersonColumn[];

type Row = (typeof rows)[number];

/** The registry, in the order the merge walks it. */
export const PERSON_COLUMNS: readonly PersonColumn[] = rows;

export type MovedPersonTable = Extract<Row, { merge: "move" }>["table"];
export type RefusedPersonTable = Extract<Row, { merge: "refuse"; withoutShop?: never }>["table"];
export type RefusedPersonOnlyTable = Extract<Row, { withoutShop: true }>["table"];
export type SingletonPersonTable = Extract<Row, { singleton: true }>["table"];

/** The tables whose bare `person_id` the merge repoints, in order. */
export function movedPersonTables(): MovedPersonTable[] {
  return rows.filter((row) => row.merge === "move").map((row) => row.table) as MovedPersonTable[];
}

/** One-row-per-person tables among them. */
export function singletonPersonTables(): SingletonPersonTable[] {
  return rows.filter((row) => "singleton" in row).map((row) => row.table) as SingletonPersonTable[];
}

/** Staff tables scoped by shop whose rows on either side refuse the merge. */
export function refusedPersonTables(): { table: RefusedPersonTable; column: string }[] {
  return rows
    .filter((row) => row.merge === "refuse" && !("withoutShop" in row))
    .map((row) => ({ table: row.table as RefusedPersonTable, column: row.column }));
}

/** Staff tables with no `shop_id` whose rows on either side refuse the merge. */
export function refusedPersonOnlyTables(): RefusedPersonOnlyTable[] {
  return rows
    .filter((row) => "withoutShop" in row)
    .map((row) => row.table) as RefusedPersonOnlyTable[];
}

/** `table.column` for every row, the key the guards and the docs use. */
export function personColumnKey(row: Pick<PersonColumn, "table" | "column">): string {
  return `${row.table}.${row.column}`;
}
