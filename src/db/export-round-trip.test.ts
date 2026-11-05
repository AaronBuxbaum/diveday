import { describe, expect, it } from "vitest";
import { prepareDiveSiteCreaturesImport, prepareDiveSiteImport } from "@/lib/dive-site-import";
import { buildCsv, type CsvValue } from "@/lib/export";
import { fileScopedShopContext, unseededTestDb } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { commitContactImport } from "@/test/words-wiring";
import { commitDiveSiteImport } from "./dive-site-import";
import { loadShopExportBundleInput } from "./export";
import { people, shops } from "./schema";

/**
 * **A shop exported and read straight back** (#3889). The export tests pin each
 * file's columns and the importer tests pin each importer; this runs one
 * through the other. A seeded shop's bundle goes into an empty shop through
 * every importer DiveDay has, the empty shop is exported again, and the files
 * an importer reads must come back row for row, apart from the ids and the
 * provenance the importer mints.
 *
 * Every other file is named below with the reason nothing reads it back, so a
 * file added to the bundle is a decision here rather than a silent loss.
 */
const ctx = fileScopedShopContext();

/** The files an importer reads, and the columns that must survive the trip. */
const READ_BACK = {
  // The contacts importer (ADR 20260723-contact-importer) reads the export's
  // own headers by name. It carries who the diver is and who to call; the
  // rest of the row is DiveDay's own bookkeeping about that person here.
  "people.csv": [
    "full_name",
    "email",
    "phone",
    "date_of_birth",
    "dive_insurance",
    "emergency_contact_name",
    "emergency_contact_phone",
  ],
  // The dive-site importer reads DiveDay's own file and refuses a column it
  // does not know (issue #1771), so everything but the minted ids survives.
  "dive_sites.csv": "all but ids",
  "dive_site_creatures.csv": "all but ids",
} as const;

/** Columns another shop's importer mints afresh, never carries. */
const MINTED = new Set(["id", "dive_site_id", "created_at"]);

// A diver's people.csv row lands as a diver, whatever `roles` says: an import
// that granted staff powers would let a file decide who can open the shop's
// medical answers. Roles are given by an owner, in the shop.
const STAFF_ROLES_ARE_NOT_IMPORTED = "people.csv roles";

const EVIDENCE =
  "a record of something that happened in this shop (a signature, a roll call, a payment, a review); minting it in another shop would be a record of something that never happened there";
const SCHEDULE =
  "the shop's live schedule and work in flight; the contacts import is inert on purpose (ADR 20260725-import-prior-visits) so a migrated file can never reach the dock or capacity";
const PER_PERSON =
  "one row per card, fit or note keyed by a person_id the target shop does not have; the contacts importer reads one flat row per diver, so reading these back needs a join the bundle does not make";
const CONFIGURATION = "shop setup with no importer yet; a shop moving in sets it up by hand";
const GEAR =
  "the gear importer reads another system's list and does not know DiveDay's `label` header; teaching it naively would bring retired and deleted units back in service";

