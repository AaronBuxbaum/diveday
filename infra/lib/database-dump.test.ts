import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The full-cluster `pg_dump` layer (S20, ADR 20260812-platform-database-dump).
 *
 * The per-shop export bundles deliberately exclude `user_accounts`,
 * `account_tokens` and `calendar_feeds`, so a restore from bundles alone yields a
 * complete platform nobody can sign in to. This is the layer that closes that,
 * and what these assert are the properties that make holding such a file
 * defensible rather than the fact that a CodeBuild project exists:
 *
 *  1. **The job cannot read a bundle.** Since 2026-08-15 it holds no grant of
 *     any kind on the bundle bucket -- the dump lives in its own bucket, so a
 *     shop's exported waivers under `exports/` are out of reach rather than
 *     merely out of scope.
 *  2. **The file does not live forever.** A dump holds every password hash and
 *     every medical answer in the platform; unlike the bundles (indefinite,
 *     pending H-02) everything in its bucket expires -- and the bucket is
 *     unversioned, so expiring means gone rather than hidden behind a delete
 *     marker for another 35 days.
 *  3. **A truncated dump can never look like a good one.** `pipefail` is the
 *     whole reason a `pg_dump` that dies mid-stream fails the build instead of
 *     uploading a partial file and reporting success.
 *  4. **It is scheduled by AWS**, like the watchdog and for the same reason: a
 *     backup that can only run where the app runs shares fate with it.
 */
function template() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDayDatabaseDump", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

type RenderedBucket = {
  Properties?: {
    BucketName?: unknown;
    VersioningConfiguration?: unknown;
    LifecycleConfiguration?: {
      Rules?: { Id?: string; Prefix?: string; ExpirationInDays?: number }[];
    };
  };
};

/** The one synthesized bucket carrying this name, or undefined. */
function bucketNamed(name: string): RenderedBucket | undefined {
  const buckets = template().findResources("AWS::S3::Bucket") as Record<string, RenderedBucket>;
  return Object.values(buckets).find((bucket) => bucket.Properties?.BucketName === name);
}

/** Every statement on the dump job's own role, by sid. */
function dumpRoleStatements(): { Sid?: string; Action?: unknown; Resource?: unknown }[] {
  const policies = template().findResources("AWS::IAM::Policy") as Record<
    string,
    {
      Properties?: {
        PolicyDocument?: { Statement?: { Sid?: string; Action?: unknown; Resource?: unknown }[] };
      };
    }
  >;
  return Object.values(policies)
    .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
    .filter(
      (statement) =>
        statement.Sid === "WriteDatabaseDumpsOnly" || statement.Sid === "ConfirmDatabaseDumpLanded",
    );
}

function buildSpecOf(rendered: Template): string {
  const projects = rendered.findResources("AWS::CodeBuild::Project") as Record<
    string,
    { Properties?: { Name?: string; Source?: { BuildSpec?: string } } }
  >;
  const project = Object.values(projects).find(
    (entry) => entry.Properties?.Name === "diveday-database-dump",
  );
  const spec = project?.Properties?.Source?.BuildSpec;
  if (typeof spec !== "string") throw new Error("the dump project has no inline buildspec");
  return spec;
}

