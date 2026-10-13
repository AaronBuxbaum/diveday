import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * **No route evaluates the Sentry SDK at import** (code review 2026-10-13,
 * item 28).
 *
 * Fifteen cron routes and two webhooks once opened with
 * `import * as Sentry from "@sentry/nextjs"`, so every cold start parsed the
 * SDK and its 1.2 MB server chunk before the route had checked its bearer
 * token, and in a build with no DSN at all. A route reports through
 * `src/lib/observability/sentry.ts`, which imports the SDK on first use and
 * only when a DSN is configured; a Client Component that must report (the root
 * `global-error.tsx`) imports it dynamically, inside the handler.
 *
 * Refused under `src/app`: any static import of `@sentry/nextjs` that brings in
 * a value — a namespace (`import * as Sentry`), a default, or named bindings.
 * Left alone: `import type`, a type-only binding list, a dynamic `import()`,
 * and test files, which mock the SDK to assert what a route reported.
 */
const ROOT = process.cwd();
const SCANNED = "src/app";
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const STATIC_IMPORT = /^\s*import\s+([^;]*?)\s+from\s+["']@sentry\/nextjs["']/gm;

/** True when an import clause binds a value, not only types. */
function bindsAValue(clause) {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return false;
  const braces = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braces) return true;
  const names = braces[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length === 0 || names.some((name) => !/^type\s/.test(name));
}

async function walk(relative) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relative), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) files.push(child);
  }
  return files;
}

const violations = [];
for (const file of await walk(SCANNED)) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  for (const match of text.matchAll(STATIC_IMPORT)) {
    if (!bindsAValue(match[1])) continue;
    const line = text.slice(0, match.index).split("\n").length;
    violations.push(`${file}:${line}: ${match[0].trim()}`);
  }
}

if (violations.length > 0) {
  console.error(
    `sentry-imports: ${violations.length} static import(s) of the Sentry SDK under ${SCANNED}. Report through \`sentry\` from "@/lib/observability/sentry" (loaded on first use), or import the SDK dynamically inside a client handler:\n${violations.map((v) => `- ${v}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(`sentry-imports: no route under ${SCANNED} imports the Sentry SDK statically`);
