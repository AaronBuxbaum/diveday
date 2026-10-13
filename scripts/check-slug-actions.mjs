import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * A server action that is handed a shop slug must check the slug is the
 * caller's shop.
 *
 * A `"use server"` export is an endpoint: its arguments are whatever the
 * browser posts, including a `shopSlug` bound into a form with `.bind`. The
 * writes behind it are scoped by `session.user.shopId`, so a foreign slug never
 * reaches another tenant's rows, but the slug steers everything else: the
 * `revalidatePath` calls (another shop's board, Today, its public course page)
 * and the redirect that carries a notice. `requireStaffSession()` says only
 * "this is somebody's live staff"; `requireShopSurface(shopSlug)`
 * (`src/lib/session.ts`) also refuses, with a 404, a slug that is not theirs.
 * #2367 fixed the diver record; the 2026-10-11 review found the same shape in
 * fifteen more actions across five files.
 *
 * ## The rule
 *
 * In a module whose first statement is `"use server"`, an **exported** function
 * whose parameter list names `shopSlug` may not reach `requireStaffSession(` —
 * in its own body, or through a function of the same module it calls (a
 * `requireBoardAuthor(shopSlug)` helper is the usual way). Exported actions that
 * take no slug build their paths from `session.user.shopSlug` and may keep
 * `requireStaffSession`.
 *
 * And the positive half (2026-10-13 review): a slug-taking export in a module
 * under `src/app/shop/`, or one that calls `auth(` itself, must **reach**
 * `requireShopSurface(` — directly, through a function of the same module, or
 * through a helper it imports from a module of this repository where that
 * helper reaches it (the diver record's `requireDiverActionContext`).
 * `requireStaffSession(` and `auth(` are resolved across modules the same
 * way, so a wrapper imported from another file counts as if written here. Without
 * this half an action that compared the slug by hand, called `auth()`, or
 * checked nothing passed. A public action under `src/app/s/` checks no session
 * and is outside the rule; an action that reads the session before there is a
 * shop to be inside (the demo role switch) says
 * `diveday:slug-action-before-sign-in: <why>`.
 *
 * The reading is textual, top-level declarations only: a `function` or a
 * `const name = (async) (…) =>` starting at column zero, running to the next
 * statement at column zero. Comments and string contents are blanked first, so
 * a doc comment naming the gate is not a call.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IS_TEST = /\.test\.tsx?$/;
const GATE = /\brequireStaffSession\s*\(/;
/** The call that proves the slug is the session's shop. */
const SURFACE = /\brequireShopSurface\s*\(/;
/** Signing in by hand: a staff action that skipped both gates. */
const AUTH = /\bauth\s*\(/;
/**
 * Said inside an action that reads the session but is not yet inside a shop
 * (the demo role switch, which is how a visitor gets one).
 */
const OUTSIDE_A_SHOP = /diveday:slug-action-before-sign-in:/;
/** Every action in a module here is a staff action. */
const STAFF_ROOT = path.normalize("src/app/shop/");

/**
 * The source with every comment and every string or template body replaced by
 * spaces (newlines kept), so line numbers survive and only code is matched.
 */
export function blankCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const blank = (text) => text.replace(/[^\n]/g, " ");
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") j++;
        j++;
      }
      out += ch + blank(source.slice(i + 1, j)) + (j < source.length ? ch : "");
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** True when the module's first statement is the `"use server"` directive. */
export function isServerModule(source) {
  return /^\s*(["'])use server\1/.test(source.replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/))*/, ""));
}

const DECLARATION =
  /^(export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^(]*>)?\s*\(|^(export\s+)?const\s+(\w+)\s*(?::[^=]*)?=\s*(?:async\s*)?\(/;

/** The text from the `(` at `open` to its matching `)`. */
function parenthesized(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

/** Every top-level function of a module: name, exported, parameters, body, line. */
export function topLevelFunctions(source) {
  const code = blankCommentsAndStrings(source);
  const lines = code.split("\n");
  const starts = [];
  let offset = 0;
  lines.forEach((line, index) => {
    // A statement at column zero ends the declaration before it; a closing
    // brace or paren at column zero is still inside one.
    if (/^[A-Za-z_$@]/.test(line)) starts.push({ index, offset, line });
    offset += line.length + 1;
  });
  const functions = [];
  starts.forEach((start, position) => {
    const match = DECLARATION.exec(start.line);
    if (!match) return;
    const name = match[2] ?? match[4];
    const exported = Boolean(match[1] ?? match[3]);
    const end = starts[position + 1]?.offset ?? code.length;
    const text = code.slice(start.offset, end);
    const params = parenthesized(text, match[0].length - 1);
    const raw = source.slice(start.offset, end);
    functions.push({ name, exported, params, body: text, raw, line: start.index + 1 });
  });
  return functions;
}

/**
 * The exported, slug-taking actions of one module that reach
 * `requireStaffSession`, directly or through the module's own functions.
 */
/**
 * Whether a function of the module calls `pattern`, in its own body or
 * through another function of the same module it calls.
 */
function reachesThrough(byName, pattern) {
  const memo = new Map();
  const reaches = (fn, seen = new Set()) => {
    if (memo.has(fn.name)) return memo.get(fn.name);
    if (seen.has(fn.name)) return false;
    seen.add(fn.name);
    let result = pattern.test(fn.body);
    if (!result) {
      for (const other of byName.values()) {
        if (other.name === fn.name) continue;
        if (new RegExp(`\\b${other.name}\\s*\\(`).test(fn.body) && reaches(other, seen)) {
          result = true;
          break;
        }
      }
    }
    memo.set(fn.name, result);
    return result;
  };
  return reaches;
}

export function findSlugActionsOnStaffSession(source, options = {}) {
  if (!isServerModule(source)) return [];
  const {
    staffModule = false,
    importedGates = [],
    importedStaffGates = [],
    importedSignIns = [],
  } = options;
  const functions = topLevelFunctions(source);
  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  const reaches = reachesThrough(byName, callPattern(GATE, importedStaffGates));
  const slugMemo = new Map();
  const takesSlug = (fn, seen = new Set()) => {
    if (slugMemo.has(fn.name)) return slugMemo.get(fn.name);
    if (seen.has(fn.name)) return false;
    seen.add(fn.name);
    let result = /\bshopSlug\b/.test(fn.params);
    const names = parameterNames(fn.params);
    if (!result) {
      result = names.some((name) =>
        new RegExp(`\\b${name}\\s*\\??\\.\\s*shopSlug\\b`).test(fn.body),
      );
    }
    if (!result) {
      // A parameter handed whole to a function of this module that itself
      // takes a slug: `manifestPath(ctx)` reading `{ shopSlug }` off it.
      for (const other of byName.values()) {
        if (other.name === fn.name) continue;
        const calls = fn.body.matchAll(new RegExp(`\\b${other.name}\\s*\\(([^)]*)\\)`, "g"));
        const passesParam = [...calls].some((call) =>
          names.some((name) => new RegExp(`\\b${name}\\b`).test(call[1])),
        );
        if (passesParam && takesSlug(other, seen)) {
          result = true;
          break;
        }
      }
    }
    slugMemo.set(fn.name, result);
    return result;
  };
  const surfaces = reachesThrough(byName, callPattern(SURFACE, importedGates));
  const signsIn = reachesThrough(byName, callPattern(AUTH, importedSignIns));
  return functions
    .filter((fn) => fn.exported && takesSlug(fn))
    .flatMap((fn) => {
      if (reaches(fn)) return [{ line: fn.line, name: fn.name, problem: "staff-session" }];
      const staff = staffModule || signsIn(fn);
      if (staff && !surfaces(fn) && !OUTSIDE_A_SHOP.test(fn.raw))
        return [{ line: fn.line, name: fn.name, problem: "no-surface" }];
      return [];
    });
}

/**
 * `pattern` (a call), or a call to any of `imported`: helpers imported from a
 * module where they reach that call. Each of the three calls the rule reads
 * (`requireShopSurface(`, `requireStaffSession(`, `auth(`) is resolved across
 * modules the same way, so a wrapper in another file hides none of them.
 */
function callPattern(pattern, imported) {
  if (imported.length === 0) return pattern;
  return new RegExp(`${pattern.source}|\\b(?:${imported.join("|")})\\s*\\(`);
}

/**
 * The names a module imports from another module of this repository (`./x`,
 * `../x`, `@/x`), with the import's specifier.
 */
export function repositoryImports(source) {
  const imports = [];
  const pattern = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']((?:\.{1,2}\/|@\/)[^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const named = /^\s*(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (named) imports.push({ name: named[1], local: named[2] ?? named[1], from: match[2] });
    }
  }
  return imports;
}

/** Whether `name`, a top-level function of `source`, reaches a call matching `pattern`. */
export function exportReaches(source, name, pattern) {
  const byName = new Map(topLevelFunctions(source).map((fn) => [fn.name, fn]));
  const fn = byName.get(name);
  return fn ? reachesThrough(byName, pattern)(fn) : false;
}

/** Whether `name`, a top-level function of `source`, reaches `requireShopSurface(`. */
export function exportReachesSurface(source, name) {
  return exportReaches(source, name, SURFACE);
}

/**
 * The plain identifiers a parameter list names (`ctx`, `formData`); a
 * destructured parameter is left to the `shopSlug` text test above.
 */
function parameterNames(params) {
  const names = [];
  let depth = 0;
  let segment = "";
  for (const char of params.replace(/^\(|\)$/g, "")) {
    if ("{[(<".includes(char)) depth++;
    if ("}])>".includes(char)) depth--;
    if (char === "," && depth === 0) {
      names.push(segment);
      segment = "";
    } else segment += char;
  }
  names.push(segment);
  return names
    .map((part) => /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(part)?.[1])
    .filter((name) => name !== undefined);
}

async function walk(relativeDirectory) {
  const entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

/** Resolve `./x`, `../x` or `@/x` from `file` to a source file, or null. */
async function resolveImport(file, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join("src", specifier.slice(2))
    : path.join(path.dirname(file), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try {
      return { file: candidate, source: await readFile(path.join(ROOT, candidate), "utf8") };
    } catch {}
  }
  return null;
}

/**
 * The imported helpers of `file`, sorted by which of the three calls each
 * reaches in its own module: `requireShopSurface(` (`importedGates`),
 * `requireStaffSession(` (`importedStaffGates`) and `auth(` (`importedSignIns`).
 * `@/lib/session` itself is skipped: it is where the gates are defined, and its
 * exports are matched by name.
 */
async function importedCalls(file, source) {
  const found = { importedGates: [], importedStaffGates: [], importedSignIns: [] };
  for (const imported of repositoryImports(source)) {
    if (imported.from === "@/lib/session") continue;
    const target = await resolveImport(file, imported.from);
    if (!target) continue;
    if (exportReaches(target.source, imported.name, SURFACE))
      found.importedGates.push(imported.local);
    if (exportReaches(target.source, imported.name, GATE))
      found.importedStaffGates.push(imported.local);
    if (exportReaches(target.source, imported.name, AUTH))
      found.importedSignIns.push(imported.local);
  }
  return found;
}

async function main() {
  const violations = [];
  const unproven = [];
  let modules = 0;
  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      if (IS_TEST.test(file)) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      if (!isServerModule(source)) continue;
      modules++;
      const options = {
        staffModule: path.normalize(file).startsWith(STAFF_ROOT),
        ...(await importedCalls(file, source)),
      };
      for (const finding of findSlugActionsOnStaffSession(source, options)) {
        (finding.problem === "staff-session" ? violations : unproven).push(
          `${file}:${finding.line}: ${finding.name}`,
        );
      }
    }
  }
  if (unproven.length > 0) {
    console.error(
      `Staff server actions that take a shopSlug and never reach requireShopSurface:\n${unproven
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Open the action with `requireShopSurface(shopSlug)` (src/lib/session.ts), or call a helper (in this module or imported) that does. Checking the slug against session.user.shopSlug by hand, calling auth() directly, or checking nothing, all leave the slug steering another shop's revalidation and redirect.",
    );
  }
  if (violations.length > 0) {
    console.error(
      `Server actions that take a shopSlug but gate on requireStaffSession:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Open the action with `requireShopSurface(shopSlug)` (src/lib/session.ts), which is a 404 for a slug that is not the session's shop, or drop the slug and build paths from `session.user.shopSlug`. Writes scoped by session.user.shopId are not enough: the slug still steers the revalidation and the redirect.",
    );
  }
  if (violations.length > 0 || unproven.length > 0) process.exit(1);
  console.log(
    `slug-actions: ${modules} "use server" modules; every slug-taking staff action reaches requireShopSurface`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
