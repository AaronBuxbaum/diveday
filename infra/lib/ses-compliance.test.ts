import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

describe("SES recipient protection", () => {
  it("adds hard bounces and complaints to SES account suppression", () => {
    const app = new cdk.App();
    const stack = new InfraStack(app, "DiveDaySesCompliance", {
      env: { account: "123456789012", region: "us-east-1" },
    });

    const configurationSets = Template.fromStack(stack).findResources(
      "AWS::SES::ConfigurationSet",
    ) as Record<string, { Properties?: { SuppressionOptions?: { SuppressedReasons?: string[] } } }>;
    const configurationSet = Object.values(configurationSets)[0];

    expect(configurationSet?.Properties?.SuppressionOptions?.SuppressedReasons).toEqual([
      "BOUNCE",
      "COMPLAINT",
    ]);
  });
});
