import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { CLAUDE_MODELS } from "../src/lib/claude/models.ts";
import { placeholderParity } from "./locale-placeholders.mjs";

/**
 * **Draft the missing translations** (issue #4250, ADR
 * 20261116-claude-drafts-missing-locale-strings). `pnpm check:locale` fails on
 * a key one locale lacks; this sends exactly those keys to Claude, one request
 * per locale, and prints the drafts. `--write` puts them in the locale's bundle
 * files, in the English file's key order, where `git diff` is the review.
 *
 *   node scripts/draft-locale.mjs            # dry run: print the drafts
 *   node scripts/draft-locale.mjs --write    # write them to the working tree
 *
 * Waiver and medical keys are never sent: that wording is legally reviewed
 * and stays a human's (H-20260730-jurisdiction-waiver-text-medical). A draft
 * that loses or invents a placeholder is dropped and named, never written.
 * Needs ANTHROPIC_API_KEY. Nothing is committed; a human reads every line.
 */

const LOCALES_DIR = "src/i18n/locales";
const DEFAULT_LOCALE = "en-US";

/** The bundle files, by the layout `scripts/check-locale.mjs` reads. */
const BUNDLE_FILES = ["diver.json"];
const BUNDLE_DIRS = ["content", "staff"];

/** A segment of the key path that marks legal or medical wording. */
const EXCLUDED_SEGMENT = /waiver|medical/i;

/** One request may run this long, its one retry included twice over. */
const REQUEST_TIMEOUT_MS = 10 * 60_000;

/** Every leaf as `dotted.path` → message. */
export function flatten(node, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value, dotted));
    else out[dotted] = value;
  }
  return out;
}

/**
 * Whether a key is legal or medical wording a machine must not draft. The
 * bundle file's namespace counts as a segment, so all of `waiversStaff.json`
 * stays with a human too: over-skipping costs a translator a minute, and
 * under-skipping would put an unreviewed waiver sentence in front of a diver.
 */
export function isExcludedKey(file, key) {
  const namespace = path.basename(file, ".json");
  return [namespace, ...key.split(".")].some((segment) => EXCLUDED_SEGMENT.test(segment));
}

/**
 * The English messages a locale lacks (absent or blank), split into what may
 * be drafted and what is left for a human.
 */
export function missingMessages(file, reference, other) {
  const draftable = {};
  const excluded = [];
  const translated = flatten(other);
  for (const [key, english] of Object.entries(flatten(reference))) {
    if (typeof english !== "string") continue;
    const current = translated[key];
    if (typeof current === "string" && current.trim()) continue;
    if (isExcludedKey(file, key)) excluded.push(key);
    else draftable[key] = english;
  }
  return { draftable, excluded };
}

/**
 * The locale's bundle with the drafts filled in, in the English file's key
 * order (the README's rule: key names and order never change). A key only the
 * locale has is kept at the end, for `pnpm check:locale` to report.
 */
export function mergeDrafts(reference, other, drafts, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(reference)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    const existing = other?.[key];
    if (value && typeof value === "object") {
      const merged = mergeDrafts(value, existing ?? {}, drafts, dotted);
      if (Object.keys(merged).length > 0) out[key] = merged;
    } else if (typeof existing === "string" && existing.trim()) {
      out[key] = existing;
    } else if (dotted in drafts) {
      out[key] = drafts[dotted];
    } else if (existing !== undefined) {
      out[key] = existing;
    }
  }
  for (const [key, value] of Object.entries(other ?? {})) {
    if (!(key in reference)) out[key] = value;
  }
  return out;
}

/**
 * Sort Claude's answer into drafts that keep their placeholders and the ones
 * that do not. An answer for a key that was not asked is ignored.
 */
export function checkDrafts(asked, answered) {
  const accepted = {};
  const rejected = [];
  for (const { id, text } of answered) {
    if (!(id in asked) || typeof text !== "string" || !text.trim()) continue;
    const parity = placeholderParity(asked[id], text);
    if (parity.ok) accepted[id] = text;
    else rejected.push({ id, missing: parity.missing, extra: parity.extra });
  }
  const unanswered = Object.keys(asked).filter(
    (id) => !(id in accepted) && !rejected.some((entry) => entry.id === id),
  );
  return { accepted, rejected, unanswered };
}

