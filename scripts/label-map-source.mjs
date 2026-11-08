import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** The physical owners of closed label maps: legacy copy modules and feature contracts. */
export function labelModuleName(file) {
  const source = file.split(path.sep).join("/");
  if (/^src\/i18n\/[^/]+\.ts$/.test(source) && !/\.(?:test|d)\.ts$/.test(source)) {
    return source.slice("src/i18n/".length);
  }
  return /^src\/features\/[^/]+\/labels\.ts$/.test(source)
    ? `../${source.slice("src/".length)}`
    : null;
}

/** Discover every owner, including an unregistered future feature; never load its runtime. */
export async function labelModuleSources(root) {
  const files = (await readdir(path.join(root, "src/i18n"))).map((file) => `src/i18n/${file}`);
  const features = await readdir(path.join(root, "src/features"), { withFileTypes: true });
  files.push(
    ...features
      .filter((entry) => entry.isDirectory())
      .map((entry) => `src/features/${entry.name}/labels.ts`),
  );
  const modules = [];
  for (const file of files.sort()) {
    const module = labelModuleName(file);
    if (!module) continue;
    try {
      modules.push([module, await readFile(path.join(root, file), "utf8")]);
    } catch (error) {
      if (!file.startsWith("src/features/") || error.code !== "ENOENT") throw error;
    }
  }
  return modules;
}
/**
 * Every `const NAME: Record<…>` whose type arguments name a message key.
 *
 * The type arguments are read by balancing angle brackets rather than by
 * matching up to the first `>`: `Record<Exclude<ThreadStepState, "done">,
 * DiverMessageKey>` closes its first `>` inside the key type, and a scan that
 * stopped there would miss the map and report the directory clean.
 */
export function messageKeyMaps(source) {
  const found = [];
  for (const match of source.matchAll(/\bconst\s+([A-Za-z0-9_]+)\s*:\s*Record</g)) {
    const name = match[1];
    let depth = 0;
    let end = source.indexOf("<", match.index);
    for (let index = end; index < source.length; index += 1) {
      if (source[index] === "<") depth += 1;
      else if (source[index] === ">") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (source.slice(match.index, end).includes("MessageKey")) found.push(name);
  }
  return found;
}