/** Every bundle file nothing reads back, and why. */
const NOT_READ_BACK: Record<string, string> = {
  "shop.csv": "the shop being restored into already exists and keeps its own settings",
  "contacts.csv": "derived from people.csv, so it comes back when people do",
  "boats.csv": CONFIGURATION,
  "trip_lenses.csv": CONFIGURATION,
  "waiver_templates.csv": CONFIGURATION,
  "course_forms.csv": CONFIGURATION,
  "course_form_versions.csv": CONFIGURATION,
  "course_form_requirements.csv": CONFIGURATION,
  "courses.csv": CONFIGURATION,
  "dive_packages.csv": CONFIGURATION,
  "shop_promo_codes.csv": CONFIGURATION,
  "pre_departure_checklist_items.csv": CONFIGURATION,
  "customer_gear_reminder_settings.csv": CONFIGURATION,
  "shop_text_translations.csv": CONFIGURATION,
  "cards.csv": PER_PERSON,
  "rental_fit.csv": PER_PERSON,
  "staff_credentials.csv": PER_PERSON,
  "prior_visits.csv": PER_PERSON,
  "imported_payment_history.csv": PER_PERSON,
  "internal_notes.csv": PER_PERSON,
  "gear_items.csv": GEAR,
  "gear_service_events.csv": GEAR,
  "trips.csv": SCHEDULE,
  "trip_series.csv": SCHEDULE,
  "trip_series_crew.csv": SCHEDULE,
  "trip_series_skips.csv": SCHEDULE,
  "trip_schedule_days.csv": SCHEDULE,
  "trip_dives.csv": SCHEDULE,
  "trip_requirements.csv": SCHEDULE,
  "trip_assignments.csv": SCHEDULE,
  "staff_shifts.csv": SCHEDULE,
  "crew_availability_blocks.csv": SCHEDULE,
  "crew_away_acknowledgements.csv": SCHEDULE,
  "crew_assignment_requests.csv": SCHEDULE,
  "bookings.csv": SCHEDULE,
  "trip_help_requests.csv": SCHEDULE,
  "interests.csv": SCHEDULE,
  "date_request_offer_bookings.csv": SCHEDULE,
  "trip_last_minute_promos.csv": SCHEDULE,
  "buddy_teams.csv": SCHEDULE,
  "gear_reservations.csv": SCHEDULE,
  "customer_gear_items.csv": SCHEDULE,
  "work_orders.csv": SCHEDULE,
  "work_order_items.csv": SCHEDULE,
  "work_order_lines.csv": SCHEDULE,
  "work_order_care.csv": SCHEDULE,
  "boat_snags.csv": SCHEDULE,
  "certification_junior_reviews.csv": EVIDENCE,
  "trip_change_events.csv": EVIDENCE,
  "trip_stage_events.csv": EVIDENCE,
  "safety_drills.csv": EVIDENCE,
  "safety_drill_participants.csv": EVIDENCE,
  "deck_counts.csv": EVIDENCE,
  "staff_credential_history.csv": EVIDENCE,
  "booking_payment_events.csv": EVIDENCE,
  "booking_checkouts.csv": EVIDENCE,
  "booking_checkout_bookings.csv": EVIDENCE,
  "executed_dives.csv": EVIDENCE,
  "trip_sightings.csv": EVIDENCE,
  "booking_arrival_events.csv": EVIDENCE,
  "roll_call_events.csv": EVIDENCE,
  "roll_call_crew_events.csv": EVIDENCE,
  "waiver_materiality_decisions.csv": EVIDENCE,
  "waiver_records.csv": EVIDENCE,
  "course_form_records.csv": EVIDENCE,
  "work_order_events.csv": EVIDENCE,
  "work_order_bills.csv": EVIDENCE,
  "pre_departure_check_events.csv": EVIDENCE,
  "departure_boat_safety_snapshots.csv": EVIDENCE,
  "incident_reports.csv": EVIDENCE,
  "incident_report_people.csv": EVIDENCE,
  "incident_report_addenda.csv": EVIDENCE,
  "activity_events.csv": EVIDENCE,
  "notification_deliveries.csv": EVIDENCE,
  "orders.csv": EVIDENCE,
  "order_line_items.csv": EVIDENCE,
  "tips.csv": EVIDENCE,
  "recap_photos.csv": EVIDENCE,
  "trip_recap_photos.csv": EVIDENCE,
  "trip_reviews.csv": EVIDENCE,
  "recap_pulses.csv": EVIDENCE,
  "review_moderation_events.csv": EVIDENCE,
  "dive_package_entitlements.csv": EVIDENCE,
};

type Bundle = NonNullable<Awaited<ReturnType<typeof loadShopExportBundleInput>>>;

function table(bundle: Bundle, file: string) {
  const found = bundle.tables.find((candidate) => candidate.file === file);
  if (!found) throw new Error(`expected ${file} in the bundle`);
  return found;
}

