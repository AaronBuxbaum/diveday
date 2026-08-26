import { and, eq, getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { ANONYMIZED_PERSON_NAME } from "@/lib/anonymization";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createDiver, deleteDiver } from "./divers";
import { canPersonExportShopData, loadShopExportBundleInput, loadShopExportCounts } from "./export";
import * as schema from "./schema";
import {
  activityEvents,
  certifications,
  courseInquiries,
  courses,
  diveSites,
  internalNotes,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";
import { getCurrentWaiverTemplate, issueWaiverRequest } from "./waivers";

const EXPECTED_FILES = [
  "shop.csv",
  "boats.csv",
  "contacts.csv",
  "people.csv",
  "certifications.csv",
  "specialty_certifications.csv",
  "nitrox_certifications.csv",
  "trips.csv",
  "trip_series.csv",
  "trip_series_skips.csv",
  "trip_schedule_days.csv",
  "trip_dives.csv",
  "trip_requirements.csv",
  "trip_assignments.csv",
  "staff_shifts.csv",
  "bookings.csv",
  "waitlist_entries.csv",
  "trip_invitations.csv",
  "last_minute_list.csv",
  "trip_last_minute_promos.csv",
  "trip_last_minute_promo_recipients.csv",
  "booking_payment_events.csv",
  "booking_checkouts.csv",
  "booking_checkout_bookings.csv",
  "roll_call_events.csv",
  "roll_call_crew_events.csv",
  "buddy_pairs.csv",
  "waiver_templates.csv",
  "waiver_materiality_decisions.csv",
  "waiver_records.csv",
  "rental_fit.csv",
  "gear_items.csv",
  "gear_service_events.csv",
  "gear_reservations.csv",
  "closeout_leftover_decisions.csv",
  "pre_departure_checklist_items.csv",
  "pre_departure_check_events.csv",
  "prior_visits.csv",
  "imported_payment_history.csv",
  "internal_notes.csv",
  "activity_events.csv",
  "notification_deliveries.csv",
  "orders.csv",
  "order_line_items.csv",
  "tips.csv",
  "dive_sites.csv",
  "dive_site_creatures.csv",
  "dive_site_moments.csv",
  "recap_photos.csv",
  "trip_recap_photos.csv",
  "trip_reviews.csv",
  "review_moderation_events.csv",
  "dive_packages.csv",
  "dive_package_entitlements.csv",
  "shop_promo_codes.csv",
  "shop_promo_redemptions.csv",
  "courses.csv",
  "course_inquiries.csv",
];

/** Schema tables that get their own CSV in the bundle. */
const EXPORTED_TABLES = [
  "dive_packages",
  "dive_package_entitlements",
  "shops",
  "boats",
  "people",
  "certifications",
  "specialty_certifications",
  "nitrox_certifications",
  "trips",
  "trip_series",
  "trip_series_skips",
  "trip_schedule_days",
  "trip_dives",
  "trip_requirements",
  "trip_assignments",
  "staff_shifts",
  "bookings",
  "booking_payment_events",
  "booking_checkouts",
  "booking_checkout_bookings",
  "internal_notes",
  "activity_events",
  "notification_deliveries",
  "course_inquiries",
  "shop_promo_redemptions",
  "trip_waitlist_entries",
  "trip_invitations",
  "last_minute_list_entries",
  "trip_last_minute_promos",
  "trip_last_minute_promo_recipients",
  "roll_call_events",
  "roll_call_crew_events",
  "buddy_pair_members",
  "waiver_templates",
  "waiver_materiality_decisions",
  "waiver_records",
  "rental_fit_profiles",
  "gear_items",
  "gear_service_events",
  "gear_reservations",
  "closeout_leftover_decisions",
  "pre_departure_checklist_items",
  "pre_departure_check_events",
  "prior_visits",
  "imported_payment_history",
  "orders",
  "order_line_items",
  "tips",
  "dive_sites",
  "dive_site_creatures",
  "dive_site_moments",
  "recap_photos",
  "trip_recap_photos",
  "trip_reviews",
  "review_moderation_events",
  "shop_promo_codes",
  "courses",
];

/** Tables whose data rides inside another file rather than its own CSV. */
const FOLDED_TABLES = [
  "person_roles", // people.csv / trip_assignments.csv `roles`
  "booking_payments", // bookings.csv payment_* columns
];

/**
 * Deliberate exclusions — each must be defensible in the bundle README and on
 * the export page, and as of ADR 20260806-export-operational-records each must
 * clear that record's rule: a table stays out only when carrying it would be a
 * credential, a pointer into infrastructure the destination cannot reach, or
 * DiveDay's own bookkeeping about its own machinery. "Not in this first slice"
 * is not a reason — that is exactly what `internal_notes` sat on for a fortnight
 * before DATA-A10 forced the question. Adding a schema table without deciding
 * its export fate fails the coverage test below.
 */
const EXCLUDED_TABLES = [
  // Historical assignments are source evidence attached to the gear-history
  // import, not a live reservation or booking record. They remain in the
  // shop database and are intentionally not part of the current full-shop
  // export contract until that export has a matching assignment file.
  "prior_gear_assignments",
  // The close-out ritual's append-only trail. The one in-product operational
  // record that stayed out after DATA-A10's sweep, and on a narrower argument
  // than the ones that moved: a close-out is an attestation *about* a day whose
  // every underlying fact — the roll call, the blockers, the departures — is
  // already in the bundle, so the row adds a signature over records the
  // destination has, and nothing the destination lacks.
  "day_closeouts",
  // The buddy-team pairing trail (ADR 20260804-buddy-teams). The *standing*
  // teams a shop would carry to another system are already exported as
  // buddy_pairs.csv; this is the history of how they got that way.
  "buddy_team_events",
  "notification_delivery_attempts", // per-attempt retry mechanics behind notification_deliveries.csv, which carries the outcome
  // Which way each waiver link was handed over and what happened on that
  // channel. The outcome another system could act on is already on
  // waiver_records.csv (`delivery_status` and the provider columns beside it);
  // these rows are the per-channel mechanics behind it, so they are out for
  // exactly the reason notification_delivery_attempts is.
  "waiver_deliveries",
  "notification_send_queue", // operational retry state, not shop records
  // Per-device Web Push credentials (ADR 20260804-manifest-web-push). Excluded
  // for two independent reasons: they are meaningless in another system — an
  // endpoint is issued by a browser vendor to one installed app on one device,
  // and cannot be transferred — and the endpoint/p256dh/auth triple is a
  // *credential*, so writing it into a portable bundle would spread the ability
  // to push to a captain's phone anywhere that bundle goes.
  "push_subscriptions",
  "trip_blowouts", // operational cascade record for a weather cancel; the cancellation itself lives on the trip
  "trip_blowout_divers", // per-diver message/rebooking state for that cascade — same reasoning as notification_send_queue
  "notification_rate_limit_state", // provider coordination, not shop records
  "shop_stripe_accounts", // provider linkage, useless outside Stripe
  "payment_operation_intents", // internal reconciliation ledger, not a shop record (CR-005)
  "stripe_webhook_events", // provider webhook-delivery ledger, not a shop record — same reasoning as payment_operation_intents
  "media_deletion_attempts", // internal reconciliation ledger, not a shop record (CR-012)
  // The "what erasure still owes at Stripe" ledger. Not a shop record: every row
  // is a pointer into *this* Stripe account (`cus_…`/`in_…`) plus the state of
  // work done there, both meaningless in another system — the same reasoning as
  // shop_stripe_accounts. Deliberately not exported for a second reason too: an
  // outstanding obligation is the shop's own compliance state, and shipping it
  // into a portable bundle would carry it somewhere nobody can discharge it
  // (ADR 20260803-processor-erasure-obligations).
  "processor_erasure_obligations",
  // A shop asking DiveDay for a species the field-guide catalog does not carry
  // (ADR 20260813-marine-life-is-diveday-copy). Correspondence with the vendor
  // rather than a shop record: it says nothing about a diver, a booking or a
  // departure, and "we asked DiveDay for a seahorse" is not a fact another
  // system can do anything with. Same reasoning as shop_stripe_accounts --
  // meaningless outside this vendor relationship.
  "marine_life_requests",
  "global_dive_sites", // DiveDay's shared catalog; the shop's copies export
  "global_dive_site_versions",
  "user_accounts", // credentials are never exported
  "booking_capabilities", // bearer credentials, never exported — same reasoning as user_accounts
  "account_tokens", // bearer credentials (email verify / password reset), never exported
  "account_sessions", // a live sign-in session — more sensitive than a bearer token, never exported
  // better-auth adapter scaffolding, functionally unused (no OAuth, no
  // built-in email/password flow — src/lib/auth.ts) but still credential-
  // shaped by name, same reasoning as user_accounts.
  "auth_provider_accounts",
  "auth_verifications",
  "calendar_feeds", // bearer credentials for a staff calendar subscription, never exported
  "last_minute_list_unsubscribe_tokens", // bearer credentials, never exported — same reasoning as booking_capabilities
  "person_courtesy_email_unsubscribe_tokens", // bearer credentials, never exported — same reasoning as booking_capabilities
  // The shop's own Meta access token (sealed) plus the provider linkage around
  // it. Never exported, for both reasons already on this list: it is a live
  // credential like user_accounts, and a phone number id is provider linkage
  // useless outside that Meta account, like shop_stripe_accounts.
  "shop_whatsapp_accounts",
  // The shop's own S3 credential (sealed) plus where its weekly backup bundle
  // goes. Never exported, same two reasons as shop_whatsapp_accounts: the
  // secret key is a live credential to storage the shop owns, and the
  // endpoint/bucket rows are linkage to an account that already belongs to
  // the shop (ADR 20260804-shop-owned-backup-export).
  "shop_backup_destinations",
  // Delivery outcomes for those bundles — operational plumbing about the
  // export process, not a shop record; same reasoning as
  // notification_deliveries.
  "shop_backup_deliveries",
];

/**
 * Columns on an exported table that deliberately stay out of the bundle. The
 * default for anything absent from this map is "must be exported" — a new
 * column has to be argued out, not quietly forgotten.
 */
const EXCLUDED_COLUMNS: Record<string, string[]> = {
  // `shop_id` is the same value on every row of a single-shop bundle.
  shops: [
    "jurisdiction",
    "is_demo",
    "latitude",
    "longitude",
    // Setup-checklist progress, not a shop record: it says whether anyone has
    // looked at the currency and depth unit onboarding derived from the
    // timezone (issue #712). A shop restoring from a backup *should* be asked
    // again, so carrying this over would be the wrong answer, not a loss.
    "units_confirmed_at",
  ], // DiveDay-side config, not shop records
  boats: ["shop_id"],
  dive_packages: ["shop_id"],
  dive_package_entitlements: ["shop_id"],
  staff_shifts: ["shop_id"],
  review_moderation_events: ["shop_id"],
  people: [
    "shop_id",
    // The language a diver reads, as observed from their own request's
    // Accept-Language (docs ADR 20260731-per-person-notification-locale). An
    // inferred first-hand signal, not a fact the shop entered — a CSV can't
    // vouch for one, and accepting an imported value would be exactly the
    // "stale header from an unrelated past request" that ADR narrows against.
    // Null on import falls back to the shop's locale, which is the same mail a
    // shop got before the column existed, so nothing is silently lost.
    "locale",
  ],
  certifications: ["shop_id"],
  specialty_certifications: ["shop_id"],
  nitrox_certifications: ["shop_id"],
  trips: [
    "shop_id",
    "recap_shoutout", // recap copy travels with recap_photos.csv
    "recap_auto_send_paused", // auto-send countdown / pause is ephemeral operational state
    "recap_auto_send_at",
  ],
  trip_series: ["shop_id"],
  trip_series_skips: ["id", "shop_id"],
  trip_dives: [],
  trip_requirements: ["shop_id"],
  trip_assignments: [],
  bookings: [
    "shop_id",
    "pending_checkout_intent_id", // in-flight Stripe attempt, meaningless elsewhere
    "identity_unconfirmed_at", // H-13 review state, not a shop record
    // Seat-claim linkage (ADR 20260804-seat-claim-links): a pointer at another
    // booking row's id, which does not survive a re-import — same class as
    // pending_checkout_intent_id.
    "party_lead_booking_id",
    "claimed_at", // claim-flow operational state, same reasoning as identity_unconfirmed_at
  ],
  trip_waitlist_entries: ["shop_id"],
  trip_invitations: ["shop_id"],
  last_minute_list_entries: ["shop_id"],
  trip_last_minute_promos: [
    "shop_id",
    "stripe_coupon_id", // provider linkage, useless outside this Stripe account
    "stripe_promotion_code_id",
  ],
  trip_last_minute_promo_recipients: ["shop_id"],
  roll_call_events: ["shop_id"],
  roll_call_crew_events: ["shop_id"],
  // The member row's surrogate id says nothing beyond (pair_id, booking_id),
  // which are both exported.
  buddy_pair_members: ["shop_id", "id"],
  waiver_templates: ["shop_id"],
  waiver_materiality_decisions: ["shop_id"],
  waiver_records: [
    "shop_id",
    "template_body", // the frozen copy; waiver_templates.csv carries the text
    "token_hash", // bearer credential — never exported
    // The openable copy of that same credential, kept only while the link is
    // live (ADR 20260820-waiver-links-are-reused-not-reissued). Excluded for a
    // stronger reason than the hash: this one *can* be opened, and an export
    // bundle leaves DiveDay's custody entirely — to a shop's own S3, a laptop,
    // an email attachment. A destination issues its own links.
    "token_sealed",
    "draft_signer_name", // unsubmitted draft state, not a signed record
    "draft_acknowledged",
    "draft_medical_answers",
    // Delivery plumbing is provider-specific operational state. The signed
    // waiver remains portable; a destination can issue its own link and
    // delivery attempt rather than importing stale provider ids or outcomes.
    "delivery_status",
    "delivery_provider_message_id",
    "delivery_provider_status",
    "delivery_provider_status_at",
    "delivery_error",
  ],
  // `created_at` is when DiveDay wrote the row; `occurred_at` is when the
  // money actually moved, and that is the one a reader replays.
  booking_payment_events: ["shop_id", "created_at"],
  booking_checkouts: [
    "shop_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    // An ephemeral Stripe Checkout link that stopped resolving when the session
    // expired — same reasoning as tips.checkout_url.
    "checkout_url",
  ],
  // The join row's surrogate id says nothing beyond (checkout_id, booking_id),
  // which are both exported — same reasoning as buddy_pair_members.id.
  booking_checkout_bookings: ["shop_id", "id"],
  shop_promo_redemptions: ["shop_id"],
  internal_notes: ["shop_id"],
  activity_events: ["shop_id"],
  notification_deliveries: ["shop_id"],
  course_inquiries: ["shop_id"],
  rental_fit_profiles: [
    "shop_id",
    // A DiveDay-side discriminator, not a fact about the diver: it separates a
    // row that states a fit from one holding only their note (schema.ts,
    // `fit_stated_at`). The import rebuilds it correctly on its own — a row
    // carrying any size is a stated fit and `src/db/import.ts` stamps it — so
    // exporting it would carry an internal flag out and re-derive it anyway.
    "fit_stated_at",
  ],
  gear_items: ["shop_id"],
  gear_service_events: ["shop_id"],
  gear_reservations: ["shop_id"],
  closeout_leftover_decisions: ["shop_id"],
  pre_departure_checklist_items: ["shop_id"],
  pre_departure_check_events: ["shop_id"],
  prior_visits: [
    "shop_id",
    // The re-import idempotency key, derived from the columns that *are*
    // exported (src/lib/import.ts, `priorVisitDedupeKey`) — a DiveDay-side
    // implementation detail, not a fact about the shop's history.
    "dedupe_key",
    "created_at", // when the import ran; `imported_at` already carries that
  ],
  imported_payment_history: [
    "shop_id",
    // Re-import machinery, not a source fact; the exported source references
    // and visible fields carry the history elsewhere.
    "dedupe_key",
    "created_at", // `imported_at` is the meaningful import timestamp
  ],
  orders: [
    "shop_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    "stripe_customer_id",
  ],
  order_line_items: ["shop_id"],
  tips: [
    "shop_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    "checkout_url", // an ephemeral Stripe Checkout link, same reasoning as booking_checkouts
  ],
  dive_sites: [
    "shop_id",
    "source_template_id", // provenance into DiveDay's catalog, not the shop's
    "source_template_version",
    // A one-time rollback snapshot for the template-apply interaction. It is
    // DiveDay's temporary UI bookkeeping, not part of the site's portable
    // briefing and must never be restored by an import.
    "template_update_undo",
    // The row's edit generation for the two-tab guard. It counts saves made in
    // *this* installation's editor and means nothing to another one — a shop
    // restoring a bundle wants its briefing back, not the number of times
    // somebody pressed Save. Restoring it would also hand an importing row a
    // generation no rendered page has ever carried.
    "row_version",
  ],
  dive_site_creatures: ["shop_id"],
  dive_site_moments: ["shop_id"],
  recap_photos: ["shop_id"],
  trip_recap_photos: ["shop_id"],
  trip_reviews: ["shop_id"],
  shop_promo_codes: [
    "shop_id",
    "stripe_coupon_id", // provider linkage, useless outside this Stripe account
    "stripe_promotion_code_id",
  ],
  // `row_version` for the same reason as `dive_sites` above: it counts saves
  // in this installation's editor and is meaningless in another.
  courses: ["shop_id", "row_version"],
};

function table(
  input: NonNullable<Awaited<ReturnType<typeof loadShopExportBundleInput>>>,
  file: string,
) {
  const found = input.tables.find((candidate) => candidate.file === file);
  if (!found) throw new Error(`missing table ${file}`);
  return found;
}

describe("schema coverage", () => {
  it("forces every schema table to be exported, folded, or deliberately excluded", () => {
    const tableNames = Object.values(schema)
      .map((value) => {
        try {
          return getTableName(value as Parameters<typeof getTableName>[0]);
        } catch {
          return null;
        }
      })
      .filter((name): name is string => typeof name === "string");
    expect(tableNames.length).toBeGreaterThan(20);

    const decided = new Set([...EXPORTED_TABLES, ...FOLDED_TABLES, ...EXCLUDED_TABLES]);
    const undecided = tableNames.filter((name) => !decided.has(name));
    // A new table must land in one of the three lists above — and in the
    // loader or the README's "not included" list to match.
    expect(undecided).toEqual([]);

    // And the lists must not carry stale names a rename would orphan.
    const actual = new Set(tableNames);
    expect([...decided].filter((name) => !actual.has(name))).toEqual([]);
  });

  it("forces every column of an exported table to be exported or deliberately excluded", async () => {
    // Deliberately *not* `{ history: true }`. This assertion only reads
    // `table.header`, and every header in loadShopExportBundleInput is a static
    // literal emitted whether or not the table has rows — so the back-filled
    // reporting history buys it nothing. It costs a lot, though: the history
    // path skips the template snapshot and pays a full migrate-and-seed, which
    // pushed this test over its 20s budget under full-suite parallelism while
    // passing in isolation. The sibling dataset test below still asks for
    // history, because it genuinely asserts on rows.
    const { db, shop } = await seededShopContext();
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");

    // A column counts as exported if it appears in *any* file's header — some
    // ride in a rollup (contacts.csv) rather than their own table's CSV.
    const exportedColumns = new Set(input.tables.flatMap((table) => table.header));
    const exportedTables = new Set(EXPORTED_TABLES);

    const undecided: Record<string, string[]> = {};
    for (const value of Object.values(schema)) {
      let name: string;
      try {
        name = getTableName(value as Parameters<typeof getTableName>[0]);
      } catch {
        continue;
      }
      if (!exportedTables.has(name)) continue;
      const missing = Object.values(getTableColumns(value as Parameters<typeof getTableColumns>[0]))
        .map((column) => column.name)
        .filter((column) => !exportedColumns.has(column))
        .filter((column) => !(EXCLUDED_COLUMNS[name] ?? []).includes(column));
      if (missing.length > 0) undecided[name] = missing;
    }
    // The table-level test above passes happily when a *new column* on an
    // already-exported table never reaches the bundle — which is exactly how a
    // shop exports, re-imports, and silently loses a field. Adding a column
    // now forces a decision here too.
    expect(undecided).toEqual({});
  });
});

describe("full-shop export dataset", () => {
  it("covers every promised record family with data from the seeded shop", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");

    expect(input.shopSlug).toBe("blue-mantis");
    expect(input.tables.map((row) => row.file)).toEqual(EXPECTED_FILES);

    // The demo seed exercises the whole spine; an empty core table here means
    // a query broke, not that the seed changed shape.
    for (const file of [
      "contacts.csv",
      "people.csv",
      "trips.csv",
      "trip_schedule_days.csv",
      "trip_requirements.csv",
      "trip_assignments.csv",
      "bookings.csv",
      "waitlist_entries.csv",
      "waiver_templates.csv",
      "dive_sites.csv",
      "dive_site_creatures.csv",
      "courses.csv",
      // The DATA-A10 additions. A file that is *declared* but always empty is
      // the failure mode this whole list guards against — it reads as "we
      // export that" on the settings page and hands a leaving shop a header row.
      "booking_checkouts.csv",
      "booking_checkout_bookings.csv",
      "internal_notes.csv",
      "activity_events.csv",
      "notification_deliveries.csv",
      "shop_promo_redemptions.csv",
      "imported_payment_history.csv",
      "course_inquiries.csv",
    ]) {
      expect(table(input, file).rows.length, `${file} has no rows`).toBeGreaterThan(0);
    }

    // Staff belong in the bundle too, with their roles readable.
    const peopleTable = table(input, "people.csv");
    const nameIndex = peopleTable.header.indexOf("full_name");
    const rolesIndex = peopleTable.header.indexOf("roles");
    const dana = peopleTable.rows.find((row) => row[nameIndex] === "Dana Reyes");
    expect(dana).toBeDefined();
    expect(String(dana?.[rolesIndex])).not.toBe("");

    // Bookings denormalize names so the CSV is spreadsheet-readable.
    const bookingsTable = table(input, "bookings.csv");
    for (const row of bookingsTable.rows) {
      expect(row[bookingsTable.header.indexOf("trip_title")]).toBeTruthy();
      expect(row[bookingsTable.header.indexOf("person_name")]).toBeTruthy();
      expect(row[bookingsTable.header.indexOf("payment_status")]).toBeTruthy();
    }

    // The safety records an incident review needs: each trip's boarding gates
    // and its crew, both readable without joining by hand.
    const requirements = table(input, "trip_requirements.csv");
    expect(requirements.header).toContain("minimum_certification_level");
    expect(requirements.header).toContain("required_specialties");
    const scheduleDays = table(input, "trip_schedule_days.csv");
    expect(scheduleDays.rows.length).toBeGreaterThan(0);
    expect(
      scheduleDays.rows.filter(
        (row) =>
          row[scheduleDays.header.indexOf("trip_title")] === "Open Water Diver — three-day course",
      ),
    ).toHaveLength(3);
    const assignments = table(input, "trip_assignments.csv");
    for (const row of assignments.rows) {
      expect(row[assignments.header.indexOf("person_name")]).toBeTruthy();
    }
    const rollCall = table(input, "roll_call_events.csv");
    expect(rollCall.header).toContain("recorded_by_name");
    // Offline provenance: which device event and which encrypted snapshot an
    // incident review would correlate against.
    expect(rollCall.header).toContain("client_event_id");
    expect(rollCall.header).toContain("offline_snapshot_saved_at");
    const crewRollCall = table(input, "roll_call_crew_events.csv");
    expect(crewRollCall.header).toContain("source");
    expect(crewRollCall.header).toContain("client_event_id");
  });

  it("flattens each person into an import-ready contacts row", async () => {
    const { db, shop } = await seededShopContext();
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");

    const contacts = table(input, "contacts.csv");
    const peopleTable = table(input, "people.csv");
    // One row per person, exactly — the file a rival's import wizard maps.
    expect(contacts.rows.length).toBe(peopleTable.rows.length);

    const cell = (row: (typeof contacts.rows)[number], header: string) =>
      row[contacts.header.indexOf(header)];

    // Names arrive pre-split for wizards that demand first/last, with the
    // authoritative full name alongside.
    const dana = contacts.rows.find((row) => cell(row, "full_name") === "Dana Reyes");
    expect(dana).toBeDefined();
    if (!dana) return;
    expect(cell(dana, "first_name")).toBe("Dana");
    expect(cell(dana, "last_name")).toBe("Reyes");
    expect(String(cell(dana, "roles"))).toContain("owner");

    // The best card travels with its verification status — the seeded shop
    // has verified divers, and the status column is what keeps a fast import
    // honest in the destination system.
    const verified = contacts.rows.find((row) => cell(row, "certification_status") === "verified");
    expect(verified).toBeDefined();
    if (!verified) return;
    expect(cell(verified, "certification_level")).toBeTruthy();
    expect(cell(verified, "certification_agency")).toBeTruthy();
    expect(cell(verified, "certification_number")).toBeTruthy();

    // Nitrox status is a boolean per person, never a card dump.
    for (const row of contacts.rows) {
      expect([true, false]).toContain(cell(row, "nitrox_certified"));
    }
  });

  it("never lets a pending card outrank a verified one in contacts.csv", async () => {
    const { db, shop } = await seededShopContext();
    const now = new Date("2026-07-23T12:00:00.000Z");

    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Lapsed Card Lee", email: "lee@example.com" })
      .returning();
    await db.insert(certifications).values([
      {
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        level: "rescue",
        identifier: "PENDING-RESCUE-1",
        status: "pending",
      },
      {
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        level: "open_water",
        identifier: "CURRENT-OW-1",
        status: "verified",
      },
    ]);
    const [onlyPending] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Only Expired Erin", email: "erin@example.com" })
      .returning();
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: onlyPending.id,
      agency: "ssi",
      level: "advanced_open_water",
      identifier: "PENDING-AOW-1",
      status: "pending",
    });

    const input = await loadShopExportBundleInput(db, shop.id, now);
    if (!input) throw new Error("shop failed to load");
    const contacts = table(input, "contacts.csv");
    const cell = (row: (typeof contacts.rows)[number], header: string) =>
      row[contacts.header.indexOf(header)];

    // A verified lower card beats an unsighted higher one — the file hands the
    // next system the strongest *honest* claim, never the biggest one.
    const lee = contacts.rows.find((row) => cell(row, "full_name") === "Lapsed Card Lee");
    expect(lee).toBeDefined();
    if (!lee) return;
    expect(cell(lee, "certification_number")).toBe("CURRENT-OW-1");
    expect(cell(lee, "certification_level")).toBe("open_water");

    // A diver with nothing verified still exports what is on file, with the
    // status visible so the destination can weigh it.
    const erin = contacts.rows.find((row) => cell(row, "full_name") === "Only Expired Erin");
    expect(erin).toBeDefined();
    if (!erin) return;
    expect(cell(erin, "certification_number")).toBe("PENDING-AOW-1");
    expect(cell(erin, "certification_status")).toBe("pending");
  });

  /**
   * **"Said they hold no card" and "was never asked" were byte-identical in
   * contacts.csv** — blank agency, blank level, blank number — which is the
   * exact ambiguity `people.no_certification_declared_at` was added to remove,
   * reintroduced for the reader most likely to act on it. A destination system
   * mapping this file prompts staff to "complete" a blank record; a shop
   * reading it in a spreadsheet reads a gap as an oversight.
   */
  it("tells an uncertified diver from an unasked one in contacts.csv", async () => {
    const { db, shop } = await seededShopContext();
    const declaredAt = new Date("2026-07-20T09:00:00.000Z");
    const [stated] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Discover Scuba Dee",
        email: "dee@example.com",
        noCertificationDeclaredAt: declaredAt,
      })
      .returning();
    const [unasked] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Never Asked Nina", email: "nina@example.com" })
      .returning();
    // The same answer, refuted by a card the shop actually holds: the reader
    // ignores the stamp there, and so must the flat file — handing a
    // destination both a card and "there is no card" leaves it to arbitrate.
    const [carded] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Carded Cass",
        email: "cass@example.com",
        noCertificationDeclaredAt: declaredAt,
      })
      .returning();
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: carded.id,
      agency: "padi",
      level: "open_water",
      identifier: "CASS-OW-1",
      status: "verified",
    });
    // And the same answer a staffer has since said was never given.
    const [cleared] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Corrected Cleo",
        email: "cleo@example.com",
        noCertificationDeclaredAt: declaredAt,
        noCertificationClearedAt: new Date("2026-07-21T09:00:00.000Z"),
      })
      .returning();

    const [changedMind] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Changed Mind Cam",
        email: "cam@example.com",
        noCertificationDeclaredAt: declaredAt,
      })
      .returning();
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: changedMind.id,
      agency: "other",
      level: "open_water",
      identifier: null,
      status: "pending",
      selfDeclaredAt: new Date("2026-07-22T09:00:00.000Z"),
    });

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const contacts = table(input, "contacts.csv");
    const cell = (name: string, header: string) => {
      const row = contacts.rows.find((r) => r[contacts.header.indexOf("full_name")] === name);
      if (!row) throw new Error(`no contacts row for ${name}`);
      return row[contacts.header.indexOf(header)];
    };

    expect(cell("Discover Scuba Dee", "no_certification_declared_at")).toEqual(declaredAt);
    expect(cell("Never Asked Nina", "no_certification_declared_at")).toBeNull();
    expect(cell("Carded Cass", "no_certification_declared_at")).toBeNull();
    expect(cell("Corrected Cleo", "no_certification_declared_at")).toBeNull();
    // A diver who said "no card" and later declared a *rung* has made two
    // statements, and the staff reader renders the rung as the later, more
    // specific one. `bestCertification` ranks a still-unsighted claim too, so
    // without the `card` test this row would ship a level **and** "there is no
    // card" — the contradiction this column's own comment says it prevents.
    expect(cell("Changed Mind Cam", "certification_level")).toBe("open_water");
    expect(cell("Changed Mind Cam", "certification_status")).toBe("pending");
    expect(cell("Changed Mind Cam", "no_certification_declared_at")).toBeNull();

    // Never a value in a certification column: a "none" level is the
    // `certifications`-row mistake the ADR refuses, one file format down, and
    // the first importer to rank that column would put it on the ladder.
    expect(cell("Discover Scuba Dee", "certification_level")).toBeUndefined();
    expect(cell("Discover Scuba Dee", "certification_agency")).toBeUndefined();
    expect(cell("Discover Scuba Dee", "certification_status")).toBeUndefined();

    // people.csv is the dump, so it keeps the raw pair for anyone auditing what
    // the shop was actually told and who corrected it.
    const peopleTable = table(input, "people.csv");
    const peopleRow = peopleTable.rows.find(
      (r) => r[peopleTable.header.indexOf("id")] === cleared.id,
    );
    expect(peopleRow?.[peopleTable.header.indexOf("no_certification_declared_at")]).toEqual(
      declaredAt,
    );
    expect(peopleRow?.[peopleTable.header.indexOf("no_certification_cleared_at")]).not.toBeNull();
    expect(stated.id).toBeTruthy();
    expect(unasked.id).toBeTruthy();
  });

  it("exports issued waiver evidence linked to its template version", async () => {
    const { db, shop } = await seededShopContext();
    const before = await loadShopExportBundleInput(db, shop.id);
    if (!before) throw new Error("shop failed to load");
    const bookingsTable = table(before, "bookings.csv");
    const recordsBefore = table(before, "waiver_records.csv");
    const issuedBookingIds = new Set(
      recordsBefore.rows.map((row) => row[recordsBefore.header.indexOf("booking_id")]),
    );
    const unissuedBooking = bookingsTable.rows.find(
      (row) => !issuedBookingIds.has(row[bookingsTable.header.indexOf("id")]),
    );
    if (!unissuedBooking) throw new Error("seeded shop has no booking without a waiver request");
    const bookingId = String(unissuedBooking[bookingsTable.header.indexOf("id")]);

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    expect(issued.ok).toBe(true);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const records = table(input, "waiver_records.csv");
    const row = records.rows.find(
      (candidate) => candidate[records.header.indexOf("booking_id")] === bookingId,
    );
    expect(row).toBeDefined();
    // The signed text lives in waiver_templates.csv, keyed by the ids here;
    // a staff-attested paper signature keeps its attester; and the bearer
    // token hash never leaves the database.
    expect(row?.[records.header.indexOf("template_version")]).toBeTruthy();
    expect(records.header).toContain("recorded_by_person_id");
    expect(records.header).toContain("recorded_by_name");
    expect(records.header).toContain("started_at");
    expect(records.header).not.toContain("token_hash");
    expect(records.header).not.toContain("token_sealed");
  });

  it("round-trips an imported waiver's provenance through waiver_records.csv, contacts.csv, and the photo bundle (ADR 20260724-import-waiver-acceptance)", async () => {
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Imported Ida", email: "ida.import@example.com" })
      .returning();
    const template = await getCurrentWaiverTemplate(db, shop.id);
    if (!template) throw new Error("no template");
    const docUrl = "https://xyz.public.blob.vercel-storage.com/import-waivers/ida-waiver.jpg";
    const medicalDocUrl =
      "https://xyz.public.blob.vercel-storage.com/import-waivers/ida-medical.jpg";
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      bookingId: null,
      personId: diver.id,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "completed",
      tokenHash: "imported-ida",
      expiresAt: new Date("2026-01-01T00:00:00Z"),
      signedName: "Imported Ida",
      signatureMethod: "imported",
      consentedAt: new Date("2025-05-01T16:00:00Z"),
      signedAt: new Date("2025-05-01T16:00:00Z"),
      medicalReviewRequired: false,
      completedAt: new Date("2025-05-01T16:00:00Z"),
      importedFromLabel: "Old Blue Reef Divers",
      importSourceDocumentUrl: docUrl,
      importSourceMedicalDocumentUrl: medicalDocUrl,
    });

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");

    const records = table(input, "waiver_records.csv");
    const row = records.rows.find(
      (candidate) => candidate[records.header.indexOf("person_id")] === diver.id,
    );
    expect(row).toBeDefined();
    expect(row?.[records.header.indexOf("imported_from_label")]).toBe("Old Blue Reef Divers");
    expect(row?.[records.header.indexOf("import_source_document_url")]).toBe(docUrl);
    expect(row?.[records.header.indexOf("import_source_medical_document_url")]).toBe(medicalDocUrl);

    const contacts = table(input, "contacts.csv");
    const contactRow = contacts.rows.find(
      (candidate) => candidate[contacts.header.indexOf("email")] === "ida.import@example.com",
    );
    expect(contactRow).toBeDefined();
    expect(contactRow?.[contacts.header.indexOf("waiver_accepted")]).toBe(true);
    expect(contactRow?.[contacts.header.indexOf("waiver_signed_at")]).toBe("2025-05-01");
    expect(contactRow?.[contacts.header.indexOf("waiver_source_name")]).toBe(
      "Old Blue Reef Divers",
    );

    expect(input.photoUrls).toContain(docUrl);
    expect(input.photoUrls).toContain(medicalDocUrl);
  });

  it("excludes a live medical_review hold from contacts.csv's waiver_accepted signal", async () => {
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Held Holly", email: "holly.import@example.com" })
      .returning();
    const template = await getCurrentWaiverTemplate(db, shop.id);
    if (!template) throw new Error("no template");
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      bookingId: null,
      personId: diver.id,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "medical_review",
      tokenHash: "held-holly",
      expiresAt: nowDate(),
      signedName: "Held Holly",
      signatureMethod: "typed_consent",
      consentedAt: nowDate(),
      signedAt: nowDate(),
      medicalReviewRequired: true,
      completedAt: nowDate(),
    });

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const contacts = table(input, "contacts.csv");
    const contactRow = contacts.rows.find(
      (candidate) => candidate[contacts.header.indexOf("email")] === "holly.import@example.com",
    );
    expect(contactRow).toBeDefined();
    // A live referral hold is never mistaken for accepted, even in the flat
    // migration file — a downstream import must never read it as clearance.
    expect(contactRow?.[contacts.header.indexOf("waiver_accepted")]).toBe(false);
  });

  it("keeps soft-archived people in the bundle with their deleted_at", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Archived Alex",
      email: "alex@example.com",
    });
    if (!diver) throw new Error("diver insert failed");
    expect(await deleteDiver(db, shop.id, diver.id)).toBe(true);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const peopleTable = table(input, "people.csv");
    const row = peopleTable.rows.find(
      (candidate) => candidate[peopleTable.header.indexOf("id")] === diver.id,
    );
    expect(row).toBeDefined();
    expect(row?.[peopleTable.header.indexOf("deleted_at")]).toBeInstanceOf(Date);
  });

  it("carries an erased diver out as erased, not as their original details", async () => {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")));
    if (!owner) throw new Error("seed owner missing");
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Erased Erica",
      email: "erica@example.com",
      phone: "+1 305 555 0155",
    });
    if (!diver) throw new Error("diver insert failed");
    await db
      .update(people)
      .set({ dateOfBirth: "1988-02-02", diveInsurance: "DAN #55", emergencyContactName: "Kit" })
      .where(eq(people.id, diver.id));

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    if (!erased.ok) throw new Error(`erasure refused: ${erased.reason}`);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");

    // The full-shop export is migration-grade history and deliberately carries
    // archived people out with every column — so an erasure that stopped at the
    // roster read boundary would hand the diver's details straight back over in
    // the bundle. It must be erased at the row, and this is where that shows.
    for (const file of ["people.csv", "contacts.csv"] as const) {
      const exported = table(input, file);
      const cells = exported.rows.filter((candidate) =>
        candidate.some((cell) => cell === ANONYMIZED_PERSON_NAME),
      );
      expect(cells).toHaveLength(1);
      const serialized = JSON.stringify(cells[0]);
      for (const secret of ["Erased Erica", "erica@example.com", "0155", "1988-02-02", "DAN #55"]) {
        expect(serialized).not.toContain(secret);
      }
    }
    expect(JSON.stringify(input.tables.flatMap((exported) => exported.rows))).not.toContain(
      "erica@example.com",
    );
  });

  /**
   * The guard ADR 20260806-export-operational-records leans on. The test above
   * erases a diver with no notes, no leads, no messages and no checkouts, so it
   * proved nothing about the seven files that record went on to add — a table
   * exported but not swept by `anonymize.ts` hands a diver's details back out
   * through the bundle, and nothing mechanical would have said so (security
   * review, 2026-08-06).
   *
   * Written as "no file in the bundle contains any of these strings" rather than
   * per-file assertions on purpose: a future export file inherits the guard for
   * free, which is the property the ADR actually claims.
   */
  it("keeps an erased diver out of every file, including the operational records", async () => {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [diver] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Erasable Esme",
        email: "esme@example.com",
        phone: "+1 305 555 0424",
      })
      .returning();
    if (!diver || !owner) throw new Error("fixture insert failed");

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .limit(1);
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!course || !trip) throw new Error("seeded course/trip missing");

    await db.insert(internalNotes).values({
      shopId: shop.id,
      personId: diver.id,
      // i18n-exempt: a staff note fixture, stored verbatim — not product copy
      body: "Esme prefers the 5mm suit; ask before the second tank.",
      createdByPersonId: owner.id,
    });
    // A note filed under *somebody else* that names her. Keyed on the other
    // diver's `person_id`, so only the word-boundary body sweep can reach it.
    await db.insert(internalNotes).values({
      shopId: shop.id,
      personId: owner.id,
      // i18n-exempt: a staff note fixture, stored verbatim — not product copy
      body: "Split Erasable Esme from this group on the next boat.",
      createdByPersonId: owner.id,
    });
    await db.insert(activityEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: owner.id,
      // i18n-exempt: a seeded activity-trail fixture, stored verbatim
      message: "Erasable Esme checked in at the desk",
    });
    await db.insert(courseInquiries).values({
      shopId: shop.id,
      courseId: course.id,
      personId: diver.id,
      name: "Erasable Esme",
      email: "esme@example.com",
      phone: "+1 305 555 0424",
      experienceLevel: "never",
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    if (!erased.ok) throw new Error(`erasure refused: ${erased.reason}`);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const wholeBundle = JSON.stringify(
      input.tables.map((exported) => ({ file: exported.file, rows: exported.rows })),
    );
    for (const secret of ["Erasable Esme", "esme@example.com", "555 0424", "5mm suit"]) {
      expect(wholeBundle, `bundle still carries ${secret}`).not.toContain(secret);
    }
  });

  it("never leaks another shop's rows into the bundle", async () => {
    const { db, shop } = await seededShopContext();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef", timezone: "America/New_York" })
      .returning();
    const [rivalDiver] = await db
      .insert(people)
      .values({ shopId: rival.id, fullName: "Rival Rae" })
      .returning();

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const peopleTable = table(input, "people.csv");
    const idIndex = peopleTable.header.indexOf("id");
    expect(peopleTable.rows.some((row) => row[idIndex] === rivalDiver.id)).toBe(false);

    // And the rival's own export sees exactly its one person.
    const rivalInput = await loadShopExportBundleInput(db, rival.id);
    if (!rivalInput) throw new Error("rival shop failed to load");
    expect(table(rivalInput, "people.csv").rows).toHaveLength(1);
    expect(table(rivalInput, "bookings.csv").rows).toHaveLength(0);
  });

  it("returns null for an unknown shop instead of an empty bundle", async () => {
    const { db } = await seededShopContext();
    expect(await loadShopExportBundleInput(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("export privilege re-check (database, not JWT)", () => {
  async function personIdForEmail(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    email: string,
  ) {
    const [account] = await db
      .select({ personId: userAccounts.personId })
      .from(userAccounts)
      .where(eq(userAccounts.email, email))
      .limit(1);
    if (!account) throw new Error(`no account for ${email}`);
    return account.personId;
  }

  it("passes a current owner and refuses roles the token might overstate", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    expect(await canPersonExportShopData(db, shop.id, owner)).toBe(true);

    // A captain is staff everywhere else, but not accountable for the
    // roster's medical evidence.
    const captain = await personIdForEmail(db, DEV_STAFF_LOGINS.captain.email);
    expect(await canPersonExportShopData(db, shop.id, captain)).toBe(false);

    // A diver with no login can never export, and neither can an owner id
    // presented against a shop it does not belong to.
    const diver = await createDiver(db, { shopId: shop.id, fullName: "No Login Nora" });
    if (!diver) throw new Error("diver insert failed");
    expect(await canPersonExportShopData(db, shop.id, diver.id)).toBe(false);
    expect(await canPersonExportShopData(db, "00000000-0000-0000-0000-000000000000", owner)).toBe(
      false,
    );
  });

  it("revokes access the moment the accountable roles are removed, before any token expires", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    // The seed gives Dana both accountable roles; a demotion removes both.
    for (const role of ["owner", "manager"] as const) {
      await db
        .delete(personRoles)
        .where(and(eq(personRoles.personId, owner), eq(personRoles.role, role)));
    }
    expect(await canPersonExportShopData(db, shop.id, owner)).toBe(false);
  });

  it("revokes access the moment the login is disabled", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, owner));
    expect(await canPersonExportShopData(db, shop.id, owner)).toBe(false);
  });
});

