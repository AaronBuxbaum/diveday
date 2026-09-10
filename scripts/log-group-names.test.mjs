import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { logGroupNamesFrom, resolveLogGroupName, templateFileNameFor } from "./log-group-names.mjs";

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

describe("resolveLogGroupName", () => {
  it("passes a literal through", () => {
    expect(resolveLogGroupName("/diveday/app", { account, region })).toBe("/diveday/app");
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
    expect(resolveLogGroupName(value, { account, region })).toBe(
      "sns/us-east-2/123456789012/DirectPublishToPhoneNumber/Failure",
    );
  });

  it("resolves a region reference", () => {
    expect(resolveLogGroupName({ Ref: "AWS::Region" }, { account, region })).toBe("us-east-2");
  });

  it("returns null for a shape it does not understand, rather than a wrong name", () => {
    // Null is reported by the caller. A guess would be worse than silence, and
    // silence is what caused this whole class of failure in the first place.
    expect(resolveLogGroupName({ "Fn::Sub": "${Thing}/logs" }, { account, region })).toBeNull();
    expect(resolveLogGroupName({ Ref: "SomeResource" }, { account, region })).toBeNull();
    expect(
      resolveLogGroupName({ "Fn::Join": ["", ["a/", { Ref: "Unknown" }]] }, { account, region }),
    ).toBeNull();
  });
});

describe("logGroupNamesFrom", () => {
  it("finds both the literal and the joined names, and ignores other resources", () => {
    const { names, unresolved } = logGroupNamesFrom(TEMPLATE, { account, region });

    expect(unresolved).toEqual([]);
    expect(names).toEqual([
      "/aws/lambda/diveday-access-key-pruner-provider",
      "/aws/lambda/diveday-sns-sms-delivery-status-attributes",
      "sns/us-east-2/123456789012/DirectPublishToPhoneNumber",
    ]);
  });

  it("hands back what it could not resolve instead of dropping it", () => {
    const { names, unresolved } = logGroupNamesFrom(
      {
        Resources: {
          X: { Type: "AWS::Logs::LogGroup", Properties: { LogGroupName: { "Fn::Sub": "${A}" } } },
        },
      },
      { account, region },
    );

    expect(names).toEqual([]);
    expect(unresolved).toHaveLength(1);
  });

  it("survives a template with no log groups at all", () => {
    expect(logGroupNamesFrom({ Resources: {} }, { account, region })).toEqual({
      names: [],
      unresolved: [],
    });
    expect(logGroupNamesFrom({}, { account, region })).toEqual({ names: [], unresolved: [] });
  });

  it("resolves every log group in the real synthesized template, when one is present", () => {
    // The strongest version of this test needs `cdk.out`, which is a build
    // artifact and absent on a clean checkout -- so it is skipped rather than
    // failed there. When it is present it is the one check that would catch a
    // new log group whose name is built in a shape the resolver cannot read.
    let template;
    try {
      template = JSON.parse(
        readFileSync(join(process.cwd(), "cdk.out", templateFileNameFor("DiveDay")), "utf8"),
      );
    } catch {
      return;
    }
    const { names, unresolved } = logGroupNamesFrom(template, { account, region });
    expect(unresolved).toEqual([]);
    expect(names).toContain("/aws/lambda/diveday-access-key-pruner-provider");
    expect(names).toContain("/aws/lambda/diveday-sns-sms-delivery-status-attributes");
  });
});
