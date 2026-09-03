import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * One process at a time on a file-backed PGlite directory.
 *
 * PGlite takes no lock of its own — not across processes, not within one. Two
 * openers of the same directory do not error, do not warn and do not block:
 * they fork the database. Each sees only its own writes, and whichever closes
 * last lands its copy on disk over the other's. Verified by experiment on
 * 2026-09-03: two processes, forty committed rows each, neither observing the
 * other, one set surviving and no output from anybody.
 *
 * That is a silent data-loss path reachable by ordinary local work — a
 * `pnpm build` beside a running `pnpm dev` is all it takes — and the failure
 * surfaces later as "my change didn't save", which is the most expensive shape
 * a bug can have. This turns it into a refusal that names the process to stop.
 *
 * **What it does not cover.** It guards openers that come through
 * `src/db/client.ts`'s `init()`, which is every way this app reaches its own
 * database. It cannot guard a tool that opens the directory directly:
 * `drizzle.config.ts` points `dbCredentials.url` at `./.pglite`, so a
 * `drizzle-kit studio` or `push` would still fork it. `pnpm db:generate`
 * diffs the schema and never connects, and `pnpm db:migrate` runs against the
 * production config, so neither is exposed today.
 *
 * The in-memory branch takes no lock and needs none: `PGLITE_DATA_DIR=memory`
 * gives every process its own private database, which is exactly the isolation
 * the e2e and visual fleets rely on (`playwright.config.ts` sets it for the
 * whole fleet, and `pnpm e2e:build` for the build behind it).
 */

/** The lock file's name inside the data directory. */
export const LOCK_FILE = ".diveday-lock";

/** What the lock file records about the process holding it. */
export type LockOwner = {
  pid: number;
  /**
   * The holder's process start time, so a *recycled* pid is not mistaken for
   * the original holder. Null off Linux, where it cannot be read.
   */
  since: string | null;
};

/** Injectable seams, so the whole decision can be tested without real processes. */
export type LockDeps = {
  readFile: (file: string) => string;
  writeFile: (file: string, contents: string, exclusive: boolean) => void;
  removeFile: (file: string) => void;
  makeDir: (dir: string) => void;
  isAlive: (pid: number) => boolean;
  startToken: (pid: number) => string | null;
  onExit: (release: () => void) => void;
  pid: number;
};

/** The owner a lock file names, or `null` for one absent, empty or malformed. */
export function parseLockOwner(contents: string): LockOwner | null {
  try {
    const parsed = JSON.parse(contents) as { pid?: unknown; since?: unknown };
    if (!Number.isInteger(parsed.pid)) return null;
    return {
      pid: parsed.pid as number,
      since: typeof parsed.since === "string" ? parsed.since : null,
    };
  } catch {
    return null;
  }
}

/**
 * A Linux process's start time in clock ticks, or `null` when it cannot be read
 * — off Linux, or for a pid that has gone.
 *
 * `comm` (field 2) is the process name in parentheses and may itself contain
 * spaces and parentheses — `next-server (v16.3.4)` does — so the fields after
 * it are found from the **last** `)` rather than by splitting the whole line.
 * `starttime` is field 22, which is index 19 of what follows. Verified against
 * `/proc/uptime` rather than counted off the man page.
 */
export function processStartToken(
  pid: number,
  readFile: (file: string) => string = (file) => readFileSync(file, "utf8"),
): string | null {
  try {
    const stat = readFile(`/proc/${pid}/stat`);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const starttime = fields[19];
    return starttime && /^\d+$/.test(starttime) ? starttime : null;
  } catch {
    return null;
  }
}

/**
 * Whether the process a lock names is still the process that took it.
 *
 * Deliberately conservative in both unknowable cases — no start token recorded,
 * or none readable now — because the two mistakes are not equally bad. Treating
 * a live holder as stale resumes the silent data loss this exists to stop;
 * treating a dead one as live refuses to start the app, and this repository's
 * whole premise is that its dev server gets *killed*, so stale locks are the
 * normal end state rather than the exotic one. The start token is what keeps
 * that conservatism from becoming a permanent refusal when a pid is recycled.
 */
export function holderIsLive(
  owner: LockOwner,
  deps: Pick<LockDeps, "isAlive" | "startToken">,
): boolean {
  if (!deps.isAlive(owner.pid)) return false;
  if (owner.since === null) return true;
  const current = deps.startToken(owner.pid);
  if (current === null) return true;
  return current === owner.since;
}

/** The refusal a second opener gets, naming the process to stop. */
export function lockedMessage(dataDir: string, owner: LockOwner): string {
  return (
    `${dataDir} is already open by process ${owner.pid}. PGlite does not lock its data directory, ` +
    "so a second opener would not fail — it would silently fork the database, and whichever process " +
    `closed last would overwrite the other's writes. Stop that process first (kill ${owner.pid}), or ` +
    "give this one a database of its own with PGLITE_DATA_DIR."
  );
}

function defaultDeps(): LockDeps {
  return {
    readFile: (file) => readFileSync(file, "utf8"),
    writeFile: (file, contents, exclusive) =>
      writeFileSync(file, contents, exclusive ? { flag: "wx" } : {}),
    removeFile: (file) => rmSync(file, { force: true }),
    makeDir: (dir) => mkdirSync(dir, { recursive: true }),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // EPERM means it exists and belongs to somebody else — still running.
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    startToken: (pid) => processStartToken(pid),
    onExit: (release) => process.on("exit", release),
    pid: process.pid,
  };
}

/**
 * Take the lock on `dataDir`, or throw naming who holds it.
 *
 * Returns a release, which is also registered on process exit. The release
 * checks the file still names *this* process before removing it, so a lock this
 * process took over as stale — and which a third process has since taken from
 * it — is never deleted out from under its new owner.
 */
export function acquireDataDirLock(dataDir: string, overrides: Partial<LockDeps> = {}): () => void {
  const deps = { ...defaultDeps(), ...overrides };
  const lockPath = path.join(dataDir, LOCK_FILE);
  const mine = JSON.stringify({ pid: deps.pid, since: deps.startToken(deps.pid) });

  // PGlite creates the directory itself, but the lock has to be written before
  // it opens — so this may be the thing that creates it.
  deps.makeDir(dataDir);

  try {
    deps.writeFile(lockPath, mine, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let owner: LockOwner | null = null;
    try {
      owner = parseLockOwner(deps.readFile(lockPath));
    } catch {
      // Unreadable is the same as unowned: a half-written lock names nobody.
    }
    if (owner && holderIsLive(owner, deps)) throw new Error(lockedMessage(dataDir, owner));
    // Stale — the holder is gone, or its pid now belongs to something else.
    deps.writeFile(lockPath, mine, false);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const owner = parseLockOwner(deps.readFile(lockPath));
      if (owner?.pid !== deps.pid) return;
      deps.removeFile(lockPath);
    } catch {
      // Nothing here is worth failing an exit path over.
    }
  };
  deps.onExit(release);
  return release;
}
