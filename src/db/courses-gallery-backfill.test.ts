import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, onTestFinished } from "vitest";

/**
 * Does the DATA-L4 migration's backfill actually carry a shop's captions across
 * — including from the rows the old shape allowed to drift?
 *
 * `courses.image_urls` / `image_alts` were two jsonb arrays lined up by
 * position with nothing enforcing they stayed the same length, which is the
 * defect the migration exists to end. The interesting rows are therefore
 * precisely the ones that were already wrong, and the migration had to *decide*
 * what those become. That decision is documented in the migration and in
 * `schema.ts`; this file is what holds it to it.
 *
 * The SQL under test is read from the committed migration rather than
 * paraphrased here. A paraphrase would pass while the shipped statement did
 * something else, which is the one failure a backfill test has to rule out —
 * the real statement runs against a real Postgres (PGlite) exactly once, on a
 * database that already looks like production did the moment before.
 */
const MIGRATION = "20260806051740_course-gallery-photos";

/** The migration's statements, in order, as `drizzle-orm`'s migrator splits them. */
function migrationStatements(): string[] {
  const file = path.join(process.cwd(), "drizzle", MIGRATION, "migration.sql");
  return readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * A bare Postgres holding just enough `courses` to run the backfill: the two
 * old columns and a title to identify rows by. Deliberately *not* the migrated
 * app schema — the whole point is to stand where the migration stands, with the
 * old shape still in place.
 */
async function preMigrationDb() {
  const client = new PGlite();
  onTestFinished(async () => {
    await client.close();
  });
  await client.exec(`
    CREATE TABLE "courses" (
      "id" serial PRIMARY KEY,
      "title" text NOT NULL,
      "image_urls" jsonb DEFAULT '[]' NOT NULL,
      "image_alts" jsonb DEFAULT '[]' NOT NULL
    );
  `);
  return client;
}

type Photo = { url: string; alt: string };

async function backfilled(client: Awaited<ReturnType<typeof preMigrationDb>>) {
  for (const statement of migrationStatements()) await client.exec(statement);
  const result = await client.query<{ title: string; gallery_photos: Photo[] }>(
    `SELECT "title", "gallery_photos" FROM "courses" ORDER BY "id"`,
  );
  return new Map(result.rows.map((row) => [row.title, row.gallery_photos]));
}

describe("courses.gallery_photos backfill (DATA-L4)", () => {
  it("pairs each caption with the photo it was written for", async () => {
    const client = await preMigrationDb();
    await client.exec(`
      INSERT INTO "courses" ("title", "image_urls", "image_alts") VALUES
        ('Open Water',
         '["/a.jpg","/b.jpg","/c.jpg"]',
         '["Fitting a mask","","Surfacing at the mooring"]');
    `);

    expect((await backfilled(client)).get("Open Water")).toEqual([
      { url: "/a.jpg", alt: "Fitting a mask" },
      { url: "/b.jpg", alt: "" },
      { url: "/c.jpg", alt: "Surfacing at the mooring" },
    ]);
  });

  it("keeps a photo whose caption is missing, and gives it a blank one", async () => {
    // Drift the old shape allowed: more urls than alts. The photo is what a
    // diver sees, so it survives; "" renders as the generated
    // "{title} — photo {n}" fallback, exactly as a blank caption always has.
    const client = await preMigrationDb();
    await client.exec(`
      INSERT INTO "courses" ("title", "image_urls", "image_alts") VALUES
        ('Rescue Diver', '["/a.jpg","/b.jpg","/c.jpg"]', '["Tired-diver tow"]');
    `);

    expect((await backfilled(client)).get("Rescue Diver")).toEqual([
      { url: "/a.jpg", alt: "Tired-diver tow" },
      { url: "/b.jpg", alt: "" },
      { url: "/c.jpg", alt: "" },
    ]);
  });

  it("drops a caption with no photo under it", async () => {
    // The other direction: more alts than urls. A caption with nothing to
    // caption is dropped — carrying it forward could only re-create the
    // misalignment this migration exists to end.
    const client = await preMigrationDb();
    await client.exec(`
      INSERT INTO "courses" ("title", "image_urls", "image_alts") VALUES
        ('Nitrox', '["/a.jpg"]', '["Analyzing a fill","Orphaned caption","Another"]');
    `);

    expect((await backfilled(client)).get("Nitrox")).toEqual([
      { url: "/a.jpg", alt: "Analyzing a fill" },
    ]);
  });

  it("never lands on a null caption", async () => {
    // A stored JSON `null` is not a SQL NULL, so `coalesce` alone would let it
    // through and break `alt: string` for every reader downstream.
    const client = await preMigrationDb();
    await client.exec(`
      INSERT INTO "courses" ("title", "image_urls", "image_alts") VALUES
        ('Deep', '["/a.jpg","/b.jpg"]', '[null,"Descending the line"]');
    `);

    expect((await backfilled(client)).get("Deep")).toEqual([
      { url: "/a.jpg", alt: "" },
      { url: "/b.jpg", alt: "Descending the line" },
    ]);
  });

  it("leaves a course with no photos as an empty gallery, never null", async () => {
    const client = await preMigrationDb();
    await client.exec(`
      INSERT INTO "courses" ("title", "image_urls", "image_alts") VALUES
        ('Discover Scuba', '[]', '[]'),
        ('Divemaster', '[]', '["A caption nobody can see"]');
    `);

    const rows = await backfilled(client);
    expect(rows.get("Discover Scuba")).toEqual([]);
    expect(rows.get("Divemaster")).toEqual([]);
  });

  it("expands without contracting — the old columns survive this release", async () => {
    // Not an oversight. Migrations run inside the production build while the
    // previous release is still serving course pages off `image_urls` /
    // `image_alts`, so dropping them here would take the live site down
    // mid-deploy; `scripts/check-migrations.mjs` refuses it, and the contract
    // release is a separate deploy
    // (docs/engineering/deploy-and-migrations-runbook.md).
    const client = await preMigrationDb();
    for (const statement of migrationStatements()) await client.exec(statement);

    const columns = await client.query<{ column_name: string }>(
      `SELECT "column_name" FROM information_schema.columns WHERE "table_name" = 'courses'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain("gallery_photos");
    expect(names).toContain("image_urls");
    expect(names).toContain("image_alts");
  });
});
