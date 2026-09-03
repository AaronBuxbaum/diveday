import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The copy does not sound like a language model wrote it.
 *
 * Every word a shop or a diver reads comes through the message bundles under
 * `src/i18n/locales/`, and by 2026-09-03 those bundles carried the mannerisms
 * that give machine-written prose away: an em-dash pivot in most sentences
 * ("one answer — all day", "at the desk — not at the dock"), the "not a
 * project, a file" contrast, the "No X. No Y. No Z." run, "actually" and
 * "genuinely" and "plainly" doing the work a plain claim should do, and the
 * "Here's how" lead-in. None of them is wrong in isolation. Together they read
 * as a voice a reader has met a thousand times this year and learned to skim,
 * which on a marketing page is the one outcome the page exists to avoid.
 *
 * The rules a writer follows are in `docs/design/brand.md` ("What gives us
 * away"). This guard holds the mechanical subset — the shapes a regex can name
 * without lying — over every bundle value, per locale:
 *
 * - **A prose em-dash.** An em-dash between two clauses of three or more words,
 *   or anywhere in a string that carries a sentence terminator. A short label
 *   separator ("Boarded — tap again to undo", "Checked in — 2") is not a
 *   sentence and is left alone; the tell is the dash that replaced a full stop,
 *   a comma or a colon in running prose.
 * - **A filler intensifier.** "actually", "genuinely", "simply", "quietly",
 *   "seamless", "effortless", "elevate", "empower", "streamline", "leverage",
 *   "robust": words that assert a quality instead of showing it. ("Unlock" is
 *   not on the list: the water lock's "hold to unlock" is a literal verb.)
 * - **A lead-in.** "Here's how", "the best part", "rest assured", "say goodbye
 *   to", "whether you're", "at its core", "it's worth noting".
 * - **The "not just" contrast.** "isn't just", "more than just", "not about
 *   X, it's about Y".
 * - **The staccato run.** Two consecutive sentences of a few words each that
 *   both begin "No" — "No setup fee. No per-seat math."
 *
 * Every locale states its own word list, and a locale with none is a failure
 * rather than a pass: a third language must name what it refuses.
 *
 * Ratcheted like `check:copy` — a per-file count in `scripts/voice-baseline.json`
 * that may only fall. `--write` banks a fall and refuses a rise, `--absorb`
 * records growth that arrived in a merge, `--report [prefix]` prints every hit.
 * It lands at zero, so it behaves as a full gate today.
 */

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/voice-baseline.json";
export const LOCALES_DIR = "src/i18n/locales";

/**
 * A spaced em-dash (or a double hyphen standing in for one). The en-dash is
 * left alone: it is a range ("8:05 – 8:47"), never a pivot.
 */
const DASH_PATTERN = /\s(?:—|--)\s/g;

/** How many words on each side of a dash before it reads as two clauses. */
const CLAUSE_WORDS = 3;

/**
 * Per-locale word rules. Each is a regex over the whole value; a locale that
 * appears in `src/i18n/locales/` and not here fails the check.
 */
export const RULES = {
  "en-US": {
    filler:
      /\b(?:actually|genuinely|simply|quietly|truly|literally|seamless(?:ly)?|effortless(?:ly)?|elevates?d?|empower(?:s|ed|ing)?|streamlines?d?|leverages?d?|robust|delve|supercharge[sd]?|frictionless|hassle-free|world-class|cutting-edge|best-in-class|next-level|game-changer|revolutioni[sz]e\w*|transformative)\b/gi,
    leadIn:
      /\b(?:here's (?:how|what|the|why|where)|here is (?:how|what|why)|the best part|let's be honest|rest assured|look no further|say goodbye to|whether you're|in today's (?:world|market|landscape|economy|fast-paced)|at its core|it's worth noting|the whole point|the thing is)\b/gi,
    notJust:
      /\b(?:isn't just|is not just|aren't just|not just an?\b|more than just|isn't about|is not about|it's not (?:a|an|about) [^.]{0,40}, it's)\b/gi,
    staccato: /\b(?:No|Nothing|Never) [^.!?]{1,24}[.!?] (?:No|Nothing|Never)\b/g,
  },
  "es-ES": {
    filler:
      /\b(?:realmente|genuinamente|simplemente|sin esfuerzo|sin fricciones|potenciar|revolucionar?)\b/gi,
    leadIn: /\b(?:la mejor parte|di adiós a|hoy en día|en esencia|vale la pena señalar)\b/gi,
    notJust: /\b(?:no es solo|no se trata (?:solo )?de|más que (?:un|una) simple)\b/gi,
    staccato: /\b(?:Sin|Ni|Nada) [^.!?]{1,24}[.!?] (?:Sin|Ni|Nada)\b/g,
  },
};

/**
 * A dash is a tell when it sits inside running prose: a sentence terminator
 * anywhere in the value, or three or more words on each side of it.
 */
export function proseDashes(value) {
  const found = [];
  const hasSentence = /[.!?]/.test(value);
  DASH_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(DASH_PATTERN)) {
    const left = value.slice(0, match.index).trim().split(/\s+/).filter(Boolean);
    const right = value
      .slice(match.index + match[0].length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (hasSentence || (left.length >= CLAUSE_WORDS && right.length >= CLAUSE_WORDS)) {
      const excerpt = `${left.slice(-3).join(" ")} — ${right.slice(0, 3).join(" ")}`;
      found.push({ rule: "em-dash", text: excerpt });
    }
  }
  return found;
}

/** Every tell in one bundle value, for one locale. */
export function findTells(value, locale) {
  const rules = RULES[locale];
  if (!rules) throw new Error(`no voice rules for locale ${locale}`);
  const found = proseDashes(value);
  for (const [rule, pattern] of Object.entries(rules)) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) found.push({ rule, text: match[0] });
  }
  return found;
}

function walkValues(node, prefix, visit) {
  if (typeof node === "string") {
    visit(prefix, node);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      walkValues(child, prefix ? `${prefix}.${key}` : key, visit);
    }
  }
}

async function bundleFiles(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await bundleFiles(relativePath)));
    else if (entry.name.endsWith(".json")) files.push(relativePath);
  }
  return files.sort();
}

