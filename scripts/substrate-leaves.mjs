import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { filesUnder } from "./files-under.mjs";

/**
 * A production substrate module without another production substrate importer is a feature
 * candidate, unless its exact path documents a shared primitive or a composition-root entry.
 * Rule 8 of check-architecture.mjs, issue #2753; type edges hold the boundary too.
 */
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(?:test|spec|test-support)\.[cm]?[jt]sx?$/;
const substrate = (file) => /^src\/(?:lib|db)\//.test(file);
const production = (file) =>
  !TEST.test(file) && !file.startsWith("src/test/") && !file.startsWith("src/app/api/test/");

/** Resolve against the on-disk source set: aliases, relative paths, explicit extensions, indexes. */
function resolved(importer, specifier, files, resolveSpecifier) {
  const base = resolveSpecifier(importer, specifier)?.replaceAll(path.sep, "/");
  if (!base) return null;
  return (
    [
      base,
      ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].map((ext) => base + ext),
      ...[".ts", ".tsx", ".js", ".mjs"].map((ext) => `${base}/index${ext}`),
    ].find((candidate) => files.has(candidate)) ?? null
  );
}

/**
 * Exact-path exemptions carry a reviewable reason. No new UI import automatically exempts a
 * leaf: that would let a route turn any use case into a primitive without an ownership decision.
 */
export async function collectSubstrateLeaves(
  root,
  { importsOf, resolveSpecifier },
  primitives = {},
) {
  const files = new Set(
    (
      await filesUnder(
        "src",
        (dir) => readdir(path.join(root, dir), { withFileTypes: true }),
        (file) => SOURCE.test(file),
      )
    ).map((file) => file.replaceAll(path.sep, "/")),
  );
  const modules = [...files].filter((file) => substrate(file) && production(file));
  const violations = new Map();
  for (const [file, reason] of Object.entries(primitives)) {
    if (
      !files.has(file) ||
      !substrate(file) ||
      !production(file) ||
      typeof reason !== "string" ||
      reason.trim().length < 20
    ) {
      violations.set(file, [
        `${file}: primitive registry entry must name an existing production substrate file and explain its shared responsibility`,
      ]);
    }
  }
  const incoming = new Map(modules.map((file) => [file, new Set()]));
  for (const importer of modules) {
    const source = await readFile(path.join(root, importer), "utf8");
    for (const { specifier } of importsOf(source)) {
      const target = resolved(importer, specifier, files, resolveSpecifier);
      if (target !== importer && incoming.has(target)) incoming.get(target).add(importer);
    }
  }
  for (const [file, importers] of incoming) {
    if (file.startsWith("src/db/schema/") || primitives[file] || importers.size > 0) continue;
    violations.set(file, [
      `${file}: no production substrate importer — move the use case into src/features/<concept> with its twin and tests, or document the shared primitive in scripts/substrate-primitives.json`,
    ]);
  }
  return violations;
}
