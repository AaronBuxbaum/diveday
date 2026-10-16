import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * reg-suit's OIDC role (issue #2543). CI's visual-report job assumes it instead
 * of reading a long-lived IAM access key, so what it may do is the whole
 * security argument: this bucket, list/read/write, and nothing else.
 */
function synthesize() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDay", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack).toJSON() as {
    Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
    Outputs: Record<string, unknown>;
  };
}

function regSuitRole(template: ReturnType<typeof synthesize>) {
  const entry = Object.entries(template.Resources).find(
    ([, resource]) =>
      resource.Type === "AWS::IAM::Role" &&
      resource.Properties.RoleName === "diveday-github-actions-reg-suit",
  );
  expect(entry, "GitHubActionsRegSuitRole must exist").toBeDefined();
  return entry as [string, { Properties: Record<string, unknown> }];
}

function attachedStatements(template: ReturnType<typeof synthesize>, roleLogicalId: string) {
  return Object.values(template.Resources)
    .filter((resource) => resource.Type === "AWS::IAM::Policy")
    .filter((resource) => (JSON.stringify(resource.Properties.Roles) ?? "").includes(roleLogicalId))
    .flatMap(
      (resource) =>
        (resource.Properties.PolicyDocument as { Statement: Record<string, unknown>[] }).Statement,
    );
}

describe("GitHubActionsRegSuitRole", () => {
  it("is trusted from this repository's pull_request and main runs only", () => {
    const [, role] = regSuitRole(synthesize());
    const trust = JSON.stringify(role.Properties.AssumeRolePolicyDocument);
    expect(trust).toContain("AaronBuxbaum@5578581/diveday@1302222351:pull_request");
    expect(trust).toContain("AaronBuxbaum@5578581/diveday@1302222351:ref:refs/heads/main");
    // Not the diff role's `repo:...:*`: no other branch ref, no environment. The
    // `ref:refs/heads/main` subject also matches a schedule or dispatch run on
    // main, so schedule is NOT excluded here; ci.yml's triggers decide that.
    expect(trust).not.toContain("diveday@1302222351:*");
    expect(trust).toContain("sts.amazonaws.com");
  });

  it("can only list, read and write objects in the visual bucket", () => {
    const template = synthesize();
    const [logicalId] = regSuitRole(template);
    const statements = attachedStatements(template, logicalId);
    const allowed = statements
      .filter((statement) => statement.Effect === "Allow")
      .flatMap((statement) => statement.Action as string | string[]);
    expect([...allowed].sort()).toEqual(
      ["s3:GetBucketLocation", "s3:GetObject", "s3:ListBucket", "s3:PutObject"].sort(),
    );
    const serialized = JSON.stringify(
      statements.filter((statement) => statement.Effect === "Allow"),
    );
    expect(serialized).not.toContain('"*"}');
    // Exact Resources, not a substring: no Allow may name the bare "*" in any form.
    const allowStatements = statements.filter((statement) => statement.Effect === "Allow");
    for (const statement of allowStatements) {
      const resources = ([] as unknown[]).concat(statement.Resource);
      expect(resources).not.toContain("*");
      expect(resources.length).toBeGreaterThan(0);
    }
    const bucketScoped = JSON.stringify(allowStatements.map((statement) => statement.Resource));
    expect(bucketScoped).not.toMatch(/"\*"/);
    expect(serialized).not.toContain("DeleteObject");
    expect(serialized).not.toContain("Acl");
    expect(serialized).toContain("VisualRegressionBucket");
  });

  it("can never read a secret, and publishes its ARN as an output", () => {
    const template = synthesize();
    const [logicalId] = regSuitRole(template);
    const denies = attachedStatements(template, logicalId).filter(
      (statement) => statement.Effect === "Deny",
    );
    expect(JSON.stringify(denies)).toContain("secretsmanager:GetSecretValue");
    expect(template.Outputs.GitHubActionsRegSuitRoleArn).toBeDefined();
  });
});
