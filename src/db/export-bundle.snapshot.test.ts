import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { count, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CsvValue, ExportTable } from "@/lib/export";
import { seededShopContext } from "@/test/db";
import { loadDiverExportBundleInput, loadShopExportBundleInput } from "./export";
import { bookings, people } from "./schema";

/**
 * **The whole export bundle, pinned** — the seeded shop's, and its three
 * busiest divers' own.
 *
 * `export.test.ts` and `diver-export.test.ts` assert what a bundle must
 * *contain*; this pins what it *is*, so a change to how the loaders are put
 * together (the read list in `./export-tables`, the per-file row builders in
 * `./export-shop-files` and `./export-diver-files`) cannot quietly change a
 * cell a shop or a diver is handed. A change that means to move the output
 * updates the snapshot in the same diff, where a reviewer sees which file moved.
 *
 * The seeded database is rebuilt every run, so three things in it are not
 * stable across runs and are normalized away before hashing: uuids (random),
 * instants (some are stamped by the database's own clock, which the frozen
 * test clock does not reach), and therefore the order of rows that tie on such
 * an instant and fall back to a uuid — each file's rows are sorted after
 * normalizing. What is pinned is every file, its note, its header, its row
 * count, and every other value in every cell. Row order is the other two
 * files' to assert, and they do.
 *
 * A snapshot holding 1.5 MB of normalized CSV would be unreviewable, so the
 * snapshot is one digest per file. On a mismatch the full normalized text of
 * both bundles is written under the OS temp directory (the path is in the
 * failure message) so the moved cells can be diffed.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normalizeCell(value: CsvValue): string {
  if (value instanceof Date) return "<instant>";
  if (value === null) return "<null>";
  if (value === undefined) return "<undefined>";
  return `${typeof value}:${String(value).replace(UUID, "<uuid>")}`;
}

type NormalizedFile = { file: string; text: string; digest: string };

function normalizeTables(tables: ExportTable[]): NormalizedFile[] {
  return tables.map((table) => {
    const rows = table.rows.map((row) => row.map(normalizeCell).join(" | ")).sort();
    const text = [
      `## ${table.file} (${table.rows.length} rows)`,
      `# ${table.note}`,
      table.header.join(" | "),
      ...rows,
    ].join("\n");
    const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
    return { file: table.file, text, digest };
  });
}

function photoLine(urls: string[]): string {
  const normalized = urls.map((url) => url.replace(UUID, "<uuid>")).sort();
  const digest = createHash("sha256").update(normalized.join("\n")).digest("hex").slice(0, 16);
  return `photos: ${urls.length} ${digest}`;
}

function digestLines(title: string, files: NormalizedFile[], tables: ExportTable[]): string[] {
  return [
    title,
    ...files.map(
      (file, index) =>
        `${file.file} ${tables[index]?.rows.length} rows ${file.digest} [${tables[index]?.header.join(",")}]`,
    ),
  ];
}

function dumpOnMismatch(name: string, files: NormalizedFile[]): string {
  const dir = path.join(tmpdir(), "diveday-export-snapshot");
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${name}.txt`);
  writeFileSync(target, files.map((file) => file.text).join("\n\n"));
  return target;
}

describe("the export bundle, pinned", () => {
  it("pins the seeded shop's whole bundle", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");
    const files = normalizeTables(input.tables);
    const dumped = dumpOnMismatch("shop", files);
    const lines = [
      ...digestLines(
        `shop ${input.shopName} (${input.shopSlug}) ${input.timezone}`,
        files,
        input.tables,
      ),
      photoLine(input.photoUrls),
    ];
    await expect(
      `${lines.join("\n")}\n`,
      `normalized bundle written to ${dumped}`,
    ).toMatchFileSnapshot("./__snapshots__/export-bundle.shop.snap");
  });

  it("pins three seeded divers' own bundles", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const busiest = await db
      .select({ personId: people.id, fullName: people.fullName, seats: count(bookings.id) })
      .from(people)
      .innerJoin(bookings, eq(bookings.personId, people.id))
      .where(eq(people.shopId, shop.id))
      .groupBy(people.id, people.fullName)
      .orderBy(desc(count(bookings.id)), people.fullName)
      .limit(3);
    expect(busiest).toHaveLength(3);

    const lines: string[] = [];
    const all: NormalizedFile[] = [];
    for (const diver of busiest) {
      const input = await loadDiverExportBundleInput(db, shop.id, diver.personId);
      if (!input) throw new Error(`seeded diver ${diver.fullName} failed to load`);
      const files = normalizeTables(input.tables);
      all.push(...files);
      lines.push(
        ...digestLines(
          `diver ${input.diverName} (${diver.seats} seats) at ${input.shopSlug} ${input.timezone}`,
          files,
          input.tables,
        ),
        photoLine(input.photoUrls),
        "",
      );
    }
    const dumped = dumpOnMismatch("divers", all);
    await expect(lines.join("\n"), `normalized bundles written to ${dumped}`).toMatchFileSnapshot(
      "./__snapshots__/export-bundle.divers.snap",
    );
  });
});
