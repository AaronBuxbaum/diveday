import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import type { AppDb } from "./client";
import { createDiveSite, SITE_EDIT_CONFLICT, updateDiveSiteForForm } from "./dive-sites";
import { diveSites, shops } from "./schema";

/**
 * **The editor's edit generation, held to a real Postgres server.**
 *
 * This file exists because of a defect that shipped past every green test in
 * the repository, and would have shipped to production if a `security-reviewer`
 * pass had not read the diff.
 *
 * The first cut of the two-tab guard (issue #820) used `updated_at` as the
 * generation, falling back to `created_at` for a row nobody had saved yet.
 * `created_at` is `timestamptz DEFAULT now()`, and Postgres `now()` has
 * **microsecond** resolution. `pg` parses that into a JS `Date`, which has
 * millisecond resolution, so the value the page rendered into its hidden field
 * was already truncated — and `timestamptz '…12.123' = '…12.123456'` is false.
 * Neither branch of the comparison could match. Every course and every dive
 * site would have become permanently unsaveable through its editor, telling a
 * lone staffer with one tab open that somebody else had changed the page, and
 * never healing: the refused write was the only thing that would have set
 * `updated_at`.
 *
 * **Nothing in this repository could see it.** `src/db/client.ts` runs PGlite
 * for dev and unit tests, and `playwright.config.ts` puts the e2e fleet on it
 * too. PGlite's clock comes through emscripten's `gettimeofday`, backed by the
 * host's millisecond epoch — measured here, and asserted below, as whole
 * milliseconds with nothing under them. So
 * the round trip was lossless everywhere it was tested and lossy in the one
 * place that matters. The real-postgres CI job runs `src/db/*.postgres.test.ts`
 * and nothing else, and that change added no such suite.
 *
 * The generation is an integer now, which takes the clock out of the comparison
 * altogether. These tests pin both halves of what went wrong: that the token
 * survives a round trip through a real server, and that the assumption which
 * hid the bug — millisecond `now()` — is false here.
 */

/** A shop of its own, so a parallel suite's rows cannot be mistaken for ours. */
async function scratchShop(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Row Version Divers ${suffix}`,
      slug: `row-version-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  return shop;
}

describePostgres("the editor's edit generation on a real server", () => {
  it("lets a writer save a row the server has only just created", async () => {
    const pg = await postgresTestDb();
    const shop = await scratchShop(pg.db);
    const site = await createDiveSite(pg.db, { shopId: shop.id, name: "First Save Reef" });

    // Exactly what the page renders into its hidden field, and exactly what it
    // posts back — through the string form, because that round trip is where
    // the timestamp version lost its microseconds.
    const asRendered = String(site.rowVersion);
    const saved = await updateDiveSiteForForm(
      pg.db,
      shop.id,
      site.id,
      { shopId: shop.id, name: "First Save Reef", currentNote: "Saved once." },
      { expectedVersion: Number.parseInt(asRendered, 10) },
    );

    // The assertion that fails under the timestamp version: a lone writer's
    // very first save is refused as somebody else's edit.
    expect(saved).not.toBe(SITE_EDIT_CONFLICT);
    expect(saved).not.toBeNull();

    const [after] = await pg.db.select().from(diveSites).where(eq(diveSites.id, site.id));
    expect(after?.currentNote).toBe("Saved once.");
    expect(after?.rowVersion).toBe(site.rowVersion + 1);
  });

  it("still refuses a second tab holding the generation from before that save", async () => {
    const pg = await postgresTestDb();
    const shop = await scratchShop(pg.db);
    const site = await createDiveSite(pg.db, { shopId: shop.id, name: "Two Tabs Reef" });
    const opened = site.rowVersion;

    await updateDiveSiteForForm(
      pg.db,
      shop.id,
      site.id,
      { shopId: shop.id, name: "Two Tabs Reef", currentNote: "First tab." },
      { expectedVersion: opened },
    );
    expect(
      await updateDiveSiteForForm(
        pg.db,
        shop.id,
        site.id,
        { shopId: shop.id, name: "Two Tabs Reef" },
        { expectedVersion: opened },
      ),
    ).toBe(SITE_EDIT_CONFLICT);
  });

  /**
   * The measurement, stated as a test rather than left in a comment: on a real
   * server a `timestamptz` carries sub-millisecond digits, and on PGlite it
   * does not. Anyone who reaches for a timestamp as a version token again finds
   * this instead of finding out in production.
   *
   * Fifty readings from `clock_timestamp()` rather than fifty rows from one
   * `INSERT`: `now()` is the *transaction* timestamp, so a single statement
   * stamps every row it writes identically, and a run that happened to land on
   * a whole millisecond would fail a test that is not about luck. What is being
   * measured is the resolution of the server's clock, which is what `now()` is
   * read from.
   */
  it("shows why a timestamp cannot be the token: the server clock keeps microseconds", async () => {
    const pg = await postgresTestDb();
    const readings = (
      await pg.db.execute<{ micros: string }>(
        sql`select to_char(clock_timestamp(), 'US') as micros from generate_series(1, 50)`,
      )
    ).rows.map((row) => row.micros);

    expect(readings).toHaveLength(50);
    // PGlite answers `000` to every one of these — which is exactly why the
    // timestamp version of this guard passed every test in the repository.
    expect(readings.some((micros) => !micros.endsWith("000"))).toBe(true);
  });
});
