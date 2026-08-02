// @vitest-environment node
import { and, eq, getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { ANONYMIZED_PERSON_NAME } from "@/lib/anonymization";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createDiver, deleteDiver } from "./divers";
import { canPersonExportShopData, loadShopExportBundleInput, loadShopExportCounts } from "./export";
import { recordCrewAttestation } from "./manifests";
import * as schema from "./schema";
import {
  certifications,
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
  "contacts.csv",
  "people.csv",
  "certifications.csv",
  "specialty_certifications.csv",
  "nitrox_certifications.csv",
  "trips.csv",
  "trip_series.csv",
  "trip_schedule_days.csv",
  "trip_dives.csv",
  "trip_requirements.csv",
  "trip_assignments.csv",
  "staff_shifts.csv",
  "bookings.csv",
  "waitlist_entries.csv",
  "last_minute_list.csv",
  "trip_last_minute_promos.csv",
  "roll_call_events.csv",
  "roll_call_crew_attestations.csv",
  "waiver_templates.csv",
  "waiver_records.csv",
  "rental_fit.csv",
  "prior_visits.csv",
  "orders.csv",
  "order_line_items.csv",
  "tips.csv",
  "dive_sites.csv",
  "dive_site_creatures.csv",
  "dive_site_moments.csv",
  "recap_photos.csv",
  "trip_reviews.csv",
  "shop_promo_codes.csv",
  "courses.csv",
  "course_paths.csv",
  "course_path_steps.csv",
];

/** Schema tables that get their own CSV in the bundle. */
const EXPORTED_TABLES = [
  "shops",
  "people",
  "certifications",
  "specialty_certifications",
  "nitrox_certifications",
  "trips",
  "trip_series",
  "trip_schedule_days",
  "trip_dives",
  "trip_requirements",
  "trip_assignments",
  "staff_shifts",
  "bookings",
  "trip_waitlist_entries",
  "last_minute_list_entries",
  "trip_last_minute_promos",
  "roll_call_events",
  "roll_call_crew_attestations",
  "waiver_templates",
  "waiver_records",
  "rental_fit_profiles",
  "prior_visits",
  "orders",
  "order_line_items",
  "tips",
  "dive_sites",
  "dive_site_creatures",
  "dive_site_moments",
  "recap_photos",
  "trip_reviews",
  "shop_promo_codes",
  "courses",
  "course_paths",
  "course_path_steps",
];

/** Tables whose data rides inside another file rather than its own CSV. */
const FOLDED_TABLES = [
  "person_roles", // people.csv / trip_assignments.csv `roles`
  "booking_payments", // bookings.csv payment_* columns
];

/**
 * Deliberate exclusions — each must be defensible in the bundle README and on
 * the export page. Adding a schema table without deciding its export fate
 * fails the coverage test below.
 */
const EXCLUDED_TABLES = [
  "activity_events", // in-product operational feed, not a migration record
  "internal_notes", // private staff working context; deliberately not portable in this first slice
  "notification_deliveries", // operational plumbing, not shop records
  "notification_delivery_attempts",
  "notification_send_queue", // operational retry state, not shop records
  "notification_rate_limit_state", // provider coordination, not shop records
  "shop_stripe_accounts", // provider linkage, useless outside Stripe
  "booking_checkouts", // payment attempts; outcomes live in bookings/orders
  "booking_checkout_bookings",
  "shop_promo_redemptions", // points at a checkout attempt; Stripe holds the authoritative count
  "payment_operation_intents", // internal reconciliation ledger, not a shop record (CR-005)
  "stripe_webhook_events", // provider webhook-delivery ledger, not a shop record — same reasoning as payment_operation_intents
  "media_deletion_attempts", // internal reconciliation ledger, not a shop record (CR-012)
  "global_dive_sites", // DiveDay's shared catalog; the shop's copies export
  "global_dive_site_versions",
  "user_accounts", // credentials are never exported
  "booking_capabilities", // bearer credentials, never exported — same reasoning as user_accounts
  "account_tokens", // bearer credentials (email verify / password reset), never exported
  "calendar_feeds", // bearer credentials for a staff calendar subscription, never exported
  "course_inquiries", // a marketing lead, not a shop operational record — same reasoning as activity_events
  "last_minute_list_unsubscribe_tokens", // bearer credentials, never exported — same reasoning as booking_capabilities
  "person_courtesy_email_unsubscribe_tokens", // bearer credentials, never exported — same reasoning as booking_capabilities
  // The shop's own Meta access token (sealed) plus the provider linkage around
  // it. Never exported, for both reasons already on this list: it is a live
  // credential like user_accounts, and a phone number id is provider linkage
  // useless outside that Meta account, like shop_stripe_accounts.
  "shop_whatsapp_accounts",
];

