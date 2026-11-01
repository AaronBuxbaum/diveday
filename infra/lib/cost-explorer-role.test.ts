import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraStack } from "./infra-stack";

/**
 * The agents' Cost Explorer role. `.github/workflows/cost-report.yml` assumes it to read the bill.
 * Cost Explorer takes no resource scope, so the argument is: read-only actions, no data access,
 * and a trust that admits `main` alone.
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

function role(template: ReturnType<typeof synthesize>) {
  const entry = Object.entries(template.Resources).find(
    ([, resource]) =>
      resource.Type === "AWS::IAM::Role" &&
      resource.Properties.RoleName === "diveday-github-actions-cost-explorer",
  );
  expect(entry, "GitHubActionsCostExplorerRole must exist").toBeDefined();
  return entry as [string, { Properties: Record<string, unknown> }];
}

function statements(template: ReturnType<typeof synthesize>, logicalId: string) {
  return Object.values(template.Resources)
    .filter((resource) => resource.Type === "AWS::IAM::Policy")
    .filter((resource) => (JSON.stringify(resource.Properties.Roles) ?? "").includes(logicalId))
    .flatMap(
      (resource) =>
        (resource.Properties.PolicyDocument as { Statement: Record<string, unknown>[] }).Statement,
    );
}

describe("GitHubActionsCostExplorerRole", () => {
  it("is trusted from main alone", () => {
    const [, entry] = role(synthesize());
    const trust = JSON.stringify(entry.Properties.AssumeRolePolicyDocument);
    expect(trust).toContain(
      '"token.actions.githubusercontent.com:sub":"repo:AaronBuxbaum@5578581/diveday@1302222351:ref:refs/heads/main"',
    );
    expect(trust).not.toContain(":*");
    expect(trust).not.toContain("pull_request");
    expect(trust).toContain("sts.amazonaws.com");
  });

  it("allows only Cost Explorer and budget reads, never a write or a data read", () => {
    const template = synthesize();
    const [logicalId] = role(template);
    const allows = statements(template, logicalId).filter(
      (statement) => statement.Effect === "Allow",
    );
    const actions = allows.flatMap((statement) => statement.Action as string | string[]);
    expect([...actions].sort()).toEqual([
      "budgets:ViewBudget",
      "ce:Describe*",
      "ce:Get*",
      "ce:List*",
    ]);
    // ce:Get* must not be widened to a verb that writes.
    for (const verb of ["Create", "Update", "Delete", "Put", "Start", "Provide"]) {
      expect(JSON.stringify(actions)).not.toContain(verb);
    }
  });

  it("can never read a secret, and publishes its ARN as an output", () => {
    const template = synthesize();
    const [logicalId] = role(template);
    const denies = statements(template, logicalId).filter(
      (statement) => statement.Effect === "Deny",
    );
    expect(JSON.stringify(denies)).toContain("secretsmanager:GetSecretValue");
    expect(template.Outputs.GitHubActionsCostExplorerRoleArn).toBeDefined();
  });
});
