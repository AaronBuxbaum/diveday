import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Two layout invariants (docs ADR 20260730-feature-module-contracts).
 *
 * 1. **Dependency direction.** Domain (`src/lib`) and data (`src/db`) code must
 *    never import from `src/app` or from `src/features`. They sit below both:
 *    a feature composes them, not the other way round. Without this a "shared
 *    helper" quietly acquires a route's or a feature's dependencies and stops
 *    being testable without them.
 *
 * 2. **Feature modules have a contract.** A `src/features/<feature>/` module
 *    publishes exactly one entry point — its `index.ts` — and documents itself
 *    in a `README.md`. Nothing outside the module may reach past the index.
 *    That is what makes the internals genuinely internal: a file can be split,
 *    renamed, or merged without a repo-wide edit, and the module's surface is
 *    reviewable in one file rather than inferred from every call site.
 */

const ROOT = process.cwd();
const FEATURES_DIR = "src/features";
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;

/** Layers that may not import from these prefixes. */
const forbidden = [
  { root: "src/lib", banned: ["src/app", "src/features"] },
  { root: "src/db", banned: ["src/app", "src/features"] },
  { root: "src/features", banned: ["src/app"] },
];

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
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
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

/**
 * The repo-relative path an import resolves to, or null for a bare package
 * specifier. `@/x` is the tsconfig alias for `src/x`.
 */
function resolveSpecifier(importer, specifier) {
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

const violations = [];

// 1. Dependency direction.
for (const { root, banned } of forbidden) {
  for (const file of await walk(root)) {
    const contents = await readFile(path.join(ROOT, file), "utf8");
    for (const match of contents.matchAll(importPattern)) {
      const target = resolveSpecifier(file, match[1]);
      if (!target) continue;
      for (const bannedRoot of banned) {
        if (isWithin(target, bannedRoot)) violations.push(`${file}: imports ${match[1]}`);
      }
    }
  }
}

// 2. Feature-module contract.
let features = [];
try {
  features = (await readdir(path.join(ROOT, FEATURES_DIR), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

for (const feature of features) {
  for (const required of ["index.ts", "README.md"]) {
    const target = path.join(ROOT, FEATURES_DIR, feature, required);
    try {
      await stat(target);
    } catch {
      violations.push(
        `${FEATURES_DIR}/${feature}: missing ${required} — every feature module publishes one entry point and documents itself`,
      );
    }
  }
}

// Nothing outside a feature module may reach past its index. Scanning whole
// roots rather than a hand-listed set of subtrees: an enumerated list silently
// stops covering `src/i18n`, `src/test`, and any directory added later, and a
// boundary with unwatched gaps is not a boundary.
for (const root of ["src", "e2e", "scripts"]) {
  for (const file of await walk(root)) {
    const importerFeature = featureOf(path.normalize(file));
    const contents = await readFile(path.join(ROOT, file), "utf8");
    for (const match of contents.matchAll(importPattern)) {
      const target = resolveSpecifier(file, match[1]);
      if (!target) continue;
      const targetFeature = featureOf(target);
      if (!targetFeature) continue;
      // Inside the same module, any internal file is fair game.
      if (importerFeature === targetFeature) continue;
      const index = path.normalize(`${FEATURES_DIR}/${targetFeature}`);
      if (target !== index && target !== path.join(index, "index")) {
        violations.push(
          `${file}: deep-imports ${match[1]} — import from "@/features/${targetFeature}" instead`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `Architecture boundary violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
  console.error(
    "Domain code must not import from src/app or src/features, and a feature module is reachable only through its index.ts. See docs/architecture/decisions/20260730-feature-module-contracts.md.",
  );
  process.exit(1);
}

console.log("architecture: layer boundaries and feature-module contracts valid");
