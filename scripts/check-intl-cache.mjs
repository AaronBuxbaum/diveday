import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Every `Intl` formatter is constructed through `src/lib/intl-cache.ts`, never
 * with a bare `new Intl.*` at the call site.
 *
 * Why this is a guarded invariant rather than a style nit: constructing an
 * `Intl` formatter does locale-data lookup and pattern compilation; calling
 * `.format()` on an existing one does neither. Measured on a CI-class box,
 * constructing an `Intl.DateTimeFormat` and calling `formatToParts` costs
 * ~75µs against ~6µs for reusing one (**12x**), and `Intl.ListFormat` ~8.6x.
 * AGENTS.md requires locale-negotiated formatting for every date, time and
 * money figure app-wide, so that cost is paid on essentially every render.
 *
 * This has already regressed twice, which is why it is machine-checked now.
 * The first round memoized `src/lib/format.ts` and cut a contended CI e2e
 * set's failure rate from 6/18 to 0–2/18. The fix stopped at that file's
 * boundary: sixteen other modules kept building their own, `src/lib/zoned.ts`
 * worst of all at *three* `Intl.DateTimeFormat`s per single wall-clock
 * conversion on a module 26 others import, and several surfaces built an
 * `Intl.ListFormat` inside a `.map()`. The second round swept those up — and
 * new code merged in the same week reintroduced it again in `src/i18n/fill.ts`
 * (an `Intl.PluralRules` per interpolated message, the hottest site in the
 * app). A review-only rule does not survive that; a check does. The decision
 * record is docs/architecture/decisions/20260807-intl-formatter-cache.md.
 *
 * Scope is every guarded source root, tests excluded: a test constructing a
 * formatter directly is usually asserting *about* `Intl` itself, and paying a
 * constructor once in a test costs nothing that matters.
 */

const ROOT = process.cwd();
const guardedRoots = ["src/app", "src/components", "src/lib", "src/db", "src/features", "src/i18n"];
const sourceExtensions = new Set([".ts", ".tsx"]);

/** The one module allowed to call the constructors — it is the cache. */
const allowed = new Set([path.normalize("src/lib/intl-cache.ts")]);

/**
 * `Intl.Locale` is deliberately not guarded. It is a parsed locale *value*,
 * not a compiled formatter — there is no `.format()` on it and no ruleset to
 * compile, so caching it buys nothing and would add a seam for no reason.
 * Every other `Intl` constructor produces a compiled, reusable, stateless
 * object, which is exactly what the cache exists for.
 */
const guardedConstructor = /\bnew\s+Intl\.(?!Locale\b)([A-Za-z]+)\s*\(/g;

const isTestFile = (file) => /\.test\.tsx?$/.test(file);

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const violations = [];
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    if (allowed.has(path.normalize(file))) continue;
    if (isTestFile(file)) continue;
    const contents = await readFile(path.join(ROOT, file), "utf8");
    contents.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(guardedConstructor)) {
        violations.push(`${file}:${index + 1}: new Intl.${match[1]}(…)`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    `Intl formatters constructed outside the cache:\n${violations.map((v) => `- ${v}`).join("\n")}`,
  );
  console.error(
    "Build them through src/lib/intl-cache.ts instead — `cachedFormatter(tag, Intl.X, locale, options)`, or one of the named helpers (`cachedListFormat`, `cachedPluralRules`, `cachedCollator`, `cachedDisplayNames`).",
  );
  console.error(
    "Constructing a formatter is ~12x the cost of reusing one, and this app formats on essentially every render. If a call site genuinely needs its own instance, say why in this script's `allowed` set rather than at the call site.",
  );
  process.exit(1);
}

console.log("intl-cache: every Intl formatter is built through src/lib/intl-cache.ts");
