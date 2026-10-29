import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BRANCH_PREFIX,
  BRANCH_TTL_MS,
  drillBranchName,
  logRow,
  newestDump,
  ownLines,
  POSTGRES_IMAGE,
  pgRestoreErrorSummary,
  roleFromConnectionUris,
  SWEEP_MIN_AGE_MS,
  scratchBranchProblem,
  subprocessEnv,
  sweepProblem,
  worstCaseMs,
} from "./restore-drill.mjs";

describe("newestDump", () => {
  it("picks the newest dated dump and ignores anything not shaped like one", () => {
    const dump = newestDump([
      { Key: "dumps/2026-10-12/diveday.dump.gz", Size: 90_000 },
      { Key: "dumps/2026-10-19/diveday.dump.gz", Size: 91_000 },
      { Key: "dumps/2026-10-26/notes.txt", Size: 10 },
      { Key: "dumps/2026-10-26/diveday.dump.gz.partial", Size: 10 },
      { Key: "exports/2026-10-30/blue-mantis.zip", Size: 10 },
    ]);
    expect(dump).toEqual({
      key: "dumps/2026-10-19/diveday.dump.gz",
      date: "2026-10-19",
      bytes: 91_000,
    });
  });

  it("answers null for an empty bucket", () => {
    expect(newestDump(undefined)).toBeNull();
    expect(newestDump([])).toBeNull();
  });
});

describe("scratchBranchProblem", () => {
  const created = { id: "br-scratch-1", name: `${BRANCH_PREFIX}20261023-1200` };

  it("clears the branch this run created", () => {
    expect(scratchBranchProblem(created, "br-scratch-1")).toBeNull();
  });

  it("refuses the production branch, however it is described", () => {
    expect(scratchBranchProblem({ ...created, default: true }, "br-scratch-1")).toMatch(/default/);
    expect(scratchBranchProblem({ ...created, primary: true }, "br-scratch-1")).toMatch(/default/);
    expect(scratchBranchProblem({ ...created, protected: true }, "br-scratch-1")).toMatch(
      /protected/,
    );
    expect(scratchBranchProblem({ id: "br-main", name: "main" }, "br-main")).toMatch(/named/);
  });

  it("refuses a branch this run did not create, even one named like a drill", () => {
    expect(scratchBranchProblem({ ...created, id: "br-other" }, "br-scratch-1")).toMatch(
      /not the branch this run created/,
    );
    expect(scratchBranchProblem(undefined, "br-scratch-1")).toMatch(/not the branch/);
    expect(scratchBranchProblem(created, null)).toMatch(/not the branch/);
  });
});

describe("drillBranchName", () => {
  it("names the drill, the minute and the run", () => {
    const at = new Date("2026-10-23T12:34:56Z");
    expect(drillBranchName(at, "987")).toBe("restore-drill-20261023-1234-987");
    expect(drillBranchName(at, undefined)).toBe("restore-drill-20261023-1234");
  });
});

describe("roleFromConnectionUris", () => {
  it("reads the role Neon names, or the URI's user", () => {
    expect(roleFromConnectionUris([{ connection_parameters: { role: "neondb_owner" } }])).toBe(
      "neondb_owner",
    );
    expect(
      roleFromConnectionUris([
        { connection_uri: "postgresql://app_owner:pw@ep-x.neon.tech/neondb" },
      ]),
    ).toBe("app_owner");
    expect(roleFromConnectionUris([])).toBeNull();
    expect(roleFromConnectionUris([{ connection_uri: "not a url" }])).toBeNull();
  });
});

describe("logRow", () => {
  it("is one table row with no connection details in it", () => {
    const row = logRow({
      date: "2026-10-23",
      dumpDate: "2026-10-19",
      branchSeconds: 4,
      restoreSeconds: 31,
      outcome: "restored, signed in, manifest read",
    });
    expect(row.startsWith("| 2026-10-23 |")).toBe(true);
    expect(row.split("|")).toHaveLength(9);
    expect(row).toContain("dump 2026-10-19: restored, signed in, manifest read");
  });
});

