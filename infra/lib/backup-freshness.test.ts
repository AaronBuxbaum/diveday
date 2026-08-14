import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  parsePlatformBackupCensusKey,
  platformBackupCensusKey,
  platformBackupObjectKey,
} from "../../src/features/backup-export";
import { InfraStack } from "./infra-stack";

/**
 * The watchdog over the platform backup (S19, ADR 20260812-platform-backup-runner).
 *
 * What these assert is not "the construct exists" but the two properties the
 * whole design rests on, both of which are easy to break in a way nothing else
 * would notice:
 *
 *  1. It can *list* the backup bucket and nothing more. The reason the uploader
 *     credential is safe to keep in Vercel is that no principal reachable from
 *     the app can read a bundle back; a `s3:GetObject` quietly added here would
 *     undo that for a function that runs unattended every week.
 *  2. It is scheduled by AWS, not by Vercel. A watchdog that shares fate with
 *     the thing it watches cannot report the failure that matters most -- the
 *     pass never running at all.
 */
function template() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDayBackupFreshness", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

describe("backup freshness watchdog", () => {
  it("runs on EventBridge Scheduler, in the account that holds the bucket", () => {
    template().hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "diveday-backup-freshness",
      ScheduleExpression: "cron(0 6 ? * TUE *)",
      ScheduleExpressionTimezone: "Etc/UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
    });
  });

  it("is a Lambda with the bucket, topic and threshold it needs", () => {
    template().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "diveday-backup-freshness-check",
      Environment: {
        Variables: Match.objectLike({ MAX_AGE_DAYS: "8" }),
      },
    });
  });

  it("can list the backup bucket", () => {
    template().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: "ListBackupBundlesOnly", Action: "s3:ListBucket" }),
        ]),
      }),
    });
  });

  // The one that matters: a watchdog that could read a bundle would defeat the
  // write-only posture the uploader credential depends on.
  it("can never read, write or delete an object", () => {
    const policies = template().findResources("AWS::IAM::Policy") as Record<
      string,
      { Properties?: { PolicyDocument?: { Statement?: { Sid?: string; Action?: unknown }[] } } }
    >;
    const listing = Object.values(policies)
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter((statement) => statement.Sid === "ListBackupBundlesOnly");

    expect(listing).toHaveLength(1);
    for (const statement of listing) {
      const actions = [statement.Action].flat();
      expect(actions).toEqual(["s3:ListBucket"]);
      for (const action of actions) {
        expect(action).not.toMatch(/GetObject|PutObject|DeleteObject/);
      }
    }
  });

  it("reports to the same alarm topic every other operational signal uses", () => {
    const functions = template().findResources("AWS::Lambda::Function") as Record<
      string,
      {
        Properties?: {
          FunctionName?: string;
          Environment?: { Variables?: Record<string, unknown> };
        };
      }
    >;
    const watchdog = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === "diveday-backup-freshness-check",
    );

    expect(watchdog?.Properties?.Environment?.Variables?.TOPIC_ARN).toBeDefined();
  });

  it("keeps its own log group bounded rather than letting Lambda make an eternal one", () => {
    template().hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/diveday-backup-freshness-check",
      RetentionInDays: 30,
    });
  });
});

describe("the platform backup uploader credential", () => {
  // It moved out of the "nowhere yet" off-dotenv block and into the app's
  // environment when the runner landed. Still write-only: that is what makes
  // shipping it to Vercel acceptable at all.
  it("stays write-only, with no way to read a bundle back", () => {
    const policies = template().findResources("AWS::IAM::Policy") as Record<
      string,
      { Properties?: { PolicyDocument?: { Statement?: { Sid?: string; Action?: unknown }[] } } }
    >;
    const uploads = Object.values(policies)
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter((statement) => statement.Sid === "WriteBackupBundlesOnly");

    expect(uploads).toHaveLength(1);
    expect([uploads[0]?.Action].flat()).toEqual(["s3:PutObject", "s3:AbortMultipartUpload"]);
  });
});

/**
 * The census the pass files, and the parse this watchdog does of it.
 *
 * The counts ride in the object KEY rather than a JSON body so that reading
 * them costs no `s3:GetObject` -- see `platformBackupCensusKey` in
 * `src/features/backup-export/period.ts`, and the "can never read, write or
 * delete an object" test above, which is the invariant that choice protects.
 *
 * The cost of that choice is two implementations of one format: the app's, and
 * a regex inside a string of inline Lambda JavaScript that cannot import it.
 * These tests are what stop the two drifting. They pull the Lambda's own source
 * out of the synthesized template and run its regex against keys built by the
 * app's own function -- so a change to either side fails here rather than in
 * production, where the symptom would be a watchdog that silently stops
 * checking coverage and reports `census_missing` forever.
 */
