// Gate freshness — how long each human-owned gate in docs/product/human-decisions.md has sat
// without recorded movement, reconciled against rollout.md's "next 30 days" list.
//
// This is a REPORT, not a gate. It always exits 0 and is deliberately not part of
// `pnpm check:repo`: every row it reports on is a human conversation, a regulator's
// queue, or a boat day, so nothing an agent does in this repo can turn one green.
// Failing the build on it would only teach sessions to route around it. What it can do
// is make a stall visible on demand, which is the whole ask (review action item 24).
//
// **Precision is the design problem.** A hand-maintained "last touched" column would go
// stale exactly when the rows it describes do, so nothing here is hand-maintained. Two
// independent kinds of evidence exist, and neither is authoritative alone:
//
//   1. A dated outcome written into the row itself ("Decided 2026-07-30 (Aaron Buxbaum)").
//      A human wrote a date next to an outcome. Strongest signal, and exact.
//   2. The commit that last touched the row's line (`git blame`). Weaker — a typo fix is
//      not movement — but it exists for rows nobody has ever dated. In a shallow clone
//      (CI and this harness both use one) every line older than the graft boundary is
//      attributed to the boundary commit, so that date is only a *lower* bound: the row
//      last changed at or before it. Those ages print as "≥ N days", never as a number
//      the evidence can't carry.
//
// Time: `pnpm check:clock` guards src/lib, src/db, and src/features — not scripts/ — so
// the bare `new Date()` in `main()` below is in bounds. Every function that reasons about
// time still takes `now` as a parameter, because that is what makes the parsing testable
// (`scripts/gate-freshness.test.mjs`) without a frozen wall clock.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER = "docs/product/human-decisions.md";
const ROLLOUT = "docs/product/rollout.md";
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Parsing — pure, exported for the unit test.
// ---------------------------------------------------------------------------

/**
 * A row's lifecycle state, collapsed from the register's own status key. "open" is the
 * only one that means a human owes an action right now; "parked" is a deliberate
 * Deferred; "closed" needs nothing. An unrecognised status is treated as open on
 * purpose — a status this script has never seen is not evidence that anything is done.
 */
export function classifyStatus(status) {
  if (/^(Implemented|Validated|Dropped)\b/.test(status)) return "closed";
  if (/^Deferred\b/.test(status)) return "parked";
  return "open";
}

/** The newest `YYYY-MM-DD` written anywhere in a chunk of text, or null. */
export function latestDateIn(text) {
  let newest = null;
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (newest === null || match[0] > newest) newest = match[0];
  }
  return newest;
}

/**
 * Every `| H-nn |` / `| V-nn |` table row in the register, with its 1-based line number
 * so `git blame` can be joined onto it. Both tables (decision register and verification
 * queue) share the shape `| id | status | … |`, so one pattern covers them.
 */
export function parseGateRows(markdown) {
  const rows = [];
  markdown.split("\n").forEach((line, index) => {
    const match = /^\|\s*([HV]-\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (!match) return;
    rows.push({
      id: match[1],
      status: match[2],
      state: classifyStatus(match[2]),
      line: index + 1,
      datedOutcome: latestDateIn(line),
    });
  });
  return rows;
}

/**
 * Gate ids named in a sentence, expanding ranges: "H-01–H-03" is three rows, not two,
 * and the middle one is exactly the sort of thing a reconciliation is supposed to catch.
 */
export function gateIdsIn(text) {
  const ids = new Set();
  for (const match of text.matchAll(/\b([HV])-(\d+)\s*[–—-]\s*(?:\1-)?(\d+)\b/g)) {
    const [, prefix, from, to] = match;
    for (let n = Number(from); n <= Number(to); n += 1) {
      ids.add(`${prefix}-${String(n).padStart(2, "0")}`);
    }
  }
  for (const match of text.matchAll(/\b([HV])-(\d+)\b/g)) ids.add(`${match[1]}-${match[2]}`);
  return [...ids].sort();
}

/**
 * The rollout plan's "next 30 days, in order" list: its stated authorship date (which is
 * when the 30-day clock started) and one entry per numbered item, continuation lines
 * folded in so an id mentioned on the second line of an item still counts.
 */
export function parseThirtyDayList(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^##\s+The next 30 days/.test(line));
  const items = [];
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (/^##\s/.test(line)) break;
      const numbered = /^(\d+)\.\s+(.*)$/.exec(line);
      if (numbered) items.push({ number: Number(numbered[1]), text: numbered[2] });
      else if (line.trim() && items.length > 0) items[items.length - 1].text += ` ${line.trim()}`;
    }
  }
  return { writtenOn: /Written (\d{4}-\d{2}-\d{2})/.exec(markdown)?.[1] ?? null, items };
}

