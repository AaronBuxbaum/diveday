#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Every message-bundle key has a reader.
 *
 * `pnpm check:locale` proves that whatever *is* in a bundle is in every
 * bundle. `pnpm check:copy` proves that no sentence is hard-coded at a call
 * site. Neither proves a key is *read* by anything, so a bundle grows dead copy
 * silently and every deletion has to be re-derived by grep.
 *
 * Two instances found the hard way, both mid-recomposition and both by
 * accident: `requests.groupCount` was a staff key nothing rendered, noticed
 * only because the slice deleting its neighbours happened to read past it; and
 * `trip.crewPrediction` in the diver bundle was orphaned when `ForecastSection`
 * became `ConditionsLine`, and took a separate issue (#1110) to spot. A
 * recomposition deletes and rewrites dozens of surfaces at a time; every one of
 * them can strand keys.
 *
 * ## Walk the call sites, not the bundles
 *
 * A grep for `t("…")` alone would report every map-reached key as dead, and
 * this repo reaches keys through record maps on purpose — `READINESS_STATUS_KEYS`,
 * `CARD_STATUS_KEYS`, `BUDDY_ALERT_KEYS`, `CERTIFICATION_LEVEL_KEYS` and a dozen
 * more `Record<…, StaffMessageKey>` tables. A guard that told somebody to
 * delete a live sentence would be worse than no guard at all, because a false
 * positive here invites exactly that.
 *
 * So the rule is simpler and stricter than a call-site parse: **a key is
 * reached if the tree contains a string literal equal to it.** That covers a
 * `t("…")` call, a `Record<…, StaffMessageKey>` value, an `as const` array of
 * key names and a helper that takes a key and passes it on, all without
 * knowing which is which — because every one of them writes the *whole* key as
 * a literal. Nothing is prefix-matched, and nothing should be: prefix matching
 * is what would make this guard start guessing.
 *
 * ## The one place it declines to decide
 *
 * A key assembled at runtime — `` t(`switching.common.facts.${fact}.label`) ``
 * — has no literal anywhere. The static half of such a template is collected as
 * an *undecidable region*: every bundle key under it is treated as reached and
 * never reported. That is prefix matching, and it is the deliberate exception:
 * the prefix is not guessed, it is read out of a dynamic call that provably
 * reaches keys this walk cannot enumerate. Reporting nothing is the only sound
 * answer there.
 *
 * ## Ratcheted, not a day-one gate
 *
 * The first run finds keys nobody has looked at in months. A guard that goes
 * red on arrival gets a baseline entry per file and stops meaning anything, so
 * this follows `scripts/check-copy.mjs`: `--write` banks the current set, a
 * count that rises fails, a count that falls must be banked in the same change.
 * The baseline is a list to triage, never a list to delete on sight — some
 * entries will be a hole in this walk rather than dead copy, and each of those
 * is a fix here or an exemption with a written reason.
 */

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/bundle-reach-baseline.json";
const LOCALES_DIR = "src/i18n/locales";
const DEFAULT_LOCALE = "en-US";

/**
 * Where a key can be read from. The whole of `src` rather than the two UI
 * roots `check:copy` guards: `src/i18n`'s own label modules hold most of the
 * record maps, and `src/features` renders its own surfaces.
 */
const READER_ROOTS = ["src"];

/** A dotted key as it appears written out in full. */
const KEY_LITERAL = /["'`]([A-Za-z][\w-]*(?:\.[\w-]+)+)["'`]/g;

/**
 * A key assembled at runtime. The captured group is the static head —
 * everything before the first `${` — which is the most this walk can know
 * about which keys it reaches.
 *
 * **Any** template literal, not only one inside a `t(…)` call: a key is as
 * often built and passed along as it is interpolated at the call site, and
 * `PackingSection.tsx`'s `` return `trip.timeline.${step}` as DiverMessageKey ``
 * is the shape that proved it — nine live keys reported dead. The head must
 * still contain a dot, which is what keeps a path or a URL out; a head that
 * happens to look like a key prefix over-reaches, in the direction this guard
 * errs in everywhere else.
 */
const DYNAMIC_KEY = /`([^`$]*)\$\{/g;

/**
 * `useTranslations("booking")` — next-intl scopes the translator to a
 * namespace, so every call in that file writes a key **relative** to it:
 * `t("bookAndPay")`, never `t("booking.bookAndPay")`.
 *
 * Without this the walk reported all 39 of `booking.*` as dead within an hour
 * of the guard landing — a report that reads as authority and would have had
 * somebody delete the live booking page's copy. It is the false positive
 * `check-bundle-reach.test.mjs` opens by saying is the one that hurts, and it
 * was in the tree the whole time.
 */
const SCOPE = /\buseTranslations\(\s*["'`]([A-Za-z][\w-]*(?:\.[\w-]+)*)["'`]\s*\)/g;

/**
 * The literal argument of a translator call, of any depth. Only consulted in a
 * file that scopes: unscoped, a bare `t("owner")` is not a key and
 * {@link KEY_LITERAL}'s dotted requirement is what keeps it out.
 */
const CALL_LITERAL = /\bt(?:\.(?:raw|rich))?\(\s*["'`]([A-Za-z][\w-]*(?:\.[\w-]+)*)["'`]/g;

/** Every leaf as `dotted.path`. */
function flatten(node, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") out.push(...flatten(value, dotted));
    else out.push(dotted);
  }
  return out;
}

/**
 * Every key in the default locale, as `bundleFile → [key…]`.
 *
 * The staff bundle is a directory composed by its `index.ts`, namespace keyed
 * by filename (ADR 20260807-per-area-staff-bundles); reading it here merges the
 * files exactly the way that index does, so a key's dotted path is the one a
 * call site writes.
 */
export async function loadBundles(root = ROOT) {
  const localeDir = path.join(root, LOCALES_DIR, DEFAULT_LOCALE);
  const bundles = new Map();

  const diver = JSON.parse(await readFile(path.join(localeDir, "diver.json"), "utf8"));
  bundles.set(`${LOCALES_DIR}/${DEFAULT_LOCALE}/diver.json`, flatten(diver));

  const staffDir = path.join(localeDir, "staff");
  for (const name of (await readdir(staffDir)).filter((n) => n.endsWith(".json")).sort()) {
    const namespace = name.replace(/\.json$/, "");
    const contents = JSON.parse(await readFile(path.join(staffDir, name), "utf8"));
    bundles.set(
      `${LOCALES_DIR}/${DEFAULT_LOCALE}/staff/${name}`,
      flatten({ [namespace]: contents }),
    );
  }
  return bundles;
}

/**
 * Every key literal and every dynamic prefix in one file's source.
 *
 * Comments are not stripped: a key named in a comment is a weak signal that
 * something reads it, and this guard is tuned to under-report. A key that
 * survives *only* in a comment is a shape worth catching later, not a reason
 * to risk telling someone to delete live copy today.
 */
export function findReaches(source) {
  const literals = new Set();
  for (const match of source.matchAll(KEY_LITERAL)) literals.add(match[1]);
  const dynamicPrefixes = new Set();
  for (const match of source.matchAll(DYNAMIC_KEY)) {
    const head = match[1];
    if (head.includes(".")) dynamicPrefixes.add(head);
  }

  // A file that scopes its translator reaches every key under that namespace
  // by a relative name, so read its calls again through each scope it names.
  const scopes = [...source.matchAll(SCOPE)].map((match) => match[1]);
  for (const scope of scopes) {
    for (const match of source.matchAll(CALL_LITERAL)) literals.add(`${scope}.${match[1]}`);
    for (const match of source.matchAll(DYNAMIC_KEY)) {
      // An empty head — `t(`${x}`)` under a scope — is the honest "this file
      // assembles keys under `scope` and none of them can be enumerated". The
      // walk declines the whole namespace rather than guessing, which is the
      // direction this guard errs in everywhere else.
      dynamicPrefixes.add(`${scope}.${match[1]}`);
    }
  }
  return { literals, dynamicPrefixes };
}

async function walk(root, relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(root, relativePath)));
    // The bundles themselves are not readers — a key's own JSON file names it
    // by definition, and counting that would make every key reachable.
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !relativePath.startsWith(`${LOCALES_DIR}/`)) {
      files.push(relativePath);
    }
  }
  return files;
}

