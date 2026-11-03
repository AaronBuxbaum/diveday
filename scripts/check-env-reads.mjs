import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { ENV_KEYS } from "../config/env-registry.mjs";

/**
 * Every environment variable `src/` reads is in `config/env-registry.mjs`.
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
 *
 * There is no exemption list. A key the platform sets (`NODE_ENV`, `VERCEL_ENV`)
 * is a `platform` row, an override of a value compiled into the code
 * (`APP_HOST`, the Sentry cron monitor slugs) an `override` row, and a test or
 * dev switch a `harness` row (issue #2778): the registry answers for every key
 * the code reads, and each group names its seam.
 */

const ROOT = process.cwd();
const IS_TEST = /\.test\.tsx?$/;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const READ = /\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]*)\b|\[["']([A-Z][A-Z0-9_]*)["']\])/g;

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

/** Whether the registry holds a key. */
export function isAccounted(key, registered = ENV_KEYS) {
  return registered.includes(key);
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
  if (violations.length > 0) {
    console.error(
      `Environment variables read in src/ that config/env-registry.mjs does not hold:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Add a row to config/env-registry.mjs (who supplies it, where it goes, what its absence switches off), then `node scripts/render-env-example.mjs --write`. A variable the platform sets is a `platform` row; an override of a compiled-in value an `override` row; a test or dev switch a `harness` row.",
    );
    process.exit(1);
  }
  console.log(`env-reads: ${seen.size} environment keys read in src/, each in the registry`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
