import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **A refused capability never lands on DiveDay's sales homepage** (issue #914).
 *
 * `src/app/not-found.tsx` ends in one button to `/`, which is a *software
 * marketing* page. A diver holding a dead waiver link was trying to reach a
 * dive shop, so that page is the wrong answer for them — and a namespace
 * `not-found.tsx` cannot help, because a capability URL names no shop and
 * resolving an already-refused token to find one is the widening
 * `docs/engineering/capability-telemetry-runbook.md` rules out.
 *
 * So every `[token]` route that renders a page answers its own dead token in
 * the page: it never calls `notFound()`, and it has an `error.tsx` of its own.
 * The routes are read off the filesystem, because a capability route is
 * created by adding a directory and nothing about that act reminds anyone to
 * come here. `calendar/[token]` is a Route Handler with no page, so it is not
 * one. Moved from `src/app/capability-refusals.test.ts` (test review
 * 2026-10-14, L2c).
 */

export const APP = "src/app";

/** The capability page routes this guard expects; a new one is added here on purpose. */
export const KNOWN_ROUTES = [
  "claim/[token]",
  "confirm-contact/[token]",
  "invite/[token]",
  "ready/[token]",
  "recap/[token]",
  "reset-password/[token]",
  "unsubscribe/[token]",
  "verify/[token]",
  "waivers/[token]",
];

/** Every `[token]` directory under `dir` holding a `page.tsx`, relative to `dir`. */
async function capabilityPageRoutes(dir, trail = []) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const here = path.join(dir, entry.name);
    if (entry.name === "[token]") {
      if ((await readdir(here)).includes("page.tsx")) found.push([...trail, entry.name].join("/"));
      continue;
    }
    found.push(...(await capabilityPageRoutes(here, [...trail, entry.name])));
  }
  return found;
}

async function sourceFilesUnder(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const here = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceFilesUnder(here, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(here);
  }
  return found;
}

/**
 * The problems with one route: `files` maps each source file under it to its
 * text, `entries` is its own directory listing.
 */
export function routeProblems(route, files, entries) {
  const problems = [];
  for (const [file, source] of Object.entries(files)) {
    if (source.includes("notFound")) {
      problems.push(
        `${file}: calls notFound(), which sends a diver holding a dead link to the marketing homepage; answer the dead token in the page (issue 914)`,
      );
    }
  }
  if (!entries.includes("error.tsx")) {
    problems.push(`${APP}/${route}: has no error.tsx, so a thrown error leaves the route`);
  }
  return problems;
}

/** Every problem under `root`. */
export async function capabilityRefusalProblems(root = process.cwd()) {
  const app = path.join(root, APP);
  const routes = (await capabilityPageRoutes(app)).sort();
  const problems = [];
  const unknown = routes.filter((route) => !KNOWN_ROUTES.includes(route));
  const gone = KNOWN_ROUTES.filter((route) => !routes.includes(route));
  for (const route of unknown) {
    problems.push(
      `${APP}/${route}: a capability page this guard did not know; check it refuses in place, then add it to KNOWN_ROUTES in scripts/check-capability-refusals.mjs`,
    );
  }
  for (const route of gone) problems.push(`${APP}/${route}: listed in KNOWN_ROUTES but gone`);
  for (const route of routes) {
    const dir = path.join(app, route);
    const files = {};
    for (const file of await sourceFilesUnder(dir)) {
      files[path.relative(root, file).replaceAll(path.sep, "/")] = await readFile(file, "utf8");
    }
    problems.push(...routeProblems(route, files, await readdir(dir)));
  }
  return { problems, routes: routes.length };
}

async function main() {
  const { problems, routes } = await capabilityRefusalProblems();
  if (problems.length > 0) {
    console.error(
      `Capability routes that do not refuse in place:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`capability-refusals: ${routes} capability pages refuse in place`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