describe("the weekly database dump", () => {
  it("runs on EventBridge Scheduler, a day ahead of the watchdog that checks it", () => {
    template().hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "diveday-database-dump",
      ScheduleExpression: "cron(30 5 ? * MON *)",
      ScheduleExpressionTimezone: "Etc/UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
    });
  });

  it("runs a pinned Postgres image, because pg_dump may never be older than its server", () => {
    template().hasResourceProperties("AWS::CodeBuild::Project", {
      Name: "diveday-database-dump",
      Environment: Match.objectLike({
        Image: "public.ecr.aws/docker/library/postgres:17-alpine",
      }),
      Source: Match.objectLike({ Type: "NO_SOURCE" }),
    });
  });

  it("fails the build rather than uploading a truncated dump", () => {
    const spec = buildSpecOf(template());
    // Without pipefail the exit status is the *upload's*, so a pg_dump that died
    // mid-stream would store a partial file and report success -- the single
    // worst outcome available here.
    expect(spec).toContain("set -o pipefail");
    expect(spec).toContain("pg_dump");
    // Custom format, so a restore can reorder and parallelise; no owners or
    // grants, because the restore target's roles are not this cluster's.
    expect(spec).toContain("--format=custom");
    expect(spec).toContain("--no-owner");
    expect(spec).toContain("--no-privileges");
  });

  it("refuses to run before a human has supplied the connection string", () => {
    const spec = buildSpecOf(template());
    // A stack deployed but never handed a connection string must fail loudly on
    // its first run rather than write a zero-byte object every week forever.
    expect(spec).toContain("has not been filled in");
    expect(spec).toContain("exit 1");
  });

  it("reads back what it wrote instead of trusting the upload's exit code", () => {
    expect(buildSpecOf(template())).toContain("head-object");
  });

  it("keeps the connection string in its own secret, not the hand-off document", () => {
    // `diveday/env` is rewritten from a rendered .env.example on every deploy, so
    // a human-pasted value there would be silently overwritten.
    template().hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "diveday/database-url-unpooled",
    });
  });

  it("can write a dump and read one back only under its own prefix", () => {
    const statements = dumpRoleStatements();

    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      // Every resource this job touches is under `dumps/`, in the dump bucket.
      // The prefix stopped being the boundary on 2026-08-15 and the grant keeps
      // it anyway: widening it because the bucket is now dedicated is how a
      // dedicated bucket stops being dedicated.
      const rendered = JSON.stringify(statement.Resource);
      expect(rendered).toContain("dumps/*");
      expect(rendered).not.toBe('"*"');
    }
    const writing = statements.find((statement) => statement.Sid === "WriteDatabaseDumpsOnly");
    expect([writing?.Action].flat()).toEqual(["s3:PutObject", "s3:AbortMultipartUpload"]);
    // No delete, anywhere: a dump the job could remove is a dump ransomware could
    // remove with the same credential.
    for (const statement of statements) {
      for (const action of [statement.Action].flat()) {
        expect(String(action)).not.toMatch(/DeleteObject/);
      }
    }
  });

  /*
   * The 2026-08-15 split, from the dump job's side. Before it, "this job cannot
   * read a shop's exported waivers" was a claim about a PREFIX in a shared
   * bucket -- true, and true only for as long as every grant on that bucket was
   * remembered to be prefix-scoped. Now it is a claim about a bucket the job has
   * no grant on at all, which nothing can forget.
   */
  it("holds no grant of any kind on the bundle bucket", () => {
    for (const statement of dumpRoleStatements()) {
      const rendered = JSON.stringify(statement.Resource);
      expect(rendered).toContain("DatabaseDumpBucket");
      expect(rendered).not.toContain("DatabaseBackupBucket");
    }
  });

  it("writes to the dump bucket, not the bundle bucket", () => {
    const projects = template().findResources("AWS::CodeBuild::Project") as Record<
      string,
      {
        Properties?: {
          Name?: string;
          Environment?: { EnvironmentVariables?: { Name?: string; Value?: unknown }[] };
        };
      }
    >;
    const project = Object.values(projects).find(
      (entry) => entry.Properties?.Name === "diveday-database-dump",
    );
    const bucket = project?.Properties?.Environment?.EnvironmentVariables?.find(
      (variable) => variable.Name === "BUCKET",
    );

    expect(JSON.stringify(bucket?.Value)).toContain("DatabaseDumpBucket");
  });

  it("expires everything in the dump bucket, unlike the bundles next door", () => {
    const dumps = bucketNamed("diveday-database-dumps");
    const rules = dumps?.Properties?.LifecycleConfiguration?.Rules ?? [];

    const dumpRule = rules.find((rule) => rule.Id === "expire-database-dumps");
    // Unprefixed on purpose: this bucket holds dumps and nothing else, so a
    // future artifact parked outside `dumps/` is swept by the same 35 days
    // rather than quietly outliving them.
    expect(dumpRule?.Prefix).toBeUndefined();
    // Bounded on purpose: this file holds every password hash and every medical
    // answer in the platform, and it answers a question asked within days of a
    // loss, never months.
    expect(dumpRule?.ExpirationInDays).toBe(35);

    // And the bundles still do not expire -- H-02 makes waiver retention a legal
    // call, so a lifecycle rule must never be what decides a bundle is finished.
    const bundleRules = bucketNamed("diveday-backups")?.Properties?.LifecycleConfiguration?.Rules;
    const bundleRule = (bundleRules ?? []).find(
      (rule) => rule.Id === "age-backups-into-colder-storage",
    );
    expect(bundleRule?.ExpirationInDays).toBeUndefined();
  });

  /*
   * The property that makes "kept 35 days" true rather than approximately half
   * true. On a VERSIONED bucket a lifecycle expiration writes a delete marker
   * and keeps the bytes as a non-current version, so the shared bucket's
   * 35-day rule meant the file existed for up to 70 days -- twice the window
   * chosen for an artifact whose whole retention argument is that holding it
   * longer is a liability.
   */
  it("is unversioned, so an expiry is a deletion and not a delete marker", () => {
    expect(
      bucketNamed("diveday-database-dumps")?.Properties?.VersioningConfiguration,
    ).toBeUndefined();
    // The bundles keep versioning: theirs insures against an overwrite of a good
    // bundle by a bad one, and their retention is indefinite anyway.
    expect(bucketNamed("diveday-backups")?.Properties?.VersioningConfiguration).toEqual({
      Status: "Enabled",
    });
  });

  it("survives a cdk destroy, like the bundles", () => {
    const buckets = template().findResources("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
    }) as Record<string, { Properties?: { BucketName?: unknown } }>;

    expect(Object.values(buckets).map((bucket) => bucket.Properties?.BucketName)).toContain(
      "diveday-database-dumps",
    );
  });

  /*
   * The dumps this bucket held before the 2026-08-15 split are ABANDONED, not
   * drained. A `drain-legacy-database-dumps` rule expired them for a day, on
   * the assumption that they were real dumps worth waiting out roughly 70 days
   * of versioned lifecycle for; H-47 says otherwise -- DiveDay is pre-pilot,
   * the database is disposable, and what is under that prefix is seeded demo
   * data. So the rule went, and this asserts the bundle bucket now carries
   * exactly one lifecycle rule about bundles and nothing about dumps. Deleting
   * those objects is a human's `aws s3api delete-objects`, written down in
   * section 2c of the backup-and-restore runbook and deliberately not in code.
   */
  it("carries no lifecycle rule for the abandoned legacy dump prefix", () => {
    const rules = bucketNamed("diveday-backups")?.Properties?.LifecycleConfiguration?.Rules ?? [];

    expect(rules.map((rule) => rule.Id)).toEqual(["age-backups-into-colder-storage"]);
    expect(rules.some((rule) => rule.Prefix === "dumps/")).toBe(false);
  });

  it("is watched by the same weekly check as the bundles", () => {
    const functions = template().findResources("AWS::Lambda::Function") as Record<
      string,
      {
        Properties?: {
          FunctionName?: string;
          Code?: { ZipFile?: string };
          Environment?: { Variables?: Record<string, unknown> };
        };
      }
    >;
    const watchdog = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === "diveday-backup-freshness-check",
    );

    expect(watchdog?.Properties?.Environment?.Variables?.DUMP_PREFIX).toBe("dumps/");
    // Two buckets, one function. The stated reason the dump is checked here
    // rather than by a watchdog of its own -- two alarms with the same trigger
    // and the same reader is one too many -- survived the 2026-08-15 split at a
    // cost of one environment value and one ListBucket grant.
    expect(JSON.stringify(watchdog?.Properties?.Environment?.Variables?.DUMP_BUCKET)).toContain(
      "DatabaseDumpBucket",
    );
    const dumpWatchdogs = Object.values(functions).filter((fn) =>
      (fn.Properties?.Code?.ZipFile ?? "").includes("checkDump"),
    );
    expect(dumpWatchdogs).toHaveLength(1);

    // The dump is checked before the bundle logic, which returns early on each of
    // its own failures: a week where both layers broke has to raise both alarms.
    const code = watchdog?.Properties?.Code?.ZipFile ?? "";
    expect(code).toContain("checkDump");
    expect(code.indexOf("await checkDump")).toBeLessThan(code.indexOf('status: "never_run"'));
  });
});
