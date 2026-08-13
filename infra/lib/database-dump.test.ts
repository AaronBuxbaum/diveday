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
 *  1. **The job cannot read a bundle.** Its write access is scoped to `dumps/`,
 *     so the principal that runs unattended every week can never reach a shop's
 *     exported waivers under `exports/`.
 *  2. **The file does not live forever.** A dump holds every password hash and
 *     every medical answer in the platform; unlike the bundles (indefinite,
 *     pending H-02) its prefix expires.
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
    const policies = template().findResources("AWS::IAM::Policy") as Record<
      string,
      {
        Properties?: {
          PolicyDocument?: { Statement?: { Sid?: string; Action?: unknown; Resource?: unknown }[] };
        };
      }
    >;
    const statements = Object.values(policies)
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter(
        (statement) =>
          statement.Sid === "WriteDatabaseDumpsOnly" ||
          statement.Sid === "ConfirmDatabaseDumpLanded",
      );

    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      // Every resource this job touches is under `dumps/`. The exports/ prefix
      // beside it holds every shop's exported waivers, and an unattended weekly
      // job has no business reaching it.
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

  it("expires the dumps, unlike the bundles beside them", () => {
    const buckets = template().findResources("AWS::S3::Bucket") as Record<
      string,
      {
        Properties?: {
          BucketName?: unknown;
          LifecycleConfiguration?: {
            Rules?: { Id?: string; Prefix?: string; ExpirationInDays?: number }[];
          };
        };
      }
    >;
    const backup = Object.values(buckets).find(
      (bucket) => bucket.Properties?.BucketName === "diveday-backups",
    );
    const rules = backup?.Properties?.LifecycleConfiguration?.Rules ?? [];

    const dumpRule = rules.find((rule) => rule.Id === "expire-database-dumps");
    expect(dumpRule?.Prefix).toBe("dumps/");
    // Bounded on purpose: this file holds every password hash and every medical
    // answer in the platform, and it answers a question asked within days of a
    // loss, never months.
    expect(dumpRule?.ExpirationInDays).toBe(35);

    // And the bundles still do not expire -- H-02 makes waiver retention a legal
    // call, so a lifecycle rule must never be what decides a bundle is finished.
    const bundleRule = rules.find((rule) => rule.Id === "age-backups-into-colder-storage");
    expect(bundleRule?.ExpirationInDays).toBeUndefined();
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
    // The dump is checked before the bundle logic, which returns early on each of
    // its own failures: a week where both layers broke has to raise both alarms.
    const code = watchdog?.Properties?.Code?.ZipFile ?? "";
    expect(code).toContain("checkDump");
    expect(code.indexOf("await checkDump")).toBeLessThan(code.indexOf('status: "never_run"'));
  });
});