const csvOf = (bundle: Bundle, file: string) => {
  const { header, rows } = table(bundle, file);
  return buildCsv([...header], rows);
};

/** Each row as the columns that must survive, sorted, so two shops compare. */
function survivingRows(bundle: Bundle, file: keyof typeof READ_BACK): string[] {
  const { header, rows } = table(bundle, file);
  const wanted = READ_BACK[file];
  const columns = header
    .map((name, index) => ({ name, index }))
    .filter(({ name }) =>
      wanted === "all but ids" ? !MINTED.has(name) : (wanted as readonly string[]).includes(name),
    );
  return rows
    .map((row: CsvValue[]) =>
      JSON.stringify(columns.map(({ name, index }) => [name, row[index] ?? null])),
    )
    .sort();
}

async function emptyShop() {
  const db = await unseededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Round Trip Reef", slug: "round-trip-reef", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const [importer] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Round Trip Importer", email: "importer@example.com" })
    .returning();
  if (!importer) throw new Error("person insert failed");
  return { db, shop, importerId: importer.id };
}

describe("a shop exported and read straight back (#3889)", () => {
  it("names every bundle file as read back or argued out", async () => {
    const bundle = await loadShopExportBundleInput(ctx.db, ctx.shop.id);
    if (!bundle) throw new Error("seeded shop failed to load");
    const files = bundle.tables.map((candidate) => candidate.file).sort();
    const named = [...Object.keys(READ_BACK), ...Object.keys(NOT_READ_BACK)].sort();
    expect(files).toEqual(named);
    for (const file of Object.keys(READ_BACK)) expect(NOT_READ_BACK[file]).toBeUndefined();
  });

  it("brings back every row an importer reads, apart from the ids it mints", async () => {
    const source = await loadShopExportBundleInput(ctx.db, ctx.shop.id);
    if (!source) throw new Error("seeded shop failed to load");
    const target = await emptyShop();

    const contacts = prepareContactImport(csvOf(source, "people.csv"));
    expect(contacts.rows.filter((row) => row.action === "skip")).toEqual([]);
    const imported = await commitContactImport(
      target.db,
      target.shop.id,
      contacts,
      target.importerId,
    );
    expect(imported.rowsSkipped).toBe(0);

    const sites = prepareDiveSiteImport(csvOf(source, "dive_sites.csv"));
    expect(sites.fatal).toBeNull();
    expect(sites.unknownColumns).toEqual([]);
    const creatures = prepareDiveSiteCreaturesImport(csvOf(source, "dive_site_creatures.csv"));
    const library = await commitDiveSiteImport(
      target.db,
      target.shop.id,
      sites,
      target.importerId,
      creatures,
    );
    expect(library.skipped).toEqual([]);
    expect(library.creaturesSkipped).toEqual([]);

    const back = await loadShopExportBundleInput(target.db, target.shop.id);
    if (!back) throw new Error("restored shop failed to load");

    // The one person the restored shop had before the import is the importer.
    const restoredPeople = survivingRows(back, "people.csv").filter(
      (row) => !row.includes("importer@example.com"),
    );
    expect(restoredPeople).toEqual(survivingRows(source, "people.csv"));
    expect(survivingRows(back, "dive_sites.csv")).toEqual(survivingRows(source, "dive_sites.csv"));
    expect(survivingRows(back, "dive_site_creatures.csv")).toEqual(
      survivingRows(source, "dive_site_creatures.csv"),
    );

    // Every staff member comes back as a diver, never as staff.
    const roles = table(back, "people.csv").header.indexOf("roles");
    const restoredRoles = new Set(
      table(back, "people.csv")
        .rows.filter((row) => !row.includes("importer@example.com"))
        .map((row) => row[roles]),
    );
    expect([...restoredRoles], STAFF_ROLES_ARE_NOT_IMPORTED).toEqual(["diver"]);
  });
});
