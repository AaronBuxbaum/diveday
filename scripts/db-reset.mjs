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

/** True when `pid` names a process this user could signal. */
export function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else — still running.
    return error.code === "EPERM";
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

  const full = path.join(ROOT, dir);
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
