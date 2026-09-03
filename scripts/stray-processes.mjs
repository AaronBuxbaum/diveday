#!/usr/bin/env node
/**
 * Report background processes that should have closed down and did not.
 *
 * Wired as a `Stop` hook in `.claude/settings.json`, so it runs when an agent
 * finishes a turn and hands anything it finds straight back to that agent. It
 * **reports**; it never kills. A long `pnpm test` or a sharded e2e run is
 * indistinguishable from a wedged one by elapsed time alone, and killing a
 * healthy twenty-minute run is a worse failure than mentioning an idle one.
 *
 * ## The failure this exists for
 *
 * On 2026-08-15 a wait-loop ran for **nine hours**. The chain:
 *
 *   1. `pnpm test 2>&1 | grep … | tail -6` exceeded its timeout and was moved
 *      to the background. `tail` cannot flush, so the task's output file stayed
 *      empty rather than filling in as the suite ran.
 *   2. A second background task was started to wait on that file:
 *      `until grep -qE "Test Files .*(passed|failed)" "$F"; do sleep 5; done`
 *      — a success marker, with no timeout and no failure branch.
 *   3. The producer was then killed by a `pkill -f vitest` during cleanup, so
 *      the marker could never arrive. The loop's condition became
 *      unsatisfiable and it spun `sleep 5` until someone noticed.
 *
 * Two things make a written rule insufficient here, which is why this is a
 * script and not another paragraph:
 *
 * - The rule already existed. `~/.claude/CLAUDE.md` says a poll loop matching
 *   only a success marker "goes silent forever if the watched process crashes",
 *   and to default to self-terminating waits. It was written anyway.
 * - **The obvious check gave a false all-clear.** `TaskList` reported "No tasks
 *   found" — twice, during cleanup — while that shell was alive. An agent that
 *   dutifully reaps before ending its turn still misses this, so the check has
 *   to look at the process table rather than at the task list.
 *
 * It also reports a second class the same afternoon turned up: two
 * `next-server` processes from sixteen days earlier, reparented to init,
 * listening on nothing, holding 3.6 GB between them. Nothing in a session's
 * task list has ever known about those.
 *
 * ## Usage
 *
 *   node scripts/stray-processes.mjs           # report (exit 2 if found)
 *   node scripts/stray-processes.mjs --list    # report, always exit 0
 *   node scripts/stray-processes.mjs --kill    # report and terminate
 *
 * `--kill` is for a human or an explicitly-asked-for cleanup, never the hook.
 */

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * How long a session-spawned shell may live before it is worth mentioning.
 *
 * Ten minutes is above a focused test run and a build, and well under the
 * horizon where a wedged loop stops being noticed. `pnpm check` and a sharded
 * e2e run do exceed it, and are *meant* to be reported: an agent that reads
 * "still running, 12m" about a suite it started knows to keep waiting, and an
 * agent that reads it about a `sleep` loop knows it has a problem.
 */
const STALE_MINUTES = Number(process.env.DIVEDAY_STRAY_PROCESS_MINUTES ?? 10);

/** Long-lived processes that belong to a dev loop and should not outlive it. */
const ORPHAN_PATTERNS = [
  { label: "next-server", match: /\bnext-server\b/ },
  { label: "next start", match: /\bnext\b.*\bstart\b/ },
  { label: "next dev", match: /\bnext\b.*\bdev\b/ },
  // The supervisor `pnpm dev` actually runs. Without this the report has a
  // blind spot at exactly its own subject: a supervisor whose parent shell has
  // gone keeps its `next dev` child alive and *restarts* it on schedule, so the
  // leak it produces is the longest-lived kind there is.
  { label: "dev-server supervisor", match: /\bscripts\/dev-server\.mjs\b/ },
  { label: "vitest", match: /\bvitest\b/ },
  { label: "playwright", match: /\bplaywright\b.*\btest\b/ },
];

/** `[[DD-]HH:]MM:SS` as ps prints it, in seconds. */
export function parseElapsedSeconds(etime) {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)
  );
}

export function humanElapsed(seconds) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours >= 24
    ? `${Math.floor(hours / 24)}d${hours % 24}h`
    : `${hours}h${String(minutes).padStart(2, "0")}m`;
}

