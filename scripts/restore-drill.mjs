#!/usr/bin/env node
// The monthly restore drill (pre-mortem 2026-10-23, item 3; H-154): restore the newest full-cluster
// dump into a scratch Neon branch, sign in as a seeded staffer, read tomorrow's manifest, delete
// the branch. Run by .github/workflows/restore-drill.yml; the procedure and every secret it needs
// are in docs/engineering/backup-and-restore-runbook.md ("Monthly restore drill").
//
//   node scripts/restore-drill.mjs            the drill
//   node scripts/restore-drill.mjs --sweep    delete a leftover restore-drill-* branch
//
// Environment: NEON_API_KEY, NEON_PROJECT_ID, AWS credentials that can list and read
// s3://<DUMP_BUCKET>/dumps/ (DUMP_BUCKET defaults to diveday-database-dumps), and docker for
// pg_restore. GITHUB_STEP_SUMMARY, when set, gets the result and a row for the runbook's log.
//
// **It never touches the production branch.** It creates one branch, named `restore-drill-...`,
// restores into a new, empty database on that branch (never the copy of production the branch
// starts with), and deletes only the branch id it created, after checking that branch is not the
// project's default or protected branch. Neon itself refuses to delete a default branch, so the
// check is a second lock, not the only one.
//
// **A killed run cannot leave production's copy behind for long.** The branch is created with a
// Neon expiry (`BRANCH_TTL_MS`), and the workflow's `if: always()` step runs `--sweep`, which
// deletes this run's branch and any `restore-drill-*` branch older than `SWEEP_MIN_AGE_MS`
// through the same guard. The script's own ceilings add up to less than the workflow step's
// timeout (`worstCaseMs`, tested against the workflow file), so its `finally` gets to run.
//
// Nothing here prints a connection string, a row, or a subprocess's environment: the dump holds
// every password hash and medical answer in the platform, and this runs in a CI log.
// pg_restore's and the verify step's stderr go to a file and only vetted lines are printed
// (`pgRestoreErrorSummary`, `ownLines`): a Postgres DETAIL or CONTEXT line quotes row values.
// Subprocesses get `subprocessEnv`, never the Neon key, AWS credentials or a GitHub token.

import {
  appendFileSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

// Overridable only so the drill can be rehearsed against a stub; the workflow never sets it.
const NEON_API = process.env.NEON_API_URL?.trim() || "https://console.neon.tech/api/v2";
export const DUMP_PREFIX = "dumps/";
export const DUMP_FILE = "diveday.dump.gz";
/** The database the dump is restored into, on the scratch branch. Never the branch's own copy. */
export const RESTORE_DATABASE = "restore_drill";
export const BRANCH_PREFIX = "restore-drill-";
/**
 * pg_dump may be newer than its server, never older; the dump job pins the same major (§2c).
 * This container receives a connection string and the whole dump. The dump job and this drill
 * read the same digest-pinned image; Dependabot watches the Dockerfile for updates.
 */
const imageManifest = readFileSync(
  new URL("../config/postgres-image/Dockerfile", import.meta.url),
  "utf8",
).trim();
const imageMatch =
  /^FROM (public\.ecr\.aws\/docker\/library\/postgres:17-alpine@sha256:[0-9a-f]{64})$/.exec(
    imageManifest,
  );
if (!imageMatch) throw new Error("Invalid pinned Postgres image manifest");
export const POSTGRES_IMAGE = imageMatch[1];
/** Far below any real dump; the freshness watchdog alarms under the same floor (§2c). */
export const MIN_DUMP_BYTES = 4 * 1024;
/** One Neon API request. Creates return at once; Neon's slow work is in `operations`. */
export const NEON_CALL_MS = 30_000;
/** Attempts for a read or a delete whose socket died before it was sent; see `neon` below. */
export const IDEMPOTENT_ATTEMPTS = 3;
/** How long one wait for a branch's or a database's operations may run. */
export const OPERATIONS_DEADLINE_MS = 180_000;
/** Neon deletes the branch itself this long after creating it, if nothing here did. */
export const BRANCH_TTL_MS = 3 * 60 * 60 * 1000;
/**
 * A drill branch this old belongs to no running drill (a drill's ceilings add up to less), so the
 * sweep may delete it even when another run made it.
 */
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * The longest the drill can run before its `finally` deletes the branch, from the ceilings below.
 * The workflow's drill step has to allow more than this, or a timeout kills the delete.
 */
export function worstCaseMs() {
  const neonRead = IDEMPOTENT_ATTEMPTS * NEON_CALL_MS + (IDEMPOTENT_ATTEMPTS - 1) * 1_000;
  const operations = OPERATIONS_DEADLINE_MS + neonRead + 2_000;
  return (
    SUBPROCESS_TIMEOUTS.awsApi +
    SUBPROCESS_TIMEOUTS.dumpDownload +
    NEON_CALL_MS + // create the branch
    neonRead + // look it up by name, when the create failed
    operations +
    NEON_CALL_MS + // create the database
    operations +
    neonRead + // the connection string
    SUBPROCESS_TIMEOUTS.pgRestore +
    SUBPROCESS_TIMEOUTS.nodeScript +
    neonRead + // the last check
    neonRead // the delete
  );
}

/**
 * The environment a subprocess gets: what finds programs and their config, and nothing that
 * signs in anywhere. The Neon key, the AWS session and any GitHub token stay in this process.
 * This stops inheritance and accidental printing; it is not a wall against a hostile
 * dependency, which can still read this process's environment from /proc.
 */
export const SUBPROCESS_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "CI",
  "PNPM_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
];

