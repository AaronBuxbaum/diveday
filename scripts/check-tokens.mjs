import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { filesUnder } from "./files-under.mjs";
import { prepareLinePreservingSource } from "./line-preserving-source.mjs";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * Semantic design tokens only (docs ADR 0004-design-tokens).
 *
 * Components style through the semantic utilities bound in
 * `src/app/globals.css` (`bg-surface`, `text-muted`, `border-border`, …) —
 * never a raw hex value, never a Tailwind palette-scale class
 * (`bg-cyan-600`). Until now that rule was held by review alone (review
 * finding I18N-4); this makes it a gate, ratcheted exactly like
 * `check-copy.mjs` and `check-architecture.mjs`.
 *
 * What counts as a violation, in `.ts`/`.tsx` under the guarded roots:
 *   - a hex color literal (`#0e7490`, `#fff`, `#22d3eecc`) outside a comment;
 *   - a palette-scale utility (`bg-cyan-600`, `dark:text-red-500/80`,
 *     `from-slate-50`) — any color-bearing prefix on any Tailwind palette
 *     name with a numeric scale.
 *
 * What does not, and why:
 *   - `src/app/globals.css` — the one place hex is *supposed* to live; token
 *     definitions are the point of the file, and it is CSS, not a component.
 *   - Next's metadata-file conventions (`opengraph-image.tsx`,
 *     `twitter-image.tsx`, `manifest.ts`) — these render to bitmaps (Satori)
 *     or JSON served outside any stylesheet, so CSS custom properties
 *     literally cannot reach them. Hex there is not a missed token, it is the
 *     only mechanism that exists.
 *   - the shared code those metadata files render *through*, listed one exact
 *     path at a time in `exemptPaths` below. Same bitmap, same reason; the
 *     only difference is that a shared module carries no convention name to
 *     key on.
 *   - an issue or PR reference (`(issue #722)`, `PR #1010`) — see
 *     {@link isIssueReference};
 *   - fragment hrefs and other `#word` strings — the hex pattern requires a
 *     valid color length and rejects a match that continues into an
 *     identifier (`#add-diver` never matches), and comments are stripped
 *     before scanning.
 *
 * The escape hatch is a baseline entry, never an inline-disable comment:
 * Its section of `scripts/ratchets.json` records how many violations a file still carries
 * (today: the embed-snippet generator, whose hex is copied into *third-party*
 * sites where our tokens do not exist). A file not in the baseline may have
 * none, a count may never rise, and a fall must be banked in the same change
 * (`--write`, which refuses to raise anything; `--absorb` records growth
 * arriving from a merge).
 */

const ROOT = process.cwd();
const guardedRoots = ["src/app", "src/components", "src/features"];

/**
 * Rendered outside the stylesheet — tokens cannot apply. Kept to Next's exact
 * metadata-file names, and honored only under `src/app` where the conventions
 * exist, so an ordinary component can't opt out by taking one of the names.
 */
const metadataFileNames = new Set(["opengraph-image.tsx", "twitter-image.tsx", "manifest.ts"]);

/**
 * Exempt for the same reason and by the same rule as the names above —
 * rendered outside the stylesheet — but named one path at a time rather than
 * by filename, because these carry no Next convention to key on.
 *
 * `src/app/_og/card.tsx` is the chrome (ground, wordmark, tagline footer) the
 * four link-preview cards share. It was copied into all four until
 * FU-20260812, which is how the mark managed to be wrong on every card at once
 * and then drift again inside its own fix. Extracting it is only possible if
 * the extracted file keeps the exemption the four originals have: it is the
 * *same satori bitmap*, where CSS custom properties cannot reach. Deliberately
 * an exact path and not a glob — `src/app/_og/**` would let an ordinary module
 * opt out by moving house.
 *
 * `src/app/_brand/colors.ts` is the same arrangement for two things a token
 * genuinely cannot reach: the bubble-trail mark's fills, which
 * `pwa-icon-maskable/route.tsx` renders through at request time and
 * `scripts/render-brand-icons.tsx` renders through into the four committed
 * PNGs, rather than each hand-placing them at one size; and the `<meta
 * name="theme-color">` pair — an HTML attribute, where a custom property has
 * nothing to resolve against (issue #794).
 *
 * `icon.tsx` and `apple-icon.tsx` were in the name list above until issue
 * #1361 turned them into `icon.png` and `apple-icon.png`. The names are gone
 * from the list with the files, so an ordinary component cannot claim the
 * exemption by taking one.
 */
const exemptPaths = new Set(["src/app/_og/card.tsx", "src/app/_brand/colors.ts"]);

