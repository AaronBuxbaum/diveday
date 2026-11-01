import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { filesUnder } from "./files-under.mjs";

/**
 * Every read of an append-only event table names the shop.
 *
 * The event tables (`roll_call_events`, `roll_call_crew_events`, the payment,
 * review-moderation and work-order trails, and the rest) are written for ever
 * and read by a trip, a person or a parent row. Each carries `shop_id`, and
 * each one's index leads with it. A read by `tripId` alone is correct today
 * (a trip id belongs to one shop) but it is a tenant boundary resting on an
 * id rather than on the column that states it, and it misses the index: the
 * 2026-10-11 review fixed two such roll-call reads, and the next day a new
 * module (`src/db/rehearsals.ts`, run across every shop by a nightly cron)
 * wrote the same shape again, with three siblings already in the tree. A
 * guard, not a sweep, is what keeps the fourth one out.
 *
 * ## What is guarded
 *
 * `.from(<table>)` for every `export const <name>Events = pgTable(...)` in
 * `src/db/schema/` that declares `shopId`, plus {@link EXTRA_TABLES}. A read
 * passes when `eq(<table>.shopId,` or `inArray(<table>.shopId,` appears
 * inside it (a projection, join or groupBy of the column does not count):
 * from the anchor to the next
 * `.from(` or {@link QUERY_WINDOW} lines, whichever is first, so one query is
 * never covered by its neighbour (issue #635's lesson, from
 * `check-live-trips.mjs`).
 *
 * ## Saying "this one is across shops on purpose"
 *
 * `diveday:allow-unscoped-event: <why>` in a comment inside the query or on
 * the three lines above it. {@link SKIPPED_FILES} holds the modules where
 * every read is across shops by design.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features", "src/app", "src/lib"];
const SCHEMA_DIR = "src/db/schema";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const QUERY_WINDOW = 40;
const ALLOW = /diveday:allow-unscoped-event:/;
const IS_TEST = /\.test\.tsx?$/;

/** Append-only tables whose names do not end in `Events` but read the same way. */
const EXTRA_TABLES = ["executedDives", "recapPhotos", "tripRecapPhotos"];

/**
 * `retention.ts` prunes every shop's expired rows in one pass, and the seed
 * writes the tables rather than reading them.
 */
const SKIPPED_FILES = new Set(
  ["src/db/retention.ts", "src/db/seed.ts"].map((file) => path.normalize(file)),
);

/** The event tables a schema file declares with a `shopId` column. */
export function eventTablesIn(schemaSource) {
  const tables = [];
  const declaration = /^export const (\w+Events) = pgTable\(/gm;
  for (const match of schemaSource.matchAll(declaration)) {
    const rest = schemaSource.slice(match.index + match[0].length);
    const end = rest.search(/^export /m);
    if (/\bshopId:\s*uuid\(/.test(end === -1 ? rest : rest.slice(0, end))) tables.push(match[1]);
  }
  return tables;
}

/**
 * `eq(<table>.shopId, …)` or `inArray(<table>.shopId, …)`: the shop as a
 * predicate. A bare mention is not enough, since a projection, a join to
 * `shops` or a `groupBy` names the column while reading every shop's rows.
 */
function filtersShop(window, table) {
  return new RegExp(`\\b(?:eq|inArray)\\(\\s*${table}\\.shopId\\s*,`).test(window);
}

/** Reads of `tables` in `source` that name no shop and give no reason. */
export function findUnscopedEventReads(source, tables) {
  const lines = source.split("\n");
  const anchors = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\.from\((\w+)\)/g)) {
      anchors.push({ index, table: match[1] });
    }
  });
  const findings = [];
  let guarded = 0;
  anchors.forEach(({ index, table }, position) => {
    if (!tables.includes(table)) return;
    guarded += 1;
    const next = anchors.slice(position + 1).find((anchor) => anchor.index > index);
    const end = Math.min(index + QUERY_WINDOW, next?.index ?? lines.length);
    const window = lines.slice(index, end).join("\n");
    const above = lines.slice(Math.max(0, index - 3), index).join("\n");
    if (filtersShop(window, table) || ALLOW.test(window) || ALLOW.test(above)) return;
    findings.push({ line: index + 1, table, text: lines[index].trim() });
  });
  return { guarded, findings };
}

async function main() {
  const tables = [...EXTRA_TABLES];
  for (const file of await filesUnder(
    SCHEMA_DIR,
    (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
    (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)),
  )) {
    tables.push(...eventTablesIn(await readFile(path.join(ROOT, file), "utf8")));
  }
  const violations = [];
  let guarded = 0;
  for (const root of GUARDED_ROOTS) {
    for (const file of await filesUnder(
      root,
      (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
      (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)),
    )) {
      const normalized = path.normalize(file);
      if (SKIPPED_FILES.has(normalized) || IS_TEST.test(file)) continue;
      if (normalized.startsWith(path.normalize(SCHEMA_DIR))) continue;
      if (path.basename(file).startsWith("seed-")) continue;
      const result = findUnscopedEventReads(await readFile(path.join(ROOT, file), "utf8"), tables);
      guarded += result.guarded;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }
  if (violations.length > 0) {
    console.error(
      `Reads of an append-only event table that do not name the shop:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Add `eq(<table>.shopId, shopId)` to the query's where clause: the event tables' indexes lead with `shop_id`, and the column is the tenant boundary, not the trip or parent id.",
    );
    console.error(
      "A read that is across shops by design says `diveday:allow-unscoped-event: <why>` in a comment inside the query or just above it.",
    );
    process.exit(1);
  }
  console.log(
    `event-scope: ${guarded} reads of ${tables.length} event tables all name the shop (or say why not)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