export function subprocessEnv(source, extra = {}) {
  const env = {};
  for (const key of SUBPROCESS_ENV_KEYS) {
    if (typeof source?.[key] === "string") env[key] = source[key];
  }
  return { ...env, ...extra };
}

/**
 * The newest `dumps/<YYYY-MM-DD>/diveday.dump.gz` in a `list-objects-v2` listing, or null.
 * Keys are date-first, so the newest is the largest key; anything not shaped like a dump is
 * ignored rather than trusted.
 */
export function newestDump(contents) {
  const pattern = /^dumps\/(\d{4}-\d{2}-\d{2})\/diveday\.dump\.gz$/;
  const dumps = (contents ?? [])
    .filter((object) => pattern.test(object?.Key ?? ""))
    .sort((a, b) => (a.Key < b.Key ? 1 : -1));
  if (dumps.length === 0) return null;
  const [newest] = dumps;
  return { key: newest.Key, date: newest.Key.match(pattern)[1], bytes: Number(newest.Size) };
}

/** A branch name that says what it is and when, so nobody mistakes it for production. */
export function drillBranchName(now, runId) {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `${BRANCH_PREFIX}${stamp}${runId ? `-${runId}` : ""}`;
}

/** Why a branch is not a drill branch at all: its name, or it is the default or protected. */
function drillBranchProblem(branch) {
  if (!String(branch?.name ?? "").startsWith(BRANCH_PREFIX))
    return `is not named ${BRANCH_PREFIX}*`;
  if (branch.default === true || branch.primary === true) return "is the project's default branch";
  if (branch.protected === true) return "is a protected branch";
  return null;
}

/**
 * The refusal that stands between this script and deleting production: the branch must be the one
 * this run created, carry the drill's name, and be neither the default nor a protected branch.
 */
export function scratchBranchProblem(branch, createdId) {
  if (!branch || !createdId || branch.id !== createdId) return "is not the branch this run created";
  return drillBranchProblem(branch);
}

/**
 * The sweep's refusal, for a branch it found by listing rather than created: a drill branch, not
 * the default or protected, and either this workflow run's own (its name ends in the run id) or
 * older than `SWEEP_MIN_AGE_MS`. "too young" is not an error: a drill by hand may still be using it.
 */
export function sweepProblem(branch, { now, runId }) {
  const problem = drillBranchProblem(branch);
  if (problem) return problem;
  const ownRun = runId ? branch.name.match(/^restore-drill-\d{8}-\d{4}-(\d+)$/)?.[1] : undefined;
  if (ownRun !== undefined && ownRun === String(runId)) return null;
  const created = Date.parse(branch.created_at ?? "");
  if (!Number.isFinite(created) || now.getTime() - created < SWEEP_MIN_AGE_MS) return "too young";
  return null;
}

