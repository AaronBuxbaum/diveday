// Which modules a diff's changed lines can change, followed through imports name by name
// rather than file by file.
//
// A file-level import graph says a change to `src/db/incident-reports.ts` reaches 179 of 190
// routes, because `seed.ts` imports one function from it and every public page imports the
// demo action that imports the seed. The edit touched none of the functions `seed.ts` reads.
// Followed by name, the edit reaches the incident pages only.
//
// Each module is read as a list of top-level items (an import, a declaration, an export list,
// a statement). A changed line taints the item it sits in; a tainted import binding or
// declaration taints every declaration whose text names it, to a fixpoint; an exported tainted
// declaration taints that export for the modules importing it. A changed line or a tainted
// name in a module-level statement taints the whole module, and so does anything this cannot
// read (a namespace import used as a value, a dynamic or side-effect import of a touched
// module). Over-reading costs a capture or a spec; under-reading is the bug, so every unknown
// falls toward "the whole module".
//
// Used by `visual-affected.mjs` (which captures a diff can move); the parse is regex over the
// Biome-formatted tree, where a top-level item starts at column 0.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_EXT = /\.(?:ts|tsx|mts|mjs|js|jsx)$/;
const TEST_FILE = /\.test\.(?:ts|tsx|mjs)$/;
const ALL = "all";
const IDENT = /[A-Za-z_$][\w$]*/g;
const COMMENT = /\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/[^\n]*/g;
/** A changed line that cannot change behavior: blank or a comment. */
const INERT_LINE = /^\s*(?:$|\/\/|\/\*|\*)/;
/** A line that starts a new top-level item; closers and continuations do not. */
const ITEM_START = /^[A-Za-z@"'[{(]/;

/** `src/` modules by repository path, tests left out. */
export function readModules(root) {
  const modules = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (SOURCE_EXT.test(rel) && !TEST_FILE.test(rel)) {
        modules.set(rel, readFileSync(path.join(root, rel), "utf8"));
      }
    }
  };
  walk("src");
  return modules;
}

function resolver(modules) {
  return (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
    else return null;
    for (const candidate of [
      base,
      ...[".ts", ".tsx", ".js", ".mjs"].map((ext) => base + ext),
      ...["/index.ts", "/index.tsx"].map((ext) => base + ext),
    ]) {
      if (modules.has(candidate)) return candidate;
    }
    return null;
  };
}

/** `a, type b, c as d` → [{ imported, local }]. */
function specifiers(list) {
  return list
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, ""))
    .map((part) => part.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/))
    .filter(Boolean)
    .map((match) => ({ imported: match[1], local: match[2] ?? match[1] }));
}

/**
 * One module as top-level items, each with its lines (1-based, inclusive), the identifiers its
 * text names, and what it declares, imports or exports.
 */
