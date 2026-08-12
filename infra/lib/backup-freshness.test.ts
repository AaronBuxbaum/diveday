import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
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
