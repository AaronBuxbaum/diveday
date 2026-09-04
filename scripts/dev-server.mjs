#!/usr/bin/env node
/**
 * `pnpm dev`'s supervisor. It runs `next dev` and does two things that the dev
 * server cannot do for itself: it keeps the server inside a memory budget it
 * derives from the *real* ceiling, and it says out loud when the server can
 * actually answer a request.
 *
 * ## Why this exists
 *
 * `next dev` in this app does not have a steady-state memory footprint. Measured
 * here on 2026-09-03 against Next 16.3.4, warm `.next`, one route at a time:
 *
 *   | after                              | RSS      |
 *   | ---------------------------------- | -------- |
 *   | boot ("Ready in 407ms")            |   155 MB |
 *   | one request to `/terms`            | 1,400 MB |
 *   | 20 routes                          | 6,796 MB |
 *   | ~30 routes                         |  killed  |
 *
 * The last row is not a figure of speech. The kernel took it:
 *
 *   oom-kill: ... task=next-server (v16.3.4),pid=2542
 *   Memory cgroup out of memory: Killed process 2542 — anon-rss:13,091,384kB
 *
 * Three properties of that failure are what make it expensive rather than merely
 * annoying, and each one is a thing this script fixes:
 *
 *  1. **It is silent.** The dev log does not end in an error; it just *stops*
 *     mid-line. Every later request is `ECONNREFUSED` with no explanation
 *     anywhere, so the reasonable next move — read the log — finds nothing, and
 *     a session burns a long time looking for a bug in the change it was making.
 *  2. **`--max-old-space-size` does not bound it.** Measured: with V8's old space
 *     capped at 1536 MB the process still reached 5.3 GB with no heap OOM, so
 *     nearly all of it is native (Turbopack's Rust allocations), outside any V8
 *     limit. There is no Node flag that helps.
 *  3. **Turbopack's own eviction does not fire in time.**
 *     `experimental.turbopackMemoryEviction` defaults to `'auto'`, documented as
 *     evicting "when we expect to save a lot of memory or the system is under
 *     pressure". Under a cgroup there *is* no system pressure to detect: this
 *     container's limit is 13,663 MB while `os.totalmem()` reports 16,075 MB, so
 *     from inside the process nothing looks wrong right up to the kill. Setting
 *     it to `'full'` was measured and did not change the trajectory
 *     (5,266 MB vs 5,339 MB over the same 20 routes), which is why this script
 *     exists instead of a one-line config change.
 *
 * So the budget is enforced from outside, against the ceiling that actually
 * applies, and a restart is announced. A restart is cheap — Turbopack's
 * filesystem cache survives it, so the server is back in under a second and the
 * next page costs a warm compile, not a cold one — and `.pglite` is on disk, so
 * no data is lost. Losing an in-flight request to a planned restart is strictly
 * better than losing the whole server to an unplanned kill.
 *
 * ## The other half: "Ready" is not ready
 *
 * `next dev` prints `✓ Ready in 407ms` when it is listening, which here is about
 * twenty-six seconds before it can serve a page — the first request pays for
 * Turbopack's compile plus PGlite's migrate-and-seed. A session that reads
 * "Ready" and then watches `curl` hang for 26s has every reason to conclude the
 * server is wedged, and the cheapest thing it can do about that is kill it and
 * start again, which buys another cold start. So after each start this script
 * warms `/api/health` — one request that proves the process *and* its database
 * — and prints one line, with the real port, when the answer comes back.
 *
 * It also owns the handful of environment defaults local development wants and
 * production does not — see {@link applyDevDefaults} — because this is now the
 * documented way to start the app, and defaults that live in a `package.json`
 * shell prefix are defaults that only one of the several ways in gets.
 *
 * Everything the child writes is passed through untouched; this script's own
 * lines are the only additions and all carry the `dev:` prefix.
 *
 *   node scripts/dev-server.mjs [--port 3000] [any other `next dev` flag]
 *
 * `DIVEDAY_DEV_MEMORY_BUDGET_MB` overrides the derived budget; `0` turns
 * supervision off entirely and leaves a plain `next dev` passthrough.
 */

import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * How often the supervisor reads the server's memory, in ms.
 *
 * Two seconds rather than five because of how fast this particular server
 * moves: measured climbing 1.6 GB between two five-second samples while
 * *idle*, as `cacheComponents` re-renders in the background after a burst of
 * requests. At that rate the whole span between the budget and the hard limit
 * is under two samples, so a slow poll hands every restart to the hard limit —
 * the one that can interrupt a request — when the cheap idle one would have
 * done. One `ps` read costs a few milliseconds; the resolution is worth more.
 */
