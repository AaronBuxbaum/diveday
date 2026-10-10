// One line per hook refusal, in a gitignored `.claude/.hook-log`, so the papercuts rule
// (docs/agents/papercuts.md) fires on evidence rather than on a session remembering it was
// fought. Every `PreToolUse` guard and `Stop` hook that refuses calls `recordRefusal`; the
// per-prompt line in `session-context.mjs` reads the tally back once per session and says
// "N refusals last session" when the previous session was refused at all.
//
// The log is JSON lines, newest last:
//
//   {"at":"2026-10-10T17:00:00.000Z","session":"…","hook":"guard-bash","kind":"refusal","reason":"…"}
//   {"at":"…","session":"…","hook":"session-context","kind":"noted"}
//
// `noted` marks that a session has already been told, so the reminder is said once per session
// and never on every prompt. Like every hook in this repository, nothing here may throw into its
// caller: a refusal that cannot be logged is still a refusal.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const HOOK_LOG = ".claude/.hook-log";

/** Above this many lines the log is cut back to its newest KEEP_LINES. */
const MAX_LINES = 2_000;
const KEEP_LINES = 500;

function logPath(root) {
  return path.join(root ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), HOOK_LOG);
}

/** Appends one entry. Never throws. */
export function appendEntry(entry, { root, now = new Date() } = {}) {
  try {
    const line = JSON.stringify({ at: now.toISOString(), ...entry });
    const file = logPath(root);
    appendFileSync(file, `${line}\n`);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    if (lines.length > MAX_LINES) writeFileSync(file, `${lines.slice(-KEEP_LINES).join("\n")}\n`);
  } catch {
    // A refusal that cannot be logged is still a refusal.
  }
}

/** Records that `hook` refused something in `session`. `reason` is cut to one short line. */
export function recordRefusal(hook, reason, { session, root, now } = {}) {
  const short = String(reason ?? "")
    .split("\n")[0]
    .slice(0, 160);
  appendEntry(
    { session: session ?? "unknown", hook, kind: "refusal", reason: short },
    { root, now },
  );
}

/** Parses the log's text into entries, skipping any line that is not JSON. */
export function parseLog(text) {
  const entries = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object") entries.push(entry);
    } catch {
      // A torn write from a killed hook; skip it.
    }
  }
  return entries;
}

export function readLog({ root } = {}) {
  try {
    return parseLog(readFileSync(logPath(root), "utf8"));
  } catch {
    return [];
  }
}

/**
 * The previous session's refusals, as `{ session, count, byHook }`, or null when there is
 * nothing to say: the current session was already told, or no earlier session was refused.
 * "Previous" is the session of the newest refusal that is not the current one.
 */
export function lastSessionRefusals(entries, currentSession) {
  if (entries.some((e) => e.kind === "noted" && e.session === currentSession)) return null;
  const refusals = entries.filter((e) => e.kind === "refusal");
  const previous = [...refusals].reverse().find((e) => e.session !== currentSession)?.session;
  if (!previous) return null;
  const mine = refusals.filter((e) => e.session === previous);
  const byHook = {};
  for (const entry of mine) byHook[entry.hook] = (byHook[entry.hook] ?? 0) + 1;
  return { session: previous, count: mine.length, byHook };
}

/** The sentence the per-prompt line carries, or "" when there is nothing to report. */
export function refusalLine(summary) {
  if (!summary || summary.count === 0) return "";
  const hooks = Object.entries(summary.byHook)
    .sort((a, b) => b[1] - a[1])
    .map(([hook, n]) => `${hook} ${n}`)
    .join(", ");
  return `${summary.count} hook refusal${summary.count === 1 ? "" : "s"} last session (${hooks}): if one fought you, add a papercut (docs/agents/papercuts.md)`;
}
