import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { ENV_KEYS } from "../config/env-registry.mjs";

/**
 * Every environment variable `src/` reads is in `config/env-registry.mjs`, or
 * is named here with the reason it is not.
 *
 * The registry is the one place a human learns who supplies a value and what
 * its absence switches off (ADR 20260812-env-provenance-registry), and
 * `pnpm check:env` compares `.env.example` and a deployment against it. Neither
 * looks at the code: the 2026-10-13 review found six keys read in `src/` and
 * missing from it, three of them signing secrets that fall back to
 * `AUTH_SECRET`, so a rotation of `AUTH_SECRET` silently invalidated every
 * recap link, buddy link and waiver seal and nobody could learn that from the
 * registry. Writing this guard found three more (the VAPID keypair).
 *
 * A read is `process.env.KEY`, `process.env["KEY"]`, or `env.KEY` on a
 * parameter defaulted to `process.env`; keys are upper-case.
 */

const ROOT = process.cwd();
const IS_TEST = /\.test\.tsx?$/;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const READ = /\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]*)\b|\[["']([A-Z][A-Z0-9_]*)["']\])/g;

/** Keys read in `src/` that the registry does not hold, each with why. */
const NOT_REGISTERED = {
  // The platform sets these; nobody supplies them.
  NODE_ENV: "set by Node and Next",
  PORT: "set by Next to the bound server port; isolates loopback e2e auth transport",
  NEXT_RUNTIME: "set by Next",
  VERCEL_ENV: "set by Vercel",
  VERCEL_GIT_COMMIT_SHA: "set by Vercel",
  GITHUB_ACTIONS: "set by GitHub Actions; the failed-file annotations switch on under it",
  TZ: "the test setup pins the process zone",
  NEXT_PUBLIC_DIVEDAY_BUILD_ID:
    "set by next.config.ts from the build id; names the build in every document",
  // Overrides of a value compiled into the code (src/lib/configured.ts). The
  // registry holds only values that come from somewhere else; see its header.
  APP_HOST: "compiled-in origin; the variable is a fork's override",
  SES_FROM_EMAIL: "compiled-in sender; the variable is a fork's override",
  STRIPE_CONNECT_CLIENT_ID: "compiled-in CONNECT_CLIENT_ID; the variable is a fork's override",
  NEXT_PUBLIC_SENTRY_DSN: "compiled-in DSN; set empty by `pnpm e2e:build` to switch reporting off",
  // The test and dev harness.
  DIVEDAY_CLOCK: "the e2e harness's frozen clock; src/lib/clock.ts refuses it in production",
  DIVEDAY_DISABLE_EXTERNAL_HTTP: "the e2e harness switches outbound calls off",
  DIVEDAY_RATE_LIMIT_DISABLED: "the e2e harness switches the limiter off",
  DIVEDAY_TEST_CACHE_DIR: "the unit-test database template cache",
  DIVEDAY_TEST_POSTGRES_URL: "the real-Postgres unit tests",
  DIVEDAY_PRINT_QUERY_COUNTS: "the render-cost tests print their query counts for a PR body",
  PGLITE_DATA_DIR: "where a local run keeps its embedded database",
};

/** Sentry cron monitor names: each has a default Sentry upserts on first check-in. */
const NOT_REGISTERED_PATTERN = /^SENTRY_(?:\w+_)?CRON_MONITOR_SLUG$/;

async function walk(relativeDirectory) {
  const entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

/** The upper-case environment keys `source` reads, with the first line of each. */
export function envReadsIn(source) {
  const reads = new Map();
  source.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(READ)) {
      const key = match[1] ?? match[2];
      if (!reads.has(key)) reads.set(key, index + 1);
    }
  });
  return reads;
}

/** Whether a key may be read without a registry row. */
export function isAccounted(key, registered = ENV_KEYS) {
  return registered.includes(key) || key in NOT_REGISTERED || NOT_REGISTERED_PATTERN.test(key);
}

async function main() {
  const violations = [];
  const seen = new Set();
  for (const file of await walk("src")) {
    if (IS_TEST.test(file)) continue;
    for (const [key, line] of envReadsIn(await readFile(path.join(ROOT, file), "utf8"))) {
      seen.add(key);
      if (!isAccounted(key)) violations.push(`${file}:${line}: ${key}`);
    }
  }
  const stale = Object.keys(NOT_REGISTERED).filter((key) => !seen.has(key));
  if (violations.length > 0 || stale.length > 0) {
    if (violations.length > 0) {
      console.error(
        `Environment variables read in src/ that config/env-registry.mjs does not hold:\n${violations
          .map((violation) => `- ${violation}`)
          .join("\n")}`,
      );
      console.error(
        "Add a row to config/env-registry.mjs (who supplies it, where it goes, what its absence switches off), then `node scripts/render-env-example.mjs --write`. A platform or harness variable goes in NOT_REGISTERED in scripts/check-env-reads.mjs with its reason.",
      );
    }
    if (stale.length > 0) {
      console.error(
        `NOT_REGISTERED in scripts/check-env-reads.mjs names keys nothing in src/ reads: ${stale.join(", ")}. Remove them.`,
      );
    }
    process.exit(1);
  }
  console.log(`env-reads: ${seen.size} environment keys read in src/, each registered or excused`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
