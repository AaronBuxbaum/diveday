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

type TrustConditions = Record<string, Record<string, string | string[]>>;

function trustConditions(template: ReturnType<typeof synthesize>): TrustConditions {
  const [, role] = regSuitRole(template);
  const document = role.Properties.AssumeRolePolicyDocument as {
    Statement: { Condition: TrustConditions }[];
  };
  expect(document.Statement).toHaveLength(1);
  return document.Statement[0].Condition;
}

function globMatches(pattern: string, value: string) {
  const source = pattern
    .split("")
    .map((char) => {
      if (char === "*") return ".*";
      if (char === "?") return ".";
      return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`).test(value);
}

/**
 * Whether a token with these claims satisfies every condition, the way STS reads
 * `StringEquals` (exact) and `StringLike` (`*` and `?` globs) over GitHub's claims.
 * An operator this does not know fails the test rather than passing silently.
 */
function admits(conditions: TrustConditions, claims: Record<string, string>) {
  return Object.entries(conditions).every(([operator, keys]) =>
    Object.entries(keys).every(([key, expected]) => {
      const claim = claims[key.replace("token.actions.githubusercontent.com:", "")];
      if (claim === undefined) return false;
      const values = ([] as string[]).concat(expected);
      if (operator === "StringEquals") return values.includes(claim);
      if (operator === "StringLike") return values.some((pattern) => globMatches(pattern, claim));
      throw new Error(`unexpected trust operator ${operator}`);
    }),
  );
}

const REPO_SUB = "repo:AaronBuxbaum@5578581/diveday@1302222351";
const MAIN_PUBLISHER =
  "AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@refs/heads/main";
const PUBLISHER = "AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml";

describe("GitHubActionsRegSuitRole trusts only the reviewed publisher on main (#3274)", () => {
  // A pull request controls its own workflow files, so the `sub` claim alone
  // (`...:pull_request`) admits any job a pull request adds.
  const conditions = trustConditions(synthesize());
  const claims = (job_workflow_ref: string, sub = `${REPO_SUB}:pull_request`) => ({
    aud: "sts.amazonaws.com",
    sub,
    job_workflow_ref,
  });

  it("admits main's publisher from a pull request and from a main run", () => {
    expect(admits(conditions, claims(MAIN_PUBLISHER))).toBe(true);
    expect(admits(conditions, claims(MAIN_PUBLISHER, `${REPO_SUB}:ref:refs/heads/main`))).toBe(
      true,
    );
  });

  it.each([
    [
      "a job a pull request adds to ci.yml",
      "AaronBuxbaum/diveday/.github/workflows/ci.yml@refs/pull/7/merge",
    ],
    [
      "a new workflow file in the pull request",
      "AaronBuxbaum/diveday/.github/workflows/exfil.yml@refs/pull/7/merge",
    ],
    ["the publisher at a commit the pull request picks", `${PUBLISHER}@${"a".repeat(40)}`],
    ["the publisher from the pull request's branch", `${PUBLISHER}@refs/heads/attacker`],
    ["the publisher at a tag named main", `${PUBLISHER}@refs/tags/main`],
    ["the publisher as a local reusable workflow", `${PUBLISHER}@refs/pull/7/merge`],
    [
      "a look-alike publisher in another repository",
      "attacker/diveday/.github/workflows/reg-suit-publish.yml@refs/heads/main",
    ],
  ])("refuses %s", (_label, jobWorkflowRef) => {
    expect(admits(conditions, claims(jobWorkflowRef))).toBe(false);
  });

  it("refuses a token from a job that calls no reusable workflow", () => {
    expect(admits(conditions, { aud: "sts.amazonaws.com", sub: `${REPO_SUB}:pull_request` })).toBe(
      false,
    );
  });

  it("refuses main's publisher from another branch's run or for another audience", () => {
    expect(admits(conditions, claims(MAIN_PUBLISHER, `${REPO_SUB}:ref:refs/heads/feature`))).toBe(
      false,
    );
    expect(admits(conditions, { ...claims(MAIN_PUBLISHER), aud: "example.com" })).toBe(false);
  });

  it("names the publisher exactly, never by pattern", () => {
    expect(JSON.stringify(conditions.StringLike ?? {})).not.toContain("job_workflow_ref");
    expect(
      conditions.StringEquals?.["token.actions.githubusercontent.com:job_workflow_ref"],
    ).toBeDefined();
  });
});

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
