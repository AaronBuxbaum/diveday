import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Every `[token]` route under `src/app` that renders a page, as a path
 * relative to `src/app`.
 *
 * Read off the filesystem rather than typed out, for the reason
 * `observability.test.ts` gives about the redaction list: a capability route
 * is created by adding a directory, and nothing about that act reminds anyone
 * to come here. `calendar/[token]` is deliberately absent — it is a Route
 * Handler (`route.ts`) that answers with an iCalendar document, so it has no
 * page to refuse on and no boundary to miss.
 */
function capabilityPageRoutes(dir = APP_DIR, trail: string[] = []): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const here = join(dir, entry.name);
    if (entry.name === "[token]") {
      if (readdirSync(here).includes("page.tsx")) found.push([...trail, entry.name].join("/"));
      continue;
    }
    found.push(...capabilityPageRoutes(here, [...trail, entry.name]));
  }
  return found;
}

/** Every `.ts`/`.tsx` file under a route, tests excluded, as absolute paths. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const here = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(here));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    found.push(here);
  }
  return found;
}

/**
 * **A refused capability never lands on DiveDay's sales homepage.**
 *
 * `src/app/not-found.tsx` ends in one button to `/`, which is a *software
 * marketing* page. A diver holding a dead waiver link was trying to reach a
 * dive shop, so that page is the wrong answer for them in the same way it was
 * wrong under `/s/**` before issue #765 — and the fix there, a namespace
 * `not-found.tsx`, cannot transfer, because a capability URL names no shop
 * and resolving an already-refused token to find one is the widening
 * `docs/engineering/capability-telemetry-runbook.md` rules out.
 *
 * What makes the question moot is the shape these routes were already built
 * in: each one answers its own dead token in the page, with its own words and
 * — on `/waivers` and `/ready` — a button that mails a fresh link. That is a
 * convention, not a mechanism, and the next capability route added will
 * inherit it only if somebody remembers. This test is the mechanism (issue
 * #914).
 */
describe("capability routes refuse in place", () => {
  const routes = capabilityPageRoutes();

  it("finds the capability routes on disk", () => {
    expect(routes.sort()).toEqual([
      "claim/[token]",
      "confirm-contact/[token]",
      "invite/[token]",
      "ready/[token]",
      "recap/[token]",
      "reset-password/[token]",
      "unsubscribe/[token]",
      "verify/[token]",
      "waivers/[token]",
    ]);
  });

  it.each(routes)("%s never calls notFound()", (route) => {
    const offenders = sourceFilesUnder(join(APP_DIR, route)).filter((file) =>
      readFileSync(file, "utf8").includes("notFound"),
    );
    expect(offenders).toEqual([]);
  });

  it.each(routes)("%s catches its own thrown errors", (route) => {
    expect(readdirSync(join(APP_DIR, route))).toContain("error.tsx");
  });
});
