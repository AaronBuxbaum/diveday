import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
 *     `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`, `manifest.ts`) —
 *     these render to bitmaps (Satori) or JSON served outside any stylesheet,
 *     so CSS custom properties literally cannot reach them. Hex there is not
 *     a missed token, it is the only mechanism that exists.
 *   - fragment hrefs and other `#word` strings — the hex pattern requires a
 *     valid color length and rejects a match that continues into an
 *     identifier (`#add-diver` never matches), and comments are stripped
 *     before scanning.
 *
 * The escape hatch is a baseline entry, never an inline-disable comment:
 * `tokens-baseline.json` records how many violations a file still carries
 * (today: the embed-snippet generator, whose hex is copied into *third-party*
 * sites where our tokens do not exist). A file not in the baseline may have
 * none, a count may never rise, and a fall must be banked in the same change
 * (`--write`, which refuses to raise anything; `--absorb` records growth
 * arriving from a merge).
 */

const ROOT = process.cwd();
export const BASELINE_PATH = "scripts/tokens-baseline.json";
const guardedRoots = ["src/app", "src/components", "src/features"];

/**
 * Rendered outside the stylesheet — tokens cannot apply. Kept to Next's exact
 * metadata-file names, and honored only under `src/app` where the conventions
 * exist, so an ordinary component can't opt out by taking one of the names.
 */
const metadataFileNames = new Set([
  "opengraph-image.tsx",
  "twitter-image.tsx",
  "icon.tsx",
  "apple-icon.tsx",
  "manifest.ts",
]);

/**
 * A hex color: 3/4/6/8 hex digits, not continuing into an identifier — so
 * `#add-diver` (a fragment href whose first three letters happen to be hex)
 * and `#deadbeefcafe` never match.
 */
export const hexColorPattern =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;

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

/** Strips comments so a documented hex value never reads as a violation. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/** Every violation in one file's source, as `{ line, text }`. */
export function findTokenViolations(source) {
  const stripped = stripComments(source);
  const lineStarts = [];
  let offset = 0;
  for (const line of stripped.split("\n")) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const lineAt = (index) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  const found = [];
  for (const match of stripped.matchAll(hexColorPattern)) {
    found.push({ line: lineAt(match.index), text: `raw hex ${match[0]}` });
  }
  for (const match of stripped.matchAll(paletteClassPattern)) {
    found.push({ line: lineAt(match.index), text: `palette-scale class ${match[1]}` });
  }
  return found.sort((a, b) => a.line - b.line);
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
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, relativePath)));
    else if (
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
      !entry.name.endsWith(".d.ts") &&
      !(metadataFileNames.has(entry.name) && relativePath.startsWith(`src${path.sep}app`))
    ) {
      files.push(relativePath);
    }
  }
  return files;
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

  let baseline = {};
  let baselineExists = true;
  try {
    baseline = JSON.parse(await readFile(path.join(ROOT, BASELINE_PATH), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    baselineExists = false;
  }
  // The file carries a leading note for humans; it is not a path.
  const baselineCounts = Object.fromEntries(
    Object.entries(baseline).filter(([key]) => !key.startsWith("//")),
  );

  const absorbing = process.argv.includes("--absorb");
  if (process.argv.includes("--write") || absorbing) {
    const grew = [...details.entries()].filter(
      ([file, hits]) => baselineExists && hits.length > (baselineCounts[file] ?? 0),
    );
    if (grew.length > 0 && !absorbing) {
      console.error(
        "Refusing to write a baseline that grows. The ratchet only turns one way — use a semantic token instead:",
      );
      for (const [file, hits] of grew) {
        console.error(`- ${file}: ${baselineCounts[file] ?? 0} → ${hits.length}`);
      }
      console.error(
        "If this growth arrived in a merge from a branch that predates the check, `--absorb` records it explicitly.",
      );
      process.exit(1);
    }
    if (grew.length > 0) {
      console.warn("Absorbing values that grew — this must be merged-in work, not new debt:");
      for (const [file, hits] of grew) {
        console.warn(`- ${file}: ${baselineCounts[file] ?? 0} → ${hits.length}`);
      }
    }
    const next = {
      "//": "Non-token color values still in components, per file. Written by `node scripts/check-tokens.mjs --write`. This number may only go down — see scripts/check-tokens.mjs. The embed-snippet generator is here by design: its hex is pasted into third-party sites where our tokens do not exist.",
      ...Object.fromEntries(
        [...details.entries()]
          .map(([file, hits]) => [file, hits.length])
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
    const total = [...details.values()].reduce((sum, hits) => sum + hits.length, 0);
    console.log(`tokens: baseline written — ${details.size} files, ${total} values`);
    process.exit(0);
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
