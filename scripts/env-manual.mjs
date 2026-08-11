#!/usr/bin/env node
/**
 * Creates or refreshes `.env.manual` — the one file a human edits.
 *
 * It holds exactly the values no system can mint: a Neon URL, the Stripe
 * platform keys, Meta's app credentials, the read-only usage tokens, and a
 * couple of choices like the ops alert address. Everything else in DiveDay's
 * configuration is produced by the CDK stack, derived from its seed, or a
 * checked-in constant, and arrives in the generated `.env.local` without anyone
 * being asked for it.
 *
 * Run it any time. It never overwrites a value you have set:
 *
 *  - no `.env.manual` yet, but a `.env.local` from before this split → the
 *    manual values are lifted out of it, so nobody re-pastes a Stripe key;
 *  - `.env.manual` exists → keys added to the registry since are appended
 *    blank, and everything already there is left exactly as it is;
 *  - a key that has stopped being manual (the stack learned to mint it) is
 *    reported rather than deleted, since the value may be the only copy.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { constantValue, ENV_GROUPS, isManual, isOverridable } from "../config/env-registry.mjs";

// Resolved against the working directory, not this file: the deploy runs from
// the repo root, and a test runs from a temporary one.
const MANUAL_PATH = join(process.cwd(), ".env.manual");
const LOCAL_PATH = join(process.cwd(), ".env.local");

const ENV_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/;

/** Every `KEY=value` line in a dotenv document, as an object. */
export function parseEnvDocument(text) {
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(ENV_LINE);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
}

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const HEADER = [
  "# The only DiveDay configuration file a human edits.",
  "#",
  "# Everything here is a value no system can mint — it comes from a third-party",
  "# console or 1Password. Everything DiveDay's own stack produces lands in the",
  "# generated .env.local instead, and has no override here on purpose: a private",
  "# copy of a minted credential is a stale copy waiting to happen.",
  "#",
  "# Blank is a supported state for every line below. `pnpm check:env` lists what",
  "# is unset and what each one switches off. Regenerate the scaffolding with",
  "# `node scripts/env-manual.mjs`; your values are never overwritten.",
  "",
];

/**
 * The document to write, given whatever values are already known.
 *
 * Every `manual` key gets a line whether or not it is filled in — the blanks
 * *are* the checklist. A `constant` gets one only where someone has already
 * overridden it, so an `APP_HOST` pointed at localhost for Stripe Connect
 * testing survives a regeneration without the file growing rows nobody was
 * meant to fill in.
 */
export function renderManualDocument(values) {
  const shown = (entry) => isManual(entry.key) || Boolean(values[entry.key]);
  const blocks = ENV_GROUPS.filter((group) => group.keys.some(shown)).map((group) => [
    ...group.doc.map((line) => (line ? `# ${line}` : "#")),
    ...group.keys.filter(shown).map((entry) => `${entry.key}=${values[entry.key] ?? ""}`),
  ]);
  return [...HEADER, ...blocks.flatMap((block) => [...block, ""])].join("\n").replace(/\n+$/, "\n");
}

function run() {
  const existingManual = parseEnvDocument(read(MANUAL_PATH));
  const hadManual = existsSync(MANUAL_PATH);
  // Values only ever move *into* the manual file, never out of it: a key that
  // has stopped being manual keeps whatever is on disk until a human decides.
  const adopted = hadManual ? {} : parseEnvDocument(read(LOCAL_PATH));

  const values = {};
  for (const [key, value] of Object.entries({ ...adopted, ...existingManual })) {
    if (!value || !isOverridable(key)) continue;
    // A constant is carried only when it differs from the checked-in default:
    // a `.env.local` that merely echoes `https://dive.day` is not an override,
    // and copying it in would turn a default into a second thing to maintain.
    if (!isManual(key) && value === constantValue(key)) continue;
    values[key] = value;
  }

  writeFileSync(MANUAL_PATH, renderManualDocument(values));

  const lifted = Object.keys(values).filter((key) => !(key in existingManual));
  const orphaned = Object.keys(existingManual).filter(
    (key) => existingManual[key] && !isOverridable(key),
  );

  if (!hadManual) {
    console.log(
      lifted.length > 0
        ? `env: created .env.manual, carrying ${lifted.length} value(s) over from .env.local (${lifted.join(", ")})`
        : "env: created .env.manual — fill in what you need; every line may stay blank",
    );
  } else {
    console.log("env: refreshed .env.manual; existing values untouched");
  }

  if (orphaned.length > 0) {
    // Not deleted: for a key the stack now mints, the line here may be the only
    // copy anybody has, and losing it silently is how this whole class of bug
    // starts.
    console.warn(
      `env: ${orphaned.join(", ")} is no longer a manual value and was dropped from the scaffolding. The stack supplies it now — delete your copy once you have confirmed the deployed one works.`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
