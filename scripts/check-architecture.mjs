import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Layout invariants (docs ADR 20260730-feature-module-contracts).
 *
 * 1. **Dependency direction.** Domain (`src/lib`) and data (`src/db`) code must
 *    never import from `src/app` or from `src/features`. They sit below both:
 *    a feature composes them, not the other way round. Without this a "shared
 *    helper" quietly acquires a route's or a feature's dependencies and stops
 *    being testable without them. The same direction holds one level up:
 *    shared UI (`src/components`) and copy plumbing (`src/i18n`) are composed
 *    *by* routes, so neither may import from `src/app`, and `src/i18n` — a
 *    lib-level layer — may not import shared UI or feature modules either
 *    (review finding ARCH-2: these two roots previously floated under no rule).
 *
 * 2. **Feature modules have a contract.** A `src/features/<feature>/` module
 *    publishes exactly one entry point — its `index.ts` — and documents itself
 *    in a `README.md`. Nothing outside the module may reach past the index.
 *    That is what makes the internals genuinely internal: a file can be split,
 *    renamed, or merged without a repo-wide edit, and the module's surface is
 *    reviewable in one file rather than inferred from every call site.
 *
 * ## The ratchet
 *
 * Widening the forbidden table found pre-existing debt (shared components in
 * `src/components/today/` importing server actions from `src/app/actions/`),
 * and unwinding it means moving files, not deleting an import — too structural
 * to mass-fix in the change that adds the rule. So, exactly like
 * `check-copy.mjs`, `architecture-baseline.json` records how many violations
 * each file still carries. A file not in the baseline may have none, a file's
 * count may never rise, and a count that falls must be banked in the same
 * change (`node scripts/check-architecture.mjs --write`, which refuses to
 * raise anything; `--absorb` records growth arriving from a merge). The
 * baseline can only ever go down. There is no inline-disable comment on
 * purpose: the escape hatch is a reviewable baseline entry, nothing else.
 */

const ROOT = process.cwd();
export const BASELINE_PATH = "scripts/architecture-baseline.json";
const FEATURES_DIR = "src/features";
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * Every form an import takes. The first alternation covers `import x from`,
 * `export … from`, dynamic `import(…)`, and `require(…)`; the second covers
 * the bare side-effect form — `import "@/app/x"` — which the original pattern
 * missed entirely (review finding ARCH-2), so a file could take a banned
 * dependency invisibly as long as it didn't bind a name to it.
 */
export const importPattern =
  /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;

/** Layers that may not import from these prefixes. */
export const forbidden = [
  { root: "src/lib", banned: ["src/app", "src/features"] },
  { root: "src/db", banned: ["src/app", "src/features"] },
  { root: "src/features", banned: ["src/app"] },
  { root: "src/components", banned: ["src/app", "src/features"] },
  // The service worker is a fourth composition root (ADR
  // 20260804-manifest-web-push): it is compiled separately and imports the
  // domain layer directly, so it sits beside `src/app` rather than under it.
  // Listed for the same reason ARCH-2 listed components and i18n — a root that
  // floats under no rule is one nobody notices growing an upward import.
  { root: "src/worker", banned: ["src/app", "src/features", "src/components"] },
  { root: "src/i18n", banned: ["src/app", "src/features", "src/components"] },
];

