#!/usr/bin/env node
/**
 * Refuse to end a turn, in a cloud container, with commits that exist nowhere else.
 *
 * The container a cloud session runs in is ephemeral: it is reclaimed after a period
 * of inactivity, and everything not pushed goes with it. A commit is the shape that
 * *looks* safe — the work is "saved" — and is not, because the disk it is saved on
 * is about to be recycled. This is the third `Stop` hook beside `stray-processes`
 * (something left running) and `unfinished-promises` (something never begun): this
 * one is something finished and then lost.
 *
 * What it checks, in order, and each is a reason to stay quiet:
 *
 *   1. Not a cloud container (`CLAUDE_CODE_REMOTE` is not "true"). A laptop's
 *      commits survive the session; nagging there teaches sessions to ignore hooks.
 *   2. `stop_hook_active` — this is the re-entry after it already blocked once.
 *      The session has now read the reason and either pushed or explained; either
 *      way it may stop.
 *   3. The closing message is a handoff or a question. A turn that ends on
 *      "shall I push this?" is a fine ending; the user is about to answer.
 *   4. Nothing is unpushed: the branch's upstream holds every local commit
 *      (`@{upstream}..HEAD` is empty), or, for a branch with no upstream yet,
 *      every commit is on some remote branch (`HEAD --not --remotes`), which
 *      is also how a detached HEAD is counted: a commit made on one is lost
 *      with the container like any other.
 *
 * Only when all four fail does it block, naming the count and the push command.
 * A session that has a reason not to push says so in its closing message and stops
 * on the next turn, because of (2).
 *
 * **It fails open, always.** A `Stop` hook that blocks because git did not answer
 * would be worse than the loss it prevents.
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { recordRefusal } from "./hook-log.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { isHandoff, lastAssistantText } from "./unfinished-promises.mjs";

/**
 * The whole decision, pure so the unit test can reach it.
 *
 * @param {object} facts
 * @param {boolean} facts.remote      running in a cloud container
 * @param {boolean} facts.reentry     `stop_hook_active` from the payload
 * @param {string}  facts.closing     the turn's final assistant message
 * @param {number}  facts.unpushed    commits on no remote branch
 * @returns {boolean} whether to block the stop
 */
export function shouldBlock({ remote, reentry, closing, unpushed }) {
  if (!remote) return false;
  if (reentry) return false;
  if (!unpushed || unpushed <= 0) return false;
  return !isHandoff(closing);
}

/**
 * One command to run. A block costs one more turn at the session's full context, so the reason
 * names the exact command and the one alternative, and nothing else.
 */
export function reasonFor({ unpushed, branch }) {
  if (branch === "HEAD") {
    return [
      `${unpushed} commit${unpushed === 1 ? "" : "s"} on a detached HEAD ${unpushed === 1 ? "is" : "are"} on no remote branch, and this container is ephemeral.`,
      "Run `git switch -c claude/<slug>`, then `git push -u origin claude/<slug>`, or say in one sentence why not; this check does not repeat this turn.",
    ].join("\n");
  }
  return [
    `${unpushed} commit${unpushed === 1 ? "" : "s"} on \`${branch}\` ${unpushed === 1 ? "is" : "are"} on no remote branch, and this container is ephemeral.`,
    `Run \`git push -u origin ${branch}\`, or say in one sentence why not; this check does not repeat this turn.`,
  ].join("\n");
}

function git(args) {
  try {
    return readBounded("git", args, {
      cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Commits that exist nowhere else, measured the way `session-context.mjs`
 * measures them. Against the branch's own upstream when it has one: against
 * every remote ref at once (`--not --remotes`), a container whose
 * `origin/main` was days old reported hundreds of phantom commits (issue
 * #2355). A branch with no upstream yet is the one case `--not --remotes`
 * answers honestly. A detached HEAD is counted the same way: it has no upstream, and the session-start fetch keeps the remote refs current.
 *
 * @param {(args: string[]) => string | null} run git, `null` on failure
 * @returns {number}
 */
export function countUnpushed(run) {
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return 0;
  // A detached HEAD has no upstream, but a commit made on it is lost with the container like
  // any other. session-context leaves the shared checkout detached after its fast-forward and
  // fetches first, so `--not --remotes` reads current refs there.
  if (branch === "HEAD") {
    const raw = run(["rev-list", "--count", "HEAD", "--not", "--remotes"]);
    const count = Number(raw);
    return raw !== null && Number.isFinite(count) ? count : 0;
  }
  const upstream = run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const raw = upstream
    ? run(["rev-list", "--count", "@{u}..HEAD"])
    : run(["rev-list", "--count", "HEAD", "--not", "--remotes"]);
  const count = Number(raw);
  return raw !== null && Number.isFinite(count) ? count : 0;
}

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function closingMessage(input) {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  if (input.transcript_path) return lastAssistantText(input.transcript_path);
  return "";
}

function main() {
  const input = readHookInput();
  const remote = process.env.CLAUDE_CODE_REMOTE === "true";
  if (!remote || input.stop_hook_active) return 0;

  const unpushed = countUnpushed(git);
  if (!shouldBlock({ remote, reentry: false, closing: closingMessage(input), unpushed })) return 0;

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  recordRefusal("unpushed-work", `${unpushed} unpushed commits on ${branch}`, {
    session: input.session_id,
  });
  process.stderr.write(`${reasonFor({ unpushed, branch })}\n`);
  return 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exit(main());
  } catch {
    // Fail open: never block a turn because this check itself broke.
    process.exit(0);
  }
}
