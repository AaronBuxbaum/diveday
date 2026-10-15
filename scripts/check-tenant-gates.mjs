import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **Every staff page asks whether the slug in the URL is its reader's own shop**
 * (issue #1446).
 *
 * `requireShopSurface` (`src/lib/session.ts`) asks two questions, not one: the
 * session's shop row still exists, *and* the slug in the URL names it. The
 * second is the one this guard is about, and until the staff shell became an
 * App Shell it was possible to skip it — the shell asked it above `{children}`,
 * so a page that only resolved `getShopById(db, session.user.shopId)` was
 * covered without saying so.
 *
 * The shell now streams *beside* the page rather than above it, so its refusal
 * and the page's render are two branches of one response and neither waits for
 * the other. A page relying on the shell is relying on a race. Exactly one was:
 * `shop/[shopSlug]/page.tsx`, the shop home — found by a `security-reviewer`
 * pass on the restructure, not by a test, which is why this guard exists.
 *
 * The failure it prevents is not a cross-tenant read: a page that resolves its
 * shop from `session.user.shopId` renders the reader's *own* rows. It is the
 * console rendering under someone else's slug, with every link on it built from
 * that slug.
 *
 * A text scan: there is no way to ask a Server Component "did you refuse
 * this", and booting the app per route is not something a check can afford. It
 * under-reports rather than over-reports. Moved here from
 * `src/app/shop/tenant-gate-coverage.test.ts` (test review 2026-10-14, L2c).
 */

export const STAFF_APP = "src/app/shop/[shopSlug]";

/**
 * The three shapes that ask the second question. Any one of them is the gate;
 * the point is that *something* compares the URL to the session.
 *
 * - `requireShopSurface(...)` — the helper, and what nearly every page uses.
 * - `!== session.user.shopId` — the inline form, after a `getShopBySlug`: the
 *   row came from the URL, so comparing its id to the session's is the same
 *   question asked from the other end.
 * - `shop.slug !== shopSlug` — the home's form, after a `getShopById` on the
 *   session: the row came from the session, so the slug is what has to match.
 */
export const GATES = [
  /\brequireShopSurface\s*\(/,
  /!==\s*session\.user\.shopId\b/,
  /\bshop\.slug\s*!==\s*shopSlug\b/,
];

/**
 * The pages that compare by hand rather than through the helper, each for a
 * stated reason in its own comment. A third appearing silently would mean the
 * helper is being worked around rather than used: adding to this list is a
 * decision, not a fix.
 */
export const BY_HAND = [
  // Reads the shop by slug — the course lookup is slug-scoped — and then
  // compares ids. It says why at the call site.
  "courses/page.tsx",
  // The home resolves its own shop from the session (`getShopById`) inside the
  // page's own boundary, so the slug is the half it has to check.
  "page.tsx",
];

/** `source` with its comments out, keeping a `//` straight after a colon (a URL). */
export function stripComments(source) {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Which gate `source` asks: "helper", "by-hand", or null for none. */
export function gateOf(source) {
  const code = stripComments(source);
  if (GATES[0].test(code)) return "helper";
  if (GATES.some((gate) => gate.test(code))) return "by-hand";
  return null;
}

/**
 * The bare re-export a page may be (`export { default } from "./SettingsPage"`),
 * as the sibling module's name, or null. Followed one hop; a shim of a shim is
 * not a shape this tree has.
 */
export function reexportTarget(source) {
  return (
    stripComments(source).match(
      /export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*"\.\/([\w.-]+)"/,
    )?.[1] ?? null
  );
}

async function walkPages(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkPages(full, found);
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

/** The module a page renders: itself, or the sibling it re-exports. */
async function renderingSource(file) {
  const raw = await readFile(file, "utf8");
  const target = reexportTarget(raw);
  if (!target) return { where: file, source: raw };
  for (const extension of [".tsx", ".ts"]) {
    const candidate = path.join(path.dirname(file), `${target}${extension}`);
    try {
      return { where: candidate, source: await readFile(candidate, "utf8") };
    } catch {
      // Try the other extension; a name that resolves to neither falls
      // through to the shim itself, which then fails with its own path.
    }
  }
  return { where: file, source: raw };
}

/** Every staff page under `root`, with the gate its rendering module asks. */
export async function staffPageGates(root = process.cwd()) {
  const app = path.join(root, STAFF_APP);
  const rel = (file) => path.relative(app, file).replaceAll(path.sep, "/");
  const pages = [];
  for (const file of (await walkPages(app)).sort()) {
    const { where, source } = await renderingSource(file);
    pages.push({ page: rel(file), where: rel(where), gate: gateOf(source) });
  }
  return pages;
}

/** The problems with `pages`: an ungated page, or a by-hand gate not on the list. */
export function tenantGateProblems(pages, byHand = BY_HAND) {
  const problems = [];
  if (pages.length < 40) {
    problems.push(`found only ${pages.length} staff pages under ${STAFF_APP}; the walk is broken`);
  }
  for (const { page, where, gate } of pages) {
    if (gate === null) {
      problems.push(
        `${STAFF_APP}/${where}: nothing here compares the URL slug to the session's shop. Call requireShopSurface, or make the comparison inline — the staff shell streams beside this page and cannot make it for you (issue 1446).`,
      );
    } else if (gate === "by-hand" && !byHand.includes(page)) {
      problems.push(
        `${STAFF_APP}/${page}: compares the slug by hand rather than through requireShopSurface. Use the helper, or add the page to BY_HAND in scripts/check-tenant-gates.mjs with its reason.`,
      );
    }
  }
  for (const page of byHand) {
    const found = pages.find((entry) => entry.page === page);
    if (found?.gate !== "by-hand") {
      problems.push(
        `${STAFF_APP}/${page} is listed in BY_HAND but no longer compares by hand; take it off the list.`,
      );
    }
  }
  return problems;
}

async function main() {
  const pages = await staffPageGates();
  const problems = tenantGateProblems(pages);
  if (problems.length > 0) {
    console.error(
      `Staff pages that do not gate on the slug:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`tenant-gates: ${pages.length} staff pages compare the URL's shop to the session's`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