describe("sweepProblem", () => {
  const now = new Date("2026-11-02T09:00:00Z");
  const old = new Date(now.getTime() - SWEEP_MIN_AGE_MS - 1).toISOString();
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  const branch = (fields) => ({ id: "br-x", name: `${BRANCH_PREFIX}20261102-0700-555`, ...fields });

  it("deletes this run's own branch however young, and anyone's drill branch over an hour old", () => {
    expect(sweepProblem(branch({ created_at: fresh }), { now, runId: "555" })).toBeNull();
    expect(sweepProblem(branch({ created_at: old }), { now, runId: "999" })).toBeNull();
    expect(sweepProblem(branch({ created_at: old }), { now, runId: undefined })).toBeNull();
  });

  it("leaves another run's young branch alone: a drill by hand may be using it", () => {
    expect(sweepProblem(branch({ created_at: fresh }), { now, runId: "999" })).toBe("too young");
    expect(sweepProblem(branch({ created_at: fresh }), { now, runId: undefined })).toBe(
      "too young",
    );
    expect(sweepProblem(branch({ created_at: "not a date" }), { now, runId: "999" })).toBe(
      "too young",
    );
    // A run id that is only a suffix of the name's is not this run's.
    expect(sweepProblem(branch({ created_at: fresh }), { now, runId: "55" })).toBe("too young");
  });

  it("refuses the production branch even when it is old and named like this run's", () => {
    for (const fields of [{ default: true }, { primary: true }, { protected: true }]) {
      const problem = sweepProblem(branch({ created_at: old, ...fields }), { now, runId: "555" });
      expect(problem).toMatch(/default|protected/);
      expect(problem).not.toBe("too young");
    }
    expect(
      sweepProblem({ id: "br-main", name: "main", created_at: old }, { now, runId: "555" }),
    ).toMatch(/named/);
    expect(
      sweepProblem(
        { id: "br-y", name: "main-restore-drill-20261102-0700-555", created_at: old },
        { now, runId: "555" },
      ),
    ).toMatch(/named/);
  });
});

describe("the drill's timeouts", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/restore-drill.yml", import.meta.url),
    "utf8",
  );
  const steps = workflow.split(/\n {6}- /).slice(1);
  const minutes = (text) => Number(text.match(/\n\s*timeout-minutes: (\d+)/)?.[1]);
  const jobMinutes = Number(workflow.match(/\n {4}timeout-minutes: (\d+)/)?.[1]);
  const drillStep = steps.find((step) =>
    /run: node scripts\/restore-drill\.mjs\n/.test(`${step}\n`),
  );
  const sweepStep = steps.find((step) => step.includes("restore-drill.mjs --sweep"));

  it("bound every step, and add up to less than the job's", () => {
    expect(steps.length).toBeGreaterThan(5);
    for (const step of steps) expect(minutes(`\n${step}`)).toBeGreaterThan(0);
    const total = steps.reduce((sum, step) => sum + minutes(`\n${step}`), 0);
    expect(total).toBeLessThanOrEqual(jobMinutes);
  });

  it("let the script's own delete run before the step is killed", () => {
    expect(minutes(`\n${drillStep}`) * 60_000).toBeGreaterThan(worstCaseMs());
  });

  it("make a drill branch over an hour old belong to no running drill", () => {
    expect(minutes(`\n${drillStep}`) * 60_000).toBeLessThan(SWEEP_MIN_AGE_MS);
    expect(BRANCH_TTL_MS).toBeGreaterThan(jobMinutes * 60_000);
  });

  it("sweep after a failure, a timeout or a cancel", () => {
    expect(sweepStep).toMatch(/\n\s*if: always\(\)/);
  });
});