const POLL_MS = 2_000;

/**
 * Consecutive over-budget samples before an idle restart.
 *
 * Two rather than one only to survive a bad `ps` read; the thing that keeps a
 * spike from triggering a restart is {@link IDLE_MS}, not this. A single page
 * render transiently allocates about 3 GB here and gives most of it back —
 * measured on a cold `/terms`: 167 MB → 2,996 MB during the request, settling
 * to 1,400 MB three seconds later — and four idle seconds is already past that
 * settle, so by the time this fires the number it is reading is the retained
 * one.
 *
 * Longer would be worse, not safer. Memory here climbs by over a gigabyte
 * between two five-second samples while the server is doing nothing visible
 * (`cacheComponents` re-renders in the background after every settled render),
 * so a slow soft path just hands the work to the hard limit, which is the one
 * that costs somebody a request.
 */
const OVER_BUDGET_SAMPLES = 2;

/** Where the budget sits inside the ceiling, and the headroom it must leave. */
const BUDGET_FRACTION = 0.6;
const HEADROOM_BYTES = 3072 * 1024 * 1024;
const MIN_BUDGET_BYTES = 1024 * 1024 * 1024;

/**
 * The share of the ceiling at which a restart stops waiting for a quiet moment.
 *
 * There are two thresholds because there are two different situations, and one
 * number served neither. The budget is "this server has grown past where it
 * should sit" — nothing is on fire, so it waits for {@link IDLE_MS} with no
 * request in flight and costs nobody anything. This one is "the kernel is about
 * to take it", and it interrupts whatever is running, because a lost request is
 * cheaper than a lost server.
 *
 * The gap between them is not theoretical. Capturing two staff pages through
 * `scripts/screenshot.mjs` — light and dark, phone and desktop, the ordinary
 * matrix — was measured here peaking at **12,880 MB**, and with no supervision
 * at all it OOM-killed the server mid-run. A single-threshold supervisor set
 * anywhere below that restarts underneath the browser on ordinary work; one set
 * above it never fires in time. So: hold through the spike, and cut in before
 * the kill.
 */
const HARD_LIMIT_FRACTION = 0.8;

/**
 * How long without a request logged before the server counts as idle.
 *
 * Read off Next's own per-request line rather than guessed at, and short,
 * because the gaps this needs to find are the ones between one capture and the
 * next — not between one working session and another.
 */
const IDLE_MS = 4_000;

/** Next's per-request log line, which is the only in-flight signal there is. */
const REQUEST_LOG = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*\s+\d{3}\b/;

/**
 * Reassemble a stream's `data` chunks into whole lines.
 *
 * Every reader below matches a pattern against one of Next's lines, and a
 * `data` event is not a line: Node splits wherever the pipe happened to fill,
 * so `- Local: http://localhost:3001` can arrive as two chunks and match
 * nothing. The consequences are not cosmetic — the port banner missed means the
 * health probe knocks on the wrong port for its whole deadline, and the refusal
 * missed means a permanently-refused start gets retried.
 *
 * `flush` returns whatever is left unterminated, which matters because the last
 * thing a dying process writes often has no trailing newline — and on this
 * child that last thing is the reason it died.
 */
export function lineSplitter() {
  let rest = "";
  return {
    push(chunk) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      return lines;
    },
    flush() {
      const last = rest;
      rest = "";
      return last ? [last] : [];
    },
  };
}

/** How long to wait for `/api/health` after a start before giving up on warming. */
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 1_000;

/**
 * Next's generated route types, which are only trustworthy while a dev server
 * is alive to maintain them.
 *
 * `next dev` rewrites these non-atomically, so a server that dies mid-write
 * leaves them half-finished — and they then fail *every* later command that
 * type-checks, with dozens of `TS1005`s and "Unterminated string literal" in
 * files nobody wrote. `pnpm typecheck`, `pnpm build` and `pnpm e2e` all read
 * them, and none of those failures names the real cause. It cost three separate
 * rediscoveries in one afternoon writing this file.
 *
 * Dying mid-write is no longer an accident here — it is the OOM kill this whole
 * script exists for. So whenever a child goes down other than by a clean stop,
 * these are dropped before the next one starts; Next regenerates them as part
 * of its ordinary compile. Safe at exactly that moment, because the process
 * that owned them has already exited.
 */
const GENERATED_TYPES_DIR = ".next/dev/types";

/** How long a child gets to exit on SIGTERM before it is killed outright. */
const SIGTERM_GRACE_MS = 5_000;

