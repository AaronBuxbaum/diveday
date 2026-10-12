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
    functions.push({ name, exported, params, body: text, line: start.index + 1 });
  });
  return functions;
}

/**
 * The exported, slug-taking actions of one module that reach
 * `requireStaffSession`, directly or through the module's own functions.
 */
export function findSlugActionsOnStaffSession(source) {
  if (!isServerModule(source)) return [];
  const functions = topLevelFunctions(source);
  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  const memo = new Map();
  const reaches = (fn, seen = new Set()) => {
    if (memo.has(fn.name)) return memo.get(fn.name);
    if (seen.has(fn.name)) return false;
    seen.add(fn.name);
    let result = GATE.test(fn.body);
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
  return functions
    .filter((fn) => fn.exported && /\bshopSlug\b/.test(fn.params) && reaches(fn))
    .map((fn) => ({ line: fn.line, name: fn.name }));
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

async function main() {
  const violations = [];
  let modules = 0;
  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      if (IS_TEST.test(file)) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      if (!isServerModule(source)) continue;
      modules++;
      for (const finding of findSlugActionsOnStaffSession(source)) {
        violations.push(`${file}:${finding.line}: ${finding.name}`);
      }
    }
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
    process.exit(1);
  }
  console.log(
    `slug-actions: ${modules} "use server" modules; no slug-taking action gates on requireStaffSession`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
