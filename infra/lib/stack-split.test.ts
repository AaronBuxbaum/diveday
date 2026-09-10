import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { readEnvExample } from "./credentials-document";
import { EmailStack } from "./email-stack";
import { GlobalStack } from "./global-stack";
import { InfraStack } from "./infra-stack";
import {
  EMAIL_STACK_NAME,
  GLOBAL_STACK_NAME,
  MAIN_STACK_NAME,
  PRIMARY_REGION,
  ROUTE53_METRICS_REGION,
  SES_CONFIGURATION_SET_NAME,
  SES_EVENT_TOPIC_NAME,
  SES_INBOUND_OBJECT_PREFIX,
  SES_INBOUND_TOPIC_NAME,
  SES_REGION,
} from "./stack-config";

/**
 * The app is three stacks (ADR 20260910-one-region-in-us-east-2): `DiveDay` and
 * `DiveDayEmail` in `PRIMARY_REGION`, and `DiveDayGlobal` pinned to us-east-1
 * because Route 53 publishes its health-check metric nowhere else.
 *
 * Every failure a split like this can cause is quiet. Mail sent through a
 * credential naming a region with no identity. A policy scoped to an ARN in the
 * region the identity *used* to be in. A receipt rule set in a region where the
 * recipient domain is not verified, receiving nothing. A bounce webhook
 * rejecting events off a topic whose ARN the app was never told. An alarm
 * reading a metric its region does not publish. None of them raises anything at
 * synth, at deploy, or in a green test run -- they surface as mail that stops
 * and pages that do not come.
 *
 * So the properties pinned here are the joints between the stacks, not the
 * contents of any one. `ses-compliance.test.ts` covers what the identity itself
 * promises; `observability.test.ts` covers the alarms.
 */

const account = "123456789012";

function stacks() {
  const app = new cdk.App();
  const main = new InfraStack(app, "DiveDay", {
    stackName: MAIN_STACK_NAME,
    env: { account, region: PRIMARY_REGION },
  });
  const email = new EmailStack(app, "DiveDayEmail", {
    stackName: EMAIL_STACK_NAME,
    env: { account, region: SES_REGION },
  });
  const global = new GlobalStack(app, "DiveDayGlobal", {
    stackName: GLOBAL_STACK_NAME,
    env: { account, region: ROUTE53_METRICS_REGION },
  });
  return {
    main: Template.fromStack(main),
    email: Template.fromStack(email),
    global: Template.fromStack(global),
  };
}

/** Every `Resource` string in every policy statement of a template, flattened. */
function policyResources(template: Template): string {
  return JSON.stringify(Object.values(template.findResources("AWS::IAM::Policy")));
}

describe("the stack split", () => {
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
      "AWS::SES::ReceiptRuleSet",
      "AWS::SES::ReceiptRule",
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
    expect(topics).not.toContain(SES_INBOUND_TOPIC_NAME);
  });

  it("receives divers' replies beside the identity that makes receiving legal", () => {
    const { email } = stacks();
    // SES receives only for a domain verified in the *receiving* region. The
    // rule set was in the main stack until the estate moved, which was correct
    // only while the two regions were the same one; left there it would deploy
    // cleanly and receive nothing, with no error anywhere -- every diver's
    // reply bouncing at their own mail server.
    email.resourceCountIs("AWS::SES::ReceiptRuleSet", 1);
    email.hasResourceProperties("AWS::SNS::Topic", { TopicName: SES_INBOUND_TOPIC_NAME });
    email.resourceCountIs("AWS::S3::Bucket", 1);
  });

  it("keeps the health-check alarms in the region that publishes their metric", () => {
    const { main, global } = stacks();
    // Route 53 publishes AWS/Route53 HealthCheckStatus in us-east-1 only, and
    // the uptime alarms are the one place in this estate that treats missing
    // data as breaching. In any other region they would not go quiet -- they
    // would page continuously about an outage that is not happening.
    expect(ROUTE53_METRICS_REGION).toBe("us-east-1");
    expect(Object.keys(main.findResources("AWS::Route53::HealthCheck"))).toEqual([]);
    expect(Object.keys(global.findResources("AWS::Route53::HealthCheck")).length).toBeGreaterThan(
      0,
    );
    const mainAlarms = JSON.stringify(main.findResources("AWS::CloudWatch::Alarm"));
    expect(mainAlarms).not.toContain("AWS/Route53");
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

  it("lets the sender read the received mail, and only under the prefix SES writes it", () => {
    const { main } = stacks();
    const resources = policyResources(main);
    const bucket = `:s3:::diveday-inbound-mail`;
    // The bucket is in the other stack, so this grant is an ARN assembled from
    // a constant rather than a `grantRead` on a construct. An S3 ARN carries no
    // region, which is what makes that a whole joint rather than half of one --
    // but it also means a stray `*` reaches further than anything else in this
    // file, so both halves are pinned.
    expect(resources).toContain(`${bucket}/${SES_INBOUND_OBJECT_PREFIX}*`);
    expect(resources).toContain(`${bucket}"`);
    // Never the whole bucket, and never every bucket. This credential is
    // shipped to Vercel, and the objects are divers' own words.
    expect(resources).not.toContain(`${bucket}/*`);
    expect(resources).not.toContain(":s3:::*");
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

  it("lets the deploy identities reach every region a stack is in", () => {
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
    expect(resources).toContain(`-${ROUTE53_METRICS_REGION}`);
    expect(resources).toContain(
      `:cloudformation:${SES_REGION}:${account}:stack/${EMAIL_STACK_NAME}/*`,
    );
    expect(resources).toContain(
      `:cloudformation:${ROUTE53_METRICS_REGION}:${account}:stack/${GLOBAL_STACK_NAME}/*`,
    );

    // The two CI roles reach every stack *by name*. Widening either to
    // `stack/*/*` while adding a region would hand a role assumable from any
    // pull request in this repo every CloudFormation stack in the account,
    // which is the one thing their split exists to prevent -- and it is exactly
    // the shortcut a third stack invites.
    const ciStatements = Object.values(
      main.findResources("AWS::IAM::Policy") as Record<
        string,
        { Properties?: { PolicyDocument?: { Statement?: { Sid?: string; Resource?: unknown }[] } } }
      >,
    )
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter((statement) =>
        // The deployer user's own stack read is in this list too: it holds the
        // same three names for the same reason, and leaving it out is how it
        // spent a while at `stack/*/*` in every deployment region while the two
        // CI roles were correctly scoped.
        [
          "DeployTheStack",
          "DiffAgainstDeployedStack",
          "ReadStackStatusAndBootstrapVersion",
        ].includes(statement.Sid ?? ""),
      );
    expect(ciStatements).toHaveLength(3);
    for (const statement of ciStatements) {
      const scoped = JSON.stringify(statement.Resource);
      expect(scoped).toContain(`stack/${MAIN_STACK_NAME}/*`);
      expect(scoped).toContain(`stack/${EMAIL_STACK_NAME}/*`);
      expect(scoped).toContain(`stack/${GLOBAL_STACK_NAME}/*`);
      expect(scoped).not.toContain("stack/*/*");
    }
  });
});