// ---------------------------------------------------------------------------
// Ageing — pure, exported for the unit test.
// ---------------------------------------------------------------------------

/** Whole days from an ISO date (or Date) to `now`, floored, never negative. */
export function daysSince(from, now) {
  const at = from instanceof Date ? from.getTime() : Date.parse(`${from}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

/**
 * The best defensible statement about when a row last moved. `blame` is
 * `{ at: Date, bounded: boolean }` or null — `bounded` meaning the blamed commit sits on
 * the shallow graft boundary, so the real edit happened at or before it.
 */
export function movementFor(row, blame, now) {
  if (row.datedOutcome) {
    return {
      on: row.datedOutcome,
      days: daysSince(row.datedOutcome, now),
      atLeast: false,
      evidence: "dated outcome in the row",
    };
  }
  if (blame?.at) {
    const on = blame.at.toISOString().slice(0, 10);
    return {
      on,
      days: daysSince(on, now),
      atLeast: blame.bounded,
      evidence: blame.bounded ? "last edit (history truncated)" : "last edit to the row",
    };
  }
  return { on: null, days: null, atLeast: false, evidence: "no dated outcome, no history" };
}

/**
 * Join the 30-day list onto the register. "Should have started but has not moved" is read
 * strictly: an item is unstarted when it names gate rows and *none* of them has reached a
 * closed state. Items that name no row at all (recruit shops, decide DEMA) are reported
 * as unmeasurable rather than quietly passing — the register cannot see them, and saying
 * so is more useful than a green line that means nothing.
 */
export function reconcileThirtyDays(items, rowsById) {
  return items.map((item) => {
    const ids = gateIdsIn(item.text);
    const known = ids.filter((id) => rowsById.has(id)).map((id) => rowsById.get(id));
    const closed = known.filter((row) => row.state === "closed");
    const newest = known.reduce(
      (best, row) =>
        row.movement.on && (!best || row.movement.on > best) ? row.movement.on : best,
      null,
    );
    return {
      ...item,
      ids,
      unknownIds: ids.filter((id) => !rowsById.has(id)),
      known,
      closedCount: closed.length,
      newestMovement: newest,
      unmeasurable: known.length === 0,
      unstarted: known.length > 0 && closed.length === 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Git evidence.
// ---------------------------------------------------------------------------

function git(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

/** Shas at the shallow graft boundary; blame attributions to these are lower bounds. */
function graftedShas() {
  const shallowPath = git(["rev-parse", "--git-path", "shallow"])?.trim();
  if (!shallowPath) return new Set();
  try {
    const absolute = path.isAbsolute(shallowPath) ? shallowPath : path.join(ROOT, shallowPath);
    return new Set(
      readFileSync(absolute, "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/** line number -> { at: Date, bounded } for one tracked file, or null when git can't say. */
function blameByLine(file, grafted) {
  const output = git(["blame", "--line-porcelain", "--", file]);
  if (!output) return null;
  const byLine = new Map();
  let sha = null;
  let lineNumber = null;
  let authorTime = null;
  for (const line of output.split("\n")) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (header) {
      sha = header[1];
      lineNumber = Number(header[2]);
      authorTime = null;
    } else if (line.startsWith("author-time ")) {
      authorTime = Number(line.slice("author-time ".length)) * 1000;
    } else if (line.startsWith("\t") && lineNumber !== null && authorTime !== null) {
      byLine.set(lineNumber, { at: new Date(authorTime), bounded: grafted.has(sha) });
      lineNumber = null;
    }
  }
  return byLine;
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const pad = (value, width) => String(value).padEnd(width);
const padStart = (value, width) => String(value).padStart(width);
const age = (movement) =>
  movement.days === null ? "—" : `${movement.atLeast ? "≥" : ""}${movement.days}d`;

function printRows(heading, rows) {
  if (rows.length === 0) return;
  console.log(`\n${heading}`);
  console.log(
    `  ${pad("id", 6)}${pad("status", 24)}${pad("last movement", 15)}${padStart("age", 5)}  evidence`,
  );
  for (const row of rows) {
    const status = row.status.length > 22 ? `${row.status.slice(0, 21)}…` : row.status;
    console.log(
      `  ${pad(row.id, 6)}${pad(status, 24)}${pad(row.movement.on ?? "unknown", 15)}` +
        `${padStart(age(row.movement), 5)}  ${row.movement.evidence}`,
    );
  }
}

async function main() {
  const now = new Date();
  const register = readFileSync(path.join(ROOT, REGISTER), "utf8");
  const rollout = readFileSync(path.join(ROOT, ROLLOUT), "utf8");

  const grafted = graftedShas();
  const blame = blameByLine(REGISTER, grafted);
  const rows = parseGateRows(register).map((row) => ({
    ...row,
    movement: movementFor(row, blame?.get(row.line) ?? null, now),
  }));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const open = rows.filter((row) => row.state === "open").sort(byAgeDescending);
  const parked = rows.filter((row) => row.state === "parked").sort(byAgeDescending);
  const closed = rows.filter((row) => row.state === "closed");

  console.log(`Gate freshness — ${REGISTER}, read ${now.toISOString().slice(0, 10)}`);
  console.log(
    `${rows.length} gate rows: ${open.length} open, ${parked.length} deferred, ${closed.length} closed.`,
  );
  if (!blame) {
    console.log("git blame unavailable — ages come only from dates written in the rows.");
  } else if ([...blame.values()].some((entry) => entry.bounded)) {
    console.log(
      "Shallow history: ages marked ≥ are lower bounds — the row last changed at or before that date.",
    );
  }

  printRows("Open — a human owes an action (oldest first)", open);
  printRows("Deferred — parked on purpose, still not closed", parked);

  const { writtenOn, items } = parseThirtyDayList(rollout);
  const reconciled = reconcileThirtyDays(items, rowsById);
  const elapsed = writtenOn ? daysSince(writtenOn, now) : null;
  console.log(
    `\nRollout "next 30 days" (${ROLLOUT}${
      writtenOn ? `, written ${writtenOn} — day ${elapsed} of 30` : ""
    })`,
  );
  for (const item of reconciled) {
    const flag = item.unmeasurable
      ? "NO GATE ROW"
      : item.unstarted
        ? "NOT STARTED"
        : `${item.closedCount}/${item.known.length} closed`;
    const ids = item.ids.length > 0 ? item.ids.join(" ") : "—";
    const moved = item.newestMovement
      ? ` · newest movement ${item.newestMovement}`
      : " · no dated movement";
    console.log(`  ${padStart(`${item.number}.`, 4)} ${pad(flag, 13)} ${pad(ids, 30)}${moved}`);
    console.log(`       ${truncate(item.text, 92)}`);
    if (item.unknownIds.length > 0) {
      console.log(`       names ${item.unknownIds.join(" ")}, absent from the register`);
    }
  }

  const stalled = reconciled.filter((item) => item.unstarted);
  const unmeasurable = reconciled.filter((item) => item.unmeasurable);
  console.log(`\n${listSummary(stalled, reconciled.length, "have no closed gate row")}`);
  console.log(
    listSummary(unmeasurable, reconciled.length, "name no gate row — check those by hand"),
  );
  console.log("Report only — nothing here fails a build, and nothing here is an agent's to close.");
}

function listSummary(matched, total, phrase) {
  const numbers = matched.map((item) => item.number).join(", ");
  return `${matched.length} of ${total} listed items ${phrase}${numbers ? ` (${numbers})` : ""}.`;
}

function byAgeDescending(a, b) {
  if (a.movement.days === null) return -1;
  if (b.movement.days === null) return 1;
  return b.movement.days - a.movement.days || a.id.localeCompare(b.id);
}

function truncate(text, width) {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
