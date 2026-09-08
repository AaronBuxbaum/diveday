import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Every staff page asks whether the slug in the URL is its reader's own shop**
 * (issue #1446).
 *
 * `requireShopSurface` (`src/lib/session.ts`) asks two questions, not one: the
 * session's shop row still exists, *and* the slug in the URL names it. The
 * second is the one this file is about, and until the staff shell became an
 * App Shell it was possible to skip it — the shell asked it above `{children}`,
 * so a page that only resolved `getShopById(db, session.user.shopId)` was
 * covered without saying so.
 *
 * The shell now streams *beside* the page rather than above it, so its refusal
 * and the page's render are two branches of one response and neither waits for
 * the other. A page relying on the shell is relying on a race. Exactly one was:
 * `shop/[shopSlug]/page.tsx`, the shop home — found by a `security-reviewer`
 * pass on the restructure, not by a test, which is why this file exists.
 *
 * The failure it prevents is not a cross-tenant read: a page that resolves its
 * shop from `session.user.shopId` renders the reader's *own* rows. It is the
 * console rendering under someone else's slug, with every link on it built from
 * that slug — the "phishing-shaped breach of the 'slug and session agree'
 * invariant" `ShopChrome` names in its own comment, on the one page that
 * comment did not cover.
 *
 * A text scan, like `instant-coverage.test.ts` and
 * `src/i18n/provider-coverage.test.ts`: there is no way to ask a Server
 * Component "did you refuse this", and booting the app per route is not
 * something a unit suite can afford. It under-reports rather than over-reports.
 */

const STAFF_APP = path.join(process.cwd(), "src/app/shop/[shopSlug]");

/**
 * Comments first, and this is not decoration.
 *
 * `shop/[shopSlug]/page.tsx` mentions `requireShopSurface` three times in
 * prose, explaining why it cannot call the helper from inside its own
 * `<Suspense>` boundary. Scanning the raw text passes that page on its
 * *comments* — which is precisely the page whose missing gate started this
 * file. A guard satisfied by an explanation of why the thing is absent is
 * worse than no guard.
 *
 * Line comments before block comments, for the reason `instant-coverage.test.ts`
 * states at its own copy: a `//` comment naming a route glob contains the
 * characters that open a block comment.
 */
function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The three shapes that ask the second question. Any one of them is the gate;
 * the point is that *something* compares the URL to the session.
 *
 * - `requireShopSurface(...)` — the helper, and what 43 of the 47 use.
 * - `!== session.user.shopId` — the inline form, after a `getShopBySlug`: the
 *   row came from the URL, so comparing its id to the session's is the same
 *   question asked from the other end.
 * - `shop.slug !== shopSlug` — the home's form, after a `getShopById` on the
 *   session: the row came from the session, so the slug is what has to match.
 */
const GATES = [
  /\brequireShopSurface\s*\(/,
  /!==\s*session\.user\.shopId\b/,
  /\bshop\.slug\s*!==\s*shopSlug\b/,
] as const;

/**
 * Pages that are a bare re-export (`export { default } from "./SettingsPage"`)
 * render somebody else's module, and that module is where the gate lives.
 * Follow one hop; a second would mean a shim of a shim, which is not a shape
 * this tree has.
 */
async function renderingSource(file: string): Promise<{ where: string; source: string }> {
  const raw = stripComments(await readFile(file, "utf8"));
  const reexport = raw.match(/export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*"\.\/([\w.-]+)"/);
  if (!reexport) return { where: file, source: raw };
  for (const extension of [".tsx", ".ts"]) {
    const target = path.join(path.dirname(file), `${reexport[1]}${extension}`);
    try {
      return { where: target, source: stripComments(await readFile(target, "utf8")) };
    } catch {
      // Try the other extension; a name that resolves to neither falls through
      // to the shim itself, which then fails the assertion with its own path.
    }
  }
  return { where: file, source: raw };
}

async function staffPages(): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "page.tsx") found.push(full);
    }
  }
  await walk(STAFF_APP);
  return found.sort();
}

const relative = (file: string) => path.relative(STAFF_APP, file).replaceAll(path.sep, "/");

describe("every staff page gates on the slug, not on the shell", () => {
  it("finds the pages at all", async () => {
    // Guards the guard: an empty walk would make the assertion below vacuous.
    expect((await staffPages()).length).toBeGreaterThan(40);
  });

  it("compares the URL's shop to the session's, on every one of them", async () => {
    const ungated: string[] = [];
    for (const file of await staffPages()) {
      const { where, source } = await renderingSource(file);
      if (GATES.some((gate) => gate.test(source))) continue;
      ungated.push(
        `${relative(where)}: nothing here compares the URL slug to the session's shop. ` +
          `Call requireShopSurface, or make the comparison inline — the staff shell streams ` +
          `beside this page and cannot make it for you (issue 1446).`,
      );
    }
    expect(ungated).toEqual([]);
  });

  /**
   * The other direction. Four pages make the comparison by hand rather than
   * through the helper, each for a stated reason in its own comment, and a
   * fifth appearing here silently would mean the helper is being worked around
   * rather than used. Adding to this list is a decision; it is not a fix.
   */
  it("keeps the by-hand comparisons to the four that have a reason", async () => {
    const byHand: string[] = [];
    for (const file of await staffPages()) {
      const { source } = await renderingSource(file);
      if (GATES[0].test(source)) continue;
      byHand.push(relative(file));
    }
    // Sorted by path, which is why the home comes last rather than first.
    expect(byHand).toEqual([
      // These three read the shop by slug — the walk-in and course lookups are
      // slug-scoped — and then compare ids. Each says why at the call site.
      "check-in/page.tsx",
      "check-in/walk-in/page.tsx",
      "courses/page.tsx",
      // The home resolves its own shop from the session (`getShopById`) inside
      // the page's own boundary, so the slug is the half it has to check.
      "page.tsx",
    ]);
  });
});