/** Keys with no reader, as `bundleFile → [key…]`. */
export async function findUnreachedKeys(root = ROOT) {
  const bundles = await loadBundles(root);

  const literals = new Set();
  const dynamicPrefixes = new Set();
  for (const readerRoot of READER_ROOTS) {
    for (const file of await walk(root, readerRoot)) {
      const source = await readFile(path.join(root, file), "utf8");
      const found = findReaches(source);
      for (const literal of found.literals) literals.add(literal);
      for (const prefix of found.dynamicPrefixes) dynamicPrefixes.add(prefix);
    }
  }

  const reachedDynamically = (key) => {
    for (const prefix of dynamicPrefixes) if (key.startsWith(prefix)) return true;
    return false;
  };

  const unreached = new Map();
  for (const [file, keys] of bundles) {
    const dead = keys.filter((key) => !literals.has(key) && !reachedDynamically(key));
    if (dead.length > 0) unreached.set(file, dead);
  }
  return unreached;
}

async function main() {
  const unreached = await findUnreachedKeys();
  const counts = new Map([...unreached].map(([file, keys]) => [file, keys.length]));

  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex !== -1) {
    const destination = process.argv[reportIndex + 1];
    const lines = [];
    let total = 0;
    for (const [file, keys] of [...unreached].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`\n${file} (${keys.length})`);
      for (const key of keys.sort()) lines.push(`  ${key}`);
      total += keys.length;
    }
    lines.push(`\n${total} keys with no reader across ${unreached.size} bundles`);
    const text = `${lines.join("\n")}\n`;
    if (destination && !destination.startsWith("--")) await writeFile(destination, text);
    else console.log(text);
    process.exit(0);
  }

  let baseline = {};
  let baselineExists = true;
  try {
    baseline = JSON.parse(await readFile(path.join(ROOT, BASELINE_PATH), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    baselineExists = false;
  }
  const baselineCounts = Object.fromEntries(
    Object.entries(baseline).filter(([key]) => !key.startsWith("//")),
  );

  const absorbing = process.argv.includes("--absorb");
  if (process.argv.includes("--write") || absorbing) {
    const grew = [...counts.entries()].filter(
      ([file, count]) => baselineExists && count > (baselineCounts[file] ?? 0),
    );
    const added = [...counts.keys()].filter((file) => baselineExists && !(file in baselineCounts));
    if (grew.length > 0 || added.length > 0) {
      if (!absorbing) {
        console.error(
          "Refusing to write a baseline that grows. The ratchet only turns one way — delete the key, or give it a reader:",
        );
        for (const [file, count] of grew) {
          console.error(`- ${file}: ${baselineCounts[file]} → ${count}`);
        }
        for (const file of added) console.error(`- ${file}: new bundle with ${counts.get(file)}`);
        console.error(
          "If this growth arrived in a merge from a branch that predates the check, `--absorb` records it explicitly.",
        );
        process.exit(1);
      }
      console.warn("Absorbing unreached keys — this must be merged-in work, not new dead copy:");
      for (const [file, count] of grew) {
        console.warn(`- ${file}: ${baselineCounts[file]} → ${count}`);
      }
      for (const file of added) console.warn(`- ${file}: new bundle with ${counts.get(file)}`);
    }
    const next = {
      "//": "Message-bundle keys no string literal in src/ can reach, per bundle. Written by `node scripts/check-bundle-reach.mjs --write`. This number may only go down — see scripts/check-bundle-reach.mjs. An entry is a list to triage, not a list to delete on sight: some are a hole in the walk.",
      ...Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    console.log(`bundle-reach: baseline written — ${counts.size} bundles, ${total} keys`);
    process.exit(0);
  }

  const violations = [];
  for (const [file, count] of counts) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      const sample = unreached
        .get(file)
        .slice(0, 5)
        .map((key) => `\n    ${key}`)
        .join("");
      violations.push(
        `${file}: ${count} key${count === 1 ? "" : "s"} nothing reads, in a bundle with no baseline entry.${sample}`,
      );
      continue;
    }
    if (count > allowed) {
      violations.push(
        `${file}: ${count} keys nothing reads, baseline allows ${allowed}. Delete the key, or give it a reader.`,
      );
    }
    if (count < allowed) {
      violations.push(
        `${file}: down to ${count} from ${allowed} — lower the baseline in this change (\`node scripts/check-bundle-reach.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!counts.has(file)) {
      violations.push(
        `${file}: every key now has a reader — remove its baseline entry (\`node scripts/check-bundle-reach.mjs --write\`).`,
      );
    }
  }

  if (violations.length > 0) {
    console.error(`Unreached message-bundle keys:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    console.error(
      "A key with no reader is dead copy that every locale still has to translate. Delete it from every locale's bundle, or find the reader this walk missed and say so here.",
    );
    process.exit(1);
  }

  const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `bundle-reach: no new unreached keys — ${remaining} key${remaining === 1 ? "" : "s"} across ${counts.size} bundles still to triage`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
