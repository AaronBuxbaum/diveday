import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

function template() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDaySesCompliance", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

describe("SES recipient protection", () => {
  it("adds hard bounces and complaints to SES account suppression", () => {
    const configurationSets = template().findResources("AWS::SES::ConfigurationSet") as Record<
      string,
      { Properties?: { SuppressionOptions?: { SuppressedReasons?: string[] } } }
    >;
    const configurationSet = Object.values(configurationSets)[0];

    expect(configurationSet?.Properties?.SuppressionOptions?.SuppressedReasons).toEqual([
      "BOUNCE",
      "COMPLAINT",
    ]);
  });

  it("publishes the configuration set's own reputation metrics", () => {
    const configurationSets = template().findResources("AWS::SES::ConfigurationSet") as Record<
      string,
      { Properties?: { ReputationOptions?: { ReputationMetricsEnabled?: boolean } } }
    >;
    const configurationSet = Object.values(configurationSets)[0];
    expect(configurationSet?.Properties?.ReputationOptions?.ReputationMetricsEnabled).toBe(true);
  });

  /**
   * Every bounce and complaint reaches the app through the SNS event
   * destination; the identity must not also forward each one as an email to
   * noreply@ses.dive.day, a mailbox nobody reads. The event destination is the
   * other half of that claim, so it is pinned here too.
   */
  it("takes bounce and complaint feedback through SNS, never forwarded as mail to the sender", () => {
    const built = template();
    const identities = built.findResources("AWS::SES::EmailIdentity") as Record<
      string,
      { Properties?: { FeedbackAttributes?: { EmailForwardingEnabled?: boolean } } }
    >;
    const identity = Object.values(identities)[0];
    expect(identity?.Properties?.FeedbackAttributes?.EmailForwardingEnabled).toBe(false);

    const destinations = built.findResources(
      "AWS::SES::ConfigurationSetEventDestination",
    ) as Record<string, { Properties?: { EventDestination?: { MatchingEventTypes?: string[] } } }>;
    const events = Object.values(destinations).flatMap(
      (destination) => destination.Properties?.EventDestination?.MatchingEventTypes ?? [],
    );
    // CloudFormation spells the event types in lower case.
    expect(events).toEqual(expect.arrayContaining(["bounce", "complaint"]));
  });
});