/**
 * One `ps` line per row, as `{ pid, ppid, elapsedSeconds, rssMb, command }`.
 *
 * Split from the `ps` call so it can be tested against real output from **both**
 * platforms this runs on. macOS's BSD `ps` and Linux procps pad their columns
 * differently and differ on kernel threads, and the Linux half is otherwise
 * unprovable from a workstation -- see stray-processes.test.mjs.
 */
export function parseProcessTable(raw) {
  const rows = [];
  for (const line of raw.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsedSeconds: parseElapsedSeconds(match[3]),
      rssMb: Math.round(Number(match[4]) / 1024),
      command: match[5],
    });
  }
  return rows;
}

/** Every process, read through the bounded wrapper. */
function snapshotProcesses() {
  // `-eo`, not the BSD `-axo`: this hook runs wherever the repo runs, and that
  // includes Claude Cloud's Linux runners. `-e` and `-o` are POSIX and behave
  // identically under macOS's BSD ps and Linux procps; `-axo` is BSD spelling
  // that procps only tolerates by accident.
  const raw = readBounded("ps", ["-eo", "pid=,ppid=,etime=,rss=,command="], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeoutMs: SUBPROCESS_TIMEOUTS.processTable,
  });
  return parseProcessTable(raw);
}

/**
 * This process and every ancestor of it.
 *
 * Excluded from the report for the obvious reason: the hook runs inside one of
 * exactly the shells it is looking for, and a check that always reports itself
 * is a check nobody reads.
 */
function selfAndAncestors(rows) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const chain = [];
  let cursor = process.pid;
  while (cursor && cursor > 1 && !chain.includes(cursor)) {
    chain.push(cursor);
    cursor = byPid.get(cursor)?.ppid ?? 0;
  }
  return chain;
}

/**
 * The pid of the Claude session this script is running inside, or 0.
 *
 * Found by walking up from here to the process holding `--session-id`. It is
 * what lets a finding be attributed to *this* session rather than merely to
 * some session, which the kill path depends on -- see {@link main}.
 */
export function currentSessionPid(rows, ancestors) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  for (const pid of ancestors) {
    if (byPid.get(pid)?.command.includes("--session-id")) return pid;
  }
  return 0;
}

/** Whether `row` descends from `sessionPid`. */
export function descendsFrom(row, sessionPid, byPid) {
  if (!sessionPid) return false;
  let cursor = row.ppid;
  const seen = new Set();
  while (cursor && cursor > 1 && !seen.has(cursor)) {
    if (cursor === sessionPid) return true;
    seen.add(cursor);
    cursor = byPid.get(cursor)?.ppid ?? 0;
  }
  return false;
}

/**
 * Shells a Claude session spawned that are still alive past the threshold,
 * tagged with whether they belong to *this* session.
 *
 * Identified by the shell snapshot every session-spawned command sources, which
 * is what distinguishes them from the user's own terminals. The `mine` flag is
 * not cosmetic: several sessions share this machine, and a sibling's poll loop
 * against a pull request it is waiting on looks exactly like a wedged one from
 * here. Reporting a neighbour's is useful; killing it is not ours to do.
 */
export function staleSessionShells(rows, exclude, sessionPid) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  return (
    rows
      .filter(
        (row) =>
          !exclude.includes(row.pid) &&
          row.command.includes(".claude/shell-snapshots") &&
          row.elapsedSeconds >= STALE_MINUTES * 60,
      )
      // `ppid === 1` is its own answer: the shell outlived whoever started it,
      // so no live session owns it and reaping it can interrupt nobody. Without
      // this an *orphaned* wait-loop -- the worst kind, and the kind a detached
      // `nohup ... &` leaves behind -- reads as a sibling's live work and is
      // spared forever. Found by testing the kill path against a decoy.
      .map((row) => ({
        ...row,
        orphaned: row.ppid === 1,
        mine: row.ppid === 1 || descendsFrom(row, sessionPid, byPid),
      }))
      .sort((a, b) => b.elapsedSeconds - a.elapsedSeconds)
  );
}

/**
 * Dev/test processes whose parent is gone (`ppid === 1`).
 *
 * No session's task list knows about these — their owner exited without
 * reaping them, possibly days ago — so elapsed time is not the signal.
 * Being orphaned is.
 */
