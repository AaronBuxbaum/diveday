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
 *   4. Every local commit is on some remote branch (`git rev-list HEAD --not
 *      --remotes` is empty).
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

export function reasonFor({ unpushed, branch }) {
  return [
    `${unpushed} commit${unpushed === 1 ? "" : "s"} on \`${branch}\` ${unpushed === 1 ? "is" : "are"} on no remote branch, and this container is ephemeral — an unpushed commit is lost when it is reclaimed.`,
    "",
    `Push now (\`git push -u origin ${branch}\`) and open or update the pull request. If there is a reason not to push yet, say so in your closing message; this check does not repeat on the same turn.`,
  ].join("\n");
}

function git(args) {
  return readBounded("git", args, {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
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

  const unpushed = Number(git(["rev-list", "--count", "HEAD", "--not", "--remotes"]));
  if (!shouldBlock({ remote, reentry: false, closing: closingMessage(input), unpushed })) return 0;

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
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
