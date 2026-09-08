#!/usr/bin/env node
// A `PostToolUseFailure` hook on `Bash`: when a command fails with an error this repository
// already has a written answer for, attach the answer to the failure.
//
// The debug skill's symptom table holds these answers, and a session that has not opened
// the skill does not have them. The shape of the waste is always the same: a known,
// benign-or-documented failure — the dev-server lock, the PGlite data-directory refusal, a
// `blocking-prerender-*` build error — starts a diagnostic spiral that reads logs, restarts
// processes, and rediscovers a sentence that was already written down. Attaching the
// sentence to the failure is cheaper than every alternative, and costs nothing when no
// signature matches, which is almost always.
//
// It never blocks (the tool has already failed) and it fails open: an unmatched or
// unparseable failure produces no output at all. Each answer is one or two sentences and
// points at the skill or doc that holds the rest; the hook is a signpost, not a manual.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Error signatures with their written answers. Order matters only where two could match
 * the same text; the first wins.
 */
export const SIGNATURES = [
  {
    match: /Another next dev server is already running/,
    explain:
      "The dev-server lock is `.next/dev/lock`, one per checkout — `--port` does not buy a second server. Use the running one (the supervisor names its port) or stop it with the run skill's steps; never delete the lock while its process is alive.",
  },
  {
    match: /is already open by process \d+/,
    explain:
      "PGlite's data directory is held by the named process (src/db/data-dir-lock.ts; ADR 20260903-one-process-per-pglite-directory). Stop that process or point this one at another `PGLITE_DATA_DIR`; two openers would silently fork the database.",
  },
  {
    match: /blocking-prerender-(?:dynamic|client-hook)/,
    explain:
      "A request-scoped read sits above `{children}` in a layout, or a page lacks its `loading.tsx` boundary. The route named in the error needs the read moved into an async child under its own `<Suspense>` — see the instant-navigation skill and ADR 20260804-instant-navigation.",
  },
  {
    match: /ECONNREFUSED[^\n]*(?:127\.0\.0\.1|localhost):3\d{3}/,
    explain:
      "The dev server is not listening. If it was running, it was most likely OOM-killed — nothing is logged when that happens. Restart `pnpm dev` and wait for its `dev: serving … — warmed in Ns` line, not Next's earlier `✓ Ready` (run skill).",
  },
  {
    match: /EADDRINUSE/,
    explain:
      "The port is taken, usually by an earlier dev server or e2e worker. `node scripts/stray-processes.mjs --list` names what is holding it; never `pkill` a sibling session's server.",
  },
  {
    match: /relation "[^"]+" does not exist|column "[^"]+" does not exist/,
    explain:
      "The database was built from the committed migration chain and the schema change has no migration yet — `pnpm db:generate` after editing src/db/schema.ts (schema-change skill).",
  },
  {
    match: /Test timeout of \d+ms exceeded while setting up "[^"]+"/,
    explain:
      "Playwright names whichever fixture was in flight when the budget ran out, which is rarely the slow one. The debug skill's symptom table has the diagnosis path; `waitForTimeout` and retries are refused by `pnpm check:e2e-hygiene`.",
  },
  {
    match: /db:reset[^\n]*refus|refuses while a dev server is running/i,
    explain:
      "`pnpm db:reset` refuses while a dev server holds the database, naming the pid. Stop the server first (run skill); the refusal is protecting the running process's writes.",
  },
  // Last on purpose: this one is a *bystander*. It rides along in the output of
  // an e2e run that failed for some other reason, and the whole point is that
  // it is not the failure — so anything more specific must match first.
  {
    match: /The destination stream closed early/,
    explain:
      "That line is almost certainly not your failure. It is React's own cancellation text (`createCancelHandler`, on the destination stream's `close` event): a client closed a streaming response before React finished writing it, and in this suite that is nearly always a `<Link>` prefetch the next navigation abandoned. It can mark a real action-race, so check whether an assertion sits between the click and the navigation. Look elsewhere in the output for the actual failure. The debug skill's symptom table has the short form, docs/agents/repo-checks.md's action-race section the measurement.",
  },
];

/** The answer for a failure, or null when nothing here recognises it. */
export function explanationFor(command, error) {
  const text = `${command ?? ""}\n${error ?? ""}`;
  if (/Refused by scripts\/guard-/.test(text)) return null;
  for (const signature of SIGNATURES) {
    if (signature.match.test(text)) return signature.explain;
  }
  return null;
}

async function main() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;
  const parsed = JSON.parse(payload);
  if (parsed.tool_name !== "Bash") return;

  const explanation = explanationFor(parsed.tool_input?.command, parsed.tool_error);
  if (!explanation) return;

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUseFailure",
        additionalContext: `Known failure (scripts/explain-failure.mjs): ${explanation}`,
      },
    })}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    // Fail open: an unexplained failure is the ordinary case, not an error.
  }
  process.exit(0);
}