export function parseModule(file, source, resolve) {
  const lines = source.split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) if (ITEM_START.test(lines[i])) starts.push(i);
  const items = starts.map((start, n) => {
    const end = (starts[n + 1] ?? lines.length) - 1;
    const text = lines.slice(start, end + 1).join("\n");
    // Names from code only: a docblock that mentions a function does not call it.
    const code = text.replace(COMMENT, "");
    return { start: start + 1, end: end + 1, text, names: new Set(code.match(IDENT) ?? []) };
  });
  const parsed = {
    file,
    items: [],
    imports: [],
    wholeImports: [],
    dynamicImports: [],
    reexports: [],
    stars: [],
  };
  for (const item of items) {
    const { text } = item;
    const head = text.replace(COMMENT, "").trimStart();
    item.locals = [];
    item.exports = [];
    let match = head.match(/^import\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/);
    if (match) {
      // A package or a JSON file resolves to no module, but its bindings still count: a
      // changed import line taints them.
      const target = resolve(file, match[3]);
      item.kind = "import";
      const clause = match[2];
      const def = clause.match(/^([\w$]+)\s*(?:,|$)/);
      if (def) item.locals.push({ local: def[1], target, imported: "default" });
      const ns = clause.match(/\*\s+as\s+([\w$]+)/);
      if (ns) item.locals.push({ local: ns[1], target, imported: "*" });
      const named = clause.match(/\{([^}]*)\}/);
      if (named) {
        for (const { imported, local } of specifiers(named[1])) {
          item.locals.push({ local, target, imported });
        }
      }
      parsed.imports.push(...item.locals.filter((binding) => binding.target));
      parsed.items.push(item);
      continue;
    }
    match = head.match(/^import\s*["']([^"']+)["']/);
    if (match) {
      const target = resolve(file, match[1]);
      if (target) parsed.wholeImports.push(target);
      item.kind = "import";
      parsed.items.push(item);
      continue;
    }
    match = head.match(/^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/);
    if (match) {
      const target = resolve(file, match[2]);
      item.kind = "reexport";
      item.reexported = specifiers(match[1]).map(({ local }) => local);
      if (target) {
        for (const { imported, local } of specifiers(match[1])) {
          parsed.reexports.push({ exported: local, target, imported });
        }
      }
      parsed.items.push(item);
      continue;
    }
    match = head.match(/^export\s+\*\s+(?:as\s+([\w$]+)\s+)?from\s*["']([^"']+)["']/);
    if (match) {
      const target = resolve(file, match[2]);
      item.kind = "reexport";
      item.reexported = match[1] ? [match[1]] : ALL;
      if (target && match[1]) parsed.reexports.push({ exported: match[1], target, imported: "*" });
      else if (target) parsed.stars.push(target);
      parsed.items.push(item);
      continue;
    }
    match = head.match(/^export\s+(?:type\s+)?\{([^}]*)\}/);
    if (match) {
      item.kind = "exportList";
      item.aliases = specifiers(match[1]);
      parsed.items.push(item);
      continue;
    }
    match = head.match(
      /^(export\s+)?(default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+(?:([\w$]+)|\{([^}]*)\}|\[([^\]]*)\])/,
    );
    if (match) {
      item.kind = "declaration";
      const declared = match[3]
        ? [match[3]]
        : (match[4] ?? match[5] ?? "")
            .split(",")
            .map((part) =>
              part
                .trim()
                .replace(/^\.\.\./, "")
                .split(/\s*[:=]\s*/)
                .pop(),
            )
            .filter((name) => /^[\w$]+$/.test(name ?? ""));
      item.locals.push(...declared.map((local) => ({ local })));
      if (match[1]) item.exports.push(...(match[2] ? ["default"] : declared));
      parsed.items.push(item);
      continue;
    }
    if (/^export\s+default\b/.test(head)) {
      item.kind = "declaration";
      item.exports.push("default");
      parsed.items.push(item);
      continue;
    }
    // A directive ("use client") changes how the whole module runs; any other statement runs
    // at load. Both read as the module itself.
    item.kind = "statement";
    parsed.items.push(item);
  }
  // A dynamic import reads a whole module into the item that runs it.
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const target = resolve(file, match[1]);
    const line = source.slice(0, match.index).split("\n").length;
    const item = parsed.items.find((it) => line >= it.start && line <= it.end);
    if (target && item) parsed.dynamicImports.push({ target, item });
    else if (target) parsed.wholeImports.push(target);
  }
  return parsed;
}

/** Every module parsed, keyed by path, with the reverse edges the walk follows. */
export function moduleIndex(modules) {
  const resolve = resolver(modules);
  const index = new Map();
  for (const [file, source] of modules) index.set(file, parseModule(file, source, resolve));
  const importers = new Map();
  const link = (from, to) => {
    if (!importers.has(to)) importers.set(to, new Set());
    importers.get(to).add(from);
  };
  for (const [file, parsed] of index) {
    for (const { target } of parsed.imports) link(file, target);
    for (const target of parsed.wholeImports) link(file, target);
    for (const { target } of parsed.dynamicImports) link(file, target);
    for (const { target } of parsed.reexports) link(file, target);
    for (const target of parsed.stars) link(file, target);
  }
  return { index, importers, resolve };
}

/** `diff -U0` text as the new-side lines it changes, per file; a deletion marks both neighbours. */
export function changedLinesByFile(diffText) {
  const files = new Map();
  let current = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).replace(/^b\//, "");
      current = target === "/dev/null" ? null : target;
      if (current && !files.has(current)) files.set(current, new Set());
      continue;
    }
    const hunk = current && line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const set = files.get(current);
    if (count === 0) {
      set.add(start);
      set.add(start + 1);
    }
    for (let at = start; at < start + count; at += 1) set.add(at);
  }
  return files;
}

/**
 * The modules `seeds` can change. `seeds` maps a module to the lines that changed in it, or to
 * `"all"`. Returns a map from every touched module to its touched exports (a Set of names, or
 * `"all"`); a module present with an empty Set changed inside but exports nothing touched (a
 * page whose body changed still renders differently, so callers read presence, not exports).
 */