/** SQLSTATEs for the server errors a restore meets, read from the message's opening words. */
const SQLSTATE_BY_MESSAGE = [
  [/^duplicate key value violates unique constraint/, "23505"],
  [/^could not create unique index/, "23505"],
  [/^null value in column/, "23502"],
  [/violates foreign key constraint/, "23503"],
  [/violates check constraint/, "23514"],
  [/^invalid input syntax for type/, "22P02"],
  [/^malformed array literal/, "22P02"],
  [/^value too long for type/, "22001"],
  [/^(extra data after last expected column|missing data for column)/, "22P04"],
  [/^relation .* already exists/, "42P07"],
  [/^relation .* does not exist/, "42P01"],
  [/^(type|function|schema|extension|role) .* does not exist/, "42704"],
  [/^(permission denied|must be owner)/, "42501"],
];

/** An object name as pg_restore prints it, with anything that is not an identifier dropped. */
function identifier(text) {
  const cleaned = String(text)
    .replace(/[^\w .$"-]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || null;
}

/**
 * What of pg_restore's stderr is safe for a CI log: per error, its SQLSTATE and the object it hit,
 * and a count of the lines withheld. A Postgres error's DETAIL, CONTEXT and "Failing row" lines,
 * and even its message (`invalid input syntax for type uuid: "..."`), can quote a row.
 */
export function pgRestoreErrorSummary(stderr) {
  const lines = [];
  let withheld = 0;
  let toc = null;
  for (const line of String(stderr ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const tocEntry = line.match(/^pg_restore: from TOC entry \d+; \d+ \d+ (.+)$/);
    if (tocEntry) {
      // "<desc> <tag> <owner>": keep the kind and name, drop the owner.
      toc = identifier(tocEntry[1].replace(/\s+\S+$/, ""));
      continue;
    }
    const error = line.match(/^pg_restore: error: (.*)$/);
    if (!error) {
      withheld += 1;
      continue;
    }
    const at = error[1].indexOf("ERROR:");
    if (at === -1) {
      // pg_restore's own words (a truncated archive, a lost connection), never a server's.
      lines.push(`pg_restore error: ${error[1].slice(0, 200)}`);
      toc = null;
      continue;
    }
    const own = error[1].slice(0, at);
    const server = error[1].slice(at + "ERROR:".length).trim();
    const code =
      server.match(/^([0-9A-Z]{5}):/)?.[1] ??
      SQLSTATE_BY_MESSAGE.find(([pattern]) => pattern.test(server))?.[1] ??
      "unknown";
    const object = toc ?? identifier(own.match(/"([^"]{1,63})"/)?.[1] ?? "") ?? "an unnamed object";
    lines.push(`pg_restore error: SQLSTATE ${code} on ${object}`);
    toc = null;
  }
  if (withheld > 0) {
    lines.push(`${withheld} other stderr line(s) withheld: they can quote rows.`);
  }
  return lines;
}

/** The lines a script printed under its own prefix, and a count of the rest. */
export function ownLines(stderr, prefix) {
  const lines = [];
  let withheld = 0;
  for (const line of String(stderr ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    if (line.startsWith(prefix)) lines.push(line);
    else withheld += 1;
  }
  if (withheld > 0) {
    lines.push(`${withheld} other stderr line(s) withheld: they can quote rows.`);
  }
  return lines;
}

/** The role a branch's connection string connects as, from the first URI Neon returned. */
export function roleFromConnectionUris(connectionUris) {
  const parameters = connectionUris?.[0]?.connection_parameters;
  if (parameters?.role) return parameters.role;
  const uri = connectionUris?.[0]?.connection_uri;
  if (!uri) return null;
  try {
    return decodeURIComponent(new URL(uri).username) || null;
  } catch {
    return null;
  }
}

/** One markdown row for the runbook's restore test log. */
export function logRow({ date, dumpDate, branchSeconds, restoreSeconds, outcome }) {
  return `| ${date} | restore-drill workflow | (record it) | ${branchSeconds}s branch, ${restoreSeconds}s restore | not checked by the drill | dump ${dumpDate}: ${outcome} | |`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function neon(apiKey) {
  const send = (method, path, body) =>
    fetch(`${NEON_API}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(NEON_CALL_MS),
    });
  return async function call(method, path, body) {
    // pg_restore and the verify step block this process for minutes, and the server closes the
    // idle keep-alive sockets meanwhile; the next call then fails on a dead socket ("other side
    // closed") before anything is sent -- rehearsed against a stub on 2026-10-23, where it stopped
    // the branch delete. A read or a delete is safe to send again, after a pause that lets the
    // event loop see the closes; a create is never sent twice.
    const attempts = method === "GET" || method === "DELETE" ? IDEMPOTENT_ATTEMPTS : 1;
    let response;
    for (let attempt = 1; !response; attempt += 1) {
      try {
        response = await send(method, path, body);
      } catch (error) {
        if (attempt >= attempts) throw error;
        await sleep(1_000);
      }
    }
    const text = await response.text();
    if (!response.ok) {
      // Status and path only: an error body can echo the request.
      throw Object.assign(new Error(`Neon ${method} ${path} answered ${response.status}.`), {
        status: response.status,
      });
    }
    return text ? JSON.parse(text) : {};
  };
}

/** Wait for Neon's operations on the branch to finish; the next call is refused (423) until they do. */
async function waitForOperations(call, projectId, operations, deadlineMs = OPERATIONS_DEADLINE_MS) {
  const started = Date.now();
  for (const operation of operations ?? []) {
    for (;;) {
      const { operation: state } = await call(
        "GET",
        `/projects/${projectId}/operations/${operation.id}`,
      );
      if (state?.status === "finished") break;
      if (state?.status === "failed" || state?.status === "error") {
        throw new Error(`Neon operation ${operation.action ?? operation.id} failed.`);
      }
      if (Date.now() - started > deadlineMs) {
        throw new Error(
          `Neon operation ${operation.action ?? operation.id} did not finish in time.`,
        );
      }
      await sleep(2_000);
    }
  }
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `restore-drill needs ${missing.join(", ")}. The restore-drill environment holds them; docs/engineering/backup-and-restore-runbook.md ("Monthly restore drill") says where each one comes from.`,
    );
  }
}

/**
 * The id of the one branch named `name`, or null. For a create that failed after Neon may already
 * have made the branch (a timeout on the response), so the `finally` can still delete it.
 */
async function branchIdByName(call, projectId, name) {
  const { branches } = await call(
    "GET",
    `/projects/${projectId}/branches?${new URLSearchParams({ search: name })}`,
  );
  const matches = (branches ?? []).filter((branch) => branch?.name === name);
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Delete one branch after a fresh read passes `check`. Answers null when deleted, or the refusal;
 * a Neon error is thrown.
 */
async function deleteCheckedBranch(call, projectId, branchId, check) {
  const { branch } = await call("GET", `/projects/${projectId}/branches/${branchId}`);
  const problem = check(branch);
  if (problem) return problem;
  await call("DELETE", `/projects/${projectId}/branches/${branchId}`);
  return null;
}

function summary(lines) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${lines.join("\n")}\n`);
}

async function main() {
  requireEnv(["NEON_API_KEY", "NEON_PROJECT_ID"]);
  const projectId = process.env.NEON_PROJECT_ID.trim();
  const bucket = process.env.DUMP_BUCKET?.trim() || "diveday-database-dumps";
  const call = neon(process.env.NEON_API_KEY.trim());
  const today = new Date().toISOString().slice(0, 10);

  // 1. The newest dump, and a size worth trusting.
  const listing = JSON.parse(
    readBounded(
      "aws",
      ["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", DUMP_PREFIX, "--output", "json"],
      { encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.awsApi },
    ) || "{}",
  );
  const dump = newestDump(listing.Contents);
  if (!dump) throw new Error(`No dump under s3://${bucket}/${DUMP_PREFIX}. Nothing to restore.`);
  if (!(dump.bytes >= MIN_DUMP_BYTES)) {
    throw new Error(
      `The newest dump (${dump.key}) is ${dump.bytes} bytes, under ${MIN_DUMP_BYTES}.`,
    );
  }
  console.log(`restore-drill: newest dump ${dump.key}, ${dump.bytes} bytes`);

  const workdir = mkdtempSync(join(tmpdir(), "restore-drill-"));
  let branchId = null;
  let outcome = "failed";
  let branchSeconds = "?";
  let restoreSeconds = "?";
  try {
    const download = runBounded(
      "aws",
      ["s3", "cp", "--only-show-errors", `s3://${bucket}/${dump.key}`, join(workdir, DUMP_FILE)],
      { stdio: "inherit", timeoutMs: SUBPROCESS_TIMEOUTS.dumpDownload },
    );
    if (download.status !== 0) throw new Error("Downloading the dump failed.");
    if (statSync(join(workdir, DUMP_FILE)).size !== dump.bytes) {
      throw new Error("The downloaded dump is not the size S3 listed.");
    }

    // 2. A scratch branch that expires on its own, and an empty database on it.
    const branchStarted = Date.now();
    const branchName = drillBranchName(new Date(), process.env.GITHUB_RUN_ID);
    const findCreated = () => branchIdByName(call, projectId, branchName).catch(() => null);
    let created;
    try {
      created = await call("POST", `/projects/${projectId}/branches`, {
        branch: {
          name: branchName,
          expires_at: new Date(Date.now() + BRANCH_TTL_MS).toISOString(),
        },
        endpoints: [{ type: "read_write" }],
      });
    } catch (error) {
      // A timeout can land after Neon made the branch: find it so the `finally` deletes it.
      branchId = await findCreated();
      throw error;
    }
    branchId = created.branch?.id ?? (await findCreated());
    const problem = scratchBranchProblem(created.branch, branchId);
    if (problem)
      throw new Error(`The branch Neon returned ${problem}; refusing to restore into it.`);
    const role = roleFromConnectionUris(created.connection_uris);
    if (!role) throw new Error("Neon returned no role for the new branch.");
    await waitForOperations(call, projectId, created.operations);
    const database = await call("POST", `/projects/${projectId}/branches/${branchId}/databases`, {
      database: { name: RESTORE_DATABASE, owner_name: role },
    });
    await waitForOperations(call, projectId, database.operations);
    branchSeconds = Math.round((Date.now() - branchStarted) / 1000);
    const { uri } = await call(
      "GET",
      `/projects/${projectId}/connection_uri?${new URLSearchParams({
        branch_id: branchId,
        database_name: RESTORE_DATABASE,
        role_name: role,
      })}`,
    );
    if (!uri) throw new Error("Neon returned no connection string for the restore database.");
    // GitHub masks what it is told to; the password must never reach the log.
    if (process.env.GITHUB_ACTIONS === "true") {
      const password = decodeURIComponent(new URL(uri).password);
      if (password) console.log(`::add-mask::${password}`);
      console.log(`::add-mask::${uri}`);
    }
    console.log(`restore-drill: branch ${branchId} ready in ${branchSeconds}s`);

    // 3. pg_restore, in the dump job's own Postgres major. The script inside the container is a
    //    constant; the URL reaches it through the environment, never the argv. Its stderr goes to
    //    a file in `workdir` and only `pgRestoreErrorSummary` of it is printed.
    const restoreStarted = Date.now();
    const restoreStderr = join(workdir, "pg_restore.stderr");
    const restore = withStderrFile(restoreStderr, (stderrFd) =>
      runBounded(
        "docker",
        [
          "run",
          "--rm",
          "-e",
          "RESTORE_DATABASE_URL",
          "-v",
          `${workdir}:/dump:ro`,
          POSTGRES_IMAGE,
          "sh",
          "-c",
          `set -eo pipefail; gunzip -c /dump/${DUMP_FILE} | pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-privileges --exit-on-error`,
        ],
        {
          stdio: ["ignore", "inherit", stderrFd],
          env: subprocessEnv(process.env, { RESTORE_DATABASE_URL: uri }),
          timeoutMs: SUBPROCESS_TIMEOUTS.pgRestore,
        },
      ),
    );
    for (const line of pgRestoreErrorSummary(readFileSync(restoreStderr, "utf8"))) {
      console.error(`restore-drill: ${line}`);
    }
    if (restore.status !== 0) throw new Error("pg_restore did not complete.");
    restoreSeconds = Math.round((Date.now() - restoreStarted) / 1000);
    console.log(`restore-drill: restored in ${restoreSeconds}s`);

    // 4. Sign in and read tomorrow's manifest, through the app's own code.
    //    NODE_ENV=production because production admits the seeded staff through the demo bypass.
    //    Its stderr is filtered to its own vetted lines, as pg_restore's is.
    const verifyStderr = join(workdir, "verify.stderr");
    const verify = withStderrFile(verifyStderr, (stderrFd) =>
      runBounded("pnpm", ["exec", "tsx", "scripts/restore-drill-verify.ts"], {
        stdio: ["ignore", "inherit", stderrFd],
        env: subprocessEnv(process.env, { NODE_ENV: "production", RESTORE_DATABASE_URL: uri }),
        timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
      }),
    );
    for (const line of ownLines(readFileSync(verifyStderr, "utf8"), "restore-drill-verify: ")) {
      console.error(line);
    }
    if (verify.status !== 0) throw new Error("Sign-in or the manifest read failed on the restore.");
    outcome = "restored, signed in, manifest read";
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    if (branchId) {
      // 5. Delete the branch, after checking once more that it is the scratch one.
      try {
        const problem = await deleteCheckedBranch(call, projectId, branchId, (branch) =>
          scratchBranchProblem(branch, branchId),
        );
        if (problem) {
          console.error(`restore-drill: NOT deleting branch ${branchId}: it ${problem}.`);
          outcome = `${outcome}; branch left in place`;
          // A refusal leaves a copy of production behind: the run is red, whatever came before.
          process.exitCode = 1;
        } else {
          console.log(`restore-drill: deleted branch ${branchId}`);
        }
      } catch (error) {
        console.error(
          `restore-drill: could not delete branch ${branchId} (${error.message}${error.cause?.code ? `, ${error.cause.code}` : ""}). Delete it in the Neon console: it holds a copy of production.`,
        );
        outcome = `${outcome}; branch ${branchId} NOT deleted`;
        process.exitCode = 1;
      }
    }
    summary([
      "## Restore drill",
      "",
      `- Dump: \`${dump.key}\` (${dump.bytes} bytes)`,
      `- Branch ready: ${branchSeconds}s; restore: ${restoreSeconds}s`,
      `- Outcome: ${outcome}`,
      "",
      "Row for the runbook's restore test log:",
      "",
      "```",
      logRow({ date: today, dumpDate: dump.date, branchSeconds, restoreSeconds, outcome }),
      "```",
    ]);
  }
}

/**
 * The workflow's `if: always()` step: delete this run's branch, if the drill's own `finally` never
 * ran (a timeout, a cancel, a create that timed out after Neon made it), and any drill branch older
 * than `SWEEP_MIN_AGE_MS`. A refused or failed delete makes the step red.
 */
async function sweep() {
  if (!process.env.NEON_API_KEY?.trim() || !process.env.NEON_PROJECT_ID?.trim()) {
    console.log("restore-drill --sweep: no Neon key or project here, so no branch to delete.");
    return;
  }
  const projectId = process.env.NEON_PROJECT_ID.trim();
  const call = neon(process.env.NEON_API_KEY.trim());
  const runId = process.env.GITHUB_RUN_ID;
  const { branches } = await call(
    "GET",
    `/projects/${projectId}/branches?${new URLSearchParams({ search: BRANCH_PREFIX })}`,
  );
  const drills = (branches ?? []).filter((branch) =>
    String(branch?.name ?? "").startsWith(BRANCH_PREFIX),
  );
  for (const listed of drills) {
    const check = (branch) =>
      !branch || branch.id !== listed.id
        ? "is not the branch the listing named"
        : sweepProblem(branch, { now: new Date(), runId });
    try {
      const problem = await deleteCheckedBranch(call, projectId, listed.id, check);
      if (problem === "too young") {
        console.log(`restore-drill --sweep: left ${listed.id}: under an hour old, not this run's.`);
      } else if (problem) {
        console.error(`restore-drill --sweep: NOT deleting branch ${listed.id}: it ${problem}.`);
        process.exitCode = 1;
      } else {
        console.log(`restore-drill --sweep: deleted leftover branch ${listed.id}`);
      }
    } catch (error) {
      console.error(
        `restore-drill --sweep: could not delete branch ${listed.id} (${error.message}). Delete it in the Neon console: it holds a copy of production.`,
      );
      process.exitCode = 1;
    }
  }
  if (drills.length === 0) console.log("restore-drill --sweep: no restore-drill-* branch left.");
}

/** Run `fn` with a file descriptor for a subprocess's stderr, closed whatever happens. */
function withStderrFile(path, fn) {
  const fd = openSync(path, "w");
  try {
    return fn(fd);
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv.includes("--sweep") ? sweep() : main()).catch((error) => {
    console.error(`restore-drill: ${error.message}`);
    process.exit(1);
  });
}
