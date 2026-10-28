import { and, eq, getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { ANONYMIZED_PERSON_NAME } from "@/lib/anonymization";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { FLY_SAFE_EXPORT_EXCLUSIONS } from "@/test/export-fly-safe-exclusions";
import { schemaTableNames } from "@/test/schema-tables";
import { anonymizeDiver } from "./anonymize";
import { createDiver, deleteDiver } from "./divers";
import { canPersonExportShopData, loadShopExportBundleInput } from "./export";
import { EXCLUDED_TABLES } from "./export-table-classification.test-support";
import { EXPECTED_FILES, EXPORTED_TABLES } from "./export-test-fixtures";
import * as schema from "./schema";
import {
  activityEvents,
  bookings,
  certifications,
  courses,
  interests,
  internalNotes,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";
import { createTrip } from "./trips";
import { getCurrentWaiverTemplate, issueWaiverRequest } from "./waivers";

/** Tables whose data rides inside another file rather than its own CSV. */
const FOLDED_TABLES = [
  "person_roles", // people.csv / trip_assignments.csv `roles`
  "booking_payments", // bookings.csv payment_* columns
  "booking_referrals", // bookings.csv `referred_by_booking_id`
  "review_replies", // trip_reviews.csv `shop_reply`, the one live reply per review
];
/**
 * Columns on an exported table that deliberately stay out of the bundle. The
 * default for anything absent from this map is "must be exported" — a new
 * column has to be argued out, not quietly forgotten. `shop_id` is out on every
 * table (`SHOP_SCOPED`): it is the same value on every row of a single-shop
 * bundle, so a table that excludes nothing else needs no entry.
 */
const SHOP_SCOPED = "shop_id";
const EXCLUDED_COLUMNS: Record<string, string[]> = {
  // `shop_id` is the same value on every row of a single-shop bundle.
  shops: [
    "jurisdiction",
    "is_demo",
    "latitude",
    "longitude",
    // Setup-checklist progress, not a shop record (issue #712): a shop
    // restoring from a backup *should* be asked about its units again.
    "units_confirmed_at",
    // Proof the shop controls its contact address, so it may be Reply-To (issue
    // #1288): DiveDay's own, so a restored shop is asked to confirm again.
    "contact_email_confirmed_at",
    // The inbound reply address's routing token (ADR 20260907-two-way-inbox):
    // a credential in all but name, so a restored shop is minted a fresh one.
    "inbound_email_token",
    // H-118 and item 35: an address, its consent, confirmation and send state; a restore asks afresh.
    "shore_alert_email",
    "shore_alert_consent_at",
    "shore_alert_consent_by_person_id",
    "shore_alert_confirmed_at",
    "bookkeeper_email",
    "bookkeeper_email_set_at",
    "bookkeeper_email_set_by_person_id",
    "bookkeeper_sent_month",
    "bookkeeper_confirmed_at",
    "bookkeeper_confirm_token_hash",
    "bookkeeper_confirm_expires_at",
    "bookkeeper_stop_token_hash",
    "bookkeeper_bounced_at",
    // #2450 name review flags and the offline erasure cutoff are DiveDay-only shop state.
    "name_flagged_at",
    "name_cleared_at",
    "offline_erasure_epoch",
  ], // DiveDay-side config, not shop records
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
  trips: [
    "shop_id",
    "recap_shoutout", // recap copy travels with recap_photos.csv
    "recap_auto_send_paused", // auto-send countdown / pause is ephemeral operational state
    "recap_auto_send_at",
    // When this installation alerted the owners, and the shore contact (H-118),
    // about a stale after-dive roll call: once-per-departure send state, like
    // `recap_auto_send_at`. The roll-call events travel in their own file.
    "roll_call_alerted_at",
    "roll_call_shore_alerted_at",
    // How many times this installation has re-issued the calendar events whose
    // UIDs are `trip-<uuid>@diveday`: a counter about *our* published revisions.
    // A re-imported bundle mints new trip ids and so new UIDs, and no subscriber
    // holds a revision to compare. Same class as `pending_checkout_intent_id`.
    "revision",
    // A pending "the divers still have the old time" between a move and its
    // notice: in-flight messaging state on this installation, cleared by the
    // send, and a re-imported departure has no divers who were told anything.
    "divers_told_starts_at",
    "divers_told_meeting_point",
    // A rehearsal never reaches the bundle at all (ADR
    // 20261012-rehearsal-departures): every exported departure is a real one,
    // so this column would read false on every row it could appear on.
    "is_rehearsal",
  ],
  trip_series_skips: ["id", "shop_id"],
  trip_dives: [],
  trip_assignments: [],
  bookings: [
    "shop_id",
    "pending_checkout_intent_id", // in-flight Stripe attempt, meaningless elsewhere
    "identity_unconfirmed_at", // H-13 review state, not a shop record
    "identity_booked_as", // H-13 review state: the name the held booking was made under
    "reschedule_missed_from", // a notice owed to a held seat (#2445), cleared once sent
    "reschedule_missed_place", // the same: whether the meeting point moved too
    ...FLY_SAFE_EXPORT_EXCLUSIONS,
    "identity_matched_by", // H-13 review state: why the booking was matched
    // A held seat's desk-recorded emergency contact (#2145): read only while
    // the seat is held, and moved onto the new record at a split.
    "held_emergency_contact_name",
    "held_emergency_contact_phone",
    "paid_rental_kinds", // held-seat prep state: the order lines already carry what was paid for
    // Seat-claim linkage (ADR 20260804-seat-claim-links): a pointer at another
    // booking row's id, which does not survive a re-import — same class as
    // pending_checkout_intent_id.
    "party_lead_booking_id",
    "claimed_at", // claim-flow operational state, same reasoning as identity_unconfirmed_at
  ],
  trip_last_minute_promos: [
    "shop_id",
    "stripe_coupon_id", // provider linkage, useless outside this Stripe account
    "stripe_promotion_code_id",
  ],
  // The member row's surrogate id says nothing beyond (pair_id, booking_id),
  // which are both exported.
  buddy_pair_members: ["shop_id", "id"],
  waiver_records: [
    "shop_id",
    "template_body", // the frozen copy; waiver_templates.csv carries the text
    "token_hash", // bearer credential — never exported
    // The openable copy of that same credential, kept only while the link is live
    // (ADR 20260820-waiver-links-are-reused-not-reissued). Stronger than the hash: it
    // *can* be opened, and an export bundle leaves DiveDay's custody entirely — to a
    // shop's own S3, a laptop, an email attachment. A destination issues its own links.
    "token_sealed",
    "draft_signer_name", // unsubmitted draft state, not a signed record
    "draft_acknowledged",
    "draft_medical_answers",
    "draft_guardian", // the guardian section as typed, same class as the three above
    "draft_shop_answers", // the shop questions as typed before signing, same class
    "draft_medical_alert", // the medical alert as typed before signing, same class
    // Delivery plumbing is provider state: a destination issues its own link and delivery.
    "delivery_status",
    "delivery_provider_message_id",
    "delivery_provider_status",
    "delivery_provider_status_at",
    "delivery_error",
    // The physician's evaluation itself (issue #1252), and the diver's own copy
    // before an answer (`diver_medical_form_url`, issue #2797). The *facts* are
    // exported; the documents are not, for the reason `token_sealed` is not.
    //
    // **Revisited when the read path landed** (issue #1283), and unchanged. The
    // app can now fetch these bytes back — through one permission-gated route,
    // signed as the uploader credential — but the object itself stays private:
    // the media bucket blocks all public access and `medical-clearances/` has
    // no CloudFront behaviour. So a URL in a CSV would still point at something
    // its recipient cannot fetch, and a bundle leaves DiveDay's custody
    // entirely. A broken link in an export is not better than an absent one,
    // and the file being retrievable *inside* the product is precisely why it
    // does not need to travel outside it.
    "medical_clearance_document_url",
    "diver_medical_form_url",
    "doctor_unlock_failures", // abuse control on the doctor's page, not part of the record
  ],
  // `created_at` is when DiveDay wrote the row; `occurred_at` is when the
  // money actually moved, and that is the one a reader replays.
  booking_payment_events: ["shop_id", "created_at"],
  booking_checkouts: [
    "shop_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    "stripe_customer_id", // provider linkage, same as stripe_account_id above
    // An ephemeral Stripe Checkout link that stopped resolving when the session
    // expired — same reasoning as tips.checkout_url.
    "checkout_url",
    "stripe_payment_intent_id", // provider linkage for a later refund, same as stripe_account_id
  ],
  // The join row's surrogate id says nothing beyond (checkout_id, booking_id),
  // which are both exported — same reasoning as buddy_pair_members.id.
  booking_checkout_bookings: ["shop_id", "id"],
  incident_reports: [
    "shop_id",
    // H-142, #2694: send leases and the alert's subject row id, like `roll_call_alerted_at`.
    "missing_alerted_at",
    "missing_all_clear_claimed_at",
    "missing_all_clear_leased_at",
    "missing_subject_row_id",
    "missing_alert_attempting_person_ids", // #2828: a send in flight; the reached set is exported
  ],
  rental_fit_profiles: [
    "shop_id",
    // Storage-only compatibility for the previous serving release.
    "rents_mask_fins",
    // A DiveDay-side discriminator, not a fact about the diver: it separates a
    // row that states a fit from one holding only their note (schema.ts,
    // `fit_stated_at`). The import rebuilds it correctly on its own — a row
    // carrying any size is a stated fit and `src/db/import.ts` stamps it — so
    // exporting it would carry an internal flag out and re-derive it anyway.
    "fit_stated_at",
  ],
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
    // Matches a later refund or dispute event to this order; provider
    // linkage like the two above (ADR 20261009-stripe-reversals-reach-diveday).
    "stripe_payment_intent_id",
    // A lock stamp for one Stripe round trip, null on every settled row
    // (ADR 20261009-counter-payments); nothing a shop would read in a backup.
    "counter_claimed_at",
    "auto_void_failed_at", // the nightly void sweep's retry state (issue #2304), not the sale's
    "auto_void_failures", // same
  ],
  tips: [
    "shop_id",
    "stripe_account_id", // provider linkage, useless outside this Stripe account
    "stripe_customer_id", // provider linkage, same as stripe_account_id above
    "checkout_url", // an ephemeral Stripe Checkout link, same reasoning as booking_checkouts
    "stripe_payment_intent_id", // provider linkage, same reasoning as booking_checkouts
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
  shop_promo_codes: [
    "shop_id",
    "stripe_coupon_id", // provider linkage, useless outside this Stripe account
    "stripe_promotion_code_id",
  ],
  // `row_version` for the same reason as `dive_sites` above: it counts saves
  // in this installation's editor and is meaningless in another.
  courses: ["shop_id", "row_version"],
  // The digest is recomputed from the original on import: not the shop's words.
  shop_text_translations: ["id", "shop_id", "source_digest", "created_at"],
};
function table(
  input: NonNullable<Awaited<ReturnType<typeof loadShopExportBundleInput>>>,
  file: string,
) {
  const found = input.tables.find((candidate) => candidate.file === file);
  if (!found) throw new Error(`missing table ${file}`);
  return found;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("schema coverage", () => {
  it("forces every schema table to be exported, folded, or deliberately excluded", () => {
    const tableNames = schemaTableNames();
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
    const { db, shop } = ctx;
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
        .filter((column) => column !== SHOP_SCOPED)
        .filter((column) => !(EXCLUDED_COLUMNS[name] ?? []).includes(column));
      if (missing.length > 0) undecided[name] = missing;
    }
    // The table-level test above passes happily when a *new column* on an
    // already-exported table never reaches the bundle — and a column missing
    // from the bundle is a fact a leaving shop loses, whether or not anything
    // can read it back. That is the whole reason, and it was stated as a
    // re-import for a year while only contacts had one (issue #1771). Adding a
    // column now forces a decision here too.
    //
    // For `dive_sites.csv` it is now both: a column that never reaches the
    // bundle cannot be restored either, and `dive-site-import.test.ts` holds
    // the other end by asserting the importer knows every column this bundle
    // writes.
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
      "interests.csv",
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Imported Ida", email: "ida.import@example.com" })
      .returning();
    const template = await getCurrentWaiverTemplate(db, shop.id);
    if (!template) throw new Error("no template");
    const docUrl = "https://diveday-media.s3.us-east-1.amazonaws.com/import-waivers/ida-waiver.jpg";
    const medicalDocUrl =
      "https://diveday-media.s3.us-east-1.amazonaws.com/import-waivers/ida-medical.jpg";
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
      // Ids and timestamps are generated, and a random uuid can carry "0155"
      // as easily as a phone can: read only the cells that hold words.
      const UUID_OR_INSTANT = /^([0-9a-f]{8}-[0-9a-f-]{27}|\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/;
      const serialized = JSON.stringify(
        (cells[0] ?? []).filter(
          (cell) => !(typeof cell === "string" && UUID_OR_INSTANT.test(cell)),
        ),
      );
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
   * erases a diver with no notes, no interests, no messages and no checkouts, so it
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
    const { db, shop } = ctx;
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
      code: "counter_check_in",
      params: { diver: "Erasable Esme" },
    });
    await db.insert(interests).values({
      shopId: shop.id,
      scope: "date",
      askedBy: "diver",
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
    const { db, shop } = ctx;
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

  /**
   * **`bookings.csv` is the file a shop diffs against last week's**, so its row
   * order has to be one a person can predict. `created_at` alone is not a
   * total order: `createBooking` stamps it from the application clock
   * (`nowDate()`, millisecond resolution) rather than the column's
   * `defaultNow()`, so a party written in one transaction can tie in
   * production and every booking a test or e2e run writes ties by
   * construction. The tie used to go to `asc(bookings.id)` — a
   * `defaultRandom()` uuid, a different answer in every database holding the
   * same rows (issue #1753).
   *
   * Its own shop, so the seeded bundle's rows cannot mask the ordering, and
   * the ids are forced with the **higher** one on the alphabetically-first
   * diver, so the old clause answers the exact opposite every time.
   */
  it("orders bookings.csv on the diver's name when seats share an instant, not on a random uuid", async () => {
    const { db } = ctx;
    const [shop] = await db
      .insert(shops)
      .values({ name: "Tie Break Divers", slug: "tie-break", timezone: "America/New_York" })
      .returning();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt: new Date("2026-08-01T13:00:00.000Z"),
      endsAt: new Date("2026-08-01T17:00:00.000Z"),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("test trip insert failed");
    const diver = async (fullName: string) => {
      const [person] = await db.insert(people).values({ shopId: shop.id, fullName }).returning();
      const [booking] = await db
        .insert(bookings)
        .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: person.id })
        .returning();
      return booking;
    };
    const zulu = await diver("Zulu Mbeki");
    const alpha = await diver("Alpha Nord");

    const together = new Date("2026-07-21T13:30:00.000Z");
    const lower = "00000000-0000-4000-8000-000000000001";
    const higher = "00000000-0000-4000-8000-000000000002";
    await db
      .update(bookings)
      .set({ createdAt: together, id: lower })
      .where(eq(bookings.id, zulu.id));
    await db
      .update(bookings)
      .set({ createdAt: together, id: higher })
      .where(eq(bookings.id, alpha.id));

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const bookingsTable = table(input, "bookings.csv");
    const nameIndex = bookingsTable.header.indexOf("person_name");
    expect(bookingsTable.rows.map((row) => row[nameIndex])).toEqual(["Alpha Nord", "Zulu Mbeki"]);
  });

  /**
   * **`buddy_pairs.csv` is a file a person reads too** (H-81, issue #1795).
   * The old clause was `asc(created_at), asc(pair_id)`, and every member row of
   * a team shares its `pair_id`, so two teams formed in one instant fell
   * through to whatever Postgres returned. Now: each team's rows together,
   * teams by formation time, then by their members' names, `pair_id` last.
   *
   * The team whose members sort first is handed the **higher** `pair_id`, and
   * the later-formed team the lower one with the earliest name, so neither the
   * old key nor a name-only key gives the right answer.
   */
  it("orders buddy_pairs.csv by team, then the members' names, never by a random pair id", async () => {
    const { db } = ctx;
    const [shop] = await db
      .insert(shops)
      .values({ name: "Buddy Order Divers", slug: "buddy-order", timezone: "America/New_York" })
      .returning();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt: new Date("2026-08-01T13:00:00.000Z"),
      endsAt: new Date("2026-08-01T17:00:00.000Z"),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("test trip insert failed");
    const [staffer] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Rita Moreno" })
      .returning();
    const seat = async (fullName: string) => {
      const [person] = await db.insert(people).values({ shopId: shop.id, fullName }).returning();
      const [booking] = await db
        .insert(bookings)
        .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: person.id })
        .returning();
      return booking.id;
    };

    const together = new Date("2026-07-21T13:30:00.000Z");
    const later = new Date("2026-07-21T14:00:00.000Z");
    const member = (pairId: string, bookingId: string, createdAt: Date) => ({
      shopId: shop.id,
      tripId: trip.id,
      pairId,
      bookingId,
      pairedByPersonId: staffer.id,
      createdAt,
    });
    await db.insert(schema.buddyPairMembers).values([
      // Formed together; Bea + Yuki sorts after Ana + Zoe on the first name.
      member("00000000-0000-4000-8000-000000000001", await seat("Yuki Sato"), together),
      member("00000000-0000-4000-8000-000000000001", await seat("Bea Lund"), together),
      member("00000000-0000-4000-8000-000000000009", await seat("Zoe Adler"), together),
      member("00000000-0000-4000-8000-000000000009", await seat("Ana Ruiz"), together),
      // Formed later, so it comes last despite the earliest name of all.
      member("00000000-0000-4000-8000-000000000000", await seat("Aaron Lee"), later),
      member("00000000-0000-4000-8000-000000000000", await seat("Mia Cho"), later),
    ]);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    const buddyTable = table(input, "buddy_pairs.csv");
    const nameIndex = buddyTable.header.indexOf("person_name");
    expect(buddyTable.rows.map((row) => row[nameIndex])).toEqual([
      "Ana Ruiz",
      "Zoe Adler",
      "Bea Lund",
      "Yuki Sato",
      "Aaron Lee",
      "Mia Cho",
    ]);
  });

  it("returns null for an unknown shop instead of an empty bundle", async () => {
    const { db } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
    const owner = await personIdForEmail(db, DEV_STAFF_LOGINS.owner.email);
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, owner));
    expect(await canPersonExportShopData(db, shop.id, owner)).toBe(false);
  });
});
