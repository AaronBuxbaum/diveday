import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

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
 * 2. **Three seams the direction table cannot say**, because each is about
 *    *what kind* of import crosses rather than whether any may:
 *    - `src/lib` → `src/db` *value* imports. `src/lib` is the framework-free
 *      domain layer (`.claude/rules/domain.md`): a type from a db module is a
 *      shape it may name, but a value import puts a query, and through
 *      `src/db/client.ts` the whole database bootstrap, under a module that
 *      is supposed to be testable without one. A lib file that needs to read
 *      is a loader, and a loader lives in `src/db` or a feature module.
 *    - `src/app` → `drizzle-orm`. A route that builds its own query is a query
 *      no `src/db` test covers and no tenant-scope reader sees; it becomes a
 *      named function in `src/db` instead (routes stay thin, AGENTS.md).
 *    - Anything outside `src/db` → `@/db/trips-*`. The trips modules are
 *      reached through the `@/db/trips` barrel (AGENTS.md route map), so a
 *      sibling can be split or merged without a repo-wide edit.
 *    Test code is exempt from all three (test files, `src/test/`, and the e2e
 *    fixture routes under `src/app/api/test/`): a test builds and inspects its
 *    own rows, and that is not a layering decision.
 *
 * 3. **Feature modules have a contract.** A `src/features/<feature>/` module
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
 * `check-copy.mjs`, its section of `scripts/ratchets.json` records how many violations
 * each file still carries. A file not in the baseline may have none, a file's
 * count may never rise, and a count that falls must be banked in the same
 * change (`node scripts/check-architecture.mjs --write`, which refuses to
 * raise anything; `--absorb` records growth arriving from a merge). The
 * baseline can only ever go down. There is no inline-disable comment on
 * purpose: the escape hatch is a reviewable baseline entry, nothing else.
 */

const ROOT = process.cwd();
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

/**
 * The import seams the forbidden table cannot express (rule 2 above). Each
 * names the importing roots it watches, the targets it refuses, and whether a
 * type-only import is let through.
 */
export const seams = [
  {
    roots: ["src/lib"],
    refuses: (target) => target !== null && isWithin(target, "src/db"),
    typeOnlyAllowed: true,
    message: (file, specifier) =>
      `${file}: value-imports ${specifier} — src/lib is the framework-free domain layer; a type import is fine, a loader belongs in src/db or a feature module`,
  },
  {
    roots: ["src/app"],
    refuses: (_target, specifier) => /^drizzle-orm(?:\/|$)/.test(specifier),
    typeOnlyAllowed: false,
    message: (file, specifier) =>
      `${file}: imports ${specifier} — a route never builds its own query; name it in src/db`,
  },
  {
    roots: ["src/app", "src/components", "src/features", "src/lib", "src/worker", "src/i18n"],
    refuses: (target) =>
      target !== null && path.dirname(target) === "src/db" && /^trips-/.test(path.basename(target)),
    typeOnlyAllowed: false,
    message: (file, specifier) =>
      `${file}: imports ${specifier} — reach the trips modules through the "@/db/trips" barrel`,
  },
];

/**
 * Test code, exempt from the seams: test files, the shared harness in
 * `src/test/`, and the e2e fixture routes under `src/app/api/test/`, which
 * exist to write rows a spec needs and are closed outside the harness
 * (`src/lib/e2e-test-routes.ts`).
 */
const isTestFile = (file) => {
  const posix = file.replaceAll(path.sep, "/");
  return (
    /\.test\.[cm]?[jt]sx?$/.test(posix) ||
    posix.startsWith("src/test/") ||
    posix.startsWith("src/app/api/test/")
  );
};

/**
 * Every import in a file with whether it is type-only: `import type …`,
 * `export type …`, or a braced list in which every name says `type`. Static
 * statements are read whole from their first line to their `from`, which is
 * how Biome formats every one of them; a dynamic `import("…")` or a
 * `require("…")` is always a value.
 */
export function importsOf(contents) {
  const found = [];
  const lines = contents.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*(?:import|export)\b/.test(lines[index])) continue;
    let statement = lines[index];
    while (
      !/\bfrom\s*["'][^"']+["']/.test(statement) &&
      !/^\s*import\s*["']/.test(statement) &&
      !/;\s*$/.test(statement) &&
      index + 1 < lines.length
    ) {
      index += 1;
      statement += `\n${lines[index]}`;
    }
    const from = statement.match(/\bfrom\s*["']([^"']+)["']/);
    const bare = statement.match(/^\s*import\s*["']([^"']+)["']/);
    const specifier = from?.[1] ?? bare?.[1];
    if (!specifier) continue;
    found.push({ specifier, typeOnly: from ? isTypeOnlyClause(statement) : false });
  }
  for (const match of contents.matchAll(/(?:\bimport|\brequire)\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push({ specifier: match[1], typeOnly: false });
  }
  return found;
}

function isTypeOnlyClause(statement) {
  const clause = statement
    .replace(/\bfrom\s*["'][^"']+["'][\s;]*$/, "")
    .replace(/^\s*(?:import|export)\s+/, "")
    .trim();
  if (/^type\b/.test(clause)) return true;
  const braced = clause.match(/^\{([\s\S]*)\}$/);
  if (!braced) return false;
  const names = braced[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

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

  // 2. The seams.
  for (const seam of seams) {
    for (const seamRoot of seam.roots) {
      for (const file of await walk(root, seamRoot)) {
        if (isTestFile(file)) continue;
        const contents = await readFile(path.join(root, file), "utf8");
        for (const { specifier, typeOnly } of importsOf(contents)) {
          if (typeOnly && seam.typeOnlyAllowed) continue;
          if (seam.refuses(resolveSpecifier(file, specifier), specifier)) {
            record(file, seam.message(file.replaceAll(path.sep, "/"), specifier));
          }
        }
      }
    }
  }

  // 3. Feature-module contract.
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
  const { counts: baselineCounts, exists: baselineExists } = await readCounts(ROOT, "architecture");
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    process.exit(
      await bankCounts({
        root: ROOT,
        guard: "architecture",
        counts: violations,
        allowed: baselineCounts,
        exists: baselineExists,
        note: "Pre-existing architecture-boundary violations, per file. Written by `node scripts/check-architecture.mjs --write`. This number may only go down — see scripts/check-architecture.mjs.",
        refusal: "The ratchet only turns one way — fix the imports instead",
        absorb,
        summary: (files, total) => `${files} files, ${total} violations still to unwind`,
      }),
    );
  }

  const failures = auditBaseline(violations, baselineCounts);
  if (failures.length > 0) {
    console.error(
      `Architecture boundary violations:\n${failures.map((item) => `- ${item}`).join("\n")}`,
    );
    console.error(
      "Domain code must not import from src/app or src/features, src/components and src/i18n must not import from src/app, a feature module is reachable only through its index.ts, src/lib takes only types from src/db, src/app never imports drizzle-orm, and the trips modules are reached through @/db/trips. See docs/architecture/decisions/20260730-feature-module-contracts.md and the header of scripts/check-architecture.mjs.",
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