/**
 * A hex color: 3/4/6/8 hex digits, not continuing into an identifier — so
 * `#add-diver` (a fragment href whose first three letters happen to be hex)
 * and `#deadbeefcafe` never match.
 */
export const hexColorPattern =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;

/**
 * **`(issue #722)` is a citation, not a dark red.**
 *
 * This repository cites its own issues constantly, and until now every one of
 * those citations happened to sit in a comment — which {@link stripComments}
 * blanks before the scan, so nothing ever noticed. Then a test title carried
 * one into a **string literal**: `describe("ScheduleBuilder wind line (issue
 * #722)")`. `#722` is three hex digits not followed by an identifier
 * character, so it is a perfectly good match, and `main` went red on a file
 * with no colour in it at all.
 *
 * The narrow rule, rather than exempting all-decimal hex: a reference is `#`
 * plus digits **preceded by the word that makes it one**. `#000` and `#111111`
 * are real colours a component might reach for and stay fully covered; the only
 * thing forgiven is the shape this codebase writes on purpose.
 *
 * The cost is that a citation written *without* that word — `"fixes #1010"` in
 * a string — is still read as a colour. Write `fixes issue #1010`, which is how
 * every citation in this tree already reads. Forgiving the uncited form would
 * mean forgiving every all-digit hex, and that is the half of the check most
 * worth keeping.
 */
const ISSUE_REFERENCE = /(?:\bissues?|\bPRs?|\bpull requests?)\s+#$/i;