export function orphanedDevProcesses(rows, exclude) {
  return rows
    .filter((row) => !exclude.includes(row.pid) && row.ppid === 1)
    .map((row) => ({
      ...row,
      label: ORPHAN_PATTERNS.find((pattern) => pattern.match.test(row.command))?.label,
    }))
    .filter((row) => row.label)
    .sort((a, b) => b.elapsedSeconds - a.elapsedSeconds);
}

/** The `eval '…'` a session shell was given, which is the actionable part. */
export function summarizeCommand(command) {
  const evaluated = /&& eval '([\s\S]*?)'(?: <|$)/.exec(command);
  const text = (evaluated?.[1] ?? command).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const listOnly = args.has("--list");
  const kill = args.has("--kill");

  let rows;
  try {
    rows = snapshotProcesses();
  } catch {
    // A hook that cannot read the process table must not block anyone's work.
    return 0;
  }

  const exclude = selfAndAncestors(rows);
  const sessionPid = currentSessionPid(rows, exclude);
  const shells = staleSessionShells(rows, exclude, sessionPid);
  const orphans = orphanedDevProcesses(rows, exclude);
  if (shells.length === 0 && orphans.length === 0) return 0;

  const lines = [];
  if (shells.length > 0) {
    lines.push(
      `${shells.length} background shell(s) from a Claude session still running after ${STALE_MINUTES}m:`,
    );
    for (const row of shells) {
      const owner = row.orphaned ? "orphaned" : row.mine ? "this session" : "ANOTHER session";
      lines.push(
        `  pid ${row.pid}  ${humanElapsed(row.elapsedSeconds)}  [${owner}]  ${summarizeCommand(row.command)}`,
      );
    }
    lines.push(
      "  If one is a job you are still waiting on, leave it. If it is a wait-loop whose",
      "  producer already exited, it will never finish on its own -- kill it now. Note that",
      "  TaskList can report nothing while these are alive; the process table is the truth.",
      "  Anything marked ANOTHER session is a sibling's live work -- report it, never kill it.",
    );
  }
  if (orphans.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`${orphans.length} orphaned dev process(es) (parent gone, nobody will reap them):`);
    for (const row of orphans) {
      lines.push(
        `  pid ${row.pid}  ${humanElapsed(row.elapsedSeconds)}  ${row.rssMb} MB  ${row.label}`,
      );
    }
  }
  if (!kill) {
    lines.push("", `Clean up with: node ${path.relative(process.cwd(), process.argv[1])} --kill`);
  }

  if (kill) {
    // Only what this session owns, plus orphans -- whose owner is by definition
    // already gone. A sibling session's poll loop against a pull request it is
    // waiting on is indistinguishable from a wedged one from out here, and
    // killing one is how this tool would become the problem it reports. That is
    // not hypothetical: writing it, a threshold of 0 reaped a neighbour's
    // `gh pr checks` watch.
    for (const row of [...shells.filter((row) => row.mine), ...orphans]) {
      try {
        process.kill(row.pid, "SIGKILL");
      } catch {
        // Already gone between the snapshot and here, which is the good case.
      }
    }
    const spared = shells.filter((row) => !row.mine).length;
    lines.push(
      "",
      spared > 0
        ? `Killed this session's own, and left ${spared} belonging to another session.`
        : "Killed.",
    );
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  if (listOnly) {
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  // stderr + exit 2 is what feeds this back to the agent rather than burying it
  // in a transcript nobody opens.
  process.stderr.write(`${lines.join("\n")}\n`);
  return 2;
}

/**
 * Read the hook payload before deciding anything.
 *
 * `stop_hook_active` is true when the agent is already being re-invoked because
 * of this hook. Exiting 0 then is what stops a finding it cannot clear -- a
 * genuinely long test run, say -- from becoming an infinite stop/resume loop.
 */
async function readHookPayload() {
  if (process.stdin.isTTY) return {};
  // Bounded, and that bound is the point. This script is the one thing standing
  // between a session and a wait that never ends, so it must not contain one:
  // stdin here is whatever the caller left attached, and an inherited pipe with
  // no writer never reaches end-of-stream. Reading it unbounded hung this very
  // script during development -- the tool becoming the bug it reports.
  return await Promise.race([
    (async () => {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return {};
      }
    })(),
    new Promise((resolve) => setTimeout(() => resolve({}), 250).unref()),
  ]);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const payload = await readHookPayload();
  process.exit(payload.stop_hook_active ? 0 : main());
}
