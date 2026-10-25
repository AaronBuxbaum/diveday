import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The restore drill's OIDC role (issue #2986). `.github/workflows/restore-drill.yml` assumes it
 * to read the newest database dump, which holds every password hash and medical answer in the
 * platform, so what it may do and who may assume it is the whole security argument: read-only,
 * one prefix of one bucket, and only from the `restore-drill` environment.
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

function drillRole(template: ReturnType<typeof synthesize>) {
  const entry = Object.entries(template.Resources).find(
    ([, resource]) =>
      resource.Type === "AWS::IAM::Role" &&
      resource.Properties.RoleName === "diveday-github-actions-restore-drill",
  );
  expect(entry, "GitHubActionsRestoreDrillRole must exist").toBeDefined();
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

describe("GitHubActionsRestoreDrillRole", () => {
  it("is trusted from the restore-drill environment alone", () => {
    const [, role] = drillRole(synthesize());
    const trust = JSON.stringify(role.Properties.AssumeRolePolicyDocument);
    expect(trust).toContain(
      '"token.actions.githubusercontent.com:sub":"repo:AaronBuxbaum@5578581/diveday@1302222351:environment:restore-drill"',
    );
    // Not a wildcard subject, not a branch, not the deploy environment.
    expect(trust).not.toContain(":*");
    expect(trust).not.toContain("pull_request");
    expect(trust).not.toContain("infra-deploy");
    expect(trust).toContain("sts.amazonaws.com");
  });

  it("can only list and read objects under dumps/ in the dump bucket, and never write", () => {
    const template = synthesize();
    const [logicalId] = drillRole(template);
    const statements = attachedStatements(template, logicalId);
    const allows = statements.filter((statement) => statement.Effect === "Allow");
    const actions = allows.flatMap((statement) => statement.Action as string | string[]);
    expect([...actions].sort()).toEqual(["s3:GetObject", "s3:ListBucket"]);
    const serialized = JSON.stringify(allows);
    for (const write of ["Put", "Delete", "Acl", "Abort", "Replicate", "RestoreObject"]) {
      expect(JSON.stringify(actions)).not.toContain(write);
    }
    for (const statement of allows) {
      const resources = ([] as unknown[]).concat(statement.Resource);
      expect(resources.length).toBeGreaterThan(0);
      expect(resources).not.toContain("*");
    }
    // Reads are the dump prefix only, and listing is narrowed to it by a condition.
    const getObject = allows.find((statement) => statement.Action === "s3:GetObject");
    expect(JSON.stringify(getObject?.Resource)).toContain("DatabaseDumpBucket");
    expect(JSON.stringify(getObject?.Resource)).toContain("/dumps/*");
    const list = allows.find((statement) => statement.Action === "s3:ListBucket");
    expect(JSON.stringify(list?.Resource)).toContain("DatabaseDumpBucket");
    expect(JSON.stringify(list?.Condition)).toContain("dumps/*");
    expect(serialized).not.toContain("BundleBucket");
    expect(serialized).not.toContain("Backup");
  });

  it("can never read a secret, and publishes its ARN as an output", () => {
    const template = synthesize();
    const [logicalId] = drillRole(template);
    const denies = attachedStatements(template, logicalId).filter(
      (statement) => statement.Effect === "Deny",
    );
    expect(JSON.stringify(denies)).toContain("secretsmanager:GetSecretValue");
    expect(template.Outputs.GitHubActionsRestoreDrillRoleArn).toBeDefined();
  });
});
