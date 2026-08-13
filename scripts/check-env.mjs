#!/usr/bin/env node
/**
 * Checks the two structural facts about DiveDay's configuration, and then
 * reports the checklist.
 *
 * Fatal, because they are the invariants the whole design rests on:
 *
 *  1. `.env.example` matches `config/env-registry.mjs`. It is generated, and the
 *     CDK stack reads it at synth to build the credentials secret, so a drifted
 *     copy silently changes what a deploy hands out.
 *  2. `.env.manual` speaks only for values a human is the source of. A
 *     stack-produced key there is a second opinion about a minted credential —
 *     the exact shape that left production signing with an access key AWS had
 *     never issued (ADR 20260812-env-provenance-registry).
 *
 * Then it prints what is unset and what each one switches off. That is a report,
 * never a failure: every one of these is legitimately absent — a local run has
 * no Stripe account, no Neon database, and nowhere to ship logs. The old version
 * failed on "missing from `.env.local`" and carried a hand-written skip case per
 * key to stop it failing on the ones that are optional by design. Those reasons
 * are rows in the registry now, so this file no longer knows any of them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_ENTRIES, envEntry, isManual, isStackProduced } from "../config/env-registry.mjs";
import { parseDotenv } from "./dotenv.mjs";
import { readEnvExample, renderEnvExample } from "./render-env-example.mjs";

// Resolved against the working directory, not this file: the deploy runs from
// the repo root, and a test runs from a temporary one.
const MANUAL_PATH = join(process.cwd(), ".env.manual");

const parse = parseDotenv;

const failures = [];

if (readEnvExample() !== renderEnvExample()) {
  failures.push(
    ".env.example does not match config/env-registry.mjs. It is generated — run `node scripts/render-env-example.mjs --write`. (The CDK stack reads this file at synth to build the credentials secret, so a drifted copy changes what a deploy hands out.)",
  );
}

const manual = existsSync(MANUAL_PATH) ? parse(readFileSync(MANUAL_PATH, "utf8")) : null;

if (manual) {
  const trespassing = Object.keys(manual).filter((key) => manual[key] && isStackProduced(key));
  if (trespassing.length > 0) {
    failures.push(
      `.env.manual sets ${trespassing.join(", ")}, which the deployed stack produces. There is no local override for a minted credential — delete those lines. If the deployed value is wrong, fix it in the stack and redeploy.`,
    );
  }
  const unknown = Object.keys(manual).filter((key) => !envEntry(key));
  if (unknown.length > 0) {
    failures.push(
      `.env.manual sets ${unknown.join(", ")}, which nothing in DiveDay reads. Add it to config/env-registry.mjs or remove it.`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`env: ${failure}`);
  process.exit(1);
}

if (!manual) {
  console.log(
    "env: no .env.manual; local development uses documented fallbacks (embedded PGlite, features reporting not_configured). Run `node scripts/env-manual.mjs` to create one.",
  );
  process.exit(0);
}

const blank = ENV_ENTRIES.filter((entry) => isManual(entry.key) && !manual[entry.key]);
if (blank.length === 0) {
  console.log("env: .env.manual is complete");
  process.exit(0);
}

console.log(`env: .env.manual is valid; ${blank.length} value(s) unset —`);
for (const entry of blank) {
  console.log(`  ${entry.key}: ${entry.absent ?? "no documented effect"}`);
}
