/**
 * **Every column that references `people`, and what a merge and an erasure do with it**
 * (issue #2724).
 *
 * One row per column, so the person's data story reads in one place and a column
 * added tomorrow fails one guard with one message
 * (`person-columns.test.ts`: every foreign key to `people`, and every column
 * named `%person_id`, has a row; every row names a live column). `kind` says who
 * the column names, and `merge` says what `mergeDiverRecords` does with it. The
 * erasure follows in `erase` below and a diver's own export in `export`. The
 * reap's coverage guard (`delete-path-coverage.test.ts`) reads the tables here
 * as part of the shop, so a row naming a person *by a column this registry
 * names* can never be excused as belonging to nobody. The registry itself is
 * complete only for foreign keys to `people` and columns named `%person_id`; a
 * table that names a person some other way (a bare uuid, an email) is outside
 * the guard until it is registered.
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
 *   (`activity_events.subject_person_id`):
 *   a trail records what happened, not what is true now, and repointing the
 *   subject would make the shop's history claim the survivor was the subject of an
 *   act performed against a record that had a different name at the time.
 * - `delete`: dropped on merge. A sealed retry that names the source cannot
 *   transfer its authority to the survivor.
 *
 * ## `erase` (the second slice)
 *
 * What `anonymizeDiver` (`anonymize.ts`) does to a row because *this column*
 * names the person being erased.
 *
 * - `delete`: the row goes. With no `eraseIn` it is a plain one, `shop_id` and
 *   this column (for the person and every record merged into them), only ever
 *   on a `subject` column, and the erasure runs it from this registry
 *   (`erasedPersonRowDeletes`): a new table of a person's own rows needs one
 *   line here and no hand-written statement.
 * - `scrub`: the row stays and its personal content is redacted by the sweep
 *   `eraseIn` names (the row is evidence: a signed release, a seat, a ticket).
 * - `null`: the row stays and this column is cleared by the sweep `eraseIn`
 *   names (an erased former staffer's name on somebody else's training plan).
 * - `keep`: left as it is. A pointer at an erased person discloses nothing: the
 *   name joined at read is the anonymized one. An `actor` column is `keep`
 *   unless it says otherwise; any other kind states it, and its reason is
 *   `eraseWhy` (always, on a `subject`) or the table's entry in
 *   `erasure-coverage-keeps.test-support.ts`.
 *
 * Scope (Aaron, 2026-11-01, #3437): the erasure removes the person's own data.
 * Their name in somebody else's free text is not this registry's to find.
 * `erasure-registry.test.ts` holds every fate to the code: a named sweep must
 * exist and write the table, and a `keep` table the erasure writes must say why.
 *
 * ## `export` (the third slice)
 *
 * What one diver's own bundle (`loadDiverExportBundleInput`, ADR
 * 20260824-diver-record-export) does with the rows *this column* names them on.
 *
 * - `own`: the bundle reads them as the diver's, by this column. Only a
 *   `subject` or a `crew` column (their own membership of a buddy team) may say
 *   so; an actor or a login names rows about other people.
 * - `withheld`: the bundle does not read them by this column, and `exportWhy`
 *   says why on a `subject`. Any other kind is `withheld` unless it says
 *   otherwise: a staffer who recorded a row appears by name on the diver's own
 *   rows, never as the owner of the rows they wrote.
 *
 * `diverOwnRows` (`./export-tables`), the one way the diver's bundle reads by
 * their person id (under `readScoped` and in the loader alike), refuses a
 * column this registry does not call `own`, and `export-registry.test.ts`
 * holds both directions to the loader: every `own` column is read, and nothing
 * is read by the diver's id that is not `own`. **This governs reads by person
 * id.** A read-list entry the diver's bundle takes by the diver's own booking
 * ids (roll call, deliveries, payments, recap photos) states its fate in
 * {@link BOOKING_EXPORT_READS} instead, and `readScoped` refuses one that does
 * not (#3880). The shop's whole bundle is a per-table decision
 * (`export.test.ts`), not a per-person one, and stays there.
 *
 * **`own` is row-level.** It says the rows are the diver's, not that every
 * column on them is theirs to read: a staff-typed free-text column on an own
 * row (a card's review note, a gear note, a moderation reason, a bench line's
 * description) can name another person, so it is withheld column by column in
 * the `in:` field of `./export-shared-files` (`"shop"`), and an actor's name is
 * resolved only for people holding a staff role (`loadDiverExportContext`,
 * #3880). Erasure is a separate question and redacts no name inside anyone's
 * free text (Aaron, 2026-11-01, #3437).
 *
 * `exportWhy` is required on every withheld `subject` and `crew` row: a
 * staffer asking for their own data reads the same reasons.
 *
 * ## The reap (the fourth slice)
 *
 * Every table named here is in the shop the demo reset and the demo cascade
 * must account for (`delete-path-coverage.test.ts`), declared foreign key or
 * not; that guard's `UNSCOPED_REASONS` may excuse no table this registry names.
 * The reap's fates stay per table, not per column: a delete path removes rows,
 * and the order it removes them in is `reap-demos.test.ts`'s to prove.
 */

