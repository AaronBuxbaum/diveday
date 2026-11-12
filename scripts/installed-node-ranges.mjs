import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { validRange } from "semver";

/** Engines from this checkout's reachable installed graph, independent of pnpm's store layout. */
export function installedNodeRanges(root) {
  const ranges = new Map();
  const packages = new Set();
  const moduleDirectories = new Set();
  const optionalRealpath = (directory) => {
    try {
      return realpathSync(directory);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
      throw error;
    }
  };
  const visitPackage = (directory) => {
    const resolved = optionalRealpath(directory);
    if (!resolved || packages.has(resolved)) return;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(resolved, "package.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
      throw error;
    }
    packages.add(resolved);
    const range = manifest.engines?.node;
    if (typeof range === "string" && validRange(range)) {
      ranges.set(`${manifest.name}@${manifest.version}`, range);
    }
    visitModules(path.join(resolved, "node_modules"));
    // pnpm puts dependencies and peers beside the real package in its own
    // graph's node_modules. Follow only that graph, never the shared store.
    let parent = path.dirname(resolved);
    while (parent !== path.dirname(parent)) {
      if (path.basename(parent) === "node_modules") {
        visitModules(parent);
        break;
      }
      parent = path.dirname(parent);
    }
  };
  const visitModules = (directory) => {
    const resolved = optionalRealpath(directory);
    if (!resolved || moduleDirectories.has(resolved)) return;
    moduleDirectories.add(resolved);
    for (const entry of readdirSync(resolved, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(resolved, entry.name);
      if (entry.name.startsWith("@")) {
        const scope = optionalRealpath(candidate);
        if (!scope) continue;
        for (const scoped of readdirSync(scope)) visitPackage(path.join(scope, scoped));
      } else {
        visitPackage(candidate);
      }
    }
  };
  visitModules(path.join(root, "node_modules"));
  if (packages.size === 0) throw new Error(`No installed packages found under ${root}`);
  return ranges;
}
