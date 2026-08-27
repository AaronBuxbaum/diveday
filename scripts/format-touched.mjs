#!/usr/bin/env node
// A `PostToolUse` hook on `Edit`/`Write` that runs Biome over the one file that just
// changed, applies its safe fixes, and hands back anything left over.
//
// Formatting and lint diagnostics are the cheapest possible class of failure and this
// repository discovers them in the most expensive possible place: at the `pnpm check`
// gate, minutes of work later, alongside real findings, costing a full round trip to
// learn that an import is unused. Biome takes about half a second on a single file, so
// the same finding can arrive attached to the edit that caused it, while the reason for
// the edit is still in hand.
//
// Two deliberate choices. It runs `check --write`, not `format --write`: the point is the
// lint rules (`noUnusedImports`, `noUnusedVariables` are errors here), not the whitespace.
// And it reports through **exit 2**, which is the contract that feeds stderr back to the
// session — a diagnostic printed and not read would leave the round trip exactly where it
// was.
//
// It refuses to touch a path outside the repository, and fails open on everything else:
// no Biome binary, an unreadable payload, a timeout. A formatter that can break a session
// is worse than an unformatted file.

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** What Biome parses in this repo. Anything else it would decline anyway. */
const HANDLED = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".css"]);

/**
 * Whether this hook should run Biome over `filePath`, given the repo root.
 *
 * The path arrives from a tool payload, so it is checked rather than trusted: it must
 * resolve *inside* the repository. `path.relative` escaping upward (or coming back
 * absolute, which is what happens across drives) is the whole test.
 */
export function shouldFormat(filePath, root = ROOT) {
  if (typeof filePath !== "string" || !filePath) return false;
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  if (relative.split(path.sep).includes("node_modules")) return false;
  return HANDLED.has(path.extname(resolved));
}

/**
 * Biome exits non-zero when it was handed a path it will not process: a file under an
 * `!`-excluded root in `biome.json` (`drizzle/`, `docs/design/canvases/`, `screenshots/`),
 * or one that no longer exists because the edit moved or deleted it. Both print an alarming
 * block — "No files were processed", or an `internalError/io` inviting a bug report — and
 * handing either back as a lint diagnostic would be a straightforward lie about the edit
 * that just happened. Neither is this hook's business, so both are silence.
 */
export function isNotAboutTheCode(report) {
  return /No files were processed|internalError\/io/.test(report);
}

async function main() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;

  const parsed = JSON.parse(payload);
  const filePath = parsed.tool_input?.file_path;
  if (!shouldFormat(filePath)) return;

  const biome = path.join(ROOT, "node_modules/.bin/biome");
  if (!existsSync(biome)) return;

  // Argument array, never a shell string: the path comes from a tool payload. Through
  // `runBounded` rather than `spawnSync` directly, which is this directory's one door for a
  // subprocess and the reason none of them can hang without saying which one did.
  const result = runBounded(biome, ["check", "--write", path.resolve(ROOT, filePath)], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    timeoutMs: SUBPROCESS_TIMEOUTS.biomeFile,
  });

  if (result.error || result.status === 0 || result.status === null) return;

  const report = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!report || isNotAboutTheCode(report)) return;

  console.error(
    `Biome still reports diagnostics in ${path.relative(ROOT, path.resolve(ROOT, filePath))} after applying its safe fixes. These would fail \`pnpm check\` later; they are cheaper to fix now.\n\n${report}`,
  );
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    // Fail open. See the module comment.
    process.exit(0);
  }
}