export type PersonColumnKind = "subject" | "actor" | "crew" | "login";
export type PersonColumnMerge = "move" | "refuse" | "leave" | "delete";
export type PersonColumnErase = "delete" | "scrub" | "null" | "keep";
export type PersonColumnExport = "own" | "withheld";

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
  /** What erasing the person this column names does to the row; `keep` when absent on an `actor`. */
  erase?: PersonColumnErase;
  /** The `anonymize.ts` sweep that does it. Absent on a plain `delete`, which the registry runs. */
  eraseIn?: string;
  /** The column the sweep reaches these rows by, when it is not this one (a login by its account). */
  eraseBy?: string;
  /** `keep` only, when the table's entry in the erasure keep-list does not already say why. */
  eraseWhy?: string;
  /** What the diver's own bundle does with the rows this column names them on; `withheld` when absent off a `subject`. */
  export?: PersonColumnExport;
  /** `withheld` on a `subject`: why the diver's own bundle leaves these rows out. */
  exportWhy?: string;
};

const rows = [
  {
    table: "trips",
    column: "course_teaching_note_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "instructor attribution on a departure, not a diver record",
    export: "withheld",
  },
  // ---- Moved: the diver's own history, repointed at the survivor (bare `person_id`, in this order).
  // What the bench told this diver about their own gear (ADR
  // 20261008-work-order-follow-up). It follows the gear and the tickets to the
  // survivor, or the survivor's ticket would read as never announced and the
  // next pass would remind them a second time about a date already covered.
  {
    table: "customer_gear_notices",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "delivery plumbing: a kind, a channel and a status; the ticket and the piece it was about are in the bundle",
    kind: "subject",
    merge: "move",
    erase: "keep",
    eraseWhy: "a kind, a channel, a status and a date; never the address or the words",
  },
  {
    table: "bookings",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubBookingRows",
  },
  {
    table: "internal_notes",
    column: "person_id",
    export: "withheld",
    exportWhy: "staff notes, never shown to a diver, whose free text can name another diver",
    kind: "subject",
    merge: "move",
    erase: "delete",
  },
  {
    table: "interests",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubInterests",
  },
  // What a merge does is the purpose's `merge` in `CAPABILITY_POLICY`. A
  // person's unsubscribe link (`courtesy_email_unsubscribe`,
  // `weekly_digest_unsubscribe`, `merge: "follows"`) follows the person, so a
  // link the source was mailed still opts the kept record out; stopping mail
  // grants nothing. A staff calendar feed (`calendar_assignments`,
  // `calendar_shop_trips`, `merge: "refuse"`) refuses the merge as
  // `staff_record` (`mergeDiverRecords`), and the erasure revokes it rather
  // than deleting it (`scrubStandingCredentials`). Rows of other purposes
  // leave `person_id` null.
  {
    table: "capabilities",
    column: "person_id",
    export: "withheld",
    exportWhy: "a bearer credential; carrying it out would hand on what it grants",
    kind: "subject",
    merge: "move",
    erase: "delete",
    eraseIn: "scrubPersonOnlyRows",
  },
  {
    table: "dive_package_entitlements",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "keep",
    eraseWhy: "the shop's own balance of a package: ids, a consumption time and an expiry",
  },
  {
    table: "orders",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubOrders",
  },
  {
    table: "waiver_records",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubWaiverRecords",
  },
  // A signed course form, on the booking that moves with it (ADR
  // 20261008-course-forms). `person_id` is inside its seal, so it moves
  // through `refileCourseFormRecords`, which re-seals only a record that
  // verified before the move; its unique key is per booking, so the two
  // sides cannot collide.
  {
    table: "course_form_records",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubCourseFormRecords",
  },
  {
    table: "cards",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubCertificationEvidence",
  },
  {
    table: "certification_junior_reviews",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "delete",
    eraseIn: "scrubCertificationEvidence",
  },
  {
    table: "prior_visits",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubImportedHistory",
  },
  {
    table: "imported_payment_history",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubImportedHistory",
  },
  {
    table: "rental_fit_profiles",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "delete",
    singleton: true,
  },
  // A bookingless counter rental names the diver directly (the other shape
  // names a booking, which this merge moves anyway). Leaving it behind put the
  // unit on a removed diver's record: the survivor's prep page showed no gear
  // and the reservation still held the window.
  {
    table: "gear_reservations",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubGearRegister",
  },
  // A diver's own gear on file, and the service tickets about it (ADR
  // 20261008-gear-work-orders). Both name the diver directly, and both are
  // the diver's — the shop is holding the regulator of whoever the survivor
  // is. Leaving them behind would hide a ticket the shop is still working
  // from the record the counter now opens.
  {
    table: "customer_gear_items",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubBench",
  },
  {
    table: "work_orders",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubBench",
  },
  {
    table: "prior_gear_assignments",
    column: "person_id",
    export: "withheld",
    exportWhy: "the gear-history import's source evidence; neither bundle has a file for it yet",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubImportedHistory",
  },
  {
    table: "trip_reviews",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubReviews",
  },
  // The crew member a diver thanked on their review (loop 5, row 6). The words
  // are the diver's (`trip_reviews.crew_thanks`: their export reads them, and
  // their erasure clears them in `scrubReviews`); this column only names who
  // they are for, so it is a staff record on the crew side.
  {
    table: "trip_reviews",
    column: "crew_thanks_person_id",
    export: "withheld",
    exportWhy:
      "words another diver wrote about this crew member; the writer's own export carries them, and a staffer's request does not hand over a diver's words",
    kind: "crew",
    merge: "leave",
    why: "names a crew member of the departure, a staff record whose own merge is refused; the pointer stays on the id it had",
    erase: "keep",
    eraseWhy:
      "a pointer at an erased person discloses nothing: the name is joined at read; the words are the diver's, kept through the crew member's erasure (Aaron, 2026-11-05, #3913) and cleared by the diver's own",
  },
  // The staffer who hid a thanks from the crew member.
  {
    table: "trip_reviews",
    column: "crew_thanks_hidden_by_person_id",
    export: "withheld",
    exportWhy: "a staff moderation record, not the diver's own words",
    kind: "actor",
    merge: "leave",
    why: "names the staffer who hid the line, a staff record whose own merge is refused; the pointer stays on the id it had",
    erase: "keep",
  },
  // The private half of the same act (ADR 20260904-reef-all-the-way-down,
  // D40): the diver's own word about how the day went, on the booking they
  // sat in. It moves for the reason the review above it does — it is the
  // diver's, not the shop's — and it cannot collide, because the live-row
  // unique index is per *booking*, and the bookings move with them.
  {
    table: "recap_pulses",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubPrivateWord",
  },
  {
    table: "trip_blowout_divers",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a weather cancel's message and rebooking state; the canceled seat is in bookings.csv",
    kind: "subject",
    merge: "move",
    erase: "keep",
    eraseWhy:
      "that a re-book was offered, by id; the address it went to is on the notification rows, which are redacted",
  },
  // The diver's own messages and the shop's answers to them (ADR
  // 20260907-two-way-inbox). A merge is the shop saying two records are one
  // person, and a conversation with that person belongs on the record that
  // survives — otherwise the survivor's thread opens on silence while the
  // "running late" the crew acted on sits on a record nobody opens.
  {
    table: "inbound_messages",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubInbox",
  },
  {
    table: "staff_replies",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "scrub",
    eraseIn: "scrubInbox",
  },
  // Something the crew found aboard with this diver's name on it (batch 4,
  // J2). It is the diver's, so it follows them: the survivor is who gets told.
  {
    table: "lost_items",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "move",
    erase: "delete",
  },
  // ---- Refused: a staff record on either side stops the merge.
  {
    table: "staff_shifts",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a staffer's own staff record, not a diving one; whether a staff request for it gets a file is a human decision",
    kind: "crew",
    merge: "refuse",
    erase: "scrub",
    eraseIn: "scrubPersonRecord",
  },
  {
    table: "staff_credentials",
    column: "person_id",
    export: "own",
    kind: "crew",
    merge: "refuse",
    erase: "scrub",
    eraseIn: "scrubPersonRecord",
  },
  {
    table: "account_sessions",
    column: "person_id",
    kind: "login",
    merge: "refuse",
    erase: "delete",
    eraseIn: "scrubDiverLogin",
    eraseBy: "user_account_id",
  },
  {
    table: "roll_call_events",
    column: "crew_person_id",
    export: "withheld",
    exportWhy:
      "a crew member's own boarding marks, a staff record; a diver's marks are read by their seat",
    kind: "crew",
    merge: "refuse",
    erase: "scrub",
    eraseIn: "scrubPersonRecord",
  },
  {
    table: "push_subscriptions",
    column: "person_id",
    kind: "login",
    merge: "refuse",
    erase: "delete",
    eraseIn: "scrubPersonRecord",
  },
  // The staffing week's own two tables (issue #1235). Both are written by, and
  // about, somebody who crews boats — a days-away block or an ask for a
  // departure — so either side of a merge holding one is a staff record and the
  // merge is refused, exactly as a seeded shift refuses it.
  {
    table: "crew_availability_blocks",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a staffer's own staff record, not a diving one; whether a staff request for it gets a file is a human decision",
    kind: "crew",
    merge: "refuse",
    erase: "scrub",
    eraseIn: "scrubPersonRecord",
  },
  {
    table: "crew_assignment_requests",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a staffer's own staff record, not a diving one; whether a staff request for it gets a file is a human decision",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
  },
  // "Working it anyway" on a departure (issue #2678): its subject is somebody
  // on a crew, so a record holding one is a staff record and the merge is refused.
  {
    table: "crew_away_acknowledgements",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a staffer's own staff record, not a diving one; whether a staff request for it gets a file is a human decision",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
  },
  // Where a *staffer* had read up to in a departure's shift catch-up (issues
  // #1202, #1187): a position in `activity_events.seq` (#2701). Same shape as `push_subscriptions` above it: written by, and
  // about, somebody who works the boats, so either side of a merge holding one
  // is a staff record and the merge is refused rather than carried across.
  {
    table: "trip_read_marks",
    column: "person_id",
    export: "withheld",
    exportWhy: "where a staffer had read up to in a shift catch-up; app state, not a record",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
  },
  {
    table: "today_read_marks",
    column: "person_id",
    export: "withheld",
    exportWhy: "where a staffer had read up to in the day's catch-up; app state, not a record",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
  },
  // The Monday email's claims (`src/features/weekly-digest/store.ts`). Only somebody with
  // a staff login is ever sent one, so a record holding one is a staff record
  // and the merge is refused, like a calendar feed capability.
  {
    table: "weekly_digest_sends",
    column: "person_id",
    export: "withheld",
    exportWhy: "that the Monday staff email went out; delivery plumbing, not a record",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
  },
  // Crew news waiting to be told (ADR 20261009-crew-hear-about-their-boats).
  // Only somebody on a crew is ever its subject, so either side of a merge
  // holding one is a staff record and the merge is refused.
  {
    table: "crew_notices",
    column: "person_id",
    export: "withheld",
    exportWhy: "crew news waiting to be told; delivery plumbing, not a record",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
  },
  // A staffer named in an incident report (ADR 20261012-incident-reports). A
  // diver is named there by booking, which moves with the seat; only staff are
  // named by person, so a record holding one is a staff record.
  {
    table: "incident_report_people",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a staffer named in an incident report, the shop's liability record; whether a diver's own report ships is a human decision (ADR 20261012-incident-reports)",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
    eraseWhy:
      "a staffer named in a report, the shop's liability record; a diver is named by seat, which the booking sweep reaches, and an outsider by the name `scrubIncidentReports` matches",
  },
  // A repeating trip's standing crew (`trip_series_crew`): only staff sail on
  // it, so a record holding one is a staff record and the merge is refused.
  {
    table: "trip_series_crew",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a staffer's own staff record, not a diving one; whether a staff request for it gets a file is a human decision",
    kind: "crew",
    merge: "refuse",
    erase: "keep",
  },
  {
    table: "trip_assignments",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "a staffer's own staff record, not a diving one; whether a staff request for it gets a file is a human decision",
    kind: "crew",
    merge: "refuse",
    erase: "scrub",
    eraseIn: "scrubTrainingPlans",
    withoutShop: true,
  },
  {
    table: "user_accounts",
    column: "person_id",
    kind: "login",
    merge: "refuse",
    erase: "scrub",
    eraseIn: "scrubDiverLogin",
    withoutShop: true,
  },
  // ---- Left where it is, on purpose: bare `person_id` columns the merge does not touch.
  {
    table: "person_roles",
    column: "person_id",
    export: "own",
    kind: "subject",
    merge: "leave",
    erase: "delete",
    eraseIn: "scrubPersonRecord",
    why: "a role belongs to the identity, not to its history",
  },
  {
    table: "integration_oauth_states",
    column: "person_id",
    kind: "login",
    merge: "leave",
    erase: "keep",
    why: "ephemeral staff OAuth state, consumed within minutes",
  },
  {
    table: "media_deletion_attempts",
    column: "person_id",
    kind: "subject",
    merge: "move",
    erase: "keep",
    eraseWhy:
      "retained media versions become permanent purge obligations during erasure; identity is only the anonymized person pointer",
    export: "withheld",
    exportWhy: "internal storage deletion obligations, not portable diver data",
  },
  {
    table: "processor_erasure_obligations",
    column: "person_id",
    export: "withheld",
    exportWhy:
      "what an erasure still owes at Stripe: the shop's compliance state, pointers into one Stripe account",
    kind: "subject",
    merge: "leave",
    erase: "keep",
    eraseWhy:
      "the ledger that keeps an unfinished erasure visible (ADR 20260803-processor-erasure-obligations)",
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
    table: "cards",
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
    erase: "scrub",
    eraseIn: "scrubActivityEvents",
    why: "who did it \u2014 attribution, not diver history",
  },
  {
    table: "activity_events",
    column: "subject_person_id",
    export: "withheld",
    exportWhy:
      "prose written at the time that routinely names other people, on a shared booking or a roll-call line",
    kind: "subject",
    merge: "leave",
    erase: "scrub",
    eraseIn: "scrubActivityEvents",
    why: "an event trail records who it happened to at the time",
  },
  {
    table: "bookings",
    column: "fly_safe_acknowledged_by_person_id",
    kind: "actor",
    merge: "leave",
    erase: "null",
    eraseIn: "scrubBookingRows",
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
  // Loop 5, row 10: who marked a referral student, and who collected each paper.
  {
    table: "bookings",
    column: "referred_in_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer marked the seat as a referral student",
  },
  {
    table: "bookings",
    column: "referral_form_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer collected the referral form",
  },
  {
    table: "bookings",
    column: "referral_record_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer collected the eLearning record",
  },
  {
    table: "bookings",
    column: "training_plan_by_person_id",
    kind: "actor",
    merge: "leave",
    erase: "null",
    eraseIn: "scrubTrainingPlans",
    why: "planning records involving a merged person are cleared",
  },
  {
    table: "bookings",
    column: "training_plan_instructor_person_id",
    kind: "actor",
    merge: "leave",
    erase: "null",
    eraseIn: "scrubTrainingPlans",
    why: "planning records involving a merged person are cleared",
  },
  {
    table: "trip_assignments",
    column: "training_plan_by_person_id",
    kind: "actor",
    merge: "leave",
    erase: "null",
    eraseIn: "scrubTrainingPlans",
    why: "planning records involving a merged person are cleared",
  },
  {
    table: "trip_assignments",
    column: "training_plan_instructor_person_id",
    kind: "actor",
    merge: "leave",
    erase: "null",
    eraseIn: "scrubTrainingPlans",
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
    export: "own",
    kind: "crew",
    merge: "leave",
    erase: "keep",
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
    table: "cards",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who removed the card",
  },
  {
    table: "cards",
    column: "issued_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who entered the card",
  },
  {
    table: "cards",
    column: "processed_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who told the agency about the card",
  },
  {
    table: "cards",
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
    column: "decided_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who approved or declined the days off",
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
    table: "internal_notes",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who deleted the note (issue #3701)",
  },
  {
    table: "marine_life_requests",
    column: "requested_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer asked for the species",
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
    export: "withheld",
    exportWhy: "a record merged away; its history moved to the survivor, whose bundle carries it",
    kind: "subject",
    merge: "leave",
    erase: "scrub",
    eraseIn: "scrubPersonRecord",
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
    table: "interest_replies",
    column: "sent_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer answered the date request (issue #2555)",
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
    table: "roll_call_events",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who called the roll",
  },
  {
    table: "deals",
    column: "created_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who wrote the code or sent the deal",
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
    table: "trip_help_requests",
    column: "helper_person_id",
    export: "withheld",
    exportWhy:
      "the crew member who said they would help; the ask is about a departure, not about them",
    kind: "crew",
    merge: "leave",
    erase: "keep",
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
    // Loop 5, row 11: the staffer who sent a charter quote.
    table: "interests",
    column: "charter_quoted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staffer sent the charter quote",
  },
  {
    table: "trip_recap_photos",
    column: "uploaded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who uploaded the photo",
  },
  {
    table: "trip_conservation",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "which staff member recorded the departure conservation action",
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
    table: "safety_drills",
    column: "recorded_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who logged the drill",
  },
  {
    table: "safety_drills",
    column: "deleted_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who deleted the drill",
  },
  {
    table: "safety_drill_participants",
    column: "person_id",
    export: "withheld",
    exportWhy: "a staffer's drill attendance, a staff record, not a diving one",
    kind: "crew",
    merge: "leave",
    erase: "keep",
    why: "a crew member who took part in a drill; the insurer's record keeps who drilled",
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
    export: "withheld",
    exportWhy:
      "the technician a ticket was handed to; the diver's tickets are read by their own id",
    kind: "crew",
    merge: "leave",
    erase: "keep",
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
    export: "withheld",
    exportWhy: "the technician working a ticket; the diver's tickets are read by their own id",
    kind: "crew",
    merge: "leave",
    erase: "keep",
    eraseWhy:
      "the technician who worked the ticket, a staff pointer; the ticket's diver is erased through `person_id`",
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
    table: "waiver_seal_acknowledgements",
    column: "acknowledged_by_person_id",
    kind: "actor",
    merge: "leave",
    why: "who looked into a broken waiver seal (#3891)",
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
    why: "who declined the clearance; the accountable staffer as recorded, so never repointed",
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
    why: "who cleared the medical answer; the accountable staffer as recorded, so never repointed",
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
    export: "withheld",
    exportWhy: "sealed retry state; what was delivered is in notification_deliveries.csv",
    kind: "subject",
    merge: "delete",
    erase: "delete",
    eraseIn: "scrubPersonRecord",
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

/** What erasing the person a row's column names does to it. */
export function eraseFate(row: PersonColumn): PersonColumnErase {
  if (row.erase) return row.erase;
  if (row.kind === "actor") return "keep";
  throw new Error(`person-columns: ${personColumnKey(row)} states no erase fate`);
}

/**
 * The rows the erasure deletes straight from this registry: a person's own
 * rows, found by `shop_id` and the column, with nothing bespoke about them.
 */
export function erasedPersonRowDeletes(): { table: string; column: string }[] {
  return PERSON_COLUMNS.filter((row) => eraseFate(row) === "delete" && !row.eraseIn).map((row) => {
    // A plain delete takes every row naming the person, so only a column
    // naming the subject of their own rows may have one: on an actor or crew
    // column it would take the rows a former staffer wrote about other people.
    if (row.kind !== "subject") {
      throw new Error(`person-columns: ${personColumnKey(row)} is a plain delete of a ${row.kind}`);
    }
    return { table: row.table, column: row.column };
  });
}

/**
 * What one diver's own bundle does with the rows a column names them on. A
 * `subject` states it; any other kind is `withheld` unless it says otherwise,
 * and only a `crew` column may say `own` (a staffer's own membership of a
 * team): the rows an actor or a login names are about other people.
 */
export function exportFate(row: PersonColumn): PersonColumnExport {
  if (row.export === "own" && (row.kind === "actor" || row.kind === "login")) {
    throw new Error(`person-columns: ${personColumnKey(row)} calls a ${row.kind} column own`);
  }
  if (row.export) return row.export;
  if (row.kind === "subject") {
    throw new Error(`person-columns: ${personColumnKey(row)} states no export fate`);
  }
  return "withheld";
}

/**
 * Throws unless the registry says the diver's own bundle reads `table` by
 * `column` as theirs. `diverOwnRows` (`./export-tables`) calls it before every
 * read by a diver's person id, so neither the read list nor a hand-written
 * read can widen a diver's bundle past what this registry decided. Reads by
 * the diver's booking ids do not pass through it.
 */
export function assertDiverExportColumn(table: string, column: string): void {
  const row = PERSON_COLUMNS.find((found) => found.table === table && found.column === column);
  if (!row) throw new Error(`export: ${table}.${column} has no registry row`);
  if (exportFate(row) !== "own") throw new Error(`export: ${table}.${column} is withheld`);
}

/**
 * **The read-list entries a diver's own bundle takes by their bookings** (#3880),
 * table by table, each with why its rows are the diver's: a row keyed by a seat
 * the diver holds is about that seat. `export-registry.test.ts` fails until a
 * new booking-scoped entry in `EXPORT_TABLES` states one here, and
 * `readScoped` refuses one that has not.
 */
export const BOOKING_EXPORT_READS: Readonly<Record<string, string>> = {
  recap_photos: "the photos the diver uploaded to their own recap",
  booking_payment_events: "the payment state of the diver's own seats",
  booking_checkout_bookings: "the checkouts that paid for the diver's own seats",
  notification_deliveries: "the messages sent to the diver about their own seats",
  booking_arrival_events: "when the diver's own seat was marked arrived at the dock",
  roll_call_events: "the boarding and head-count marks on the diver's own seats",
};

/** Throws unless {@link BOOKING_EXPORT_READS} states a fate for reading `table` by a diver's bookings. */
export function assertDiverBookingRead(table: string): void {
  if (!Object.hasOwn(BOOKING_EXPORT_READS, table)) {
    throw new Error(`export: ${table} has no booking-read fate`);
  }
}

/** `table.column` for every row, the key the guards and the docs use. */
export function personColumnKey(row: Pick<PersonColumn, "table" | "column">): string {
  return `${row.table}.${row.column}`;
}
