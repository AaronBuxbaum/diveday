import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orphansFrom, resolveTemplateValue, templateFileNameFor } from "./stack-orphans.mjs";

/**
 * These two functions exist because a region migration kept failing on log
 * groups a rolled-back create had orphaned, and the sweep written to delete
 * them reported success having deleted nothing -- twice, for two different
 * reasons. Both reasons are pinned here.
 */

const account = "123456789012";
const region = "us-east-2";

/** The two shapes `infra/lib/infra-stack.ts` actually synthesizes. */
const TEMPLATE = {
  Resources: {
    AccessKeyPrunerProviderLogsB5E6A87B: {
      Type: "AWS::Logs::LogGroup",
      Properties: { LogGroupName: "/aws/lambda/diveday-access-key-pruner-provider" },
    },
    SnsSmsDeliveryStatusAttributesLogs6B6348C0: {
      Type: "AWS::Logs::LogGroup",
      Properties: { LogGroupName: "/aws/lambda/diveday-sns-sms-delivery-status-attributes" },
    },
    SmsDeliveryStatusLogs: {
      Type: "AWS::Logs::LogGroup",
      Properties: {
        LogGroupName: {
          "Fn::Join": [
            "",
            ["sns/us-east-2/", { Ref: "AWS::AccountId" }, "/DirectPublishToPhoneNumber"],
          ],
        },
      },
    },
    NotALogGroup: { Type: "AWS::S3::Bucket", Properties: { BucketName: "diveday-media" } },
  },
};

describe("templateFileNameFor", () => {
  it("names the template after the construct id, never the stack name", () => {
    // The cloud assembly writes cdk.out/DiveDay.template.json for a stack
    // constructed as `new InfraStack(app, "DiveDay", { stackName: "diveday-infra" })`.
    // Reading diveday-infra.template.json threw, the caller reported "could not
    // synthesize", and the sweep skipped itself while claiming to have run.
    expect(templateFileNameFor("DiveDay")).toBe("DiveDay.template.json");
    expect(templateFileNameFor("DiveDay")).not.toBe("diveday-infra.template.json");
  });
});

describe("resolveTemplateValue", () => {
  it("passes a literal through", () => {
    expect(resolveTemplateValue("/diveday/app", { account, region })).toBe("/diveday/app");
  });

  it("resolves an Fn::Join over the account id", () => {
    // Not a literal, so a `typeof name === "string"` filter drops it. These are
    // the two names nothing else would catch either: they carry `sns`, not
    // `diveday`, so a name filter misses them too.
    const value = {
      "Fn::Join": [
        "",
        ["sns/us-east-2/", { Ref: "AWS::AccountId" }, "/DirectPublishToPhoneNumber/Failure"],
      ],
    };
    expect(resolveTemplateValue(value, { account, region })).toBe(
      "sns/us-east-2/123456789012/DirectPublishToPhoneNumber/Failure",
    );
  });

  it("resolves a region reference", () => {
    expect(resolveTemplateValue({ Ref: "AWS::Region" }, { account, region })).toBe("us-east-2");
  });

  it("returns null for a shape it does not understand, rather than a wrong name", () => {
    // Null is reported by the caller. A guess would be worse than silence, and
    // silence is what caused this whole class of failure in the first place.
    expect(resolveTemplateValue({ "Fn::Sub": "${Thing}/logs" }, { account, region })).toBeNull();
    expect(resolveTemplateValue({ Ref: "SomeResource" }, { account, region })).toBeNull();
    expect(
      resolveTemplateValue({ "Fn::Join": ["", ["a/", { Ref: "Unknown" }]] }, { account, region }),
    ).toBeNull();
  });
});

describe("orphansFrom", () => {
  it("finds both the literal and the joined log group names, and ignores other resources", () => {
    const { logGroups, unresolved } = orphansFrom(TEMPLATE, { account, region });

    expect(unresolved).toEqual([]);
    expect(logGroups).toEqual([
      "/aws/lambda/diveday-access-key-pruner-provider",
      "/aws/lambda/diveday-sns-sms-delivery-status-attributes",
      "sns/us-east-2/123456789012/DirectPublishToPhoneNumber",
    ]);
  });

  it("finds the retained buckets and secrets a rolled-back create keeps", () => {
    // CloudFormation keeps a Retain resource when a create rolls back, on
    // purpose. Each one then blocks the next create in turn -- the secret
    // first, then a bucket, then the next bucket, one failed deploy each.
    const { buckets, secrets, unsupportedRetained } = orphansFrom(
      {
        Resources: {
          Dump: {
            Type: "AWS::SecretsManager::Secret",
            DeletionPolicy: "Retain",
            Properties: { Name: "diveday/database-url-unpooled" },
          },
          Media: {
            Type: "AWS::S3::Bucket",
            DeletionPolicy: "Retain",
            Properties: { BucketName: "diveday-media" },
          },
          Vrt: {
            // Not retained, so CloudFormation removes it on rollback itself.
            Type: "AWS::S3::Bucket",
            DeletionPolicy: "Delete",
            Properties: { BucketName: "diveday-vrt" },
          },
        },
      },
      { account, region },
    );

    expect(secrets).toEqual(["diveday/database-url-unpooled"]);
    expect(buckets).toEqual(["diveday-media"]);
    expect(unsupportedRetained).toEqual([]);
  });

  it("reports a retained type it cannot remove rather than passing over it", () => {
    // The whole failure mode of this script has been silence. A retained type
    // nothing here knows how to delete is a deploy that will fail on a name
    // nothing cleaned, and the operator should hear it from the sweep.
    const { unsupportedRetained } = orphansFrom(
      {
        Resources: {
          Table: {
            Type: "AWS::DynamoDB::Table",
            DeletionPolicy: "Retain",
            Properties: { TableName: "diveday-things" },
          },
        },
      },
      { account, region },
    );

    expect(unsupportedRetained).toEqual([{ id: "Table", type: "AWS::DynamoDB::Table" }]);
  });

  it("hands back what it could not resolve instead of dropping it", () => {
    const { logGroups, unresolved } = orphansFrom(
      {
        Resources: {
          X: { Type: "AWS::Logs::LogGroup", Properties: { LogGroupName: { "Fn::Sub": "${A}" } } },
        },
      },
      { account, region },
    );

    expect(logGroups).toEqual([]);
    expect(unresolved).toHaveLength(1);
  });

  it("survives a template with nothing in it", () => {
    const empty = orphansFrom({ Resources: {} }, { account, region });
    expect(empty.logGroups).toEqual([]);
    expect(empty.buckets).toEqual([]);
    expect(empty.secrets).toEqual([]);
    expect(orphansFrom({}, { account, region }).logGroups).toEqual([]);
  });

  it("resolves every name in the real synthesized template, when one is present", () => {
    // The strongest version of this needs `cdk.out`, which is a build artifact
    // and absent on a clean checkout -- so it is skipped rather than failed
    // there. When present it is the one check that catches a new resource whose
    // name is built in a shape the resolver cannot read.
    let template;
    try {
      template = JSON.parse(
        readFileSync(join(process.cwd(), "cdk.out", templateFileNameFor("DiveDay")), "utf8"),
      );
    } catch {
      return;
    }
    const found = orphansFrom(template, { account, region });
    expect(found.unresolved).toEqual([]);
    expect(found.unsupportedRetained).toEqual([]);
    expect(found.logGroups).toContain("/aws/lambda/diveday-sns-sms-delivery-status-attributes");
    expect(found.secrets).toContain("diveday/database-url-unpooled");
    expect(found.buckets).toContain("diveday-media");
  });
});