/** What the model is told, with the locale's own terminology file as its memory. */
export function draftPrompt(locale, guide) {
  return [
    `You translate the user interface of DiveDay, software for scuba dive shops, from US English into ${locale}.`,
    "Each input item has an id and an English message. Return one item per id with the same id and your translation.",
    "Keep every ICU placeholder exactly as written: argument names such as {name} and {count, plural, ...} heads stay in English; translate only the text inside plural and select branches. Keep # and rich-text tags such as <link>...</link> as they are.",
    "Match the register: short, warm, second person, no exclamation marks added. When the English is a label, the translation is a label.",
    guide
      ? `The locale's terminology and register guide follows. Its decisions are binding.\n\n${guide}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The JSON schema Claude's answer must match. */
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/** One request for one locale's missing messages. Throws on a refusal. */
async function askClaude({ locale, guide, messages }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: REQUEST_TIMEOUT_MS });
  const items = Object.entries(messages).map(([id, english]) => ({ id, english }));
  const response = await client.beta.messages
    .stream({
      // The repo's role for long copy (src/lib/claude/models.ts), not a model id.
      model: CLAUDE_MODELS.draft,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: draftPrompt(locale, guide),
      output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      messages: [{ role: "user", content: JSON.stringify({ items }) }],
    })
    .finalMessage();
  if (response.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (response.stop_reason === "max_tokens") {
    throw new Error("the answer ran past max_tokens; translate in smaller pieces");
  }
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return JSON.parse(text).items;
}

/** Every bundle file, relative to a locale folder, that the English locale has. */
async function bundleFiles() {
  const files = [...BUNDLE_FILES];
  for (const dir of BUNDLE_DIRS) {
    const names = await readdir(path.join(LOCALES_DIR, DEFAULT_LOCALE, dir));
    for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
      files.push(path.join(dir, name));
    }
  }
  return files;
}

async function readJson(file) {
  return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
}

async function main() {
  const write = process.argv.includes("--write");
  const locales = (await readdir(LOCALES_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== DEFAULT_LOCALE)
    .map((entry) => entry.name);
  const files = await bundleFiles();
  let failed = false;

  for (const locale of locales) {
    const asked = {};
    const owner = new Map();
    const excluded = [];
    for (const file of files) {
      const reference = await readJson(path.join(LOCALES_DIR, DEFAULT_LOCALE, file));
      const other = await readJson(path.join(LOCALES_DIR, locale, file));
      const missing = missingMessages(file, reference, other);
      for (const [key, english] of Object.entries(missing.draftable)) {
        const id = `${file} ${key}`;
        asked[id] = english;
        owner.set(id, { file, key });
      }
      excluded.push(...missing.excluded.map((key) => `${file} ${key}`));
    }

    for (const id of excluded)
      console.log(`${locale}: left for a human (waiver or medical): ${id}`);
    if (Object.keys(asked).length === 0) {
      console.log(`${locale}: nothing to draft`);
      continue;
    }

    const guidePath = path.join(LOCALES_DIR, locale, "README.md");
    const guide = existsSync(guidePath) ? await readFile(guidePath, "utf8") : "";
    let answered;
    try {
      answered = await askClaude({ locale, guide, messages: asked });
    } catch (error) {
      console.error(`${locale}: no drafts: ${error instanceof Error ? error.message : error}`);
      failed = true;
      continue;
    }
    const { accepted, rejected, unanswered } = checkDrafts(asked, answered);

    for (const [id, text] of Object.entries(accepted)) console.log(`${locale}: ${id}\n  ${text}`);
    for (const { id, missing, extra } of rejected) {
      console.error(
        `${locale}: dropped ${id}: placeholders missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
      );
    }
    for (const id of unanswered) console.error(`${locale}: no answer for ${id}`);
    if (rejected.length > 0 || unanswered.length > 0) failed = true;

    if (!write) continue;
    const byFile = new Map();
    for (const [id, text] of Object.entries(accepted)) {
      const { file, key } = owner.get(id);
      byFile.set(file, { ...byFile.get(file), [key]: text });
    }
    for (const [file, drafts] of byFile) {
      const target = path.join(LOCALES_DIR, locale, file);
      const reference = await readJson(path.join(LOCALES_DIR, DEFAULT_LOCALE, file));
      const merged = mergeDrafts(reference, await readJson(target), drafts);
      await writeFile(target, `${JSON.stringify(merged, null, 2)}\n`);
      console.log(`${locale}: wrote ${Object.keys(drafts).length} draft(s) to ${target}`);
    }
  }

  if (!write)
    console.log("Dry run. Pass --write to put the drafts in the working tree for review.");
  else
    console.log(
      "Review every drafted line with git diff before committing, then run pnpm check:locale.",
    );
  if (failed) process.exitCode = 1;
}

if (import.meta.main) await main();