/**
 * How long a child must have run for its death to count as a crash worth
 * restarting rather than a startup that failed.
 *
 * The two are worth telling apart because the right answer differs: a server
 * that ran for ten minutes and vanished was almost certainly taken for memory
 * and should come straight back, while one that dies four seconds in will die
 * the same way again, and a supervisor that keeps restarting it produces an
 * unreadable log instead of the one error that explains it.
 */
const HEALTHY_RUN_MS = 20_000;

/** Consecutive too-fast exits before the supervisor stops trying. */
const MAX_FAST_EXITS = 3;

/**
 * Consecutive restarts that never got the server under budget before the
 * supervisor concludes the budget is unreachable and stops restarting.
 *
 * A budget below what this app needs at rest cannot be met by restarting: the
 * server comes back, settles above the line, and is restarted again, forever.
 * Measured with a deliberately low 1,100 MB budget — twenty-three restarts in
 * thirty seconds, each costing a warm-up, none of them able to help.
 *
 * Futility is judged on the *interval* between restarts, not on whether memory
 * ever dipped under the line. It always dips: a freshly restarted server boots
 * at about 150 MB and is under any budget for a few seconds before it grows
 * back. Reading that as relief made the first version of this check never fire,
 * which is the sort of thing only a re-run with the low budget shows.
 *
 * That is not a contrived setting. On a 4 GB machine the *derived* budget is
 * the 1 GB floor while this server settles nearer 1.5 GB, so the default would
 * have thrashed on exactly the small machines least able to afford it. A
 * supervisor that cannot help has to get out of the way and say so, which is
 * what this does — the alternative is a second instability shipped inside the
 * fix for the first.
 */
const MAX_FUTILE_RESTARTS = 3;

/**
 * How soon after the last budget restart another one counts as futile.
 *
 * Growth that genuinely earns a restart takes minutes here — around thirty
 * route requests to cross 8 GB. Coming back over the line within a minute means
 * the line is the problem, not the growth.
 */
const FUTILE_WINDOW_MS = 60_000;

/**
 * The running count of futile restarts after one more, given how long ago the
 * previous budget restart was (`null` for none yet).
 *
 * Split out so the judgement is pinned by a test rather than only by a live
 * server with a deliberately wrong budget — which is how the first version's
 * bug survived: it counted a *dip* under the budget as relief, and a restarted
 * server always dips.
 */
export function countFutileRestart(previous, msSinceLastRestart) {
  const soonAfterTheLast = msSinceLastRestart !== null && msSinceLastRestart < FUTILE_WINDOW_MS;
  return soonAfterTheLast ? previous + 1 : 0;
}

/** Whether that many futile restarts in a row means the budget is unreachable. */
export function budgetIsUnreachable(futileRestarts) {
  return futileRestarts >= MAX_FUTILE_RESTARTS;
}

/**
 * Output that means "this will fail identically next time", so there is nothing
 * to retry. Next's own message for it is already complete — it names the
 * holding pid, its port, and the command to stop it — and the lock is per
 * *checkout*, not per port, so `--port` is not the way out of it.
 */
const FATAL_OUTPUT = /Another next dev server is already running/i;

const MB = 1024 * 1024;

/** Anything at or above this is a "no limit" sentinel, not a ceiling. */
const UNLIMITED_FLOOR = 2 ** 62;

export function formatMb(bytes) {
  return `${Math.round(bytes / MB)} MB`;
}

/**
 * The memory cgroup's limit in bytes, or `null` when there isn't one.
 *
 * Both cgroup generations, because the two agent environments this repo runs in
 * disagree: Claude Code's containers put this session in a *nested v1* group
 * (`/proc/self/cgroup` line `4:memory:/process_api/<id>/claude-code-bash`,
 * limit 13,663 MB) while a v2 host answers at `memory.max` instead. Reading
 * only one of them is the same as reading neither, since the fallback —
 * `os.totalmem()` — is the host's memory and so is always *larger* than the
 * limit that will actually kill the process.
 *
 * `readFile` is injected so the parsing can be tested against both layouts on a
 * machine that has neither.
 */
