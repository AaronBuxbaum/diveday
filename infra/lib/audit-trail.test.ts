import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EmailStack } from "./email-stack";
import { InfraStack } from "./infra-stack";
import { PRIMARY_REGION, SES_REGION } from "./stack-config";

/**
 * The account's audit trail (infra-stack.ts S23, ADR 20261014-account-audit-trail)
 * and the multipart guard on the inbound-mail bucket, both from the AWS Trusted
 * Advisor export of 2026-10-14.
 *
 * A trail fails quietly: one scoped to a single region, or to write events, or
 * to a bucket that keeps old versions forever, deploys green and reads healthy
 * in the console. So the properties the ADR chose are pinned here one by one.
 */

const account = "123456789012";

function main() {
  const app = new cdk.App();
  return Template.fromStack(
    new InfraStack(app, "DiveDay", { env: { account, region: PRIMARY_REGION } }),
  );
}

function auditBucket(template: Template) {
  const buckets = template.findResources("AWS::S3::Bucket", {
    Properties: { BucketName: "diveday-audit-trail" },
  });
  const entries = Object.entries(buckets);
  expect(entries).toHaveLength(1);
  return entries[0];
}

describe("account audit trail", () => {
  it("is one trail covering every region and the global services", () => {
    const template = main();
    template.resourceCountIs("AWS::CloudTrail::Trail", 1);
    template.hasResourceProperties("AWS::CloudTrail::Trail", {
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      IsLogging: true,
      EnableLogFileValidation: true,
    });
  });

  it("records read and write management events, and nothing billed beyond them", () => {
    const trail = Object.values(main().findResources("AWS::CloudTrail::Trail"))[0] as {
      Properties: {
        EventSelectors?: Array<{ ReadWriteType: string; DataResources?: unknown[] }>;
        CloudWatchLogsLogGroupArn?: unknown;
      };
    };
    for (const selector of trail.Properties.EventSelectors ?? []) {
      expect(selector.ReadWriteType).toBe("All");
      expect(selector.DataResources ?? []).toEqual([]);
    }
    expect(trail.Properties.CloudWatchLogsLogGroupArn).toBeUndefined();
  });

  it("writes to a private, unversioned, retained bucket that expires what it holds", () => {
    const template = main();
    const [logicalId, bucket] = auditBucket(template);
    const resource = bucket as {
      DeletionPolicy: string;
      Properties: {
        VersioningConfiguration?: unknown;
        PublicAccessBlockConfiguration: Record<string, boolean>;
        LifecycleConfiguration: {
          Rules: Array<{
            ExpirationInDays?: number;
            AbortIncompleteMultipartUpload?: { DaysAfterInitiation: number };
          }>;
        };
      };
    };
    expect(resource.DeletionPolicy).toBe("Retain");
    expect(resource.Properties.VersioningConfiguration).toBeUndefined();
    expect(resource.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(resource.Properties.LifecycleConfiguration.Rules).toContainEqual(
      expect.objectContaining({
        ExpirationInDays: 365,
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      }),
    );
    template.hasResourceProperties("AWS::CloudTrail::Trail", {
      S3BucketName: { Ref: logicalId },
    });
  });

  it("lets CloudTrail write to the bucket", () => {
    const template = main();
    const [logicalId] = auditBucket(template);
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      Bucket: { Ref: logicalId },
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Principal: { Service: "cloudtrail.amazonaws.com" },
            Action: "s3:PutObject",
          }),
        ]),
      },
    });
  });
});

describe("inbound mail bucket", () => {
  it("aborts an incomplete multipart upload after a day, alongside its expiry", () => {
    const app = new cdk.App();
    const template = Template.fromStack(
      new EmailStack(app, "DiveDayEmail", { env: { account, region: SES_REGION } }),
    );
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "diveday-inbound-mail",
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: "expire-inbound-mail",
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          }),
        ]),
      },
    });
  });
});