/**
 * Columns on an exported table that deliberately stay out of the bundle. The
 * default for anything absent from this map is "must be exported" — a new
 * column has to be argued out, not quietly forgotten.
 */
const EXCLUDED_COLUMNS: Record<string, string[]> = {
  // `shop_id` is the same value on every row of a single-shop bundle.
  shops: ["jurisdiction", "is_demo"], // DiveDay-side config, not shop records
  staff_shifts: ["shop_id"],
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
  trips: ["shop_id", "recap_shoutout"], // recap copy travels with recap_photos.csv
  trip_series: ["shop_id"],
  trip_dives: [],
  trip_requirements: ["shop_id"],
  trip_assignments: [],
  bookings: [
    "shop_id",
    "pending_checkout_intent_id", // in-flight Stripe attempt, meaningless elsewhere
    "identity_unconfirmed_at", // H-13 review state, not a shop record
  ],
  trip_waitlist_entries: ["shop_id"],
  last_minute_list_entries: ["shop_id"],
  trip_last_minute_promos: [
    "shop_id",
    "stripe_coupon_id", // provider linkage, useless outside this Stripe account
    "stripe_promotion_code_id",
  ],
  roll_call_events: ["shop_id"],
  roll_call_crew_attestations: ["shop_id"],
  waiver_templates: ["shop_id"],
  waiver_records: [
    "shop_id",
    "template_body", // the frozen copy; waiver_templates.csv carries the text
    "token_hash", // bearer credential — never exported
    "draft_signer_name", // unsubmitted draft state, not a signed record
    "draft_acknowledged",
    "draft_medical_answers",
  ],
  rental_fit_profiles: ["shop_id"],
  prior_visits: [
    "shop_id",
    // The re-import idempotency key, derived from the columns that *are*
    // exported (src/lib/import.ts, `priorVisitDedupeKey`) — a DiveDay-side
    // implementation detail, not a fact about the shop's history.
    "dedupe_key",
    "created_at", // when the import ran; `imported_at` already carries that
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
  ],
  dive_site_creatures: ["shop_id"],
  dive_site_moments: ["shop_id"],
  recap_photos: ["shop_id"],
  trip_reviews: ["shop_id"],
  shop_promo_codes: [
    "shop_id",
    "stripe_coupon_id", // provider linkage, useless outside this Stripe account
    "stripe_promotion_code_id",
  ],
  courses: ["shop_id"],
  course_paths: ["shop_id"],
  // A step is scoped by the path it hangs off, which is already in the bundle.
  course_path_steps: [],
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
    ]) {
      expect(table(input, file).rows.length).toBeGreaterThan(0);
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
  });

  /**
   * A crew attestation is part of the trip's safety record — the half of the
   * head count that says whether the divemaster came back — so it leaves with
   * the shop like every other roll-call row (DOM-H1/DOM-H3). It arrived with the
   * crew-attestation change and had no export decision at all, which the schema
   * coverage guard above caught.
   */
  it("exports the crew half of the head count, with who counted and what the denominator was", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await db
      .select({ id: trips.id, title: trips.title })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.status, "scheduled")))
      .limit(1);
    if (!trip) throw new Error("seeded shop has no scheduled trip");
    const [staff] = await db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!staff) throw new Error("seeded shop has no owner");

    const recorded = await recordCrewAttestation(db, {
      shopId: shop.id,
      tripId: trip.id,
      attestedByPersonId: staff.id,
      crewAboard: 2,
      checkpoint: "after_dive_1",
      note: "Both DMs back on the ladder",
      occurredAt: new Date("2026-07-23T15:30:00.000Z"),
    });
    expect(recorded.ok).toBe(true);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");
    const attestations = table(input, "roll_call_crew_attestations.csv");
    const cell = (row: (typeof attestations.rows)[number], header: string) =>
      row[attestations.header.indexOf(header)];
    const row = attestations.rows.find((entry) => cell(entry, "trip_id") === trip.id);
    expect(row).toBeDefined();
    if (!row) return;
    // Denormalized the same way roll_call_events.csv is, so an incident review
    // reads the file without joining by hand.
    expect(cell(row, "trip_title")).toBe(trip.title);
    expect(cell(row, "checkpoint")).toBe("after_dive_1");
    expect(cell(row, "crew_aboard")).toBe(2);
    // Evidence of what the assignment list said at the time, not a claim about
    // now — the server, never the caller, supplied it.
    expect(cell(row, "crew_assigned")).toBe(recorded.ok ? recorded.crewAssigned : Number.NaN);
    // A head count is never anonymous.
    expect(cell(row, "attested_by_person_id")).toBe(staff.id);
    expect(cell(row, "attested_by_name")).toBe(staff.fullName);
    expect(cell(row, "note")).toBe("Both DMs back on the ladder");
    expect(cell(row, "occurred_at")).toEqual(new Date("2026-07-23T15:30:00.000Z"));

    // The settings page's count comes off the same table, so the two can't drift.
    const counts = await loadShopExportCounts(db, shop.id);
    expect(counts?.find((entry) => entry.file === "roll_call_crew_attestations.csv")?.count).toBe(
      attestations.rows.length,
    );
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

  it("never lets an expired card outrank a current one in contacts.csv", async () => {
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
        identifier: "EXPIRED-RESCUE-1",
        status: "verified",
        expiresAt: "2025-01-01",
      },
      {
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        level: "open_water",
        identifier: "CURRENT-OW-1",
        status: "verified",
        expiresAt: null,
      },
    ]);
    const [onlyExpired] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Only Expired Erin", email: "erin@example.com" })
      .returning();
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: onlyExpired.id,
      agency: "ssi",
      level: "advanced_open_water",
      identifier: "EXPIRED-AOW-1",
      status: "verified",
      expiresAt: "2024-06-01",
    });

    const input = await loadShopExportBundleInput(db, shop.id, now);
    if (!input) throw new Error("shop failed to load");
    const contacts = table(input, "contacts.csv");
    const cell = (row: (typeof contacts.rows)[number], header: string) =>
      row[contacts.header.indexOf(header)];

    // A current lower card beats an expired higher one — an expired card is
    // history, not evidence, and must not migrate as a live claim.
    const lee = contacts.rows.find((row) => cell(row, "full_name") === "Lapsed Card Lee");
    expect(lee).toBeDefined();
    if (!lee) return;
    expect(cell(lee, "certification_number")).toBe("CURRENT-OW-1");
    expect(cell(lee, "certification_level")).toBe("open_water");
    expect(cell(lee, "certification_expires_at")).toBeNull();

    // A diver with nothing current still exports their history — with the
    // expiry visible so the destination can enforce it.
    const erin = contacts.rows.find((row) => cell(row, "full_name") === "Only Expired Erin");
    expect(erin).toBeDefined();
    if (!erin) return;
    expect(cell(erin, "certification_number")).toBe("EXPIRED-AOW-1");
    expect(cell(erin, "certification_expires_at")).toBe("2024-06-01");
  });

  it("exports issued waiver evidence linked to its template version", async () => {
    const { db, shop } = await seededShopContext();
    const before = await loadShopExportBundleInput(db, shop.id);
    if (!before) throw new Error("shop failed to load");
    const bookingsTable = table(before, "bookings.csv");
    const bookingId = String(bookingsTable.rows[0][bookingsTable.header.indexOf("id")]);

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
      expiresAt: new Date(),
      signedName: "Held Holly",
      signatureMethod: "typed_consent",
      consentedAt: new Date(),
      signedAt: new Date(),
      medicalReviewRequired: true,
      completedAt: new Date(),
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
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Photo Person", email: "photo.person@example.com" })
      .returning();
    const managedA = "https://xyz.public.blob.vercel-storage.com/cards/a.jpg";
    const managedB = "https://xyz.public.blob.vercel-storage.com/cards/b.jpg";
    await db.insert(certifications).values([
      {
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        level: "open_water",
        identifier: "PHOTO-1",
        cardImageUrl: managedA,
      },
      {
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        level: "advanced_open_water",
        identifier: "PHOTO-2",
        // Same URL again — must be deduped, not fetched/counted twice.
        cardImageUrl: managedA,
      },
    ]);
    // A card with no image contributes nothing (not null, not undefined).
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      level: "rescue",
      identifier: "PHOTO-3",
    });

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    expect(input.photoUrls).toContain(managedA);
    expect(input.photoUrls.filter((url) => url === managedA)).toHaveLength(1);
    expect(input.photoUrls).not.toContain(managedB);
    expect(input.photoUrls).toEqual([...input.photoUrls].sort());
  });
});
