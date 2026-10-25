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
  const said = entries.filter((e) => e.kind === "refusal");
  const previous = [...said].reverse().find((e) => e.session !== currentSession)?.session;
  if (!previous) return null;
  const mine = said.filter((e) => e.session === previous);
  const byHook = {};
  for (const entry of mine) byHook[entry.hook] = (byHook[entry.hook] ?? 0) + 1;
  return { session: previous, count: mine.length, byHook };
}

/** The sentence the per-prompt line carries, or "" when there is nothing to report. */
export function refusalLine(summary) {
  if (!summary || summary.count === 0) return "";
  return refusedLine(summary);
}

function refusedLine(summary) {
  const hooks = Object.entries(summary.byHook)
    .sort((a, b) => b[1] - a[1])
    .map(([hook, n]) => `${hook} ${n}`)
    .join(", ");
  return `${summary.count} hook refusal${summary.count === 1 ? "" : "s"} last session (${hooks}): if one fought you, add a papercut (docs/agents/papercuts.md)`;
}

/** Refusals of one rule in this window, at or above this count, ask for a papercut. */
export const PAPERCUT_THRESHOLD = 3;
export const PAPERCUT_WINDOW_DAYS = 7;

/**
 * What a refusal's reason says once the command it quotes is taken out: the backticked spans
 * (and an unclosed one the 160-character cut left) and anything that is not a word go, and the
 * first eight words remain. Two refusals of `… | tail -8` and `… | head` by the same rule then
 * read the same, which is what "one rule refused three times" has to mean.
 */
export function ruleOf(reason) {
  return String(reason ?? "")
    .replace(/`[^`]*`/g, " ")
    .replace(/`.*$/, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && word !== "-")
    .slice(0, 8)
    .join(" ");
}

/**
 * The rule refused most often in the last PAPERCUT_WINDOW_DAYS, as `{ hook, rule, count, slug }`,
 * when it was refused PAPERCUT_THRESHOLD times or more; else null. Across sessions on purpose:
 * the log outlives a session but not the container, and three refusals of one rule in a week is
 * friction worth four lines in the repo whoever met it (2026-10-13 re-review, item 21).
 */
export function repeatedRefusal(entries, { now = new Date() } = {}) {
  const since = now.getTime() - PAPERCUT_WINDOW_DAYS * 86_400_000;
  const counts = new Map();
  for (const entry of entries) {
    if (entry.kind !== "refusal") continue;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || at < since) continue;
    const rule = ruleOf(entry.reason);
    const key = `${entry.hook}\u0000${rule}`;
    const seen = counts.get(key) ?? { hook: entry.hook, rule, count: 0 };
    seen.count += 1;
    counts.set(key, seen);
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  if (!top || top.count < PAPERCUT_THRESHOLD) return null;
  const slug = [top.hook, ...top.rule.split(" ").slice(0, 4)]
    .join("-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
  return { ...top, slug };
}

/** The per-prompt ask for a papercut, or "" when there is nothing to ask. */
export function papercutLine(repeat) {
  if (!repeat) return "";
  const what = repeat.rule ? ` (“${repeat.rule}”)` : "";
  return `${repeat.hook} refused one rule${what} ${repeat.count} times this week — write a papercut: node scripts/file-follow-up.mjs --papercut ${repeat.slug} --project <area> --symptom "<text>" --fix "<text>"`;
}