export function cgroupMemoryLimitBytes(readFile) {
  const read = (file) => {
    try {
      return readFile(file, "utf8");
    } catch {
      return null;
    }
  };

  const limits = [];

  // v2: one unified hierarchy, `0::<path>`, limit in `memory.max` — either
  // "max" (no limit) or a byte count.
  const unified = /^0::(.*)$/m.exec(read("/proc/self/cgroup") ?? "");
  if (unified) {
    for (const file of [
      `/sys/fs/cgroup${unified[1] === "/" ? "" : unified[1]}/memory.max`,
      "/sys/fs/cgroup/memory.max",
    ]) {
      const raw = read(file)?.trim();
      if (raw && raw !== "max") limits.push(Number(raw));
    }
  }

  // v1: a per-controller hierarchy, `<n>:memory:<path>`, limit in
  // `memory.limit_in_bytes`, with "no limit" spelled as a number near 2^63.
  const v1 = /^\d+:[^:]*\bmemory\b[^:]*:(.*)$/m.exec(read("/proc/self/cgroup") ?? "");
  if (v1) {
    const raw = read(`/sys/fs/cgroup/memory${v1[1]}/memory.limit_in_bytes`)?.trim();
    if (raw) limits.push(Number(raw));
  }

  const usable = limits.filter(
    (value) => Number.isFinite(value) && value > 0 && value < UNLIMITED_FLOOR,
  );
  return usable.length ? Math.min(...usable) : null;
}

/**
 * Anonymous (unreclaimable) memory charged to this whole cgroup, or `null`.
 *
 * The dev server's own tree is what the *budget* is about, but it is not what
 * gets killed: the cgroup charges everything in the session — a `pnpm test`
 * run, a Playwright fleet, the agent itself — and the kill lands on whichever
 * process is largest when the *total* runs out. A supervisor that watches only
 * its own child can therefore sit comfortably under budget while the container
 * dies around it, which is the failure it exists to prevent.
 *
 * Anonymous pages specifically, never `memory.usage_in_bytes` / `memory.current`:
 * measured here at 4,108 MB of "usage" against 637 MB of `total_rss`, the rest
 * being page cache the kernel reclaims on demand. Restarting the dev server
 * because the filesystem cache is warm would be pure superstition. The OOM
 * report names the same figure this reads (`anon-rss:13,091,384kB`).
 */
export function cgroupAnonBytes(readFile) {
  const read = (file) => {
    try {
      return readFile(file, "utf8");
    } catch {
      return null;
    }
  };
  const cgroups = read("/proc/self/cgroup") ?? "";

  const v1 = /^\d+:[^:]*\bmemory\b[^:]*:(.*)$/m.exec(cgroups);
  if (v1) {
    // `total_rss` includes descendant cgroups; `rss` would count only this level.
    const match = /^total_rss (\d+)$/m.exec(
      read(`/sys/fs/cgroup/memory${v1[1]}/memory.stat`) ?? "",
    );
    if (match) return Number(match[1]);
  }

  const unified = /^0::(.*)$/m.exec(cgroups);
  if (unified) {
    for (const file of [
      `/sys/fs/cgroup${unified[1] === "/" ? "" : unified[1]}/memory.stat`,
      "/sys/fs/cgroup/memory.stat",
    ]) {
      const match = /^anon (\d+)$/m.exec(read(file) ?? "");
      if (match) return Number(match[1]);
    }
  }
  return null;
}

/**
 * The smallest memory ceiling that actually applies to this process.
 *
 * The minimum rather than the first hit: a container can be both cgroup-limited
 * and running on a smaller host than its limit admits, and being wrong in the
 * generous direction is the failure this whole script is about.
 */
export function memoryCeilingBytes({ readFile = readFileSync, totalmem = os.totalmem } = {}) {
  const candidates = [cgroupMemoryLimitBytes(readFile), totalmem()].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * The budget, in bytes, or `null` for "do not supervise".
 *
 * Two constraints, whichever binds harder. {@link BUDGET_FRACTION} is the share
 * of the ceiling the server may hold at rest. {@link HEADROOM_BYTES} is the
 * absolute room a *single render* needs on top of that — measured at about 3 GB
 * transient here — because a budget that leaves less than one render's spare
 * capacity gets the process OOM-killed between two polls, which is exactly the
 * failure it was set to prevent.
 */
export function memoryBudgetBytes(ceilingBytes, { overrideMb } = {}) {
  if (overrideMb !== undefined && overrideMb !== null && overrideMb !== "") {
    const mb = Number(overrideMb);
    if (!Number.isFinite(mb) || mb < 0) return undefined;
    return mb === 0 ? null : mb * MB;
  }
  if (!ceilingBytes) return null;
  return Math.max(
    MIN_BUDGET_BYTES,
    Math.min(ceilingBytes * BUDGET_FRACTION, ceilingBytes - HEADROOM_BYTES),
  );
}

/**
 * The point at which a restart stops waiting for the server to go quiet, or
 * `null` when there is no ceiling to reckon against.
 *
 * Always above the budget, never above the ceiling: a hard limit that landed
 * below the soft one would make every restart an interrupting one, and the
 * whole reason for two numbers is that most restarts should cost nobody
 * anything.
 */
export function hardLimitBytes(ceilingBytes, budgetBytes) {
  if (!ceilingBytes || !budgetBytes) return null;
  return Math.min(ceilingBytes, Math.max(budgetBytes, ceilingBytes * HARD_LIMIT_FRACTION));
}

/** `ps` rows as `{ pid, ppid, rssBytes }`. */
export function parseProcessRows(raw) {
  const rows = [];
  for (const line of raw.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) {
      rows.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssBytes: Number(match[3]) * 1024,
      });
    }
  }
  return rows;
}

