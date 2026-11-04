import { readFileSync } from "node:fs";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The scheduled routes' clock (S19b). What matters and is easy to break:
 * one schedule per config/crons.json entry, no retry anywhere (a route that
 * half-ran must not run again), and a dispatcher that reads its own secret and
 * never the app secret seed.
 */
function template() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDayCronDispatcher", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

describe("cron dispatcher", () => {
  const { crons } = JSON.parse(readFileSync("config/crons.json", "utf8")) as {
    crons: { path: string }[];
  };

  it("has one schedule per route, each calling the dispatcher with its path and no retry", () => {
    const t = template();
    for (const { path } of crons) {
      t.hasResourceProperties("AWS::Scheduler::Schedule", {
        Name: `diveday-cron-${path.replace("/api/cron/", "")}`,
        ScheduleExpressionTimezone: "Etc/UTC",
        Target: Match.objectLike({
          Input: JSON.stringify({ path }),
          RetryPolicy: { MaximumRetryAttempts: 0 },
        }),
      });
    }
  });

  it("does not let Lambda retry a failed invocation either", () => {
    template().hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
      MaximumRetryAttempts: 0,
    });
  });

  it("reads its own secret and never the app secret seed", () => {
    const text = JSON.stringify(template().toJSON());
    const policies = Object.values(
      template().findResources("AWS::IAM::Policy") as Record<string, unknown>,
    )
      .map((policy) => JSON.stringify(policy))
      .filter((policy) => policy.includes("CronDispatcherServiceRole"));
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).toContain("CronSecret");
      expect(policy).not.toContain("ApplicationSecretSeed");
    }
    expect(text).toContain("diveday/cron-secret");
  });
});
