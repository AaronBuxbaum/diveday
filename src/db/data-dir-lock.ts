import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * **The claim is the filename.** Each opener writes its own
 * `.diveday-lock.<pid>.<start token>` and then reads the directory: if any
 * *other* file there names a process still running, it deletes its own claim
 * and refuses. Nothing is shared, overwritten or taken over, which is what
 * makes this correct under a race rather than merely usually correct — see
 * {@link acquireDataDirLock} for the argument. It is also why a killed server
 * needs no recovery: its claim names a pid that is gone, so the next start
 * reads it as dead and sweeps it up.
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

/** What every claim file in the data directory is named with. */
export const LOCK_PREFIX = ".diveday-lock.";

/** What a claim's filename says about the process that wrote it. */
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
  readDir: (dir: string) => string[];
  createFile: (file: string) => void;
  removeFile: (file: string) => void;
  makeDir: (dir: string) => void;
  isAlive: (pid: number) => boolean;
  startToken: (pid: number) => string | null;
  onExit: (release: () => void) => void;
  pid: number;
};

/** What an owner's claim file is called. */
export function lockName(owner: LockOwner): string {
  return `${LOCK_PREFIX}${owner.pid}.${owner.since ?? "unknown"}`;
}

/** The owner a filename claims for, or `null` for a name that is not a claim. */
export function parseLockName(name: string): LockOwner | null {
  if (!name.startsWith(LOCK_PREFIX)) return null;
  const [pid, since, ...rest] = name.slice(LOCK_PREFIX.length).split(".");
  if (rest.length > 0 || !pid || !since || !/^\d+$/.test(pid)) return null;
  return { pid: Number(pid), since: since === "unknown" ? null : since };
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
 * Whether the process a claim names is still the process that made it.
 *
 * Deliberately conservative in both unknowable cases — no start token recorded,
 * or none readable now — because the two mistakes are not equally bad. Treating
 * a live holder as gone resumes the silent data loss this exists to stop;
 * treating a dead one as live refuses to start the app, and this repository's
 * whole premise is that its dev server gets *killed*, so abandoned claims are
 * the normal end state rather than the exotic one. The start token is what
 * keeps that conservatism from becoming a permanent refusal when a pid is
 * recycled.
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
    readDir: (dir) => readdirSync(dir),
    createFile: (file) => writeFileSync(file, ""),
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
 * Take the directory, or throw naming the process that has it.
 *
 * Two steps, in this order and for this reason: **write my own claim, then read
 * everyone else's.** Whichever opener creates its file second is guaranteed to
 * see the first — its read happens after its own write, which happened after
 * the other's — so it is the one that refuses. Two openers whose writes both
 * land before either read see each other and *both* refuse, which is safe (the
 * database stays shut) and honest (each names the other). What cannot happen is
 * both proceeding, and that is the only outcome that loses data.
 *
 * Nothing here overwrites, deletes or takes over a live process's claim, so
 * there is no read-modify-write window for a second starter to fall into — the
 * hole every "read the lock, decide it is stale, replace it" scheme has,
 * including this file's first draft. A claim whose process is *gone* is swept
 * up on sight, and that sweep is safe to race: the filename identifies whose
 * claim it is, so two processes removing the same dead one both do exactly the
 * intended thing.
 *
 * Returns a release, also registered on process exit. It removes only this
 * process's own claim, which is the only file it ever wrote.
 */
export function acquireDataDirLock(dataDir: string, overrides: Partial<LockDeps> = {}): () => void {
  const deps = { ...defaultDeps(), ...overrides };
  const me: LockOwner = { pid: deps.pid, since: deps.startToken(deps.pid) };
  const myClaim = path.join(dataDir, lockName(me));

  // PGlite creates the directory itself, but the claim has to be written before
  // it opens — so this may be the thing that creates it.
  deps.makeDir(dataDir);
  deps.createFile(myClaim);

  let holder: LockOwner | null = null;
  const abandoned: string[] = [];
  for (const entry of deps.readDir(dataDir)) {
    const owner = parseLockName(entry);
    // A claim naming *this* process is this process's own — a second opener
    // inside one process is not what this guards, and refusing one would mean
    // refusing the database this process claimed against itself.
    if (!owner || owner.pid === deps.pid) continue;
    if (holderIsLive(owner, deps)) holder ??= owner;
    else abandoned.push(entry);
  }
  for (const entry of abandoned) deps.removeFile(path.join(dataDir, entry));

  if (holder) {
    deps.removeFile(myClaim);
    throw new Error(lockedMessage(dataDir, holder));
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      deps.removeFile(myClaim);
    } catch {
      // Nothing here is worth failing an exit path over.
    }
  };
  deps.onExit(release);
  return release;
}
