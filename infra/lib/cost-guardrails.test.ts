import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The cost guardrail (infra-stack.ts S7, ADR 20260802-aws-cost-guardrails as
 * amended 2026-08-12 and 2026-09-10).
 *
 * The failure these assertions exist for is not "the budget is missing" -- a
 * missing budget is loud, because no alert ever arrives and the first anyone
 * knows is an invoice. It is the quieter one the ADR has now hit three times:
 * **a threshold that fires every month on cost that never changes**, which
 * teaches its only reader to filter the sender. That is what happened when the
 * fixed floor grew past $5, then past a useful fraction of $30, and finally
 * past $30 altogether when Business Support+ landed at ~$25/month. (That
 * subscription is gone since 2026-11-02, and the first notification moved
 * back down with the floor.)
 *
 * So the thing pinned here is the relationship between the floor and the first
 * notification, not the numbers for their own sake. Move the floor, and this
 * test tells you which figures move with it.
 */

/**
 * What this account costs with nobody using DiveDay, read off the August and
 * early-September 2026 bills, less the $25 Business Support+
 * line that went away when the account dropped to Basic on 2026-11-02. Kept here rather than imported because it is a
 * *measurement*, and the stack must not be able to silently agree with a wrong
 * one: if these two drift apart, that is the finding.
 */
const MONTHLY_FIXED_FLOOR_USD = 18.55;

type Notification = {
  Notification: {
    NotificationType: "ACTUAL" | "FORECASTED";
    ComparisonOperator: string;
    Threshold: number;
    ThresholdType: string;
  };
  Subscribers: Array<{ SubscriptionType: string; Address: string }>;
};

function budget(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context });
  const template = Template.fromStack(
    new InfraStack(app, "DiveDay", { env: { account: "123456789012", region: "us-east-1" } }),
  );
  const budgets = Object.values(template.findResources("AWS::Budgets::Budget"));
  expect(budgets).toHaveLength(1);
  const properties = budgets[0].Properties as {
    Budget: { BudgetType: string; TimeUnit: string; BudgetLimit: { Amount: number; Unit: string } };
    NotificationsWithSubscribers: Notification[];
  };
  return properties;
}

describe("the monthly cost guardrail", () => {
  it("is a monthly cost budget capped at $90 by default", () => {
    const { Budget } = budget();
    expect(Budget.BudgetType).toBe("COST");
    expect(Budget.TimeUnit).toBe("MONTHLY");
    expect(Budget.BudgetLimit).toEqual({ Amount: 90, Unit: "USD" });
  });

  it("takes its cap from --context monthlyBudgetLimit", () => {
    expect(budget({ monthlyBudgetLimit: 250 }).Budget.BudgetLimit.Amount).toBe(250);
  });

  /**
   * The 2026-09-10 amendment, and the only assertion here that is really about
   * a *type*. A percentage threshold is a statement about the cap; the bill is
   * what anyone wants to be told about. The two are interchangeable only while
   * the floor is small, and this account's stopped being small.
   */
  it("states every threshold in dollars, never as a percentage of the cap", () => {
    for (const entry of budget().NotificationsWithSubscribers) {
      expect(entry.Notification.ThresholdType).toBe("ABSOLUTE_VALUE");
      expect(entry.Notification.ComparisonOperator).toBe("GREATER_THAN");
    }
  });

  /**
   * The whole point of the guardrail: the first email means "something is
   * running that was not running before". A threshold at or below the floor
   * cannot mean that -- it arrives on the 1st of every month whatever anyone
   * does -- and one too far above it stops being early.
   */
  it("puts its earliest notification above the fixed floor, but not far above", () => {
    const actuals = budget()
      .NotificationsWithSubscribers.filter(
        (entry) => entry.Notification.NotificationType === "ACTUAL",
      )
      .map((entry) => entry.Notification.Threshold)
      .sort((a, b) => a - b);
    const earliest = actuals[0];
    expect(earliest).toBeGreaterThan(MONTHLY_FIXED_FLOOR_USD);
    expect(earliest - MONTHLY_FIXED_FLOOR_USD).toBeLessThan(20);
  });

  it("warns before the month ends, at the cap, and again at twice it", () => {
    const notifications = budget().NotificationsWithSubscribers.map((entry) => [
      entry.Notification.NotificationType,
      entry.Notification.Threshold,
    ]);
    expect(notifications).toContainEqual(["FORECASTED", 90]);
    expect(notifications).toContainEqual(["ACTUAL", 90]);
    expect(notifications).toContainEqual(["ACTUAL", 180]);
  });

  it("sends every one of them to the operational mailbox", () => {
    for (const entry of budget().NotificationsWithSubscribers) {
      expect(entry.Subscribers).toEqual([
        { SubscriptionType: "EMAIL", Address: "alerts@dive.day" },
      ]);
    }
  });

  /**
   * Alert-only, by explicit request in the ADR: a false positive that switches
   * something off is a worse failure than a surprise few dollars. There is no
   * `AWS::Budgets::BudgetsAction` anywhere in this stack, and adding one is a
   * decision to revisit that ADR rather than a configuration change.
   */
  it("never carries an action that could disable anything", () => {
    const app = new cdk.App();
    const template = Template.fromStack(
      new InfraStack(app, "DiveDay", { env: { account: "123456789012", region: "us-east-1" } }),
    );
    expect(Object.keys(template.findResources("AWS::Budgets::BudgetsAction"))).toEqual([]);
  });
});

/**
 * The "AWS trimming" items of the cost-guardrails runbook (issue #3652): spend
 * nobody reads. Each is a property of the synthesized template, so the next
 * Lambda added without a log group fails here rather than growing silently.
 */
describe("AWS trimming", () => {
  const template = () =>
    Template.fromStack(
      new InfraStack(new cdk.App(), "DiveDay", {
        env: { account: "123456789012", region: "us-east-1" },
      }),
    );

  it("gives every Lambda function a managed log group, so none logs to an implicit one that never expires", () => {
    const functions = template().findResources("AWS::Lambda::Function");
    expect(Object.keys(functions).length).toBeGreaterThan(0);
    const implicit = Object.entries(functions)
      .filter(
        ([, fn]) =>
          !(fn.Properties as { LoggingConfig?: { LogGroup?: unknown } }).LoggingConfig?.LogGroup,
      )
      .map(([id]) => id);
    expect(implicit).toEqual([]);
  });

  it("expires every log group the stack creates", () => {
    const groups = template().findResources("AWS::Logs::LogGroup");
    const unbounded = Object.entries(groups)
      .filter(([, group]) => !(group.Properties as { RetentionInDays?: number }).RetentionInDays)
      .map(([id]) => id);
    expect(unbounded).toEqual([]);
  });

  it("holds no IAM user for the retired MCP consumers", () => {
    const users = Object.values(template().findResources("AWS::IAM::User")).map(
      (user) => (user.Properties as { UserName?: unknown }).UserName,
    );
    expect(JSON.stringify(users)).not.toContain("mcp-readonly");
  });

  it("samples a tenth of browser sessions for RUM", () => {
    const monitors = Object.values(template().findResources("AWS::RUM::AppMonitor"));
    expect(monitors).toHaveLength(1);
    const config = monitors[0].Properties as {
      AppMonitorConfiguration: { SessionSampleRate: number };
    };
    expect(config.AppMonitorConfiguration.SessionSampleRate).toBe(0.1);
  });
});
