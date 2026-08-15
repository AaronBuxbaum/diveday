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
 *  1. It can *list* the two backup buckets and nothing more. The reason the
 *     uploader credential is safe to keep in Vercel is that no principal
 *     reachable from the app can read a bundle back; a `s3:GetObject` quietly
 *     added here would undo that for a function that runs unattended every week.
 *  2. It is scheduled by AWS, not by Vercel. A watchdog that shares fate with
 *     the thing it watches cannot report the failure that matters most -- the
 *     pass never running at all.
 *  3. It is still ONE function. The dump moved into its own bucket on
 *     2026-08-15 and this check followed it there rather than being cloned:
 *     two alarms with the same trigger and the same reader is one too many.
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

  it("can list both backup buckets", () => {
    const rendered = template();
    for (const sid of ["ListBackupBundlesOnly", "ListDatabaseDumpsOnly"]) {
      rendered.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Sid: sid, Action: "s3:ListBucket" })]),
        }),
      });
    }
  });

  /*
   * ONE function over two buckets, which is the whole shape of the 2026-08-15
   * split on this side. The dump moved out of the bundles' bucket so that no
   * principal holding Vercel-resident credentials has a grant on it -- and the
   * stated reason this check covers both layers ("two alarms with the same
   * trigger and the same reader is one too many") had to survive that. It costs
   * one more ListBucket, asserted above, and a second watchdog would be the
   * regression: a second schedule, a second log group, a second thing to
   * remember exists, for one ListObjectsV2 call.
   */
  it("is one watchdog, not one per bucket", () => {
    const functions = template().findResources("AWS::Lambda::Function") as Record<
      string,
      { Properties?: { Code?: { ZipFile?: string } } }
    >;
    const watchdogs = Object.values(functions).filter((fn) =>
      (fn.Properties?.Code?.ZipFile ?? "").includes("backup_freshness."),
    );

    expect(watchdogs).toHaveLength(1);

    const schedules = template().findResources("AWS::Scheduler::Schedule") as Record<
      string,
      { Properties?: { Name?: string } }
    >;
    const freshness = Object.values(schedules).filter((schedule) =>
      (schedule.Properties?.Name ?? "").includes("freshness"),
    );
    expect(freshness).toHaveLength(1);
  });

  // The one that matters: a watchdog that could read a bundle would defeat the
  // write-only posture the uploader credential depends on. Worse for the dump
  // bucket, whose objects are every password hash in the platform.
  it("can never read, write or delete an object in either bucket", () => {
    const policies = template().findResources("AWS::IAM::Policy") as Record<
      string,
      { Properties?: { PolicyDocument?: { Statement?: { Sid?: string; Action?: unknown }[] } } }
    >;
    const listing = Object.values(policies)
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter(
        (statement) =>
          statement.Sid === "ListBackupBundlesOnly" || statement.Sid === "ListDatabaseDumpsOnly",
      );

    expect(listing).toHaveLength(2);
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
  /** The one `WriteBackupBundlesOnly` statement, or a failure saying so. */
  function uploaderStatement(): { Sid?: string; Action?: unknown; Resource?: unknown } {
    const policies = template().findResources("AWS::IAM::Policy") as Record<
      string,
      {
        Properties?: {
          PolicyDocument?: { Statement?: { Sid?: string; Action?: unknown; Resource?: unknown }[] };
        };
      }
    >;
    const uploads = Object.values(policies)
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter((statement) => statement.Sid === "WriteBackupBundlesOnly");

    expect(uploads).toHaveLength(1);
    return uploads[0] ?? {};
  }

  /**
   * The literal key pattern a grant ends in, lifted out of the `Fn::Join` that
   * CDK renders `arnForObjects()` into: the bucket ARN as a `Fn::GetAtt`,
   * followed by a plain string tail like `/exports/*`. Reading the tail is what
   * lets the resource be compared against a key the app actually builds.
   */
  function grantedKeyPattern(resource: unknown): string {
    const join = (resource as { "Fn::Join"?: [string, unknown[]] })?.["Fn::Join"];
    const tail = (join?.[1] ?? [])
      .filter((part): part is string => typeof part === "string")
      .join("");
    return tail.replace(/^\//, "");
  }

  // It moved out of the "nowhere yet" off-dotenv block and into the app's
  // environment when the runner landed. Still write-only: that is what makes
  // shipping it to Vercel acceptable at all.
  it("stays write-only, with no way to read a bundle back", () => {
    expect([uploaderStatement().Action].flat()).toEqual([
      "s3:PutObject",
      "s3:AbortMultipartUpload",
    ]);
  });

  /*
   * The half the test above does not cover, and did not until 2026-08-15: the
   * RESOURCE. The actions were pinned from the start, the resource was
   * `arnForObjects("*")`, and a write-only credential over the whole bucket can
   * still overwrite the weekly pg_dump under dumps/ -- the only artifact that
   * restores a login. S19's freshness check would not notice, because it asks
   * whether a dated prefix is recent and never what is in it.
   *
   * The dump left this bucket later the same day, which is what makes that
   * class of mistake unrepresentable rather than merely fixed. This assertion
   * outlives the move anyway: a credential that ships to a third party has no
   * business reaching anything it was not built to write, and the abandoned
   * pre-split dumps still sitting under `dumps/` stay out of its reach for
   * free.
   *
   * Asserted against the app's own key builders rather than against the string
   * "exports/", because the failure this guards is the two drifting apart. A
   * grant narrower than the keys fails as a backup that silently stops landing.
   */
  it("can write the bundle keys the app builds, and nothing under dumps/", () => {
    const pattern = grantedKeyPattern(uploaderStatement().Resource);
    expect(pattern).toBe("exports/*");

    const granted = pattern.replace(/\*$/, "");
    expect(platformBackupObjectKey("2026-08-12", "blue-mantis").startsWith(granted)).toBe(true);
    expect(
      platformBackupCensusKey("2026-08-12", {
        shops: 40,
        stored: 25,
        failed: 0,
        skipped: 15,
      }).startsWith(granted),
    ).toBe(true);

    // The prefix this exists to keep out of reach. Written by the CodeBuild
    // role in S20, which is scoped to its own prefix in the same way.
    expect("dumps/2026-08-12/diveday.dump.gz".startsWith(granted)).toBe(false);
  });
});

/**
 * The dump watchdog's size floor, run rather than read.
 *
 * The rest of this file inspects the inline Lambda's source, because a string
 * of JavaScript inside a CDK template cannot be imported. That is enough to
 * pin a format, and not enough to prove a decision: whether this function
 * ALARMS on a given bucket is the only thing it is for. So these evaluate the
 * deployed source against stub SDK clients and assert on what it publishes.
 *
 * The gap being closed: until 2026-08-15 `checkDump` asked only whether a dated
 * prefix under dumps/ existed and was recent. An object truncated to nothing,
 * or overwritten with garbage by anyone holding PutObject, read as a fresh
 * dump and this watchdog reported ok -- the failure being that the one artifact
 * that can restore a login was gone and the thing watching it said fine.
 */
describe("the dump watchdog, executed", () => {
  type Listing = {
    CommonPrefixes?: { Prefix?: string }[];
    Contents?: { Key?: string; Size?: number; LastModified?: Date }[];
  };
  // `Bucket` is unknown rather than string because the environment these run
  // against comes off the synthesized template, where a bucket name is a
  // CloudFormation reference object and not yet a name.
  type ListInput = { Bucket?: unknown; Prefix?: string; Delimiter?: string };

  /** `YYYY-MM-DD`, `daysAgo` days before now, in UTC as the watchdog reads it. */
  function runDate(daysAgo: number): string {
    return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  }

  /** The watchdog's deployed source and environment, straight off the template. */
  function deployedWatchdog(): { source: string; env: Record<string, unknown> } {
    const functions = template().findResources("AWS::Lambda::Function") as Record<
      string,
      {
        Properties?: {
          FunctionName?: string;
          Code?: { ZipFile?: string };
          Environment?: { Variables?: Record<string, string> };
        };
      }
    >;
    const watchdog = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === "diveday-backup-freshness-check",
    );
    const source = watchdog?.Properties?.Code?.ZipFile;
    if (typeof source !== "string") throw new Error("watchdog has no inline source");
    return { source, env: watchdog?.Properties?.Environment?.Variables ?? {} };
  }

  /**
   * Runs the deployed source with stubbed AWS clients and returns the alarms it
   * published. The environment comes off the synthesized template rather than
   * being invented here, so the floor under test is the floor that ships.
   */
  async function runWatchdog(
    listings: (input: ListInput) => Listing,
    onList: (input: ListInput) => void = () => {},
  ): Promise<string[]> {
    const { source, env } = deployedWatchdog();
    const alarms: string[] = [];

    class ListObjectsV2Command {
      constructor(readonly input: ListInput) {
        onList(input);
      }
    }
    class PublishCommand {
      constructor(readonly input: { Subject?: string; Message?: string }) {}
    }
    const require_ = (name: string) => {
      if (name === "@aws-sdk/client-s3") {
        return {
          ListObjectsV2Command,
          S3Client: class {
            async send(command: { input: ListInput }) {
              return listings(command.input);
            }
          },
        };
      }
      if (name === "@aws-sdk/client-sns") {
        return {
          PublishCommand,
          SNSClient: class {
            async send(command: { input: { Subject?: string } }) {
              alarms.push(command.input.Subject ?? "");
              return {};
            }
          },
        };
      }
      throw new Error(`watchdog required an unexpected module: ${name}`);
    };

    const moduleExports: { handler?: () => Promise<unknown> } = {};
    // `source` is this repository's own Lambda body, recovered from a template
    // this test synthesized a line ago -- not input, and nothing here
    // interpolates into it. Evaluating it is the point: the alternative is
    // asserting that a string contains the code we just wrote, which would pass
    // whether or not the function alarms.
    new Function("require", "exports", "process", "console", source)(
      require_,
      moduleExports,
      { env },
      { log: () => {} },
    );
    if (!moduleExports.handler) throw new Error("watchdog source exported no handler");
    await moduleExports.handler();
    // Only the dump arm is under test here; the bundle arm has its own coverage
    // and its alarms would otherwise make these assertions depend on it.
    return alarms.filter((subject) => subject.includes("database dump"));
  }

  /** A bucket whose newest dump is `bytes` big, written `daysAgo` days ago. */
  function bucketWithDump(daysAgo: number, bytes: number): (input: ListInput) => Listing {
    const date = runDate(daysAgo);
    return (input) => {
      if (input.Prefix === "dumps/" && input.Delimiter === "/") {
        return { CommonPrefixes: [{ Prefix: `dumps/${date}/` }] };
      }
      if (input.Prefix === `dumps/${date}/`) {
        return { Contents: [{ Key: `dumps/${date}/diveday.dump.gz`, Size: bytes }] };
      }
      // Enough of an exports/ side to let the handler finish.
      const today = runDate(0);
      if (input.Prefix === "exports/" && input.Delimiter === "/") {
        return { CommonPrefixes: [{ Prefix: `exports/${today}/` }] };
      }
      return {
        Contents: [
          { Key: `exports/${today}/blue-mantis.zip`, Size: 4096, LastModified: new Date() },
          {
            Key: `exports/${today}/_run.shops-1.stored-1.failed-0.skipped-0`,
            Size: 0,
            LastModified: new Date(),
          },
        ],
      };
    };
  }

  it("says nothing about a recent dump of a plausible size", async () => {
    expect(await runWatchdog(bucketWithDump(1, 40 * 1024 * 1024))).toEqual([]);
  });

  it("alarms on a recent dump that is too small to be one", async () => {
    const alarms = await runWatchdog(bucketWithDump(1, 200));
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toContain("too small");
  });

  it("alarms on an empty object where a dump should be", async () => {
    expect(await runWatchdog(bucketWithDump(1, 0))).toEqual([
      "DiveDay backup: the newest database dump is too small to be one",
    ]);
  });

  /*
   * One broken week, one alarm. A dump old enough to alarm on its age is very
   * likely also the wrong size, and two pages saying the same week is broken
   * teaches the reader to skim both.
   */
  it("reports a stale dump once, without also complaining about its size", async () => {
    const alarms = await runWatchdog(bucketWithDump(30, 0));
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toContain("no database dump in 30 days");
  });

  it("still alarms when the dump prefix has never been written at all", async () => {
    const alarms = await runWatchdog((input) =>
      input.Prefix === "dumps/" ? {} : bucketWithDump(0, 4096)(input),
    );
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toContain("ever");
  });

  it("floors the size at the value the stack actually deploys", () => {
    expect(deployedWatchdog().env.MIN_DUMP_BYTES).toBe("4096");
  });

  /*
   * The 2026-08-15 split, from the watchdog's side. The dump is no longer a
   * prefix in the bundles' bucket, so a function that kept reading `dumps/` in
   * `BUCKET` would find nothing and alarm every week -- or, worse, find the
   * abandoned legacy prefix and report a months-old dump as this week's. Each
   * listing has to go to the bucket that artifact now lives in, and nothing
   * else in this file would notice if it did not.
   */
  it("reads the dump from its own bucket and the bundles from theirs", async () => {
    const seen: ListInput[] = [];
    await runWatchdog(bucketWithDump(1, 40 * 1024 * 1024), (input) => seen.push(input));
    const { env } = deployedWatchdog();

    const dumpCalls = seen.filter((input) => (input.Prefix ?? "").startsWith("dumps/"));
    const bundleCalls = seen.filter((input) => (input.Prefix ?? "").startsWith("exports/"));
    expect(dumpCalls.length).toBeGreaterThan(0);
    expect(bundleCalls.length).toBeGreaterThan(0);
    expect(dumpCalls.length + bundleCalls.length).toBe(seen.length);

    for (const call of dumpCalls) expect(call.Bucket).toEqual(env.DUMP_BUCKET);
    for (const call of bundleCalls) expect(call.Bucket).toEqual(env.BUCKET);
    // And they really are two buckets, which is the point of the whole change.
    expect(JSON.stringify(env.DUMP_BUCKET)).not.toBe(JSON.stringify(env.BUCKET));
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