export function symbolReach({ index, importers, resolve }, seeds, { before } = {}) {
  const touched = new Map();
  const initial = new Map();
  const initialLocals = new Map();
  const initialExports = new Map();
  const queue = [];
  for (const [file, lines] of seeds) {
    const parsed = index.get(file);
    if (!parsed) continue;
    if (lines === ALL) {
      initial.set(file, ALL);
      queue.push(file);
      continue;
    }
    const items = new Set();
    const locals = new Set();
    let exported = new Set();
    // An import's bindings are compared with the fork point's: a binding that is new or now
    // comes from elsewhere is changed; one only rewrapped is not; a removed one leaves its
    // readers edited too.
    const prior = before?.(file);
    const priorKeys =
      typeof prior === "string" && resolve
        ? new Set(
            parseModule(file, prior, resolve).items.flatMap((item) =>
              item.locals
                .filter((binding) => "imported" in binding)
                .map(({ local, target, imported }) => `${local}|${target}|${imported}`),
            ),
          )
        : null;
    for (const line of lines) {
      const item = parsed.items.find((it) => line >= it.start && line <= it.end);
      if (!item) continue;
      const text = item.text.split("\n")[line - item.start] ?? "";
      if (INERT_LINE.test(text)) continue;
      if (item.kind === "import") {
        for (const { local, target, imported } of item.locals) {
          if (!priorKeys?.has(`${local}|${target}|${imported}`)) locals.add(local);
        }
      } else if (item.kind === "reexport") {
        if (item.reexported === ALL) exported = ALL;
        else if (exported !== ALL) for (const name of item.reexported) exported.add(name);
      } else if (item.kind === "exportList") {
        if (exported !== ALL) for (const { local } of item.aliases) exported.add(local);
      } else {
        items.add(item);
      }
    }
    if (items.size === 0 && locals.size === 0 && exported !== ALL && exported.size === 0) continue;
    initial.set(file, items);
    initialLocals.set(file, locals);
    initialExports.set(file, exported);
    queue.push(file);
  }
  const exportsOf = (file) => touched.get(file)?.exports;
  const reads = (target, imported) => {
    const exports = exportsOf(target);
    if (!exports) return false;
    if (exports === ALL || imported === "*") return exports === ALL || exports.size > 0;
    return exports.has(imported);
  };
  const queued = new Set(queue);
  while (queue.length > 0) {
    const file = queue.shift();
    queued.delete(file);
    const parsed = index.get(file);
    let whole = initial.get(file) === ALL;
    const tainted = new Set(initialLocals.get(file) ?? []);
    const taintedItems = new Set(initial.get(file) instanceof Set ? initial.get(file) : []);
    for (const target of parsed.wholeImports) if (exportsOf(target)) whole = true;
    for (const { target, item } of parsed.dynamicImports) {
      if (exportsOf(target)) taintedItems.add(item);
    }
    for (const { local, target, imported } of parsed.imports) {
      if (reads(target, imported)) tainted.add(local);
    }
    for (const item of taintedItems) {
      if (item.kind === "statement") whole = true;
      for (const { local } of item.locals) tainted.add(local);
    }
    // To a fixpoint: a declaration naming a tainted name is tainted.
    let grew = true;
    while (grew && !whole) {
      grew = false;
      for (const item of parsed.items) {
        if (taintedItems.has(item) || item.kind === "import" || item.kind === "reexport") continue;
        if (![...tainted].some((name) => item.names.has(name))) continue;
        if (item.kind === "statement") {
          whole = true;
          break;
        }
        taintedItems.add(item);
        for (const { local } of item.locals) tainted.add(local);
        grew = true;
      }
    }
    let exports;
    if (whole || initialExports.get(file) === ALL) {
      exports = ALL;
    } else {
      exports = new Set(initialExports.get(file) ?? []);
      for (const item of taintedItems) for (const name of item.exports) exports.add(name);
      for (const item of parsed.items) {
        if (item.kind !== "exportList") continue;
        for (const { imported, local } of item.aliases) {
          if (tainted.has(imported)) exports.add(local);
        }
      }
      for (const { exported, target, imported } of parsed.reexports) {
        if (reads(target, imported)) exports.add(exported);
      }
      for (const target of parsed.stars) {
        const theirs = exportsOf(target);
        if (theirs === ALL) exports = ALL;
        else if (theirs && exports !== ALL) for (const name of theirs) exports.add(name);
        if (exports === ALL) break;
      }
    }
    // Read by an importer that names nothing touched: not reached.
    if (exports !== ALL && taintedItems.size === 0 && exports.size === 0) continue;
    // Monotone: a dependency's touched exports only grow, so a module's only grow.
    const prior = exportsOf(file);
    const grown =
      !touched.has(file) ||
      (prior !== ALL && (exports === ALL || [...exports].some((name) => !prior.has(name))));
    if (!grown) continue;
    touched.set(file, { exports });
    for (const importer of importers.get(file) ?? []) {
      if (!queued.has(importer)) {
        queued.add(importer);
        queue.push(importer);
      }
    }
  }
  return new Map([...touched].map(([file, { exports }]) => [file, exports]));
}
