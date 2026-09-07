#!/usr/bin/env node
/**
 * Refuse to end a turn that promises work and then stops.
 *
 * On 2026-08-15 a session working the follow-up register down ended three turns
 * in a row with a sentence like "Now the queued work: dropping the retired table
 * and the wait-list mark" — and then yielded without doing it. The user waited,
 * saw nothing, and had to ask "are you still working?". Nothing was broken and
 * nothing was lost; the work simply never started, because the queue existed
 * only as prose in a message that had already been sent.
 *
 * That is a different failure from the stray-process one beside it. A stray
 * process is something left *running*; this is something never *begun*. Both
 * are invisible at the moment they happen and obvious an hour later.
 *
 * What this checks, and why each half matters:
 *
 *   1. The last assistant message reads like a commitment to do something next
 *      ("next I'll", "once X lands", "then I'll run"). On its own that is fine —
 *      handing work back to the user, or describing what a *human* should do, is
 *      an ordinary way to end a turn.
 *   2. ...and the working tree is dirty. That is the tell: a turn that promises
 *      more work while mid-change is a turn that stopped in the middle. A clean
 *      tree with a promise in it is almost always "I have finished and pushed;
 *      here is what happens next", which is exactly right.
 *
 * Both together, and it blocks — feeding the reason back so the session either
 * does the work, files it as a `needs-triage` GitHub issue, or says plainly that it
 * is handing it over. Any of those three is a good ending. Silence is not.
 *
 * **It fails open, always.** A hook that blocks a turn because it could not
 * parse a transcript would be worse than the problem it prevents, so every
 * unexpected condition exits 0. It also honours `stop_hook_active`, so it can
 * never loop a session against itself.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Phrases that promise a *next action by this session*, not by a human. */
const PROMISES = [
  /\bnext(?:,)? I(?:'|’)?ll\b/i,
  /\bnow I(?:'|’)?ll\b/i,
  /\bI(?:'|’)?ll (?:now |then |go |start |run |do |pick|fix|add|finish|continue)/i,
  /\bonce (?:that|they|it|the\b[^.]{0,40}?) (?:lands?|clears?|finishes?|completes?|returns?)\b/i,
  /\b(?:then|after that)(?:,)? (?:I|we)(?:'|’)?ll\b/i,
  /\bnow the queued work\b/i,
  /\b(?:goes|go) as soon as\b/i,
  /\bstill (?:to do|outstanding|queued)\b/i,
];

/**
 * Phrases that mean the ball is deliberately in the user's court. These win over
 * a promise match: "say the word and I'll open it" is a question, not a stall.
 */
const HANDOFFS = [
  /\bsay the word\b/i,
  /\blet me know\b/i,
  /\bwant me to\b/i,
  /\bshall I\b/i,
  /\bwould you like\b/i,
  /\?\s*$/,
];

/**
 * The whole decision, pure so the unit test can reach it: does this closing
 * message, on this working tree, mean the turn stopped in the middle?
 *
 * @param text the turn's final assistant message
 * @param dirty whether the working tree has uncommitted changes
 */
export function promisesUnfinishedWork(text, dirty) {
  if (!text || !dirty) return false;
  // Only the closing paragraphs: a promise quoted from a subagent's report, or
  // recounted from earlier in the turn, is not this turn ending on one.
  const closing = text.slice(-700);
  if (!PROMISES.some((pattern) => pattern.test(closing))) return false;
  return !HANDOFFS.some((pattern) => pattern.test(closing));
}

export function lastAssistantText(transcriptPath) {
  const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    // Skip an assistant turn that was pure tool use — it has no closing message.
    if (text) return text;
  }
  return "";
}

function workingTreeIsDirty() {
  // Through `readBounded` like every other subprocess call in this directory: a
  // `Stop` hook that can hang is the precise failure `scripts/subprocess.mjs`
  // was written to end, and this one runs on every turn.
  const status = readBounded("git", ["status", "--porcelain"], {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  return status.trim().length > 0;
}

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function main() {
  const input = readHookInput();
  // Set on the re-entry after this hook has already blocked once. Without it a
  // session that keeps re-explaining itself would never be allowed to stop.
  if (input.stop_hook_active) return 0;
  if (!input.transcript_path) return 0;

  const text = lastAssistantText(input.transcript_path);
  if (!text) return 0;
  // The git call is last: it is the only expensive half, and most turns are
  // filtered out by the message alone.
  if (!promisesUnfinishedWork(text, true)) return 0;
  if (!workingTreeIsDirty()) return 0;

  process.stderr.write(
    [
      "This turn ends by promising work it did not do, and the working tree is dirty.",
      "",
      "A queue written in a closing message is not a queue: the message is sent, the",
      "turn ends, and nothing starts it again. On 2026-08-15 that pattern cost a user",
      "three turns of silence before they asked whether anything was still running.",
      "",
      "Pick one, then finish the turn:",
      "  - DO IT NOW. If it is the next thing, it belongs in this turn.",
      "  - FILE IT. A GitHub issue labelled needs-triage (see docs/agents/issue-tracker.md's",
      "    Filing a follow-up section), so a cold reader can run it.",
      "  - HAND IT OVER explicitly. Ask the question, or say plainly that you are",
      "    stopping and what you need — a turn that ends on a question is fine.",
      "",
      "If several things are queued, track them with TaskCreate/TaskUpdate rather than",
      "in prose, so nothing depends on the next turn remembering a sentence.",
    ].join("\n"),
  );
  return 2;
}

// Only when run as the hook. Importing this module (the unit test does) must
// not exit the importing process.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exit(main());
  } catch {
    // Fail open: never block a turn because this check itself broke.
    process.exit(0);
  }
}