describe("pgRestoreErrorSummary", () => {
  const stderr = [
    "pg_restore: while PROCESSING TOC:",
    "pg_restore: from TOC entry 3311; 0 16450 TABLE DATA medical_answers neondb_owner",
    'pg_restore: error: COPY failed for table "medical_answers": ERROR:  invalid input syntax for type uuid: "secret-value-1"',
    'CONTEXT:  COPY medical_answers, line 812, column answers: "{\\"epilepsy\\": true}"',
    "pg_restore: from TOC entry 2990; 1259 16388 INDEX users_email_key neondb_owner",
    'pg_restore: error: could not execute query: ERROR:  could not create unique index "users_email_key"',
    "DETAIL:  Key (email)=(diver@example.com) is duplicated.",
    "Command was: CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);",
    'pg_restore: error: COPY failed for table "waiver_records": ERROR:  null value in column "signed_at" of relation "waiver_records" violates not-null constraint',
    "DETAIL:  Failing row contains (1, Ana Diver, ana@example.com, null).",
  ].join("\n");

  it("classifies SQL failures without exposing row values, identifiers or SQL", () => {
    const lines = pgRestoreErrorSummary(stderr);
    expect(lines).toEqual([
      "pg_restore diagnostic: sql_data (1 line)",
      "pg_restore diagnostic: redacted_detail (4 lines)",
      "pg_restore diagnostic: sql_integrity (2 lines)",
    ]);
    const printed = lines.join("\n");
    for (const secret of [
      "secret-value-1",
      "epilepsy",
      "medical_answers",
      "users_email_key",
      "waiver_records",
      "neondb_owner",
      "diver@example.com",
      "Ana Diver",
      "CREATE UNIQUE",
    ]) {
      expect(printed).not.toContain(secret);
    }
  });

  it("classifies representative connection, archive, version and SQL errors", () => {
    expect(
      pgRestoreErrorSummary(
        [
          'pg_restore: error: connection to server at "ep-secret.neon.tech" failed: password authentication failed for user "owner-secret"',
          "pg_restore: error: input file appears to be a text format dump. Please use psql.",
          "pg_restore: error: input file does not appear to be a valid archive (too short?)",
          "pg_restore: error: unsupported version (1.15) in file header",
          "pg_restore: error: could not read from input file: end of file",
          "pg_restore: error: could not execute query: ERROR:  40P01: deadlock detected",
          "pg_restore: error: could not execute query: ERROR:  permission denied for schema secret_schema",
        ].join("\n"),
      ),
    ).toEqual([
      "pg_restore diagnostic: connection (1 line)",
      "pg_restore diagnostic: archive_format (2 lines)",
      "pg_restore diagnostic: version_compatibility (1 line)",
      "pg_restore diagnostic: archive_incomplete_or_corrupt (1 line)",
      "pg_restore diagnostic: sql_transaction (1 line)",
      "pg_restore diagnostic: sql_permission (1 line)",
    ]);
  });

  it("never echoes unknown stderr or adversarial values and still reports its count", () => {
    const summary = pgRestoreErrorSummary(
      [
        'pg_restore: error: unexpected detail "Bearer ghp_super_secret" for patient@example.com',
        "private runner path /tmp/restore-drill/db-secret.dump",
        'DETAIL: Failing row contains (patient@example.com, "diagnosis-secret").',
        "CONTEXT: COPY medical_answers, line 3, column value",
        "Command was: INSERT INTO private_table VALUES ('row-secret')",
      ].join("\n"),
    );
    const printed = summary.join("\n");
    for (const secret of [
      "ghp_super_secret",
      "patient@example.com",
      "diagnosis-secret",
      "db-secret",
      "medical_answers",
      "row-secret",
      "private_table",
    ]) {
      expect(printed).not.toContain(secret);
    }
    expect(summary).toEqual([
      "pg_restore diagnostic: pg_restore_other (1 line)",
      "pg_restore diagnostic: unclassified_stderr (1 line)",
      "pg_restore diagnostic: redacted_detail (3 lines)",
    ]);
    expect(pgRestoreErrorSummary("")).toEqual([]);
  });
});

describe("ownLines", () => {
  it("keeps the verify script's own lines and withholds a stack or a pg message", () => {
    expect(
      ownLines(
        [
          "restore-drill-verify: FAILED with error (23505).",
          "error: duplicate key value: Key (email)=(diver@example.com)",
          "    at Pool.connect (node_modules/pg-pool/index.js:45)",
        ].join("\n"),
        "restore-drill-verify: ",
      ),
    ).toEqual([
      "restore-drill-verify: FAILED with error (23505).",
      "2 other stderr line(s) withheld: they can quote rows.",
    ]);
  });
});

describe("subprocessEnv", () => {
  it("hands a subprocess no Neon key, AWS session or GitHub token", () => {
    const env = subprocessEnv(
      {
        PATH: "/usr/bin",
        HOME: "/home/runner",
        PNPM_HOME: "/home/runner/pnpm",
        NEON_API_KEY: "neon-secret",
        NEON_PROJECT_ID: "proj",
        AWS_ACCESS_KEY_ID: "AKIA",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        AWS_SESSION_TOKEN: "aws-session",
        GH_TOKEN: "gh-secret",
        GITHUB_TOKEN: "gh-secret-2",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc",
        DATABASE_URL: "postgres://prod",
      },
      { NODE_ENV: "production", RESTORE_DATABASE_URL: "postgres://scratch" },
    );
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/runner",
      PNPM_HOME: "/home/runner/pnpm",
      NODE_ENV: "production",
      RESTORE_DATABASE_URL: "postgres://scratch",
    });
  });
});

describe("POSTGRES_IMAGE", () => {
  it("is pinned by digest, not only by a tag someone can move", () => {
    expect(POSTGRES_IMAGE).toMatch(/:17-alpine@sha256:[0-9a-f]{64}$/);
  });
});