/** Whether the `#…` at `index` is the tail of an issue or PR citation. */
function isIssueReference(source, index, match) {
  // Digits only. A reference is never `#a1b2c3`, and a colour that happens to
  // be all digits is still a colour unless a citing word precedes it.
  if (!/^#\d+$/.test(match)) return false;
  return ISSUE_REFERENCE.test(source.slice(0, index + 1));
}

const colorPrefixes = [
  "bg",
  "text",
  "border",
  "ring",
  "ring-offset",
  "fill",
  "stroke",
  "from",
  "via",
  "to",
  "divide",
  "outline",
  "decoration",
  "shadow",
  "accent",
  "caret",
  "placeholder",
];

const paletteNames = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

/**
 * `bg-cyan-600`, with any variant prefix (`dark:`, `hover:`) and any opacity
 * suffix (`/80`) — the class fragment itself is what matters. The leading
 * guard stops `some-bg-cyan-600`-shaped identifiers matching mid-word.
 */
export const paletteClassPattern = new RegExp(
  `(?:^|[^\\w-])((?:${colorPrefixes.join("|")})-(?:${paletteNames.join("|")})-(?:50|[1-9]00|950))(?![\\w-])`,
  "g",
);

/** Every violation in one file's source, as `{ line, text }`. */
export function findTokenViolations(source) {
  const { text: stripped, lineAt } = prepareLinePreservingSource(source);

  const found = [];
  for (const match of stripped.matchAll(hexColorPattern)) {
    if (isIssueReference(stripped, match.index, match[0])) continue;
    found.push({ line: lineAt(match.index) + 1, text: `raw hex ${match[0]}` });
  }
  for (const match of stripped.matchAll(paletteClassPattern)) {
    found.push({ line: lineAt(match.index) + 1, text: `palette-scale class ${match[1]}` });
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * **A color utility whose token does not exist renders as nothing.**
 *
 * `text-danger-strong` sat in five components while the theme defined only
 * `--color-danger`: Tailwind emits no rule for an unknown name, so the lapsed-insurance
 * line on the boat manifest rendered in plain ink and the tests that asserted the class
 * name passed anyway (issue #2908). A utility built on a semantic color family
 * (`danger`, `success`, `warning`, `info`, `primary`, `accent`) must name a
 * `--color-*` token that `src/app/globals.css` binds. No baseline: a miss is always a bug.
 */
const semanticFamilies = ["danger", "success", "warning", "info", "primary", "accent"];

export const semanticClassPattern = new RegExp(
  `(?:^|[^\\w-])(?:${colorPrefixes.join("|")})-((?:${semanticFamilies.join("|")})(?:-[a-z]+)*)(?![\\w-])`,
  "g",
);

/** The `--color-<name>` names a stylesheet binds. */
export function definedColorTokens(css) {
  return new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1]));
}

/** Every semantic color utility in `source` whose token is not in `tokens`, as `{ line, text }`. */
export function findUndefinedColorClasses(source, tokens) {
  const { text: stripped, lineAt } = prepareLinePreservingSource(source);
  const found = [];
  for (const match of stripped.matchAll(semanticClassPattern)) {
    if (tokens.has(match[1])) continue;
    const line = lineAt(match.index + 1) + 1;
    found.push({ line, text: `undefined color token ${match[1]}` });
  }
  return found;
}

async function walk(root, relativeDirectory) {
  return filesUnder(
    relativeDirectory,
    (directory) => readdir(path.join(root, directory), { withFileTypes: true }),
    (relativePath, entry) => {
      const { name } = entry;
      return (
        (name.endsWith(".tsx") || name.endsWith(".ts")) &&
        !name.endsWith(".d.ts") &&
        !(metadataFileNames.has(name) && relativePath.startsWith(`src${path.sep}app`)) &&
        !exemptPaths.has(relativePath.replaceAll(path.sep, "/"))
      );
    },
  );
}

/** Map of repo-relative file (posix separators) → violations. */
export async function scanTree(root = ROOT) {
  const details = new Map();
  for (const guardedRoot of guardedRoots) {
    for (const file of await walk(root, guardedRoot)) {
      const source = await readFile(path.join(root, file), "utf8");
      const found = findTokenViolations(source);
      if (found.length > 0) details.set(file.replaceAll(path.sep, "/"), found);
    }
  }
  return details;
}

async function main() {
  const details = await scanTree(ROOT);

  // `--report [pathPrefix]` lists what the scanner sees.
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex !== -1) {
    const prefix = process.argv[reportIndex + 1] ?? "";
    let shown = 0;
    for (const [file, hits] of [...details.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!file.startsWith(prefix)) continue;
      console.log(`\n${file} (${hits.length})`);
      for (const hit of hits) console.log(`  ${hit.line}\t${hit.text}`);
      shown += hits.length;
    }
    console.log(`\n${shown} non-token color values under "${prefix || "src"}"`);
    process.exit(0);
  }

  const tokens = definedColorTokens(await readFile(path.join(ROOT, "src/app/globals.css"), "utf8"));
  const undefinedTokens = [];
  for (const guardedRoot of guardedRoots) {
    for (const file of await walk(ROOT, guardedRoot)) {
      const found = findUndefinedColorClasses(
        await readFile(path.join(ROOT, file), "utf8"),
        tokens,
      );
      for (const hit of found)
        undefinedTokens.push(`${file.replaceAll(path.sep, "/")}:${hit.line}  ${hit.text}`);
    }
  }
  if (undefinedTokens.length > 0) {
    console.error(
      `Undefined color utilities (no --color-* token in src/app/globals.css, so they render as nothing):\n${undefinedTokens.map((v) => `- ${v}`).join("\n")}`,
    );
    process.exit(1);
  }

  const { counts: baselineCounts, exists: baselineExists } = await readCounts(ROOT, "tokens");
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    process.exit(
      await bankCounts({
        root: ROOT,
        guard: "tokens",
        counts: details,
        allowed: baselineCounts,
        exists: baselineExists,
        note: "Non-token color values still in components, per file. Written by `node scripts/check-tokens.mjs --write`. This number may only go down — see scripts/check-tokens.mjs. The embed-snippet generator is here by design: its hex is pasted into third-party sites where our tokens do not exist.",
        refusal: "The ratchet only turns one way — use a semantic token instead",
        absorb,
        summary: (files, total) => `${files} files, ${total} values`,
      }),
    );
  }

  const violations = [];
  for (const [file, hits] of details) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      const sample = hits
        .slice(0, 5)
        .map((hit) => `\n    ${file}:${hit.line}  ${hit.text}`)
        .join("");
      violations.push(
        `${file}: ${hits.length} non-token color value${hits.length === 1 ? "" : "s"} in a file with no baseline entry.${sample}`,
      );
      continue;
    }
    if (hits.length > allowed) {
      violations.push(
        `${file}: ${hits.length} non-token color values, baseline allows ${allowed}. Use a semantic token instead of raising the number.`,
      );
    }
    if (hits.length < allowed) {
      violations.push(
        `${file}: down to ${hits.length} from ${allowed} — lower the baseline in this change (\`node scripts/check-tokens.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!details.has(file)) {
      violations.push(
        `${file}: clean or gone — remove its baseline entry (\`node scripts/check-tokens.mjs --write\`).`,
      );
    }
  }

  if (violations.length > 0) {
    console.error(`Design-token violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    console.error(
      "Components style through semantic tokens only — no raw hex, no palette-scale classes. Add a token to src/app/globals.css (light and dark values) and use its utility. See docs/architecture/decisions/0004-design-tokens.md.",
    );
    process.exit(1);
  }

  const remaining = [...details.values()].reduce((sum, hits) => sum + hits.length, 0);
  console.log(
    remaining > 0
      ? `tokens: no new non-token colors — ${remaining} baselined value${remaining === 1 ? "" : "s"} across ${details.size} file${details.size === 1 ? "" : "s"}`
      : "tokens: components use semantic tokens only",
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
