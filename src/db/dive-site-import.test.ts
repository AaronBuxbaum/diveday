import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { MAX_SITE_CREATURES } from "@/lib/dive-site-field-guide";
import {
  DIVE_SITE_CREATURE_IMPORT_COLUMNS,
  DIVE_SITE_IMPORT_COLUMNS,
  isDiveSiteCreaturesCsv,
  prepareDiveSiteCreaturesImport,
  prepareDiveSiteImport,
} from "@/lib/dive-site-import";
import { DIVE_SITE_LANDMARK_KINDS, type DiveSiteLandmark } from "@/lib/dive-site-landmarks";
import { MAX_ROUTE_POINTS } from "@/lib/dive-site-route";
import { buildCsv } from "@/lib/export";
import { MAX_IMPORT_BYTES, MAX_IMPORT_CELL_LENGTH, MAX_IMPORT_ROWS } from "@/lib/import";
import { seededShopContext, unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { commitDiveSiteImport } from "./dive-site-import";
import { listDiveSiteCreatures, listDiveSites, replaceDiveSiteCreatures } from "./dive-sites";
import { loadShopExportBundleInput } from "./export";
import { diveSites, people, shops } from "./schema";

/** One file of the shop's bundle, exactly as the export would hand it over. */
async function exportedCsv(db: AppDb, shopId: string, file: string): Promise<string> {
  const bundle = await loadShopExportBundleInput(db, shopId);
  if (!bundle) throw new Error("expected an export bundle for the seeded shop");
  const table = bundle.tables.find((candidate) => candidate.file === file);
  if (!table) throw new Error(`expected ${file} in the bundle`);
  return buildCsv([...table.header], table.rows);
}

/** The shop's own `dive_sites.csv`, exactly as the bundle would hand it over. */
async function exportedDiveSitesCsv(db: AppDb, shopId: string): Promise<string> {
  return exportedCsv(db, shopId, "dive_sites.csv");
}

/** Each site's guide, keyed by site name so two libraries can be compared. */
async function guidesByName(db: AppDb, shopId: string) {
  const guides = new Map<string, (string | null)[]>();
  for (const site of await listDiveSites(db, shopId)) {
    const rows = await listDiveSiteCreatures(db, shopId, site.id);
    guides.set(
      site.name,
      rows.map((row) => row.catalogSlug),
    );
  }
  return guides;
}

/**
 * A shop with no library at all.
 *
 * `seededShopContext` always seeds dive sites, and they cannot simply be
 * deleted: five tables carry a `dive_site_id` foreign key, so a `delete` is a
 * cascade this file has no business writing. An empty shop is the honest
 * fixture for "restore into somewhere the bundle did not come from", and it is
 * also the shape a shop leaving another system arrives in.
 */
async function bareShopContext(slug: string) {
  const db = await unseededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Bare Reef Divers", slug, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const [staff] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Importer", email: `${slug}@example.com` })
    .returning();
  if (!staff) throw new Error("person insert failed");
  return { db, shop, staffId: staff.id };
}

async function anyStaffPersonId(db: AppDb, shopId: string): Promise<string> {
  const [staff] = await db.select({ id: people.id }).from(people).where(eq(people.shopId, shopId));
  if (!staff) throw new Error("expected a seeded person");
  return staff.id;
}