/** `rootPid` and every process descending from it. */
export function treePids(rows, rootPid) {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  const seen = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      queue.push(child.pid);
    }
  }
  return seen;
}

/**
 * Resident memory of `rootPid` and every descendant, in bytes.
 *
 * The whole tree, not just `next-server`: the cgroup that does the killing
 * charges the tree, and `next dev` is three processes deep here (the bin, the
 * server, and Turbopack's Node evaluation pool). Watching only the biggest one
 * would under-count by whatever the pool happens to be holding.
 */
export function treeRssBytes(rows, rootPid) {
  const pids = treePids(rows, rootPid);
  let total = 0;
  for (const row of rows) {
    if (pids.has(row.pid)) total += row.rssBytes;
  }
  return total;
}

/**
 * The pid Next recorded in its dev lockfile, or `null`.
 *
 * The lockfile is how one checkout's dev server announces itself
 * (`{"pid":…,"port":…}`, written by `setup-dev-bundler`), and reading it is the
 * only reliable way to tell "the server answering on this port is mine" from
 * "something else was already there". That distinction is not academic: a
 * second `pnpm dev` in a checkout that already has one prints its whole banner,
 * including `✓ Ready`, *before* it tries the lock and refuses — so a health
 * probe started on the strength of that banner cheerfully answers from the
 * *other* server and reports a start that never happened.
 */
export function devLockPid(contents) {
  try {
    const pid = JSON.parse(contents).pid;
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * The port `next dev` was asked for, so the health probe knows where to knock
 * before the child has printed anything.
 */
export function portFromArgs(argv, fallback = 3000) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--port" || argv[index] === "-p") {
      const value = Number(argv[index + 1]);
      if (Number.isInteger(value)) return value;
    }
    const inline = /^--port=(\d+)$/.exec(argv[index]);
    if (inline) return Number(inline[1]);
  }
  return fallback;
}

/**
 * The port Next actually bound, read off its own banner, so the health probe
 * knocks where the server is rather than where it was asked to be.
 */
export function localPortFromLine(line) {
  const match = /-\s*Local:\s*https?:\/\/[^\s:]+:(\d+)/.exec(line);
  return match ? Number(match[1]) : null;
}

/**
 * The port Next drifted to, as `{ requested, chosen }`, or `null`.
 *
 * Read off Next's own "Port N is in use … using available port M instead"
 * rather than inferred from the banner, because the banner also appears in the
 * *refusal* Next prints when this directory already has a dev server — where it
 * names the running server's port, and calling that a drift would contradict a
 * message that is already correct.
 *
 * Worth announcing when it is real: a session that asked for 3000 and got 3001
 * keeps reading 3000, where whatever *other* project owns that port answers
 * with a page from a server it cannot see. That reads exactly like a change not
 * taking effect, and nothing in the log says otherwise.
 */
export function portInUseFromLine(line) {
  const match = /Port\s+(\d+)\s+is in use[^.]*?using available port\s+(\d+)/i.exec(line);
  return match ? { requested: Number(match[1]), chosen: Number(match[2]) } : null;
}

/** Remove Next's generated route types; they are rebuilt on the next compile. */
function dropGeneratedTypes() {
  try {
    rmSync(path.join(ROOT, GENERATED_TYPES_DIR), { recursive: true, force: true });
  } catch {
    // Best effort: a stale type file is a worse morning, never a reason to fail.
  }
}

function say(message) {
  process.stdout.write(`dev: ${message}\n`);
}

function processRows() {
  try {
    const raw = readBounded("ps", ["-eo", "pid=,ppid=,rss="], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeoutMs: SUBPROCESS_TIMEOUTS.processTable,
    });
    return parseProcessRows(raw);
  } catch {
    // A `ps` that fails or wedges must not take the dev server down with it.
    // No sample this tick is the same as a sample under budget: the next one
    // will catch a genuine climb five seconds later.
    return null;
  }
}

