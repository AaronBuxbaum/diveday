#!/usr/bin/env node
/**
 * Renders `.env.example` from `config/env-registry.mjs`.
 *
 * `.env.example` is a generated artifact, but a committed one: the CDK stack
 * reads it at synth time (`readEnvExample()` in `infra/lib/infra-stack.ts`) and
 * fills it in to build the `diveday/env` secret, and a self-hoster reads it to
 * see what exists. Generating it is what keeps the key list, the provenance,
 * and the prose in one place instead of four.
 *
 * `pnpm check:repo` fails when the committed file differs from this render, so
 * the drift that let `PLACES_AWS_ACCESS_KEY_ID` be stack-minted and locally
 * overridable at the same time cannot come back.
 *
 * Run `node scripts/render-env-example.mjs --write` after editing the registry.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { constantValue, ENV_GROUPS } from "../config/env-registry.mjs";
import { formatEnvValue } from "./dotenv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_EXAMPLE_PATH = join(root, ".env.example");

const HEADER = [
  "# Generated from config/env-registry.mjs -- do not edit by hand.",
  "# Run `node scripts/render-env-example.mjs --write` after changing the registry.",
  "#",
  "# This file is the *shape* of DiveDay's configuration, not a file you fill in.",
  "# Nothing here is read at runtime. Two files are:",
  "#",
  "#   .env.manual  the only file a human edits. It holds exactly the values no",
  "#                system can mint -- a Stripe key, a Neon URL, a Meta app secret.",
  "#                `pnpm check:env` prints what is still blank and what each one",
  "#                switches off. Create it with `node scripts/env-manual.mjs`.",
  "#",
  "#   .env.local   generated. `pnpm infra:deploy` writes it from the deployed",
  "#                stack's credentials secret plus .env.manual, and overwrites it",
  "#                every time. An edit here is lost on the next deploy, so make",
  "#                it in .env.manual instead.",
  "#",
  "# Local dev and tests need neither: no DATABASE_URL means src/db/client.ts falls",
  "# back to an embedded PGlite database, auto-migrated and auto-seeded.",
  "#",
  "# A value the stack mints has no local override on purpose (ADR",
  "# 20260812-env-provenance-registry). An IAM access key is not a preference, and",
  "# a private copy is a stale copy waiting to happen.",
  "",
];

/** The `.env.example` document this registry describes. */
export function renderEnvExample() {
  const blocks = ENV_GROUPS.map((group) => [
    ...group.doc.map((line) => (line ? `# ${line}` : "#")),
    ...group.keys.map((entry) => `${entry.key}=${formatEnvValue(constantValue(entry.key))}`),
  ]);
  return [...HEADER, ...blocks.flatMap((block) => [...block, ""])].join("\n").replace(/\n+$/, "\n");
}

/** What is on disk, or null when it has never been written. */
export function readEnvExample() {
  try {
    return readFileSync(ENV_EXAMPLE_PATH, "utf8");
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rendered = renderEnvExample();
  if (process.argv.includes("--write")) {
    writeFileSync(ENV_EXAMPLE_PATH, rendered);
    console.log("env: wrote .env.example from config/env-registry.mjs");
  } else {
    process.stdout.write(rendered);
  }
}
