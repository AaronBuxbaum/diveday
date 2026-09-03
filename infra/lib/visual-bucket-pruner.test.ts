import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * Visual regression bucket pruner tests (ADR 20260826-prune-visual-bucket).
 */
function template() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDayVisualPrunerTest", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

describe("visual regression bucket pruner", () => {
  it("runs on EventBridge Scheduler on a daily schedule", () => {
    template().hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "diveday-visual-bucket-pruner",
      ScheduleExpression: "cron(0 4 * * ? *)",
      ScheduleExpressionTimezone: "Etc/UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
    });
  });

  it("is a Lambda with the bucket and repo environment variables", () => {
    template().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "diveday-visual-bucket-pruner",
      Runtime: "nodejs24.x",
      Timeout: 900,
      Environment: {
        Variables: Match.objectLike({
          GITHUB_REPO: "AaronBuxbaum/diveday",
          DEFAULT_BRANCH: "main",
        }),
      },
    });
  });

  it("holds scoped IAM permissions on the visual regression bucket only", () => {
    const rendered = template();
    rendered.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: "ListVisualBucketOnly", Action: "s3:ListBucket" }),
          Match.objectLike({
            Sid: "ManageVisualBucketObjects",
            Action: ["s3:GetObject", "s3:DeleteObject"],
          }),
        ]),
      }),
    });
  });

  it("keeps its own log group bounded to 1 month retention", () => {
    template().hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/diveday-visual-bucket-pruner",
      RetentionInDays: 30,
    });
  });

  // The pruner keeps ten main baselines by COUNT plus a seven-day floor; the
  // lifecycle rule counts only days. At 30 the rule deleted the very snapshots
  // the pruner preserved, and a run with no baseline reports `Changed: 0`,
  // which reads exactly like nothing broke. The rule may only ever be a floor
  // beneath the pruner, so this pins it well past anything the pruner keeps.
  it("expires objects far beyond the pruner's own retention, never inside it", () => {
    template().hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: "expire-old-visual-snapshots",
            Status: "Enabled",
            ExpirationInDays: 180,
          }),
        ]),
      },
    });
  });
});
