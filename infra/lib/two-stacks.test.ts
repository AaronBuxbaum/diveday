import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { readEnvExample } from "./credentials-document";
import { EmailStack } from "./email-stack";
import { InfraStack } from "./infra-stack";
import {
  EMAIL_STACK_NAME,
  MAIN_STACK_NAME,
  SES_CONFIGURATION_SET_NAME,
  SES_EVENT_TOPIC_NAME,
  SES_REGION,
} from "./stack-config";

/**
 * The app is two stacks in two regions since 2026-09-03 (ADR
 * 20260903-ses-lives-in-its-own-region), and every failure that split can cause
 * is quiet: mail sent through a credential naming a region with no identity, a
 * policy scoped to an ARN in the region the identity *used* to be in, a bounce
 * webhook rejecting events off a topic whose ARN the app was never told. None
 * of them raises anything at synth, at deploy, or in a green test run -- they
 * surface as mail that stops.
 *
 * So the properties pinned here are the joints between the two stacks, not the
 * contents of either. `ses-compliance.test.ts` covers what the identity itself
 * promises; `observability.test.ts` covers the alarms.
 */

const account = "123456789012";

function stacks() {
  const app = new cdk.App();
  const main = new InfraStack(app, "DiveDay", {
    stackName: MAIN_STACK_NAME,
    env: { account, region: "us-east-1" },
  });
  const email = new EmailStack(app, "DiveDayEmail", {
    stackName: EMAIL_STACK_NAME,
    env: { account, region: SES_REGION },
  });
  return { main: Template.fromStack(main), email: Template.fromStack(email) };
}

/** Every `Resource` string in every policy statement of a template, flattened. */
function policyResources(template: Template): string {
  return JSON.stringify(Object.values(template.findResources("AWS::IAM::Policy")));
}

describe("the SES split", () => {
  it("keeps every region-bound SES resource out of the main stack", () => {
    const { main } = stacks();
    // Not `toHaveLength(0)` on one type: the point is that *nothing* SES-shaped
    // is left behind, and a future resource type would slip past a list of
    // three. CloudFormation deletes what a template stops describing, so a
    // resource still here is a resource still in us-east-1.
    for (const type of [
      "AWS::SES::EmailIdentity",
      "AWS::SES::ConfigurationSet",
      "AWS::SES::ConfigurationSetEventDestination",
    ]) {
      expect(Object.keys(main.findResources(type))).toEqual([]);
    }
    const topics = Object.values(
      main.findResources("AWS::SNS::Topic") as Record<
        string,
        { Properties?: { TopicName?: string } }
      >,
    ).map((topic) => topic.Properties?.TopicName);
    expect(topics).not.toContain(SES_EVENT_TOPIC_NAME);
  });

  it("creates them in the SES region instead", () => {
    const { email } = stacks();
    email.resourceCountIs("AWS::SES::EmailIdentity", 1);
    email.hasResourceProperties("AWS::SES::ConfigurationSet", {
      Name: SES_CONFIGURATION_SET_NAME,
    });
    email.hasResourceProperties("AWS::SNS::Topic", { TopicName: SES_EVENT_TOPIC_NAME });
  });

  it("authorizes the sender against both SES ARNs, in the region the identity is in", () => {
    const { main } = stacks();
    const resources = policyResources(main);
    // An identity-only grant is the shape that 403s on every send, including to
    // the mailbox simulator: the configuration set is attached to the identity,
    // so it is authorized on every send whether or not the app names it.
    expect(resources).toContain(`:ses:${SES_REGION}:${account}:identity/ses.dive.day`);
    expect(resources).toContain(
      `:ses:${SES_REGION}:${account}:configuration-set/${SES_CONFIGURATION_SET_NAME}`,
    );
    // The old region's ARNs match nothing once the identity has moved, and an
    // IAM policy does not complain about naming a resource that is not there.
    expect(resources).not.toContain(":ses:us-east-1:");
  });

  it("hands the app the SES region and the topic ARN that go with it", () => {
    const { main } = stacks();
    const document = JSON.stringify(main.findResources("AWS::SecretsManager::Secret"));
    expect(document).toContain(`SES_AWS_REGION=${SES_REGION}`);
    expect(document).toContain(`:sns:${SES_REGION}:`);
    expect(document).toContain(SES_EVENT_TOPIC_NAME);
    // Both keys are in the hand-off document the app is configured from, so a
    // region change that missed either would ship a credential and a topic ARN
    // that disagree -- and `/api/webhooks/ses` rejects a correctly-signed event
    // whose TopicArn is not the one it was told about.
    for (const key of ["SES_AWS_REGION", "SES_SNS_TOPIC_ARN"]) {
      expect(readEnvExample()).toContain(key);
    }
  });

  it("lets the deploy identities reach both regions", () => {
    const { main } = stacks();
    const resources = JSON.stringify([
      ...Object.values(main.findResources("AWS::IAM::Policy")),
      ...Object.values(main.findResources("AWS::IAM::Role")),
    ]);
    // A bootstrap role's name ends in the region it was bootstrapped into, so
    // an identity holding only one region's four fails the second stack on
    // sts:AssumeRole -- which reads as a broken trust policy, not as a missing
    // grant.
    expect(resources).toContain(`cdk-hnb659fds-deploy-role-`);
    expect(resources).toContain(`-${SES_REGION}`);
    expect(resources).toContain(
      `:cloudformation:${SES_REGION}:${account}:stack/${EMAIL_STACK_NAME}/*`,
    );

    // The two CI roles reach the second region's stack *by name*. Widening
    // either to `stack/*/*` while adding the region would hand a role assumable
    // from any pull request in this repo every CloudFormation stack in the
    // account, which is the one thing their split exists to prevent -- and it
    // is exactly the shortcut a second region invites.
    const ciStatements = Object.values(
      main.findResources("AWS::IAM::Policy") as Record<
        string,
        { Properties?: { PolicyDocument?: { Statement?: { Sid?: string; Resource?: unknown }[] } } }
      >,
    )
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter((statement) =>
        ["DeployTheStack", "DiffAgainstDeployedStack"].includes(statement.Sid ?? ""),
      );
    expect(ciStatements).toHaveLength(2);
    for (const statement of ciStatements) {
      const scoped = JSON.stringify(statement.Resource);
      expect(scoped).toContain(`stack/${MAIN_STACK_NAME}/*`);
      expect(scoped).toContain(`stack/${EMAIL_STACK_NAME}/*`);
      expect(scoped).not.toContain("stack/*/*");
    }
  });
});