export async function scanBundles() {
  const counts = new Map();
  const details = new Map();
  const locales = (await readdir(path.join(ROOT, LOCALES_DIR), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const locale of locales) {
    if (!RULES[locale]) {
      throw new Error(
        `${LOCALES_DIR}/${locale} has no voice rules — add a word list for it in scripts/check-voice.mjs`,
      );
    }
    for (const file of await bundleFiles(path.join(LOCALES_DIR, locale))) {
      const bundle = JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
      const hits = [];
      walkValues(bundle, "", (key, value) => {
        for (const tell of findTells(value, locale)) hits.push({ key, ...tell });
      });
      if (hits.length > 0) {
        counts.set(file, hits.length);
        details.set(file, hits);
      }
    }
  }
  return { counts, details };
}

async function main() {
  const { counts, details } = await scanBundles();

  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex !== -1) {
    const prefix = process.argv[reportIndex + 1] ?? "";
    let shown = 0;
    for (const [file, hits] of [...details.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!file.startsWith(prefix)) continue;
      console.log(`\n${file} (${hits.length})`);
      for (const hit of hits) console.log(`  ${hit.key}\t${hit.rule}\t${hit.text}`);
      shown += hits.length;
    }
    console.log(`\n${shown} voice tells under "${prefix || LOCALES_DIR}"`);
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
          'Refusing to write a baseline that grows. Rewrite the sentence instead — docs/design/brand.md, "What gives us away":',
        );
        for (const [file, count] of grew) {
          console.error(`- ${file}: ${baselineCounts[file]} → ${count}`);
        }
        for (const file of added) console.error(`- ${file}: new file with ${counts.get(file)}`);
        console.error(
          "If this growth arrived in a merge from a branch that predates the sweep, `--absorb` records it explicitly.",
        );
        process.exit(1);
      }
      console.warn("Absorbing voice tells that grew — this must be merged-in work, not new:");
      for (const [file, count] of grew) {
        console.warn(
          `- ${file}: ${baselineCounts[file]} → ${count} (+${count - baselineCounts[file]})`,
        );
      }
      for (const file of added) console.warn(`- ${file}: new file with ${counts.get(file)}`);
    }
    const next = {
      "//": "Voice tells still in a message bundle, per file. Written by `node scripts/check-voice.mjs --write`. This number may only go down — see scripts/check-voice.mjs.",
      ...Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    console.log(`voice: baseline written — ${counts.size} files, ${total} tells left`);
    process.exit(0);
  }

  const violations = [];
  for (const [file, count] of counts) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      const sample = details
        .get(file)
        .slice(0, 5)
        .map((hit) => `\n    ${hit.key}  [${hit.rule}]  ${hit.text}`)
        .join("");
      violations.push(
        `${file}: ${count} voice tell${count === 1 ? "" : "s"} in a file with no baseline entry.${sample}`,
      );
      continue;
    }
    if (count > allowed) {
      const sample = details
        .get(file)
        .slice(0, 5)
        .map((hit) => `\n    ${hit.key}  [${hit.rule}]  ${hit.text}`)
        .join("");
      violations.push(
        `${file}: ${count} voice tells, baseline allows ${allowed}. Rewrite the sentence rather than raising the number.${sample}`,
      );
    }
    if (count < allowed) {
      violations.push(
        `${file}: down to ${count} from ${allowed}. Lower the baseline in this change (\`node scripts/check-voice.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!counts.has(file)) {
      violations.push(
        `${file}: fully swept or gone. Remove its baseline entry (\`node scripts/check-voice.mjs --write\`).`,
      );
    }
  }

  if (violations.length > 0) {
    console.error(`Voice violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    console.error(
      "A prose em-dash becomes a full stop, a comma or a colon; an intensifier is deleted; a lead-in is deleted; a 'not just X' contrast states the thing. The full list and the reasoning: docs/design/brand.md, \"What gives us away\". `node scripts/check-voice.mjs --report <file>` lists every hit.",
    );
    process.exit(1);
  }

  const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `voice: ${remaining} tell${remaining === 1 ? "" : "s"} across ${counts.size} bundle${counts.size === 1 ? "" : "s"}`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
