#!/usr/bin/env node
// The monthly restore drill (pre-mortem 2026-10-23, item 3; H-154): restore the newest full-cluster
// dump into a scratch Neon branch, sign in as a seeded staffer, read tomorrow's manifest, delete
// the branch. Run by .github/workflows/restore-drill.yml; the procedure and every secret it needs
// are in docs/engineering/backup-and-restore-runbook.md ("Monthly restore drill").
//
//   node scripts/restore-drill.mjs
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
// Nothing here prints a connection string, a row, or a subprocess's environment: the dump holds
// every password hash and medical answer in the platform, and this runs in a CI log.

import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
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
/** pg_dump may be newer than its server, never older; the dump job pins the same major (§2c). */
export const POSTGRES_IMAGE = "public.ecr.aws/docker/library/postgres:17-alpine";
/** Far below any real dump; the freshness watchdog alarms under the same floor (§2c). */
export const MIN_DUMP_BYTES = 4 * 1024;

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

/**
 * The refusal that stands between this script and deleting production: the branch must be the one
 * this run created, carry the drill's name, and be neither the default nor a protected branch.
 */
export function scratchBranchProblem(branch, createdId) {
  if (!branch || branch.id !== createdId) return "is not the branch this run created";
  if (!String(branch.name ?? "").startsWith(BRANCH_PREFIX)) return `is not named ${BRANCH_PREFIX}*`;
  if (branch.default === true || branch.primary === true) return "is the project's default branch";
  if (branch.protected === true) return "is a protected branch";
  return null;
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

/** Attempts for a read or a delete whose socket died before it was sent; see `neon` below. */
const IDEMPOTENT_ATTEMPTS = 3;

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
      signal: AbortSignal.timeout(60_000),
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
async function waitForOperations(call, projectId, operations, deadlineMs = 300_000) {
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

    // 2. A scratch branch, and an empty database on it.
    const branchStarted = Date.now();
    const created = await call("POST", `/projects/${projectId}/branches`, {
      branch: { name: drillBranchName(new Date(), process.env.GITHUB_RUN_ID) },
      endpoints: [{ type: "read_write" }],
    });
    branchId = created.branch?.id ?? null;
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
    //    constant; the URL reaches it through the environment, never the argv.
    const restoreStarted = Date.now();
    const restore = runBounded(
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
        stdio: "inherit",
        env: { ...process.env, RESTORE_DATABASE_URL: uri },
        timeoutMs: SUBPROCESS_TIMEOUTS.pgRestore,
      },
    );
    if (restore.status !== 0) throw new Error("pg_restore did not complete.");
    restoreSeconds = Math.round((Date.now() - restoreStarted) / 1000);
    console.log(`restore-drill: restored in ${restoreSeconds}s`);

    // 4. Sign in and read tomorrow's manifest, through the app's own code.
    //    NODE_ENV=production because production admits the seeded staff through the demo bypass.
    const verify = runBounded("pnpm", ["exec", "tsx", "scripts/restore-drill-verify.ts"], {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", RESTORE_DATABASE_URL: uri },
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    });
    if (verify.status !== 0) throw new Error("Sign-in or the manifest read failed on the restore.");
    outcome = "restored, signed in, manifest read";
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    if (branchId) {
      // 5. Delete the branch, after checking once more that it is the scratch one.
      try {
        const { branch } = await call("GET", `/projects/${projectId}/branches/${branchId}`);
        const problem = scratchBranchProblem(branch, branchId);
        if (problem) {
          console.error(`restore-drill: NOT deleting branch ${branchId}: it ${problem}.`);
          outcome = `${outcome}; branch left in place`;
        } else {
          await call("DELETE", `/projects/${projectId}/branches/${branchId}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`restore-drill: ${error.message}`);
    process.exit(1);
  });
}