/**
 * Poll `/api/health` until it answers, then report how long the warm took.
 *
 * Every attempt carries its own timeout and the loop carries a deadline, so
 * this cannot become the wait-with-no-exit that AGENTS.md's hard rules are
 * about: a server that never answers ends the loop with a printed line, not a
 * hang.
 */
/**
 * Whether the dev server answering right now is the child we started.
 *
 * `true` when there is no lockfile to consult — a checkout that has turned
 * `lockDistDir` off has nothing to check against, and refusing to ever report a
 * start would be worse than trusting the probe.
 */
function answeringServerIsOurs(childPid) {
  for (const file of [".next/dev/lock", ".next/lock"]) {
    let contents;
    try {
      contents = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const pid = devLockPid(contents);
    if (!pid) continue;
    const rows = processRows();
    if (!rows) return true;
    return treePids(rows, childPid).has(pid);
  }
  return true;
}

async function warm(currentPort, childPid, signal) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    if (signal.aborted) return;
    // Read the port every attempt rather than closing over it: Next may not
    // have printed the one it actually bound when this loop starts, and a probe
    // pinned to the requested port would then wait out its whole deadline
    // against a port nothing is listening on.
    const port = currentPort();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(READY_TIMEOUT_MS),
      });
      if (response.ok && answeringServerIsOurs(childPid)) {
        say(
          `serving http://localhost:${port} — warmed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
        return;
      }
    } catch {
      // Not up yet, or still compiling. Fall through to the next attempt.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  say(
    `still not answering on http://localhost:${currentPort()} after ${READY_TIMEOUT_MS / 1000}s — the log above is the only account of why`,
  );
}

/**
 * The four things local development wants switched differently from production,
 * applied here rather than in a `package.json` shell prefix so that every
 * documented way of starting the app gets them — including the bare
 * `node scripts/dev-server.mjs` that AGENTS.md now points at.
 *
 * Each is `??=`, so naming one on the command line still wins:
 * `DIVEDAY_DISABLE_EXTERNAL_HTTP=0 pnpm dev` is how you work on the forecast.
 */
function applyDevDefaults(env = process.env) {
  // Sign-in is rate-limited eight attempts per email per fifteen minutes, which
  // `scripts/screenshot.mjs` can spend in one run of captures across four roles.
  env.DIVEDAY_RATE_LIMIT_DISABLED ??= "1";
  // The Sentry DSN is compiled in (`src/lib/sentry-dsn.ts`), so without this
  // every error raised by half-finished local code is reported to the
  // production project. `pnpm e2e:build` has always emptied it for the same
  // reason; there is no reason dev should differ.
  env.NEXT_PUBLIC_SENTRY_DSN ??= "";
  // Today, the schedule board and both trip pages fetch Open-Meteo on the
  // render path. Two requests bounded at four seconds each, and a failure is
  // not cached — so in a sandbox with no egress that is up to eight seconds
  // added to *every* render of the surfaces a session looks at most, forever.
  // `playwright.config.ts` already sets this fleet-wide for exactly that
  // reason.
  env.DIVEDAY_DISABLE_EXTERNAL_HTTP ??= "1";
  // Next's telemetry prints a first-run notice into the log a session is
  // reading for errors, and leaves a detached uploader plus an uncollected
  // `_events_<pid>.json` behind on every exit. `playwright.config.ts` sets this
  // too.
  env.NEXT_TELEMETRY_DISABLED ??= "1";
}

/**
 * The database this server will actually open, as a printable phrase.
 *
 * Said out loud at startup because the alternative is finding out later. A
 * stale `.env.local` — the file `pnpm infra:deploy` generates and overwrites —
 * silently repoints local development at a real Postgres, and nothing else in
 * the boot output distinguishes that from the embedded one. The host, never a
 * credential: `withExplicitSslMode` and the pool config keep the rest.
 */
export function databaseDescription(env = process.env) {
  if (env.DATABASE_URL) {
    let host = "a configured host";
    try {
      host = new URL(env.DATABASE_URL).host;
    } catch {
      // An unparseable URL is still worth reporting as "not the local one".
    }
    return `postgres at ${host} (DATABASE_URL is set — this is not the embedded local database)`;
  }
  const dir = env.PGLITE_DATA_DIR ?? ".pglite";
  return dir === "memory" ? "PGlite, in memory" : `PGlite in ${dir}`;
}

