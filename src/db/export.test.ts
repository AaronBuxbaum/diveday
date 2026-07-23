// @vitest-environment node
import { and, eq, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { seededShopContext } from "@/test/db";
import { createDiver, deleteDiver } from "./divers";
import { canPersonExportShopData, loadShopExportBundleInput, loadShopExportCounts } from "./export";
import * as schema from "./schema";
import { people, personRoles, shops, userAccounts } from "./schema";
import { issueWaiverRequest } from "./waivers";

const EXPECTED_FILES = [
  "shop.csv",
  "people.csv",
  "certifications.csv",
  "specialty_certifications.csv",
  "nitrox_certifications.csv",
  "trips.csv",
  "trip_dives.csv",
  "trip_requirements.csv",
  "trip_assignments.csv",
  "bookings.csv",
  "roll_call_events.csv",
  "waiver_templates.csv",
  "waiver_records.csv",
  "rental_fit.csv",
];

/** Schema tables that get their own CSV in the bundle. */
const EXPORTED_TABLES = [
  "shops",
  "people",
  "certifications",
  "specialty_certifications",
  "nitrox_certifications",
  "trips",
  "trip_dives",
  "trip_requirements",
  "trip_assignments",
  "bookings",
  "roll_call_events",
  "waiver_templates",
  "waiver_records",
  "rental_fit_profiles",
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
  "trip_series", // cadence template; every materialized trip exports with its series_id
  "trip_waitlist_entries", // not bookings; never on a manifest
  "notification_deliveries",
  "notification_delivery_attempts",
  "shop_stripe_accounts", // provider linkage, useless outside Stripe
  "orders",
  "order_line_items",
  "booking_checkouts",
  "booking_checkout_bookings",
  "dive_sites", // library content; trips/dives carry site ids + names
  "global_dive_sites",
  "global_dive_site_versions",
  "dive_site_creatures",
  "dive_site_moments",
  "courses", // catalog content; course trips export with their course_id
  "user_accounts", // credentials are never exported
];

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
});

describe("full-shop export dataset", () => {
  it("covers every promised record family with data from the seeded shop", async () => {
    const { db, shop } = await seededShopContext();
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");

    expect(input.shopSlug).toBe("blue-mantis");
    expect(input.tables.map((row) => row.file)).toEqual(EXPECTED_FILES);

    // The demo seed exercises the whole spine; an empty core table here means
    // a query broke, not that the seed changed shape.
    for (const file of [
      "people.csv",
      "trips.csv",
      "trip_requirements.csv",
      "trip_assignments.csv",
      "bookings.csv",
      "waiver_templates.csv",
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
    const { db, shop } = await seededShopContext();
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
