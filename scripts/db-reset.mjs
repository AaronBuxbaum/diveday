#!/usr/bin/env node
/**
 * `pnpm db:reset` — clear the local PGlite database, and refuse to do it under
 * a running dev server.
 *
 * The refusal is the whole reason this is a script rather than the `rm -rf
 * .pglite` it used to be. PGlite takes **no lock on its data directory**, in
 * process or across processes, and nothing in this repo compensates. Two
 * openers of one directory do not error, do not warn and do not block: they
 * fork the database, each seeing only its own writes, and whichever closes last
 * lands its copy on disk over the other's. Deleting the directory out from
 * under a live server is the same failure with the timing reversed — the
 * server holds open file handles, so it keeps serving and keeps accepting
 * writes into a directory that no longer exists, and every one of them is
 * discarded when it exits.
 *
 * What that looked like before this script: `pnpm db:reset` printed its
 * cheerful "Dev database cleared", the running server carried on answering with
 * the old data, and the next hour went on the question of why a reset did
 * nothing. The whole failure is silent, and both halves of it look like
 * something else.
 *
 * The dev server announces itself in `.next/dev/lock` (`{"pid":…,"port":…}`,
 * written by Next's own `setup-dev-bundler`), so "is one running" is a file
 * read and a `kill(pid, 0)` away. A stale lock left by a killed server names a
 * pid nobody owns, and that is not a reason to refuse — hence the liveness
 * check rather than mere existence.
 *
 *   node scripts/db-reset.mjs
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Next records the dev server holding this checkout. */
const LOCK_FILES = [".next/dev/lock", ".next/lock"];

/**
 * Whether `pid` is a live process that still looks like the dev server.
 *
 * Liveness alone is not enough. A dev server here is usually killed rather than
 * stopped, so its lockfile outlives it, and pids are recycled — a stale lock
 * naming a pid the OS has since handed to something unrelated would make this
 * refuse forever, and name the wrong process while doing it.
 *
 * So on Linux — which is where the agent sessions this protects actually run —
 * the pid's own command line has to mention `next`. `/proc` does not exist on
 * macOS; there, liveness is all there is and the behaviour is unchanged, which
 * is the right way round for a check whose failure mode is refusing a reset
 * rather than performing a dangerous one.
 */
export function pidIsAlive(pid, readCmdline = defaultReadCmdline) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM means it exists and belongs to somebody else — still running.
    if (error.code !== "EPERM") return false;
  }
  const cmdline = readCmdline(pid);
  if (cmdline === null) return true;
  return /\bnext\b/.test(cmdline);
}

/** `/proc/<pid>/cmdline` with its NUL separators flattened, or null off Linux. */
function defaultReadCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
  } catch {
    return null;
  }
}

/**
 * The dev server currently holding this checkout, as `{ pid, port }`, or `null`.
 *
 * `null` for a lockfile that is absent, half-written, or names a pid that has
 * gone: a server killed abruptly (which, given how `next dev` usually dies
 * here, is the common case) leaves its lock behind, and refusing on that would
 * mean a reset nobody can ever run.
 */
export function runningDevServer(contents, isAlive = pidIsAlive) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }
  if (!Number.isInteger(parsed?.pid) || !isAlive(parsed.pid)) return null;
  return { pid: parsed.pid, port: parsed.port };
}

/** The data directory `src/db/client.ts` would open, or null for in-memory. */
export function dataDir(env = process.env) {
  const configured = env.PGLITE_DATA_DIR ?? ".pglite";
  return configured === "memory" ? null : configured;
}

/**
 * That directory as an absolute path, resolved the way PGlite resolves it.
 *
 * `src/db/client.ts` passes the configured value straight to the `PGlite`
 * constructor, so a relative one is relative to the process's working directory
 * and an absolute one is taken as given. Anything that deletes it has to agree
 * exactly, which `path.join` does not: it would turn `/tmp/pglite` into
 * `<repo>/tmp/pglite`.
 */
export function resolveDataDir(dir, root = ROOT) {
  return path.isAbsolute(dir) ? dir : path.resolve(root, dir);
}

function main() {
  for (const file of LOCK_FILES) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    const server = runningDevServer(readFileSync(full, "utf8"));
    if (!server) continue;
    process.stderr.write(
      `db:reset refused: a dev server is running (pid ${server.pid}${server.port ? `, port ${server.port}` : ""}).\n` +
        "PGlite does not lock its data directory, so deleting it under a live server does not stop that\n" +
        "server — it keeps answering from handles it already holds, and every write after this point is\n" +
        `discarded when it exits. Stop it first (kill ${server.pid}), then run this again.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const dir = dataDir();
  if (!dir) {
    process.stdout.write(
      "db:reset: PGLITE_DATA_DIR=memory — there is no database on disk to clear.\n",
    );
    return;
  }

  // `path.join(ROOT, "/tmp/pglite")` is `<repo>/tmp/pglite`, which is not where
  // `src/db/client.ts` opened the database — it hands the configured value
  // straight to PGlite, so an absolute one stays absolute. Joining would have
  // this report "does not exist" for the real directory while standing ready to
  // delete an unrelated path inside the repository that happens to match.
  const full = resolveDataDir(dir);
  if (!existsSync(full)) {
    process.stdout.write(
      `db:reset: ${dir} does not exist; next \`pnpm dev\` migrates and seeds.\n`,
    );
    return;
  }
  rmSync(full, { recursive: true, force: true });
  process.stdout.write(`db:reset: cleared ${dir}; next \`pnpm dev\` re-migrates and re-seeds.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