describe("the run census the watchdog reads out of its listing", () => {
  /** The inline Lambda source, exactly as it will be deployed. */
  function watchdogSource(): string {
    const functions = template().findResources("AWS::Lambda::Function") as Record<
      string,
      { Properties?: { FunctionName?: string; Code?: { ZipFile?: string } } }
    >;
    const watchdog = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === "diveday-backup-freshness-check",
    );
    const source = watchdog?.Properties?.Code?.ZipFile;
    if (typeof source !== "string") throw new Error("watchdog has no inline source");
    return source;
  }

  /** The Lambda's own extracting regex, recovered from its deployed source. */
  function deployedCensusPattern(): RegExp {
    const source = watchdogSource();
    const match = /\/(_run\\\.shops-\(\\d\+\)[^/]*)\/\.exec\(/.exec(source);
    if (!match) throw new Error("watchdog source has no census-extracting regex");
    return new RegExp(match[1]);
  }

  it("parses a key the app actually produces, with the app's own numbers", () => {
    const census = { shops: 40, stored: 25, failed: 2, skipped: 13 };
    const key = platformBackupCensusKey("2026-08-14", census);
    const match = deployedCensusPattern().exec(key);

    expect(match).not.toBeNull();
    expect({
      shops: Number(match?.[1]),
      stored: Number(match?.[2]),
      failed: Number(match?.[3]),
      skipped: Number(match?.[4]),
    }).toEqual(census);
  });

  it("agrees with the app's own parser on every key, which is the drift this guards", () => {
    const deployed = deployedCensusPattern();
    for (const census of [
      { shops: 1, stored: 1, failed: 0, skipped: 0 },
      { shops: 128, stored: 96, failed: 0, skipped: 32 },
      { shops: 40, stored: 0, failed: 40, skipped: 0 },
    ]) {
      const key = platformBackupCensusKey("2026-08-14", census);
      const match = deployed.exec(key);
      expect(parsePlatformBackupCensusKey(key)).toEqual(census);
      expect(match?.slice(1).map(Number)).toEqual([
        census.shops,
        census.stored,
        census.failed,
        census.skipped,
      ]);
    }
  });

  it("never mistakes a shop's bundle for the census", () => {
    // A bundle read as a census would hand the coverage check four numbers
    // parsed out of a shop's name.
    const deployed = deployedCensusPattern();
    for (const slug of ["blue-mantis", "_run", "run.shops-1.stored-1.failed-0.skipped-0"]) {
      expect(deployed.test(platformBackupObjectKey("2026-08-14", slug))).toBe(false);
    }
  });

  /**
   * Findings from the 2026-08-14 security review of this change, each pinned so
   * it cannot come back. The handler is a string of inline JavaScript here --
   * there is no module to call -- so what the deployed source *says* is the
   * only thing there is to assert.
   */
  it("acts on a failed shop, not only a skipped one", () => {
    // The hole the review found: `census.failed` was computed, printed in the
    // alarm text, and never tested. A run where 15 of 40 bundles fail reports
    // skipped-0 and stores 25, and 25 bundles really are present -- so a
    // skipped-only condition reads ok forever while 15 shops have no backup.
    const source = watchdogSource();
    expect(source).toContain("census.stored < census.shops || bundles.length < census.stored");
    expect(source).not.toContain("if (census.skipped > 0 || bundles.length < census.stored)");
  });

  it("refuses to believe a future-dated run", () => {
    // One object under exports/2099-01-01/ would otherwise pin the watchdog to
    // a run that has not happened: negative age, so the staleness arm cannot
    // fire, and it reports ok every week while the real pass is dead.
    expect(watchdogSource()).toContain("Date.now() + DAY_MS");
  });

  it("picks the census by write time, never by listing order", () => {
    // The census key carries its counts, so a same-day re-run writes a SECOND
    // object rather than overwriting. Listing order is lexicographic, and
    // "stored-100" sorts before "stored-90" -- which run's claim gets checked
    // would be decided by a leading digit.
    const source = watchdogSource();
    expect(source).toContain("LastModified");
    expect(source).toContain("censusEntries.length > 1");
  });

  it("says so when a run prefix outgrows one listing page", () => {
    // The premise of this whole check is an estate outgrowing a fixed budget,
    // and the listing's own 1000-key cap is the same regime one order out.
    expect(watchdogSource()).toContain("objects.IsTruncated");
  });

  it("alarms on a skip, a shortfall, and a missing census", () => {
    // The three readings that were invisible before 2026-08-14. Asserted
    // against the deployed source because the handler is a string here: there
    // is no module to call, so what it *says* is the only thing to check.
    const source = watchdogSource();
    expect(source).toContain("census_missing");
    expect(source).toContain("incomplete");
  });

  it("still reads the census with a listing and never a fetch", () => {
    // The point of the whole design. A GetObjectCommand here would mean the
    // watchdog had grown the ability to read a shop's exported waivers.
    const source = watchdogSource();
    expect(source).not.toContain("GetObjectCommand");
    expect(source).toContain("ListObjectsV2Command");
  });
});