describe("the dive-site importer", () => {
  /**
   * **The assertion the whole file hangs off.** The parser's column list is
   * written out rather than derived from the export, on purpose — the two live
   * in different modules and a restore that silently tracked a writer it could
   * not actually read back is the failure the list exists to make loud. So this
   * compares them against the real bundle: a column added to `dive_sites.csv`
   * without teaching the importer about it turns this red rather than
   * disappearing out of somebody's library.
   */
  it("knows every column the export writes, in the order it writes them", async () => {
    const { db, shop } = await seededShopContext();
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const table = bundle?.tables.find((candidate) => candidate.file === "dive_sites.csv");
    expect(table?.header).toEqual([...DIVE_SITE_IMPORT_COLUMNS]);
  });

  /**
   * The round trip the export's comments described for months and nothing could
   * perform: the shop's own file, read straight back into the shop it came
   * from. Every row matches on its id, so nothing is created and nothing is
   * renamed.
   */
  it("reads a shop's own bundle back onto the sites it came from", async () => {
    const { db, shop } = await seededShopContext();
    const before = await listDiveSites(db, shop.id);
    expect(before.length).toBeGreaterThan(0);

    const prepared = prepareDiveSiteImport(await exportedDiveSitesCsv(db, shop.id));
    expect(prepared.fatal).toBeNull();
    expect(prepared.unknownColumns).toEqual([]);
    expect(prepared.rows.flatMap((row) => row.issues)).toEqual([]);

    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepared,
      await anyStaffPersonId(db, shop.id),
    );
    expect(summary.created).toBe(0);
    expect(summary.skipped).toEqual([]);
    expect(summary.updated).toBe(prepared.rows.length);

    const after = await listDiveSites(db, shop.id);
    // Same sites, same ids, same names — a restore that quietly minted a
    // second copy of the library would show here first.
    expect(after.map((site) => site.id).sort()).toEqual(before.map((site) => site.id).sort());
    const named = new Map(after.map((site) => [site.id, site] as const));
    for (const site of before) {
      const restored = named.get(site.id);
      expect(restored?.name).toBe(site.name);
      expect(restored?.slug).toBe(site.slug);
      expect(restored?.description).toBe(site.description);
      expect(restored?.maxDepthMeters).toBe(site.maxDepthMeters);
      expect(restored?.difficultyLevel).toBe(site.difficultyLevel);
      expect(restored?.requiredSpecialties).toEqual(site.requiredSpecialties);
      expect(restored?.routePoints).toEqual(site.routePoints);
      expect(restored?.landmarks).toEqual(site.landmarks);
      expect(restored?.imageUrls).toEqual(site.imageUrls);
    }
  });

  /**
   * **Restoring into a shop that is not the one the bundle came from** — the
   * case the ids cannot carry. Nothing matches by id, so the names do the work,
   * and the sites are created rather than adopted: an id from another shop's
   * library must never be written here.
   */
  it("creates the library in a shop the bundle did not come from", async () => {
    const source = await seededShopContext();
    const csv = await exportedDiveSitesCsv(source.db, source.shop.id);
    const expected = await listDiveSites(source.db, source.shop.id);

    const target = await bareShopContext("import-target");

    const prepared = prepareDiveSiteImport(csv);
    const summary = await commitDiveSiteImport(target.db, target.shop.id, prepared, target.staffId);
    expect(summary.skipped).toEqual([]);
    expect(summary.created).toBe(prepared.rows.length);

    const restored = await listDiveSites(target.db, target.shop.id);
    expect(restored.map((site) => site.name).sort()).toEqual(
      expected.map((site) => site.name).sort(),
    );
    // Fresh ids, and every row belongs to the shop that ran the import.
    const sourceIds = new Set(expected.map((site) => site.id));
    for (const site of restored) {
      expect(sourceIds.has(site.id)).toBe(false);
      expect(site.shopId).toBe(target.shop.id);
    }
  });

  /**
   * **The tide acknowledgement is about one pairing** (issue #1731). A file can
   * claim it; only the row that already holds that station id keeps it. On a
   * site being created there is no such row, so the claim is always dropped —
   * which is the rule `confirmedStationWrite` states, inherited here rather
   * than restated.
   */
  it("refuses a tide acknowledgment for a station the site does not already hold", async () => {
    const { db, shop, staffId } = await bareShopContext("import-tide");
    const csv = buildCsv(
      [...DIVE_SITE_IMPORT_COLUMNS],
      [
        DIVE_SITE_IMPORT_COLUMNS.map((column) =>
          column === "name"
            ? "Tide Test Reef"
            : column === "tide_station_id"
              ? "8724580"
              : column === "tide_station_confirmed"
                ? "true"
                : null,
        ),
      ],
    );
    expect(
      (await commitDiveSiteImport(db, shop.id, prepareDiveSiteImport(csv), staffId)).created,
    ).toBe(1);

    const [created] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.name, "Tide Test Reef")));
    expect(created?.tideStationId).toBe("8724580");
    expect(created?.tideStationConfirmed).toBe(false);

    // Second pass over the same file: now the row does hold that station, so
    // the same claim is honoured. Same bytes, different answer, and the
    // difference is the pairing rather than the file.
    await commitDiveSiteImport(db, shop.id, prepareDiveSiteImport(csv), staffId);
    const [again] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.name, "Tide Test Reef")));
    expect(again?.tideStationConfirmed).toBe(true);
  });

  /**
   * **An unrecognised column refuses the file.** This reads DiveDay's own
   * export, so there is nothing to guess: a column this parser does not know is
   * either one a later DiveDay wrote and this one would silently drop, or one
   * the shop added by hand and this one would silently ignore. Both are a
   * restore that quietly loses a fact.
   */
  it("refuses a file carrying a column it does not know, and names it", () => {
    const prepared = prepareDiveSiteImport("name,description,house_reef_rating\nMolasses,,5\n");
    expect(prepared.fatal).toBe("unknown_columns");
    expect(prepared.unknownColumns).toEqual(["house_reef_rating"]);
    expect(prepared.rows).toEqual([]);
  });

  /**
   * **The cell that reaches a public page** (security review, issue #1771).
   *
   * `DiveSiteMap` reads `routePoints` straight off the row from the diver's
   * trip page, and `routeFocus` does `Math.min(...xs)` — so a route of a
   * hundred thousand waypoints is a `RangeError` on an unauthenticated page,
   * on every request, until somebody notices. `parseRoutePoints` caps at
   * `MAX_ROUTE_POINTS` and clamps each coordinate, and its own docblock names
   * the import as a caller; the first draft of this parser re-derived the shape
   * check and dropped every one of those bounds.
   *
   * Refused rather than truncated: a route the file drew and this stored half
   * of is a line over the wrong water, which is a briefing saying something
   * false instead of saying nothing.
   */
  it("refuses a route with more waypoints than the map can hold", () => {
    const flood = JSON.stringify(
      Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, index) => ({ x: index % 100, y: 5 })),
    );
    const row = prepareDiveSiteImport(
      buildCsv(
        [...DIVE_SITE_IMPORT_COLUMNS],
        [
          DIVE_SITE_IMPORT_COLUMNS.map((column) =>
            column === "name" ? "Flooded Route" : column === "route_points" ? flood : null,
          ),
        ],
      ),
    ).rows[0];
    expect(row?.issues).toContain("invalid_route_points");
    expect(row?.routePoints ?? []).toHaveLength(MAX_ROUTE_POINTS);
  });

  /**
   * The same normalizer one column over. `parseDiveSiteLandmarks` does not drop
   * a landmark whose `kind` is not a kind — it reads it as a plain point of
   * interest and bounds the note — which is the right answer and the one the
   * first draft of this parser did not give: it took any object with two
   * strings, so the column stored a `kind` the type says cannot exist and a
   * note with no length at all. Its docblock names "what the CSV import still
   * accepts" as the caller it was written for.
   */
  it("normalizes a landmark the field guide's own parser would not take as written", () => {
    const row = prepareDiveSiteImport(
      buildCsv(
        [...DIVE_SITE_IMPORT_COLUMNS],
        [
          DIVE_SITE_IMPORT_COLUMNS.map((column) =>
            column === "name"
              ? "Bad Landmark"
              : column === "landmarks"
                ? JSON.stringify([
                    { name: "The Arch", kind: "not-a-kind", note: "x".repeat(1_000) },
                  ])
                : null,
          ),
        ],
      ),
    ).rows[0];
    const [landmark] = (row?.landmarks ?? []) as DiveSiteLandmark[];
    expect(row?.issues).toEqual([]);
    expect(DIVE_SITE_LANDMARK_KINDS).toContain(landmark?.kind);
    expect(landmark?.note.length).toBeLessThan(1_000);
  });

  /**
   * **A landmark photo from a file never names one of our stored objects.**
   * Storage URLs are public and carry no shop, so a CSV could name another
   * shop's photo; the editor's next save that took it off would queue that
   * object for deletion. A bundled root-relative photo is harmless and kept.
   */
  it("drops a stored landmark photo from a file, and keeps a bundled one", () => {
    vi.stubEnv("MEDIA_PUBLIC_URL_BASE", "https://media.example.com");
    try {
      const row = prepareDiveSiteImport(
        buildCsv(
          [...DIVE_SITE_IMPORT_COLUMNS],
          [
            DIVE_SITE_IMPORT_COLUMNS.map((column) =>
              column === "name"
                ? "Someone Else's Reef"
                : column === "landmarks"
                  ? JSON.stringify([
                      { name: "Theirs", photoUrl: "https://media.example.com/shop-heroes/x.jpg" },
                      { name: "Bundled", photoUrl: "/dive-sites/brain-coral.jpg" },
                    ])
                  : null,
            ),
          ],
        ),
      ).rows[0];
      const landmarks = (row?.landmarks ?? []) as DiveSiteLandmark[];
      expect(landmarks[0]).not.toHaveProperty("photoUrl");
      expect(landmarks[1]?.photoUrl).toBe("/dive-sites/brain-coral.jpg");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  /**
   * **A photo URL the app holds is first-party.** `StoredPhoto`'s docblock says
   * nothing else can be written, and ADR 20260724-dive-site-media-ingestion
   * deleted the paste-a-URL form so a public page would never fetch from a
   * staff-chosen host and let it watch every visitor. A CSV column is that form
   * with extra steps.
   */
  it("drops a photo URL that is not ours, and says the row lost one", () => {
    const row = prepareDiveSiteImport(
      buildCsv(
        [...DIVE_SITE_IMPORT_COLUMNS],
        [
          DIVE_SITE_IMPORT_COLUMNS.map((column) =>
            column === "name"
              ? "Borrowed Photos"
              : column === "satellite_image_url"
                ? "https://tracker.example.com/pixel.png"
                : column === "image_urls"
                  ? JSON.stringify(["//tracker.example.com/a.png", "/uploads/ours.png"])
                  : null,
          ),
        ],
      ),
    ).rows[0];
    expect(row?.satelliteImageUrl).toBeNull();
    expect(row?.issues).toContain("foreign_image_url");
    expect(row?.issues).toContain("invalid_image_urls");
    // Protocol-relative is not root-relative, and it is the shape this refuses.
    expect(row?.imageUrls).toEqual(["/uploads/ours.png"]);
  });

  /**
   * **The caps the contacts importer already enforces**, from the module this
   * one borrows `parseCsv` from. Without them a 16 MB file of bare names is
   * hundreds of thousands of `createDiveSite` calls, each of which reads every
   * live site in the shop — quadratic, in one server action, with no outer
   * transaction, against a database every other tenant shares.
   */
  it("refuses a file that is too large, too long, too wide, or carries a huge cell", () => {
    const header = "name\n";
    expect(prepareDiveSiteImport(`${header}${"a".repeat(MAX_IMPORT_BYTES)}`).fatal).toBe(
      "file_too_large",
    );
    expect(
      prepareDiveSiteImport(
        header + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `s${i}`).join("\n"),
      ).fatal,
    ).toBe("too_many_rows");
    expect(
      prepareDiveSiteImport(`name,${"a".repeat(MAX_IMPORT_CELL_LENGTH + 1)}\nx,y\n`).fatal,
    ).toBe("cell_too_long");
  });

  /**
   * A row matching a **deleted** site by name matched nothing, because
   * `updateDiveSite` carries `deleted_at is null` — and the importer counted it
   * as updated anyway, then counted it as deleted on top. "1 updated, 1
   * deleted" over a library that had not changed at all, on exactly the
   * scenario the name match exists for.
   */
  it("says nothing was written when the name it matched belongs to a deleted site", async () => {
    const { db, shop } = await seededShopContext();
    const [site] = await listDiveSites(db, shop.id);
    if (!site) throw new Error("expected a seeded dive site");
    await db.update(diveSites).set({ deletedAt: nowDate() }).where(eq(diveSites.id, site.id));

    const csv = buildCsv(
      [...DIVE_SITE_IMPORT_COLUMNS],
      [DIVE_SITE_IMPORT_COLUMNS.map((column) => (column === "name" ? site.name : null))],
    );
    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(csv),
      await anyStaffPersonId(db, shop.id),
    );
    expect(summary.updated).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(summary.skipped).toEqual([{ rowNumber: 2, issues: ["not_written"] }]);
  });

  it("refuses a file with no name column, and an empty one", () => {
    expect(prepareDiveSiteImport("description,depth_range\na,b\n").fatal).toBe("no_name_column");
    expect(prepareDiveSiteImport("").fatal).toBe("file_empty");
  });

  /**
   * **The name is the key once the id is gone**, which is what makes a bundle
   * restore into a library whose ids have moved on — a shop that lost its
   * database and rebuilt it, or one that restored an older bundle over a newer
   * library. The row updates the site it names rather than creating a second
   * one: `(shop_id, name)` is unique, so a second one is not a thing that could
   * exist, and inventing "Molasses Reef 2" would have changed the library it
   * was asked to put back.
   */
  it("matches on the name when the id belongs to nobody here", async () => {
    const { db, shop } = await seededShopContext();
    const [existing] = await listDiveSites(db, shop.id);
    if (!existing) throw new Error("expected a seeded dive site");
    const csv = buildCsv(
      [...DIVE_SITE_IMPORT_COLUMNS],
      [
        DIVE_SITE_IMPORT_COLUMNS.map((column) =>
          column === "name"
            ? existing.name
            : column === "id"
              ? "11111111-2222-4333-8444-555555555555"
              : column === "description"
                ? "Restored from a bundle whose ids are gone"
                : null,
        ),
      ],
    );
    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(csv),
      await anyStaffPersonId(db, shop.id),
    );
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toEqual([]);

    const [restored] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.name, existing.name)));
    // The row it already had, rewritten — not a new one wearing the same name.
    expect(restored?.id).toBe(existing.id);
    expect(restored?.description).toBe("Restored from a bundle whose ids are gone");
  });

  /**
   * A deleted site comes back deleted. Putting the whole library back live
   * would republish briefings the shop retired, on public pages, without
   * anybody asking.
   */
  it("restores a deleted site still deleted", async () => {
    const { db, shop } = await seededShopContext();
    const [site] = await listDiveSites(db, shop.id);
    if (!site) throw new Error("expected a seeded dive site");
    const deletedAt = new Date("2026-08-01T12:00:00.000Z");
    await db.update(diveSites).set({ deletedAt }).where(eq(diveSites.id, site.id));

    // Exported while deleted — the bundle carries every site, deleted ones
    // included — then put back live, so the import has something to delete again.
    const csv = await exportedDiveSitesCsv(db, shop.id);
    await db.update(diveSites).set({ deletedAt: null }).where(eq(diveSites.id, site.id));
    expect((await listDiveSites(db, shop.id)).map((row) => row.name)).toContain(site.name);

    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(csv),
      await anyStaffPersonId(db, shop.id),
    );
    expect(summary.deleted).toBe(1);

    const [restored] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.name, site.name)));
    expect(restored?.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    // And it is not on the library page, which is what deleted means.
    expect((await listDiveSites(db, shop.id)).map((row) => row.name)).not.toContain(site.name);
  });

  /** Two rows naming one site would otherwise report as two sites. */
  it("refuses the second of two rows naming the same site", async () => {
    const { db, shop, staffId } = await bareShopContext("import-duplicates");
    const row = (name: string) =>
      DIVE_SITE_IMPORT_COLUMNS.map((column) => (column === "name" ? name : null));
    const csv = buildCsv([...DIVE_SITE_IMPORT_COLUMNS], [row("Twin Caves"), row("Twin Caves")]);
    const summary = await commitDiveSiteImport(db, shop.id, prepareDiveSiteImport(csv), staffId);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toEqual([{ rowNumber: 3, issues: ["duplicate_in_file"] }]);
  });
});