describe("export counts (the settings page's cheap view)", () => {
  it("mirrors the bundle exactly — same files, same notes, same row counts", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const input = await loadShopExportBundleInput(db, shop.id);
    const counts = await loadShopExportCounts(db, shop.id);
    if (!input || !counts) throw new Error("shop failed to load");

    expect(counts.map((row) => row.file)).toEqual(input.tables.map((row) => row.file));
    for (const [index, row] of counts.entries()) {
      expect(row.note).toBe(input.tables[index].note);
      expect(row.count).toBe(input.tables[index].rows.length);
    }
  });

  it("returns null for an unknown shop", async () => {
    const { db } = await seededShopContext();
    expect(await loadShopExportCounts(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("photoUrls (ADR 20260724-export-bundled-photos)", () => {
  it("collects every image URL referenced anywhere in the bundle, deduped and sorted", async () => {
    const { db, shop } = await seededShopContext();
    const managedA = "https://xyz.public.blob.vercel-storage.com/sites/a.jpg";
    const managedB = "https://xyz.public.blob.vercel-storage.com/sites/b.jpg";
    // Dive-site imagery rather than certification cards: a card has carried no
    // photograph since ADR 20260811-retire-the-digital-card dropped the column,
    // so there is no card URL left for this bundle to gather. What is being
    // proved — dedup across rows, sorting, and that an unreferenced URL never
    // appears — is unchanged.
    await db.insert(diveSites).values([
      { shopId: shop.id, name: "Photo Reef One", satelliteImageUrl: managedA },
      // The same URL again, on another row and another column — must be
      // deduped, not fetched or counted twice.
      { shopId: shop.id, name: "Photo Reef Two", routeImageUrl: managedA },
      // A site with no imagery at all contributes nothing (not null, not
      // undefined, not an empty string).
      { shopId: shop.id, name: "Photo Reef Three" },
    ]);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    expect(input.photoUrls).toContain(managedA);
    expect(input.photoUrls.filter((url) => url === managedA)).toHaveLength(1);
    expect(input.photoUrls).not.toContain(managedB);
    expect(input.photoUrls).toEqual([...input.photoUrls].sort());
  });
});
