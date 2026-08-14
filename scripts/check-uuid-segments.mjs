import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Every dynamic route segment that names a database row -- `[id]`, `[tripId]`,
 * `[personId]` -- must be narrowed with `uuidParam()` before the page's first
 * read, so an unparseable id renders the page's own `notFound()`.
 *
 * Why this is a guarded invariant rather than a review expectation: Postgres
 * does not coerce a malformed literal in `"orders"."id" = $1`. It raises
 * `invalid input syntax for type uuid`, which surfaces as a **500** -- an alarm
 * page, a Sentry event and a log line -- where a 404 belongs. Twelve routes
 * were in that state until 2026-08-14, including the unauthenticated public
 * booking page `/s/<slug>/trips/[id]`, where an anonymous visitor could turn a
 * shop's diver-facing page into a 500 by editing the URL. There is no data
 * disclosure in any of them (the query never runs), but the failure is loud,
 * indistinguishable from a real outage, and free to prevent.
 *
 * The query-string half of the same problem was closed earlier and stays closed
 * by construction: `uuidParam()` returns `undefined` for junk, and every
 * `searchParams` caller already treats `undefined` as "no filter". A path
 * segment has no such fallback -- the page cannot render without it -- so the
 * guard there pairs with `notFound()` instead.
 *
 * Deliberately not enforced inside `src/db`: a query helper that silently
 * dropped an id it could not parse would hide a real bug from a caller holding
 * a genuine one. Only the layer that knows the string arrived from a URL gets
 * to shrug at it.
 *
 * ## What this checks, and what it cannot
 *
 * For each `page.tsx` under a matching dynamic segment, it resolves the local
 * name the segment is destructured into (`{ id: tripId }` -> `tripId`) and
 * requires a `uuidParam(<name>)` call somewhere in the file. It does not verify
 * the guard sits *above* the first query -- that is a review reading. It does
 * catch the failure that actually happened twelve times over, which is nobody
 * thinking about the segment at all.
 *
 * A segment that genuinely is not a uuid -- a slug, an opaque token -- is named
 * in `NON_UUID_SEGMENTS` below with its reason, not exempted by a comment, so
 * the list of "ids that are not ids" stays readable in one place.
 */

const ROOT = process.cwd();
const APP_ROOT = "src/app";

/**
 * Segments whose value is not a uuid. Each needs a reason a reader can check.
 * A bearer token is deliberately absent from this list because no `[token]`
 * segment matches the id pattern in the first place.
 */
const NON_UUID_SEGMENTS = new Map();

/** `[id]`, `[tripId]`, `[personId]` -- but not `[slug]`, `[token]`, `[shopSlug]`. */
const ID_SEGMENT = /^\[(id|[a-z][a-zA-Z]*Id)\]$/;

async function walk(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (entry.name === "page.tsx") files.push(relativePath);
  }
  return files;
}

/**
 * Type positions, which wear the same `name: value` shape as a destructuring
 * rename. `params: Promise<{ shopSlug: string; id: string }>` would otherwise
 * read as "`id` is bound to `string`".
 */
const TYPE_NAMES = new Set(["string", "number", "boolean", "unknown", "any", "undefined", "null"]);

/**
 * Every local name a route param could be bound to. `{ shopSlug, id: tripId }`
 * binds `id` to `tripId`; `{ shopSlug, tripId }` binds it to itself. Both forms
 * are accepted rather than resolved to one, because a file may legitimately
 * destructure the same param twice (a page body and its `generateMetadata`)
 * under different names.
 */
function localNamesFor(contents, param) {
  const names = new Set([param]);
  const renames = contents.matchAll(new RegExp(`\\b${param}\\s*:\\s*([A-Za-z_$][\\w$]*)`, "g"));
  for (const [, name] of renames) if (!TYPE_NAMES.has(name)) names.add(name);
  return names;
}

const violations = [];

for (const file of await walk(APP_ROOT)) {
  const segments = file.split(path.sep).filter((segment) => ID_SEGMENT.test(segment));
  if (segments.length === 0) continue;

  const contents = await readFile(path.join(ROOT, file), "utf8");
  for (const segment of segments) {
    const param = segment.slice(1, -1);
    if (NON_UUID_SEGMENTS.has(`${file}:${param}`)) continue;
    const locals = [...localNamesFor(contents, param)];
    const guarded = locals.some((local) =>
      new RegExp(`uuidParam\\(\\s*${local}\\s*\\)`).test(contents),
    );
    if (!guarded) {
      violations.push(
        `${file}: [${param}] reaches a query unguarded (expected uuidParam(${locals.join(") or uuidParam(")}))`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`Unguarded uuid path segments:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    "Add `if (!uuidParam(<segment>)) notFound();` above the page's first database read. Comparing a non-uuid literal against a `uuid` column raises in Postgres, so without it a mistyped URL is a 500 where the page's own notFound() belongs.",
  );
  console.error(
    "A `generateMetadata` in the same file runs its own read and needs its own guard -- it cannot call notFound(), so it returns the fallback metadata instead.",
  );
  console.error(
    "If the segment genuinely is not a uuid, add it to `NON_UUID_SEGMENTS` in this script with the reason.",
  );
  process.exit(1);
}

console.log("uuid-segments: every [id]/[*Id] route segment is narrowed before its first read");