/**
 * **The field guide comes back with its sites** (issue #1841): the second
 * file of the same bundle, read in the same upload and joined on the ids the
 * sites pass just placed — never on the database.
 */
describe("restoring the field guide from dive_site_creatures.csv", () => {
  const creatureCsv = (rows: (string | number | null)[][]) =>
    buildCsv([...DIVE_SITE_CREATURE_IMPORT_COLUMNS], rows);
  const creatureRow = (siteId: string, slug: string, position: number) =>
    DIVE_SITE_CREATURE_IMPORT_COLUMNS.map((column) =>
      column === "dive_site_id"
        ? siteId
        : column === "catalog_slug"
          ? slug
          : column === "position"
            ? position
            : null,
    );
  const siteCsv = (rows: { id: string; name: string }[]) =>
    buildCsv(
      [...DIVE_SITE_IMPORT_COLUMNS],
      rows.map((site) =>
        DIVE_SITE_IMPORT_COLUMNS.map((column) =>
          column === "id" ? site.id : column === "name" ? site.name : null,
        ),
      ),
    );
  const SOURCE_ID = "11111111-1111-4111-8111-111111111111";

  it("knows every column the export writes, in the order it writes them", async () => {
    const { db, shop } = await seededShopContext();
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const table = bundle?.tables.find((candidate) => candidate.file === "dive_site_creatures.csv");
    expect(table?.header).toEqual([...DIVE_SITE_CREATURE_IMPORT_COLUMNS]);
  });

  it("restores every site's species, in order, into a shop the bundle did not come from", async () => {
    const source = await seededShopContext();
    const expected = await guidesByName(source.db, source.shop.id);
    expect([...expected.values()].some((slugs) => slugs.length > 0)).toBe(true);
    const sitesFile = await exportedDiveSitesCsv(source.db, source.shop.id);
    const creaturesFile = await exportedCsv(source.db, source.shop.id, "dive_site_creatures.csv");
    expect(isDiveSiteCreaturesCsv(creaturesFile)).toBe(true);
    expect(isDiveSiteCreaturesCsv(sitesFile)).toBe(false);

    const target = await bareShopContext("import-guides");
    const creatures = prepareDiveSiteCreaturesImport(creaturesFile);
    expect(creatures.fatal).toBeNull();
    const summary = await commitDiveSiteImport(
      target.db,
      target.shop.id,
      prepareDiveSiteImport(sitesFile),
      target.staffId,
      creatures,
    );
    expect(summary.creaturesSkipped).toEqual([]);
    expect(summary.guides).toBe(expected.size);
    expect(await guidesByName(target.db, target.shop.id)).toEqual(expected);
  });

  it("leaves a site's guide alone when the upload carries no creatures file", async () => {
    const { db, shop } = await seededShopContext();
    const before = await guidesByName(db, shop.id);
    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(await exportedDiveSitesCsv(db, shop.id)),
      await anyStaffPersonId(db, shop.id),
    );
    expect(summary.guides).toBe(0);
    expect(await guidesByName(db, shop.id)).toEqual(before);
  });

  it("skips a row naming a site the file did not place, even one this shop holds", async () => {
    const { db, shop } = await seededShopContext();
    const [held] = await listDiveSites(db, shop.id);
    if (!held) throw new Error("expected a seeded dive site");
    await replaceDiveSiteCreatures(db, shop.id, held.id, ["green-sea-turtle"]);
    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(siteCsv([{ id: SOURCE_ID, name: "Brand New Ledge" }])),
      await anyStaffPersonId(db, shop.id),
      prepareDiveSiteCreaturesImport(
        creatureCsv([
          creatureRow(SOURCE_ID, "green-moray", 0),
          // The held site's real id, but not in this file's sites: never reached.
          creatureRow(held.id, "nurse-shark", 0),
          creatureRow("22222222-2222-4222-8222-222222222222", "nurse-shark", 0),
        ]),
      ),
    );
    expect(summary.creaturesSkipped).toEqual([
      { rowNumber: 3, issues: ["site_not_restored"] },
      { rowNumber: 4, issues: ["site_not_restored"] },
    ]);
    const guides = await guidesByName(db, shop.id);
    expect(guides.get("Brand New Ledge")).toEqual(["green-moray"]);
    expect(guides.get(held.name)).toEqual(["green-sea-turtle"]);
  });

  it("never writes onto another shop's site, whatever id the file names", async () => {
    const victim = await seededShopContext();
    const [theirs] = await listDiveSites(victim.db, victim.shop.id);
    if (!theirs) throw new Error("expected a seeded dive site");
    const before = await listDiveSiteCreatures(victim.db, victim.shop.id, theirs.id);
    const [attacker] = await victim.db
      .insert(shops)
      .values({ name: "Other Reef", slug: "import-guides-attacker", timezone: "UTC" })
      .returning();
    if (!attacker) throw new Error("shop insert failed");
    const [staff] = await victim.db
      .insert(people)
      .values({ shopId: attacker.id, fullName: "Attacker", email: "attacker@example.com" })
      .returning();
    if (!staff) throw new Error("person insert failed");

    // The file claims the victim's site id for its own row, then names it again.
    const summary = await commitDiveSiteImport(
      victim.db,
      attacker.id,
      prepareDiveSiteImport(siteCsv([{ id: theirs.id, name: "Borrowed Name" }])),
      staff.id,
      prepareDiveSiteCreaturesImport(creatureCsv([creatureRow(theirs.id, "nurse-shark", 0)])),
    );
    expect(summary.created).toBe(1);
    expect(await listDiveSiteCreatures(victim.db, victim.shop.id, theirs.id)).toEqual(before);
    const [mine] = await listDiveSites(victim.db, attacker.id);
    expect(mine?.id).not.toBe(theirs.id);
    expect(
      (await listDiveSiteCreatures(victim.db, attacker.id, mine?.id ?? "")).map(
        (row) => row.catalogSlug,
      ),
    ).toEqual(["nurse-shark"]);
  });

  it("drops a species DiveDay no longer carries, counts it, and keeps the rest of the guide", async () => {
    const { db, shop, staffId } = await bareShopContext("import-guides-unknown");
    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(siteCsv([{ id: SOURCE_ID, name: "Kelp Wall" }])),
      staffId,
      prepareDiveSiteCreaturesImport(
        creatureCsv([
          creatureRow(SOURCE_ID, "nurse-shark", 2),
          creatureRow(SOURCE_ID, "kraken", 1),
          creatureRow(SOURCE_ID, "green-moray", 0),
        ]),
      ),
    );
    expect(summary.creaturesSkipped).toEqual([{ rowNumber: 3, issues: ["unknown_species"] }]);
    expect((await guidesByName(db, shop.id)).get("Kelp Wall")).toEqual([
      "green-moray",
      "nurse-shark",
    ]);
  });

  it("stores no repeat and nothing past the guide's limit", async () => {
    const { db, shop, staffId } = await bareShopContext("import-guides-limit");
    const slugs = [
      "green-moray",
      "nurse-shark",
      "green-sea-turtle",
      "hawksbill-turtle",
      "spotted-eagle-ray",
      "french-angelfish",
      "queen-angelfish",
      "great-barracuda",
      "stoplight-parrotfish",
    ];
    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(siteCsv([{ id: SOURCE_ID, name: "Long Reef" }])),
      staffId,
      prepareDiveSiteCreaturesImport(
        creatureCsv([
          ...slugs.map((slug, index) => creatureRow(SOURCE_ID, slug, index)),
          creatureRow(SOURCE_ID, "green-moray", 99),
        ]),
      ),
    );
    const guide = (await guidesByName(db, shop.id)).get("Long Reef") ?? [];
    expect(guide).toHaveLength(MAX_SITE_CREATURES);
    expect(summary.creaturesSkipped.map((row) => row.issues[0]).sort()).toEqual([
      "duplicate_species",
      "too_many_species",
    ]);
  });

  it("refuses a creatures file it cannot read whole, and then writes no site either", async () => {
    const { db, shop, staffId } = await bareShopContext("import-guides-refused");
    const creatures = prepareDiveSiteCreaturesImport(
      `${DIVE_SITE_CREATURE_IMPORT_COLUMNS.join(",")},secret_column\n`,
    );
    expect(creatures.fatal).toBe("unknown_columns");
    const summary = await commitDiveSiteImport(
      db,
      shop.id,
      prepareDiveSiteImport(siteCsv([{ id: SOURCE_ID, name: "Untouched" }])),
      staffId,
      creatures,
    );
    expect(summary.created).toBe(0);
    expect(await listDiveSites(db, shop.id)).toEqual([]);
    expect(prepareDiveSiteCreaturesImport("position,name\n1,x\n").fatal).toBe("no_slug_column");
  });

  it("is bounded like the sites file", () => {
    const header = `${DIVE_SITE_CREATURE_IMPORT_COLUMNS.join(",")}\n`;
    expect(prepareDiveSiteCreaturesImport(`${header}${"a".repeat(MAX_IMPORT_BYTES)}`).fatal).toBe(
      "file_too_large",
    );
    expect(
      prepareDiveSiteCreaturesImport(
        header + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `r${i}`).join("\n"),
      ).fatal,
    ).toBe("too_many_rows");
    expect(
      prepareDiveSiteCreaturesImport(
        `dive_site_id,catalog_slug\nx,${"a".repeat(MAX_IMPORT_CELL_LENGTH + 1)}\n`,
      ).fatal,
    ).toBe("cell_too_long");
  });
});