async function walk(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, relativePath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

/**
 * The repo-relative path an import resolves to, or null for a bare package
 * specifier. `@/x` is the tsconfig alias for `src/x`.
 */
export function resolveSpecifier(importer, specifier) {
  if (specifier.startsWith("@/")) return path.normalize(`src/${specifier.slice(2)}`);
  if (specifier.startsWith("."))
    return path.normalize(path.join(path.dirname(importer), specifier));
  return null;
}

function isWithin(target, root) {
  const normalized = path.normalize(root);
  return target === normalized || target.startsWith(`${normalized}${path.sep}`);
}

/** `src/features/calendar-sync/feed-store` → `calendar-sync`, else null. */
function featureOf(target) {
  const prefix = `${path.normalize(FEATURES_DIR)}${path.sep}`;
  if (!target.startsWith(prefix)) return null;
  return target.slice(prefix.length).split(path.sep)[0] || null;
}

/**
 * Every violation in the tree, as a Map of repo-relative file (posix
 * separators, so the baseline is stable across platforms) → messages. The
 * feature-contract rule keys on the module directory, the import rules on the
 * importing file.
 */
export async function collectViolations(root = ROOT) {
  const violations = new Map();
  const record = (file, message) => {
    const key = file.replaceAll(path.sep, "/");
    if (!violations.has(key)) violations.set(key, []);
    violations.get(key).push(message);
  };

  // 1. Dependency direction.
  for (const { root: layerRoot, banned } of forbidden) {
    for (const file of await walk(root, layerRoot)) {
      const contents = await readFile(path.join(root, file), "utf8");
      for (const match of contents.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        for (const bannedRoot of banned) {
          if (isWithin(target, bannedRoot)) record(file, `${file}: imports ${specifier}`);
        }
      }
    }
  }

  // 2. Feature-module contract.
  let features = [];
  try {
    features = (await readdir(path.join(root, FEATURES_DIR), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  for (const feature of features) {
    for (const required of ["index.ts", "README.md"]) {
      const target = path.join(root, FEATURES_DIR, feature, required);
      try {
        await stat(target);
      } catch {
        record(
          `${FEATURES_DIR}/${feature}`,
          `${FEATURES_DIR}/${feature}: missing ${required} — every feature module publishes one entry point and documents itself`,
        );
      }
    }
  }

  // Nothing outside a feature module may reach past its index. Scanning whole
  // roots rather than a hand-listed set of subtrees: an enumerated list silently
  // stops covering `src/i18n`, `src/test`, and any directory added later, and a
  // boundary with unwatched gaps is not a boundary.
  for (const scanRoot of ["src", "e2e", "scripts"]) {
    for (const file of await walk(root, scanRoot)) {
      const importerFeature = featureOf(path.normalize(file));
      const contents = await readFile(path.join(root, file), "utf8");
      for (const match of contents.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        const targetFeature = featureOf(target);
        if (!targetFeature) continue;
        // Inside the same module, any internal file is fair game.
        if (importerFeature === targetFeature) continue;
        const index = path.normalize(`${FEATURES_DIR}/${targetFeature}`);
        if (target !== index && target !== path.join(index, "index")) {
          record(
            file,
            `${file}: deep-imports ${specifier} — import from "@/features/${targetFeature}" instead`,
          );
        }
      }
    }
  }

  return violations;
}

export async function readBaseline(root = ROOT) {
  let baseline = {};
  let exists = true;
  try {
    baseline = JSON.parse(await readFile(path.join(root, BASELINE_PATH), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    exists = false;
  }
  // The file carries a leading note for humans; it is not a path.
  const counts = Object.fromEntries(
    Object.entries(baseline).filter(([key]) => !key.startsWith("//")),
  );
  return { counts, exists };
}

/**
 * The ratchet verdict: every violation in a file with no baseline entry, every
 * file whose count rose, and every file whose count fell without the baseline
 * being lowered in the same change. Identical semantics to `check-copy.mjs`.
 */
export function auditBaseline(violations, baselineCounts) {
  const failures = [];
  for (const [file, messages] of violations) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      failures.push(...messages.map((message) => message));
      continue;
    }
    if (messages.length > allowed) {
      failures.push(
        `${file}: ${messages.length} boundary violations, baseline allows ${allowed}. Fix the new import instead of raising the number.`,
      );
    }
    if (messages.length < allowed) {
      failures.push(
        `${file}: down to ${messages.length} from ${allowed} — lower the baseline in this change (\`node scripts/check-architecture.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!violations.has(file)) {
      failures.push(
        `${file}: clean or gone — remove its baseline entry (\`node scripts/check-architecture.mjs --write\`).`,
      );
    }
  }
  return failures;
}

async function main() {
  const violations = await collectViolations(ROOT);
  const { counts: baselineCounts, exists: baselineExists } = await readBaseline(ROOT);

  const absorbing = process.argv.includes("--absorb");
  if (process.argv.includes("--write") || absorbing) {
    const grew = [...violations.entries()].filter(
      ([file, messages]) => baselineExists && messages.length > (baselineCounts[file] ?? 0),
    );
    if (grew.length > 0 && !absorbing) {
      console.error(
        "Refusing to write a baseline that grows. The ratchet only turns one way — fix the imports instead:",
      );
      for (const [file, messages] of grew) {
        console.error(`- ${file}: ${baselineCounts[file] ?? 0} → ${messages.length}`);
      }
      console.error(
        "If this growth arrived in a merge from a branch that predates the check, `--absorb` records it explicitly.",
      );
      process.exit(1);
    }
    if (grew.length > 0) {
      console.warn("Absorbing violations that grew — this must be merged-in work, not new debt:");
      for (const [file, messages] of grew) {
        console.warn(`- ${file}: ${baselineCounts[file] ?? 0} → ${messages.length}`);
      }
    }
    const next = {
      "//": "Pre-existing architecture-boundary violations, per file. Written by `node scripts/check-architecture.mjs --write`. This number may only go down — see scripts/check-architecture.mjs.",
      ...Object.fromEntries(
        [...violations.entries()]
          .map(([file, messages]) => [file, messages.length])
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
    const total = [...violations.values()].reduce((sum, messages) => sum + messages.length, 0);
    console.log(
      `architecture: baseline written — ${violations.size} files, ${total} violations still to unwind`,
    );
    process.exit(0);
  }

  const failures = auditBaseline(violations, baselineCounts);
  if (failures.length > 0) {
    console.error(
      `Architecture boundary violations:\n${failures.map((item) => `- ${item}`).join("\n")}`,
    );
    console.error(
      "Domain code must not import from src/app or src/features, src/components and src/i18n must not import from src/app, and a feature module is reachable only through its index.ts. See docs/architecture/decisions/20260730-feature-module-contracts.md.",
    );
    process.exit(1);
  }

  const remaining = [...violations.values()].reduce((sum, messages) => sum + messages.length, 0);
  console.log(
    remaining > 0
      ? `architecture: no new boundary violations — ${remaining} pre-existing across ${violations.size} files still to unwind`
      : "architecture: layer boundaries and feature-module contracts valid",
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
