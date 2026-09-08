import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **No staff redirect builds its `Location` out of a raw slug** (issue 1569).
 *
 * `shopSlug` reaches a route handler as a path segment Next has already
 * decoded, so a `?` or a `#` in it turns the rest of a hand-built `Location`
 * into that segment's own query or fragment, and `../` normalises the `/shop/`
 * prefix away entirely. `shopPath` (`src/lib/staff-notices.ts`) exists for
 * exactly this and escapes every segment; `staff-notices.test.ts` pins what it
 * refuses.
 *
 * Five handlers hand-built the string. One of them — `waivers/signatures` —
 * called `encodeURIComponent` on the slug and the other four did not, which is
 * the shape of a rule that lives in one file's memory rather than in a check.
 * None was an open redirect (the literal `/shop/` prefix keeps the origin), so
 * this is the cheap guard for a cheap defect rather than an incident.
 *
 * A text scan, like `instant-coverage.test.ts` and `tenant-gate-coverage.test.ts`:
 * it under-reports rather than over-reports, and what it buys is that the sixth
 * handler cannot quietly go the other way.
 */

const STAFF_APP = path.join(process.cwd(), "src/app/shop");

/** `Location: ` followed by a template literal that interpolates a bare slug. */
const RAW_SLUG_LOCATION = /Location:\s*[^,\n]*`[^`]*\$\{\s*shopSlug\s*\}/;

function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function routeHandlers(): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "route.ts") found.push(full);
    }
  }
  await walk(STAFF_APP);
  return found.sort();
}

describe("staff redirects escape the slug they were handed", () => {
  it("finds the handlers at all", async () => {
    // Guards the guard: an empty walk would make the assertion below vacuous.
    expect((await routeHandlers()).length).toBeGreaterThan(4);
  });

  it("builds every Location through shopPath, never from a raw slug", async () => {
    const raw: string[] = [];
    for (const file of await routeHandlers()) {
      const source = stripComments(await readFile(file, "utf8"));
      if (!RAW_SLUG_LOCATION.test(source)) continue;
      raw.push(
        `${path.relative(STAFF_APP, file).replaceAll(path.sep, "/")}: builds a Location from a ` +
          `raw \`\${shopSlug}\`. Use shopPath(shopSlug, …) from @/lib/staff-notices, which escapes ` +
          `each segment — a slug carrying ? or # rewrites the rest of the URL (issue 1569).`,
      );
    }
    expect(raw).toEqual([]);
  });
});
