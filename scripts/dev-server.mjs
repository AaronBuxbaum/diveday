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
 * Everything the child writes is passed through untouched; this script's own
 * lines are the only additions and all carry the `dev:` prefix.
 *
 *   node scripts/dev-server.mjs [--port 3000] [any other `next dev` flag]
 *
 * `DIVEDAY_DEV_MEMORY_BUDGET_MB` overrides the derived budget; `0` turns
 * supervision off entirely and leaves a plain `next dev` passthrough.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** How often the supervisor reads the server's memory, in ms. */
const POLL_MS = 5_000;

/**
 * Consecutive over-budget samples before a restart.
 *
 * Not one, because a single page render transiently allocates about 3 GB here
 * and gives most of it straight back — measured on a cold `/terms`: 167 MB →
 * 2,996 MB during the request, settling to 1,400 MB three seconds later. A
 * one-sample trigger would restart the server on the ordinary shape of the work
 * rather than on the leak, which is the fastest way to make a supervisor worse
 * than no supervisor. Three samples at {@link POLL_MS} means fifteen seconds
 * *sustained* over budget, which a spike does not survive and growth does.
 */
const OVER_BUDGET_SAMPLES = 3;

/** Where the budget sits inside the ceiling, and the headroom it must leave. */
const BUDGET_FRACTION = 0.6;
const HEADROOM_BYTES = 3072 * 1024 * 1024;
const MIN_BUDGET_BYTES = 1024 * 1024 * 1024;

/** How long to wait for `/api/health` after a start before giving up on warming. */
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 1_000;

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

async function main(argv = process.argv.slice(2)) {
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

  if (budget) {
    say(
      `memory budget ${formatMb(budget)} of ${formatMb(ceiling)} — over it for ${(OVER_BUDGET_SAMPLES * POLL_MS) / 1000}s and the server is restarted`,
    );
  } else {
    say("memory supervision off — the server will grow until something else stops it");
  }

  let child = null;
  let stopping = false;
  let warming = null;
  let fastExits = 0;

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

    child = spawn(process.execPath, [nextBin, "dev", ...argv], {
      cwd: ROOT,
      detached: true,
      stdio: ["inherit", "pipe", "pipe"],
    });

    const scan = (chunk, stream) => {
      stream.write(chunk);
      const text = chunk.toString();
      if (FATAL_OUTPUT.test(text)) fatal = true;
      const drift = portInUseFromLine(text);
      if (drift) {
        say(
          `port ${drift.requested} belongs to another process, so Next took ${drift.chosen} — read ${drift.chosen}, and whatever still answers on ${drift.requested} is not this server`,
        );
      }
      const found = localPortFromLine(text);
      if (found) port = found;
    };
    child.stdout.on("data", (chunk) => scan(chunk, process.stdout));
    child.stderr.on("data", (chunk) => scan(chunk, process.stderr));

    const warmController = new AbortController();
    warming = warm(() => port, child.pid, warmController.signal);

    const poll = budget
      ? setInterval(() => {
          if (!child || stopping) return;
          const rows = processRows();
          if (!rows) return;
          const rss = treeRssBytes(rows, child.pid);
          lastRss = rss;
          if (rss < budget) {
            overBudget = 0;
            return;
          }
          overBudget += 1;
          if (overBudget < OVER_BUDGET_SAMPLES) {
            say(`${formatMb(rss)} — over the ${formatMb(budget)} budget`);
            return;
          }
          say(
            `restarting: held ${formatMb(rss)} for ${(OVER_BUDGET_SAMPLES * POLL_MS) / 1000}s, past the ${formatMb(budget)} budget. Next's dev server grows without a ceiling and would be killed by the kernel instead; the filesystem cache survives this, so the next page is a warm compile. Nothing you were doing caused it.`,
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
