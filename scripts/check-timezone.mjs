import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * One invariant: **a rendered date names the zone it is rendered in.**
 *
 * DiveDay stores every timestamp as a UTC instant and displays it in the shop's
 * own zone (`shops.timezone`, docs/architecture/overview.md). The failure mode
 * this guards is silent by construction: `Intl.DateTimeFormat` and the
 * `toLocale*String` family fall back to the **host** zone when no `timeZone` is
 * given, and DiveDay's servers — like CI, like every container the tests run in
 * — are UTC. A 7:30 AM Key Largo departure then renders "11:30 AM": still a
 * plausible time, still a green test suite, and four hours wrong on the one
 * screen a diver uses to decide when to leave the house. Nothing in review
 * reliably catches an option that isn't there.
 *
 * The formatters in `src/lib/format.ts` take `timeZone` as a **required**
 * parameter, so every call through them is already proven by `pnpm typecheck`.
 * This script covers what types cannot: code that reaches for `Intl` directly.
 *
 * The rule is "name a zone", not "name the shop's zone" — a deliberate
 * `timeZone: "UTC"` is fine and several modules need exactly that, because they
 * format a value that has no instant in it (a date-only calendar date in
 * `src/lib/calendar-date.ts`, a wall-clock time of day in `src/lib/courses.ts`,
 * a synthetic reference date for weekday names). Those are choices a reviewer
 * can see and agree with. An omission is not a choice at all, which is the
 * whole difference.
 *
 * Scope is every layer that formats for a human: the UI (`src/app`,
 * `src/components`) plus the domain and data layers (`src/lib`, `src/db`,
 * `src/features`), which build the emails, SMS, exports, and calendar feed that
 * a diver reads with no browser to correct them.
 */

const ROOT = process.cwd();

const guardedRoots = ["src/app", "src/components", "src/lib", "src/db", "src/features"];

const sourceExtensions = new Set([".ts", ".tsx"]);

/**
 * The date-rendering APIs that silently default to the host zone. `Intl` is
 * matched on construction; the `toLocale*` methods on the call. `toLocaleString`
 * is included even though `Number.prototype` shares the name — number and money
 * formatting in this repo goes through `Intl.NumberFormat` / `formatMoneyCents`
 * (`src/lib/format.ts`), so a bare `.toLocaleString(` here is a date far more
 * often than not, and the fix for the rare number is to use the number path.
 */
const zoneSensitiveCalls = [
  "new Intl.DateTimeFormat(",
  ".toLocaleDateString(",
  ".toLocaleTimeString(",
  ".toLocaleString(",
];

async function walk(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (
      sourceExtensions.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

/**
 * The source of the call's argument list, from the opening paren to its match.
 * Brace-counting rather than a regex because the options object routinely spans
 * lines and nests (`{ hour: "numeric", timeZone: shop.timezone }` under a
 * ternary, inside a template literal), and a line-oriented scan reads the first
 * `)` it meets as the end of a call it is only halfway through.
 */
function argumentSource(contents, openParenIndex) {
  let depth = 0;
  for (let index = openParenIndex; index < contents.length; index += 1) {
    const character = contents[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) return contents.slice(openParenIndex + 1, index);
    }
  }
  return contents.slice(openParenIndex + 1);
}

const violations = [];

for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const contents = await readFile(path.join(ROOT, file), "utf8");
    for (const call of zoneSensitiveCalls) {
      let from = 0;
      while (true) {
        const index = contents.indexOf(call, from);
        if (index === -1) break;
        from = index + call.length;
        const args = argumentSource(contents, index + call.length - 1);
        if (/\btimeZone\b/.test(args)) continue;
        const line = contents.slice(0, index).split("\n").length;
        violations.push(`${file}:${line}: ${call.trim()}…) names no timeZone`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Timezone violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    'Every rendered date names its zone. Prefer the formatters in src/lib/format.ts, which require one (pass shop.timezone); when formatting a value that has no instant — a date-only value or a wall-clock time of day — say `timeZone: "UTC"` explicitly. Omitting it renders in the host zone, which is UTC in production.',
  );
  process.exit(1);
}

console.log(
  `timezone: every date render under ${guardedRoots.join(", ")} names its zone (src/lib/format.ts requires one)`,
);