async function main(argv = process.argv.slice(2)) {
  applyDevDefaults();
  const ceiling = memoryCeilingBytes();
  const budget = memoryBudgetBytes(ceiling, {
    overrideMb: process.env.DIVEDAY_DEV_MEMORY_BUDGET_MB,
  });
  if (budget === undefined) {
    process.stderr.write(
      `dev: DIVEDAY_DEV_MEMORY_BUDGET_MB must be a non-negative number, got ${JSON.stringify(process.env.DIVEDAY_DEV_MEMORY_BUDGET_MB)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const requestedPort = portFromArgs(argv);
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

  const hardLimit = hardLimitBytes(ceiling, budget);

  say(`database: ${databaseDescription()}`);
  if (budget) {
    say(
      `memory budget ${formatMb(budget)} of ${formatMb(ceiling)} — restarted once idle above that${hardLimit ? `, or straight away above ${formatMb(hardLimit)}` : ""}`,
    );
  } else {
    say("memory supervision off — the server will grow until something else stops it");
  }

  let child = null;
  let stopping = false;
  let warming = null;
  let fastExits = 0;
  // Cleared to null when the budget proves unreachable — see MAX_FUTILE_RESTARTS.
  let activeBudget = budget;
  let futileRestarts = 0;
  let lastBudgetRestartAt = 0;

  const killTree = (signal) => {
    if (!child) return;
    try {
      // The child is its own process group (`detached`), so one signal reaches
      // `next dev`, `next-server` and Turbopack's pool together. Signalling only
      // the direct child leaves the server running and unreachable — the
      // orphaned `next-server` AGENTS.md already has a script for.
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  };

  const start = () => {
    let overBudget = 0;
    let port = requestedPort;
    let fatal = false;
    let lastRss = 0;
    const startedAt = Date.now();
    let lastRequestAt = 0;

    child = spawn(process.execPath, [nextBin, "dev", ...argv], {
      cwd: ROOT,
      detached: true,
      stdio: ["inherit", "pipe", "pipe"],
    });

    const readLine = (line) => {
      if (FATAL_OUTPUT.test(line)) fatal = true;
      if (REQUEST_LOG.test(line)) lastRequestAt = Date.now();
      const drift = portInUseFromLine(line);
      if (drift) {
        say(
          `port ${drift.requested} belongs to another process, so Next took ${drift.chosen} — read ${drift.chosen}, and whatever still answers on ${drift.requested} is not this server`,
        );
      }
      const found = localPortFromLine(line);
      if (found) port = found;
    };
    const stdoutLines = lineSplitter();
    const stderrLines = lineSplitter();
    const pipe = (chunk, stream, splitter) => {
      stream.write(chunk);
      for (const line of splitter.push(chunk.toString())) readLine(line);
    };
    child.stdout.on("data", (chunk) => pipe(chunk, process.stdout, stdoutLines));
    child.stderr.on("data", (chunk) => pipe(chunk, process.stderr, stderrLines));

    const warmController = new AbortController();
    warming = warm(() => port, child.pid, warmController.signal);

    const poll = budget
      ? setInterval(() => {
          if (!child || stopping) return;
          const rows = processRows();
          if (!rows) return;
          const rss = treeRssBytes(rows, child.pid);
          lastRss = rss;
          if (!activeBudget) return;

          // Above this the kernel is the next thing to act, so nothing is
          // waited for. Measured cgroup-wide, because that is what the kill is
          // measured against — the server's own tree can be well under budget
          // while a test run beside it takes the container over.
          const pressure = cgroupAnonBytes(readFileSync) ?? rss;
          if (hardLimit && pressure >= hardLimit) {
            const busy = Date.now() - lastRequestAt < IDLE_MS;
            const elsewhere = pressure - rss;
            say(
              `restarting now: ${formatMb(pressure)} of anonymous memory against a ${formatMb(hardLimit)} mark, past which the kernel kills the largest process outright — ${formatMb(rss)} of it this server${elsewhere > 256 * MB ? `, ${formatMb(elsewhere)} something else in this session` : ""}. ${busy ? "Whatever request was in flight is lost — that is the trade, and the alternative is losing the server with no message at all." : "Nothing was in flight."} The next page is a warm compile.`,
            );
            warmController.abort();
            restart();
            return;
          }

          if (rss < activeBudget) {
            overBudget = 0;
            return;
          }
          overBudget += 1;
          if (overBudget < OVER_BUDGET_SAMPLES) {
            say(`${formatMb(rss)} — over the ${formatMb(activeBudget)} budget`);
            return;
          }
          // Over budget but still working: hold. A staff-page capture matrix
          // legitimately runs to 12 GB here, and restarting underneath it makes
          // the tool AGENTS.md points at for "look at the UI you changed" a coin
          // flip. The hard limit above is what stops that becoming a crash.
          if (Date.now() - lastRequestAt < IDLE_MS) return;
          futileRestarts = countFutileRestart(
            futileRestarts,
            lastBudgetRestartAt > 0 ? Date.now() - lastBudgetRestartAt : null,
          );
          lastBudgetRestartAt = Date.now();
          if (budgetIsUnreachable(futileRestarts)) {
            activeBudget = null;
            say(
              `giving up on the ${formatMb(budget)} budget: ${MAX_FUTILE_RESTARTS} restarts in a row came back above it, so it is below what this app needs at rest (${formatMb(rss)} here) and no restart can meet it. Supervision is off for this session — the server keeps running, unwatched. Raise DIVEDAY_DEV_MEMORY_BUDGET_MB, or take this as the machine being too small for this dev server.`,
            );
            return;
          }
          say(
            `restarting: idle, holding ${formatMb(rss)} against a ${formatMb(activeBudget)} budget. Next's dev server never unloads a route it has served and would be killed by the kernel instead; the filesystem cache survives this, so the next page is a warm compile. Nothing you were doing caused it.`,
          );
          warmController.abort();
          restart();
        }, POLL_MS)
      : null;

    const restart = () => {
      if (stopping) return;
      clearInterval(poll);
      child.removeAllListeners("exit");
      const dying = child;
      const forced = setTimeout(() => {
        try {
          process.kill(-dying.pid, "SIGKILL");
          // Killed outright rather than asked, so it may have been mid-write.
          dropGeneratedTypes();
        } catch {
          // Already gone.
        }
      }, SIGTERM_GRACE_MS);
      dying.on("exit", () => {
        clearTimeout(forced);
        if (!stopping) start();
      });
      try {
        process.kill(-dying.pid, "SIGTERM");
      } catch {
        clearTimeout(forced);
        if (!stopping) start();
      }
    };

    child.on("exit", (code, signal) => {
      clearInterval(poll);
      warmController.abort();
      // The last thing a dying process writes usually has no trailing newline,
      // and on this child that last thing is the reason it died — including the
      // refusal that decides whether any of this is worth retrying.
      for (const line of [...stdoutLines.flush(), ...stderrLines.flush()]) readLine(line);
      if (stopping) return;

      // `next dev` runs until it is stopped, so *any* exit we did not ask for
      // is a failure — including `code 0`, which is what it reports when the
      // kernel kills `next-server` out from under it. That is the shape the OOM
      // actually takes: the killer picks the biggest process, which is the
      // grandchild, and the bin above it then shuts down tidily. An earlier
      // version of this watched for `SIGKILL` on the direct child, which never
      // arrives, so it announced "exited (code 0)" and left nothing serving.
      const ranMs = Date.now() - startedAt;
      const how = signal ? `on ${signal}` : `with code ${code}`;
      const held = lastRss ? ` It was holding ${formatMb(lastRss)} when it went.` : "";

      if (fatal) {
        // A refusal, not a crash — Next has already printed the reason and the
        // remedy above, and restarting would only print it again.
        say(`next dev refused to start (${how}) — the reason is in its own message above`);
        process.exitCode = code ?? 1;
        return;
      }

      dropGeneratedTypes();

      if (ranMs >= HEALTHY_RUN_MS) {
        fastExits = 0;
        say(
          `the dev server died ${how} after ${Math.round(ranMs / 1000)}s of running.${held} Next prints nothing when the kernel takes it for memory, and that is far and away the usual cause. Restarting — nothing you were doing caused it.`,
        );
        start();
        return;
      }

      fastExits += 1;
      if (fastExits < MAX_FAST_EXITS) {
        say(`next dev exited ${how} after ${Math.round(ranMs / 1000)}s — retrying`);
        start();
        return;
      }
      say(
        `next dev exited ${how} ${MAX_FAST_EXITS} times without staying up — that is a startup failure rather than memory, and its own output above is the reason`,
      );
      process.exitCode = code ?? 1;
    });
  };

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    killTree("SIGTERM");
    setTimeout(() => {
      killTree("SIGKILL");
      process.exit(signal === "SIGINT" ? 130 : 143);
    }, SIGTERM_GRACE_MS).unref();
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  // A supervisor that leaves its child behind is the orphaned `next-server`
  // this repository already has a hook to report. Belt and braces.
  process.on("exit", () => killTree("SIGKILL"));

  start();
  await warming;
}

// `process.argv[1]` is undefined under `node -e` and `node --eval`, where
// `pathToFileURL` throws rather than returning nothing — so importing this
// module to read one exported helper would crash on the guard itself.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
