import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * **A cap on a `rental_fit_profiles` text column lives on the writer, never
 * only on the reader.**
 *
 * The same bug has now shipped three times — #1062, #1728 and #1754 — and all
 * three are one shape: a value stored through a door with no cap, met later by
 * a form asked to re-submit it. `rental_fit_profiles`' text columns are written
 * by several boundaries and read back by all of them, and each one re-posts
 * whatever is stored, so a value one door accepts makes every *other* door's
 * save fail `safeParse` on a form where every visible box reads right.
 *
 * Issue #1754 asked whether DiveDay should adopt a general rule — never refuse
 * a save on an over-long value the submitter did not change. **That rule is
 * declined** (issue #1794). An HTML post cannot tell a retyped value from an
 * unchanged one: both are the same bytes. The only way a schema could is for
 * every form to carry an `original-<field>` hidden input and compare, which is
 * a second copy of every stored value on the wire, on surfaces where the URL is
 * the capability (`/ready/[token]`, `/shelf/[token]`) and the extra field is one
 * more thing a hand-crafted post can lie about. That is more machinery than all
 * three incidents cost put together.
 *
 * What the three incidents actually shared is narrower and mechanisable, and it
 * is what this guard checks: **the cap was on the reader and not on the
 * writer.** #1728 fixed it by making the three form caps read one constant;
 * #1754 fixed it by applying that same constant at the importer, the one door
 * that had none. Neither needed a new rule about saves; both needed the cap to
 * exist at the boundary.
 *
 * ## What it refuses, and what it deliberately leaves alone
 *
 * A **zod field named after one of the size columns** must be bounded by
 * `RENTAL_FIT_TEXT_LIMITS`. That is the shape all three incidents had — each
 * was a boundary schema — and it is the shape the next one will have, because
 * a boundary schema is the only place in this codebase a size arrives from
 * outside.
 *
 * Three things are *not* writers and are left alone on purpose, because a
 * guard that fires on them is a guard people route around:
 *
 * - `src/db/rental-fit.ts`, which writes every one of these columns and is
 *   deliberately the layer with no opinion about length. Its callers have
 *   bounded the value by the time it arrives; teaching it a second cap would
 *   put the number in two places, which is the thing #1728 fixed.
 * - the `maxLength` attributes in JSX, which already read the constant and are
 *   a courtesy to the typist rather than a bound — HTML `maxlength` does not
 *   constrain a value the visitor never typed, which is precisely how #1728
 *   reached production.
 * - every reader: the packing list, the manifest, the exporter, the seed.
 *
 * The escape hatch is one line — `diveday:allow-unbounded-size: <why>` on or
 * directly above the field — because a guard with no way out gets deleted
 * rather than argued with. There are none today.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/lib", "src/db", "src/features", "src/components"];

/**
 * The five text columns, by the field name every writer spells them with.
 * `weightPreference` is here too: it is the same class of column and carries
 * the other half of `RENTAL_FIT_TEXT_LIMITS`, and it was half of #1728.
 */
const SIZE_FIELDS = [
  "bcdSize",
  "wetsuitSize",
  "drysuitSize",
  "bootSize",
  "finSize",
  "weightPreference",
];

/**
 * The layer with no opinion about length, by design. See the note above; this
 * is the one file that writes these columns and must not be asked to bound
 * them.
 */
const NOT_A_BOUNDARY = new Set(["src/db/rental-fit.ts"]);

// The reason has to be on the marker's own line. `\s*\S` would have run
// across the newline and read the declaration below as the reason, which is
// how a bare marker passed the first time this was written.
const ALLOW = /diveday:allow-unbounded-size:[^\S\n]*\S/;
const LIMITS = "RENTAL_FIT_TEXT_LIMITS";

/**
 * A zod field declaration for one of the size columns — `finSize: z.string()`
 * and anything chained onto it, up to the end of that logical field.
 *
 * Anchored on `z.` rather than on the field name alone, so an object literal
 * that merely *carries* a size (every writer's `values()`, every reader's
 * projection) is not mistaken for a schema that accepts one from outside.
 */
const ZOD_SIZE_FIELD = new RegExp(String.raw`^\s*(${SIZE_FIELDS.join("|")})\s*:\s*z\.[^\n]*`, "gm");

export function unboundedSizeFields(relativePath, contents) {
  if (NOT_A_BOUNDARY.has(relativePath)) return [];
  const lines = contents.split("\n");
  const problems = [];
  for (const match of contents.matchAll(ZOD_SIZE_FIELD)) {
    const declaration = match[0];
    if (declaration.includes(LIMITS)) continue;
    const lineNumber = contents.slice(0, match.index).split("\n").length;
    // The line itself, or the one above it — a reason is often the comment
    // that explains the field rather than a trailing note on it.
    const nearby = `${lines[lineNumber - 2] ?? ""}\n${declaration}`;
    if (ALLOW.test(nearby)) continue;
    problems.push(
      `${relativePath}:${lineNumber}: ${match[1]} is accepted from outside without ` +
        `${LIMITS} — a value this door stores makes every other door's save fail on a ` +
        `form where every visible box reads right (issues #1062, #1728, #1754)`,
    );
  }
  return problems;
}

async function sourceFiles(dir) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, dir), { recursive: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
    .map((entry) => path.join(dir, entry))
    .sort();
}

async function main() {
  const problems = [];
  let scanned = 0;
  let bounded = 0;
  for (const dir of SCAN_DIRS) {
    for (const relativePath of await sourceFiles(dir)) {
      const contents = await readFile(path.join(ROOT, relativePath), "utf8");
      // Cheap gate before the regex: most of the tree names none of these.
      if (!SIZE_FIELDS.some((field) => contents.includes(field))) continue;
      scanned += 1;
      bounded += [...contents.matchAll(ZOD_SIZE_FIELD)].filter((match) =>
        match[0].includes(LIMITS),
      ).length;
      problems.push(...unboundedSizeFields(relativePath, contents));
    }
  }

  if (problems.length > 0) {
    console.error("check:rental-fit-caps: size field(s) accepted from outside with no cap:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `Bound it with ${LIMITS} (src/lib/rentals.ts), the one number all these doors share. If this ` +
        "field genuinely cannot be bounded, say so in a `diveday:allow-unbounded-size: <why>` line " +
        "on it or directly above it.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `rental-fit-caps: ${bounded} rental-fit size field(s) across ${scanned} file(s) are bounded by ${LIMITS}`,
  );
}

// Importable for its own test without running the sweep.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
