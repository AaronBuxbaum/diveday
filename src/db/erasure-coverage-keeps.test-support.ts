/**
 * Person-reachable tables the erasure deliberately leaves alone, and why.
 *
 * Reasons invite review of each decision. Three arguments apply throughout:
 *
 * - **A staff member is never erased** (`anonymizeDiver` refuses anyone holding
 *   a staff role), so a table whose only person column is the staffer who
 *   acted is not about the diver at all. Their name on the record is the shop's
 *   accountability trail, which the ADR keeps on purpose.
 * - **A pointer is not a disclosure.** A row that names a diver only by
 *   `person_id` says nothing once that person's row is erased, and the name
 *   joined at read now resolves to the anonymized one. Keeping the id is also
 *   what lets a replayed erasure reach the same rows.
 * - **An id-only row about a shop object** — which seat, which unit, which
 *   departure — is the shop's record of its own day.
 */
export const ERASURE_KEEPS: Record<string, string> = {
  // --- the diver is named only by a pointer, or not at all -----------------
  buddy_pair_members:
    "which seats dived together, by id; the team's words live in `buddy_team_events`, which the erasure does redact",
  booking_checkout_bookings:
    "how one checkout's money split across the seats it paid for — four amounts and two ids",
  booking_arrival_events:
    "the arrival ledger for a seat: a status, a source and the staffer who recorded it, with no diver column and no free text",
  dive_package_entitlements:
    "ids, a consumption timestamp and an expiry — how many dives of a package are left, which is the shop’s own balance",
  shop_promo_redemptions:
    "that a code was redeemed on a checkout, and for how much; the diver is reached only through the checkout, which is redacted",
  trip_blowout_divers:
    "who was offered a re-book when a departure blew out, by id, plus whether the message left. The address it went to lives on the notification rows, which are redacted",
  trip_invitations:
    "that an invitation was sent for a seat, by id. Its risk is not disclosure but #1616, where the foreign key aborts the erasure transaction outright",
  trip_read_marks: "how far a staff member has read a trip’s desk feed",
  today_read_marks: "a staff member’s Today catch-up state",
  today_read_mark_events: "IDs cascading with marks or desk events",
  stripe_refund_failures:
    "a refund Stripe reported failed or canceled: an amount, Stripe's status and reason codes (the reason narrowed at the webhook to Stripe's documented words by `refundFailureReasonOf`, anything else `unknown`), and the order, checkout or seat it reverses, by id, with no name, address or free text; the diver is reached through that order or checkout, which the erasure redacts (issue #2291)",
  payment_disputes:
    "a card dispute's amount, status and evidence deadline, pointing at its order or checkout by id with no name, address or free text; the diver is reached through that order or checkout, which the erasure redacts (ADR 20261009-stripe-reversals-reach-diveday)",
  booking_referrals:
    "that one seat arrived from another seat's recap link — two booking ids and a timestamp, and nothing else. Both bookings carry their own erasure, so the diver either side of the link is erased where they are stored",
  date_request_offer_bookings:
    "which date-request offer answered which booking, by two ids only. The linked booking is scrubbed by erasure, and the request's identifying fields are blanked; keeping the link prevents the same offer from holding capacity twice",
  trip_sightings:
    "what a crew tapped at a site: a species slug from DiveDay’s own catalog, a count, and the site’s name as it stood. Its two person columns are the crew member who tapped and the one who undid it, pointers joined at read the way `trip_desk_events` is",
  trip_desk_events:
    "`subject_person_id` is a pointer by design and the name is joined at read, which resolves to the anonymized one after this runs",
  trip_help_requests:
    "that someone at a seat asked for help and when it was handled; a kind and a status, no words. The helper and recorder are staff pointers joined at read, so an erased person resolves to the anonymized name",
  work_order_items:
    "which of a diver's pieces one service ticket covered — two ids. Both ends are erased where they are stored: the piece's note and serial clear, the ticket's words are redacted",
  work_order_care:
    "a ticket's Work done record: which check, passed or failed, the day performed and the next due date — a care code, two dates and a boolean about equipment, no words",
  work_order_events:
    "a ticket's status trail: which status it moved to, when, and the staffer who moved it. No diver column and no free text",
  payment_operation_intents:
    'a Stripe object id and a status word. Every writer passes a status or a fixed sentence — `session.status`, `result.status`, "booking already has an active checkout attempt" — so `error_message` never carries provider prose about a person',
  processor_erasure_obligations:
    "kept deliberately by ADR 20260803-processor-erasure-obligations: it names the erased person and whoever discharged the obligation, which is how an unfinished erasure stays visible",
  account_step_ups:
    "cleared by ON DELETE CASCADE from `user_accounts` and `account_sessions`, both of which the erasure deletes",
  push_subscriptions:
    "`person_id` is the staff member who opted a device in, and the erasure refuses anyone holding a staff role. This becomes a gap the day a diver-facing push subscription ships",
  trip_series_crew:
    "who sails with a repeating departure on every new date — a staff roster row, like `trip_assignments`",
  customer_gear_notices:
    "that a ready message or a service reminder went to a diver, on which channel and how it went — a kind, a status and a date. Never the address or the words",
  customer_gear_reminder_settings:
    "whether a piece's service reminders are off — a timestamp on a piece whose note and serial the erasure clears",
  work_order_bills:
    "which order billed which ticket — two ids. The order keeps its own erasure answer, and the ticket's words are redacted",
  crew_away_acknowledgements:
    "that a staffer said an away crew member is working a departure anyway, and who took it back — four ids and two dates. Only crew are its subject, and the erasure refuses anyone holding a staff role",
  crew_notices:
    "that a crew member was put on, taken off, or answered about a departure — a change code, two ids and two dates. Only crew are its subject, and the erasure refuses anyone holding a staff role",
  weekly_digest_sends:
    "that a staff member's Monday email went out for a week — a date, a delivery status and a token hash. Only staff receive it, and the erasure refuses anyone holding a staff role",

  // --- the shop's own objects, holding nobody ------------------------------
  trip_dives: "the dives inside a departure, by site and order",
  trip_requirements:
    "the gates a departure sets — a certification level, specialties, whether a waiver is needed",
  trip_schedule_days: "the day boundaries of a multi-day departure",
  trip_recap_photos:
    "the shop’s photographs of a departure, uploaded by a staff member and attached to the trip rather than to anyone on it. A photo *of* a diver is `recap_photos`, which the erasure deletes and queues for blob deletion",
  dive_sites: "a place, its briefing and its conditions",
  dive_site_creatures: "which catalog species a site lists",
  dive_packages: "the shop’s price list of multi-dive packages",
  pre_departure_checklist_items: "the shop’s own checklist lines",
  departure_boat_safety_snapshots:
    "a boat’s papers and kit notices as the boat left — the shop’s own hull and units, nobody aboard",
  gear_items: "the shop’s own units: a serial number, a size, a service note about the unit",
  shop_promo_codes: "a discount the shop published, its window and its ceiling",
  trip_last_minute_promos:
    "that a shop offered a deal on a departure and to how many people. The addresses it reached are on the recipient rows, which the erasure redacts",
  course_form_versions:
    "the wording of a course form as the shop saved it, and the staffer who saved it. The signed copy is `course_form_records`, which the erasure redacts",
  waiver_materiality_decisions:
    "an owner's ruling on whether a template change was material — a decision about the shop’s text, not about any signer",
  // --- the staffer who acted is the only person on the row -----------------
  crew_assignment_requests: "a crew member asking for a departure, and the answer",
  crew_availability_blocks: "a crew member’s own unavailable dates and their note about them",
  staff_shifts: "a staff member’s own hours and the note attached to them",
  executed_dives:
    "what the crew recorded about a dive that ran — depth, time, conditions, and why the plan changed",
  gear_service_events: "a technician's record of servicing a unit",
  boat_snags:
    "a crew member's note about a problem on a boat, and who later found it still there or fixed",
  pre_departure_check_events:
    "a crew member ticking a checklist line before a departure, and their note about the line",
  trip_stage_events: "the crew moving a departure through its stages",
  trip_blowouts: "who called a departure off, and when",
  marine_life_requests: "a staff member’s search for a species DiveDay does not carry",
  integration_oauth_states:
    "a single-use OAuth handshake bound to the staff member who started it and expiring in minutes",
  departure_notes:
    "an operational note a staffer sent to everyone on a departure — the parking, the meeting point — and who sent it. It is addressed to a departure, not to a diver: no recipient is stored, and its one person column is the staff sender",
  held_sends:
    "an eight-second undo window. Its `payload` carries ids only (and, for a departure note, the staffer's one line, which is addressed to a departure, not to a diver) — never a name or an address, which the table's own docblock states and `src/lib/held-sends.ts` holds to — and nothing lingers, so nothing prunes it",
};
