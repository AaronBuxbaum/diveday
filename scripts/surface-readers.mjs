import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Data origins retain the table-module rule after their directory changes. */
export function isDataModule(file, source, { importsOf, resolveSpecifier }) {
  if (file.startsWith("src/db/") || /(?:^|[./-])store\.tsx?$/.test(file)) return true;
  return importsOf(source).some((edge) => {
    if (edge.typeOnly) return false;
    const target = resolveSpecifier(file, edge.specifier)?.replaceAll(path.sep, "/");
    return target?.startsWith("src/db/") || /^drizzle-orm(?:\/|$)/.test(edge.specifier);
  });
}

/** Staff pages read one surface; a named feature export may originate in a store or pure rules. */
export async function surfaceReaders(root, page, { importsOf, resolveSpecifier }) {
  const sources = new Map();
  const read = async (file) => {
    if (!sources.has(file)) sources.set(file, await readFile(path.join(root, file), "utf8"));
    return sources.get(file);
  };
  const resolve = async (importer, specifier) => {
    const base = resolveSpecifier(importer, specifier);
    if (!base) return null;
    for (const file of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      try {
        if ((await stat(path.join(root, file))).isFile()) return file.replaceAll(path.sep, "/");
      } catch {}
    }
    return null;
  };
  const isLoader = async (file, symbol, seen = new Set()) => {
    const key = `${file}#${symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    // The one-reader contract is explicitly "requireShopSurface plus one surface reader".
    // It is a session gate, and moving its lib origin must not count it as a second page read.
    if (file === "src/features/session/rules.ts" && symbol === "requireShopSurface") return false;
    const source = await read(file);
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ownValue =
      symbol === "*" ||
      (symbol === "default"
        ? /\bexport\s+default\b/.test(source)
        : new RegExp(
            `\\bexport\\s+(?:async\\s+)?(?:function|const|let|var|class|enum)\\s+${escaped}\\b`,
          ).test(source));
    if (ownValue && isDataModule(file, source, { importsOf, resolveSpecifier })) return true;
    for (const match of source.matchAll(
      /^\s*export\s+(type\s+)?\{([^}]+)\}\s+from\s*["']([^"']+)["']/gm,
    )) {
      if (match[1]) continue;
      for (const item of match[2].split(",")) {
        const binding = item.trim();
        if (!binding || /^type\s/.test(binding)) continue;
        const [local, exported = local] = binding.split(/\s+as\s+/);
        if (symbol !== "*" && exported !== symbol) continue;
        const target = await resolve(file, match[3]);
        if (target && (await isLoader(target, local, new Set(seen)))) return true;
      }
    }
    for (const match of source.matchAll(/^\s*export\s*\*\s*from\s*["']([^"']+)["']/gm)) {
      const target = await resolve(file, match[1]);
      if (target && (await isLoader(target, symbol, new Set(seen)))) return true;
    }
    return false;
  };
  const readers = new Set();
  const source = await read(page);
  for (const { specifier, typeOnly } of importsOf(source)) {
    const target = resolveSpecifier(page, specifier)?.replaceAll(path.sep, "/");
    if (!typeOnly && target?.startsWith("src/db/")) readers.add(`@/${target.slice(4)}`);
  }
  for (const match of source.matchAll(
    /^\s*import\s+((?:(?!;)[\s\S])*?)\s+from\s*["']([^"']+)["'];?/gm,
  )) {
    const clause = match[1].trim();
    if (/^type\s/.test(clause)) continue;
    const target = await resolve(page, match[2]);
    if (!target?.startsWith("src/features/")) continue;
    const names = [];
    if (/^[\w$]+(?:\s*,|$)/.test(clause)) names.push("default");
    if (/\*\s+as\s/.test(clause)) names.push("*");
    const named = clause.match(/\{([^}]+)\}/)?.[1];
    if (named)
      for (const item of named.split(",")) {
        const binding = item.trim();
        if (binding && !/^type\s/.test(binding)) names.push(binding.split(/\s+as\s+/)[0]);
      }
    for (const name of names)
      if (await isLoader(target, name)) {
        readers.add(`@/features/${target.split("/")[2]}`);
        break;
      }
  }
  return readers;
}
