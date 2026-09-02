import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The SMS receipt forwarder's log group (S10).
 *
 * Lambda creates `/aws/lambda/<function name>` itself on a function's first
 * invocation, with no retention. This function ran before the stack declared
 * a group for it, so a stack that then declared exactly that name failed
 * change-set validation with "already exists" (2026-09-02) and could not
 * deploy at all. The declared group therefore carries a name Lambda would
 * never pick, and the function's logging config points at it explicitly --
 * which is what this pins, so the collision cannot be reintroduced by a
 * tidy-minded rename.
 */
function template() {
  const app = new cdk.App();
  return Template.fromStack(
    new InfraStack(app, "DiveDay", { env: { account: "123456789012", region: "us-east-1" } }),
  );
}

describe("the SMS receipt forwarder's log group", () => {
  it("is declared under a name Lambda would not create on its own, and the function logs there", () => {
    const built = template();
    const functions = built.findResources("AWS::Lambda::Function") as Record<
      string,
      { Properties?: { FunctionName?: string; LoggingConfig?: { LogGroup?: { Ref?: string } } } }
    >;
    const forwarder = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === "diveday-sms-receipt-forwarder",
    );
    expect(forwarder).toBeDefined();
    const groupLogicalId = forwarder?.Properties?.LoggingConfig?.LogGroup?.Ref;
    expect(groupLogicalId).toBeDefined();

    const groups = built.findResources("AWS::Logs::LogGroup") as Record<
      string,
      { Properties?: { LogGroupName?: string; RetentionInDays?: number } }
    >;
    const group = groups[String(groupLogicalId)];
    expect(group?.Properties?.LogGroupName).toBe("/diveday/lambda/sms-receipt-forwarder");
    expect(group?.Properties?.LogGroupName?.startsWith("/aws/lambda/")).toBe(false);
    expect(group?.Properties?.RetentionInDays).toBe(30);
  });
});
