import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { envExampleKeys, fillEnvExample, readEnvExample } from "./credentials-document";
import { InfraStack } from "./infra-stack";
import { MANUAL_ACTION_CATEGORIES, renderManualActionsDoc } from "./manual-actions";

/**
 * The only automated coverage `infra/` has. `pnpm check` never deploys, so these
 * assertions are about the shape of the synthesized template: what leaks, what
 * is missing, and what has silently drifted from the documents around it.
 *
 * Everything here is a property that has already gone wrong once, or that
 * nothing else in the repo would notice.
 */

type AccessKeyResource = { Properties: { Serial?: number } };

function synthesize() {
  const app = new cdk.App();
  const stack = new InfraStack(app, "DiveDay", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  return { stack, template: Template.fromStack(stack) };
}

/**
 * Every resource type that can grant `secretsmanager:GetSecretValue`, not just
 * `AWS::IAM::Policy`.
 *
 * Scanning only inline user/role policies was the original gap: a later
 * `credentialsSecret.addToResourcePolicy(...)` — the natural construct for
 * cross-account access, and therefore the most likely future edit — synthesizes
 * an `AWS::SecretsManager::ResourcePolicy` that nothing here would have looked
 * at, leaving the ADR's central claim asserted by a test that could not see the
 * thing contradicting it.
 */
function policyStatements(template: Template): string[] {
  return [
    "AWS::IAM::Policy",
    "AWS::IAM::ManagedPolicy",
    "AWS::IAM::Role",
    "AWS::SecretsManager::ResourcePolicy",
  ]
    .flatMap((type) => Object.values(template.findResources(type)))
    .flatMap((resource) => {
      const properties = (resource as { Properties?: Record<string, unknown> }).Properties ?? {};
      const documents = [
        properties.PolicyDocument,
        properties.AssumeRolePolicyDocument,
        ...((properties.Policies as { PolicyDocument?: unknown }[] | undefined) ?? []).map(
          (policy) => policy.PolicyDocument,
        ),
      ].filter(Boolean);
      return documents.flatMap(
        (document) => ((document as { Statement?: unknown[] }).Statement ?? []) as unknown[],
      );
    })
    .map((statement) => JSON.stringify(statement));
}

describe("the synthesized stack", () => {
  it("puts no credential material in any output", () => {
    const { template } = synthesize();
    const outputs = template.toJSON().Outputs ?? {};

    // A `CfnOutput` is the one stack surface that resolves to plaintext for
    // anyone holding `cloudformation:DescribeStacks` — which the deployer and
    // both read-only MCP users do. `IAMUserSecretKey` published the reg-suit
    // secret this way for months.
    for (const [name, output] of Object.entries<{ Value: unknown }>(outputs)) {
      const rendered = JSON.stringify(output.Value);
      expect(rendered, `output ${name} resolves an access key secret`).not.toMatch(
        /"SecretAccessKey"/,
      );
    }
  });

  it("routes every minted access key into the credentials secret and nowhere else", () => {
    const { template } = synthesize();
    const keys = template.findResources("AWS::IAM::AccessKey");
    const secrets = template.findResources("AWS::SecretsManager::Secret");

    expect(Object.keys(secrets)).toHaveLength(2);
    const secret = Object.values(secrets).find(
      (resource) =>
        (resource as { Properties?: { Name?: string } }).Properties?.Name === "diveday/env",
    );
    expect(secret, "the credentials document is missing").toBeDefined();
    const body = JSON.stringify(
      (secret as { Properties: { SecretString: unknown } }).Properties.SecretString,
    );

    // Every key's secret half has to appear in the document; a key minted and
    // then not delivered is a credential nobody can ever use.
    for (const logicalId of Object.keys(keys)) {
      expect(body, `${logicalId} is minted but missing from the credentials secret`).toContain(
        `"${logicalId}"`,
      );
    }
    expect(Object.keys(keys).length).toBeGreaterThanOrEqual(8);
  });

  it("generates one stable app-secret root without exposing it as an output", () => {
    const { template } = synthesize();
    const secrets = template.findResources("AWS::SecretsManager::Secret");
    const seed = Object.values(secrets).find(
      (resource) =>
        (resource as { Properties?: { Name?: string } }).Properties?.Name ===
        "diveday/app-secret-seed",
    ) as { Properties?: { GenerateSecretString?: unknown } } | undefined;
    expect(seed?.Properties?.GenerateSecretString).toBeDefined();

    const outputs = JSON.stringify(template.toJSON().Outputs ?? {});
    expect(outputs).not.toContain("diveday/app-secret-seed");
    expect(outputs).not.toContain("resolve:secretsmanager");
  });

  it("drives every access key's rotation from the one stack parameter", () => {
    const { template } = synthesize();
    const accessKeys = template.findResources("AWS::IAM::AccessKey") as Record<
      string,
      AccessKeyResource
    >;
    for (const [logicalId, key] of Object.entries(accessKeys)) {
      // A `Ref` to the parameter, never a synth-time literal. A literal would
      // mean the value came from context, and context is not remembered between
      // deploys — the next flag-less deploy would rotate every key back to 1 and
      // delete the ones in use.
      expect(key.Properties.Serial, `${logicalId} cannot be rotated by deploying`).toEqual({
        Ref: "CredentialSerial",
      });
    }
  });

  it("remembers the rotation serial across deploys", () => {
    const { template } = synthesize();
    const parameter = template.toJSON().Parameters?.CredentialSerial;
    expect(parameter, "rotation must be a stack parameter, not a context value").toBeDefined();
    expect(parameter.Type).toBe("Number");
    expect(parameter.Default).toBe(1);
    expect(parameter.MinValue).toBe(1);
  });

  it("denies the read-only MCP identities any secret value", () => {
    const { template } = synthesize();
    const denials = policyStatements(template).filter(
      (statement) =>
        statement.includes('"Deny"') && statement.includes("secretsmanager:GetSecretValue"),
    );
    // One per read-only user. ReadOnlyAccess is AWS's to change; the Deny is
    // what makes "this credential cannot reach key material" true regardless.
    expect(denials).toHaveLength(2);
  });

  it("grants nothing read access to the credentials secret", () => {
    const { template } = synthesize();
    const allowsRead = policyStatements(template).some(
      (statement) =>
        statement.includes("secretsmanager:GetSecretValue") && !statement.includes('"Deny"'),
    );
    expect(allowsRead, "an identity in this stack can read every credential in the account").toBe(
      false,
    );
  });

  it("scopes the access-key pruner to the identities this stack owns", () => {
    const { template } = synthesize();
    const pruning = policyStatements(template).filter((statement) =>
      statement.includes("iam:DeleteAccessKey"),
    );
    expect(pruning).toHaveLength(1);
    // A function that deletes IAM access keys must never be able to reach one it
    // does not own — a human's, or another service's.
    expect(pruning[0]).not.toContain('"Resource":"*"');
    expect(pruning[0]).toContain("RegSuitUser");
  });

  it("runs the pruner only after every key exists, and not on rotation", () => {
    const { template } = synthesize();
    const [pruner] = Object.values(
      template.findResources("AWS::CloudFormation::CustomResource") as Record<
        string,
        { DependsOn?: string[]; Properties: Record<string, unknown> }
      >,
    );
    const accessKeys = Object.keys(template.findResources("AWS::IAM::AccessKey"));

    // "Keep the newest key" is only correct once CloudFormation's own key is the
    // newest. Run it a moment early and it keeps a hand-minted key and deletes
    // the managed one.
    for (const logicalId of accessKeys) {
      expect(pruner.DependsOn, `pruner may run before ${logicalId} exists`).toContain(logicalId);
    }

    // The serial must stay out of its properties. With it in, a rotation
    // re-invokes the pruner to delete the outgoing key during the same update in
    // which CloudFormation is already deleting it — racing the stack's cleanup
    // for no gain, since after one run every user holds exactly one key.
    expect(JSON.stringify(pruner.Properties)).not.toContain("CredentialSerial");
  });

  it("keeps the long manual-action checklist out of CloudFormation outputs", () => {
    const { template } = synthesize();
    const outputNames = Object.keys(template.toJSON().Outputs ?? {});
    expect(outputNames.some((name) => name.startsWith("ManualActions"))).toBe(false);
    expect(template.toJSON().Outputs?.PostDeployWizard).toBeDefined();
  });
});

describe("the manual-action registry", () => {
  it("states a destination or an outcome for every action", () => {
    const { stack } = synthesize();
    expect(stack.manualActions.length).toBeGreaterThan(0);
    for (const action of stack.manualActions) {
      // The whole point of the record type: a step with nothing to run and
      // nowhere to put the result is a note, not an action.
      expect(action.why, `${action.id} does not say why it is manual`).not.toBe("");
      expect(
        action.store ?? action.produces ?? action.verify,
        `${action.id} says neither where its result goes nor how to tell it worked`,
      ).toBeDefined();
      expect(MANUAL_ACTION_CATEGORIES).toContain(action.category);
      // A check with no stated outcome is not a check.
      if (action.category === "Verification") {
        expect(action.verify, `${action.id} verifies nothing`).toBeDefined();
      }
      // `onFailure` answers a question `verify` has to have asked.
      if (action.onFailure !== undefined) {
        expect(action.verify, `${action.id} has a recovery but no check`).toBeDefined();
      }
    }
  });

  it("uses unique, stable ids", () => {
    const { stack } = synthesize();
    const ids = stack.manualActions.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("numbers the checklist in the order it is read", () => {
    const { stack } = synthesize();
    const numbers = [...renderManualActionsDoc(stack.manualActions).matchAll(/^\[(\d+)\] /gm)].map(
      (match) => Number(match[1]),
    );
    // Numbering used to come off the registry array, so moving one record
    // between categories put [9] under Verification while Credentials ran to
    // [10]. A reader following the list top to bottom must see 1..n.
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    expect(numbers).toHaveLength(stack.manualActions.length);
  });

  it("leaves no unresolved CDK token in the rendered text", () => {
    const { stack } = synthesize();
    const rendered = renderManualActionsDoc(stack.manualActions);
    // A token here would print as `${Token[TOKEN.42]}` in the generated doc,
    // which is read outside a deploy. Actions name the output carrying a
    // deploy-time value instead of embedding it.
    expect(rendered).not.toMatch(/\$\{Token\[/);
    expect(rendered).not.toContain("${AWS::");
  });

  it("matches the committed checklist", async () => {
    const { stack } = synthesize();
    // Regenerate with `pnpm test infra -u` after changing the registry.
    await expect(renderManualActionsDoc(stack.manualActions)).toMatchFileSnapshot(
      "../../docs/engineering/manual-actions.md",
    );
  });
});

describe("the credentials document", () => {
  it("fills only keys .env.example actually declares", () => {
    expect(() => fillEnvExample("FOO=\n", { BAR: "x" })).toThrow(/declares no BAR/);
  });

  it("leaves comments, blanks, and unfilled keys byte-for-byte alone", () => {
    const template = "# a comment\n\nFOO=\nBAR=already\n";
    expect(fillEnvExample(template, { FOO: "filled" })).toBe(
      "# a comment\n\nFOO=filled\nBAR=already\n",
    );
  });

  it("supplies a value for every AWS credential .env.example declares", () => {
    const { template } = synthesize();
    const secret = Object.values(template.findResources("AWS::SecretsManager::Secret")).find(
      (resource) =>
        (resource as { Properties?: { Name?: string } }).Properties?.Name === "diveday/env",
    );
    expect(secret, "the credentials document is missing").toBeDefined();
    const body = JSON.stringify(
      (secret as { Properties: { SecretString: unknown } }).Properties.SecretString,
    );

    // The drift guard in the other direction: `fillEnvExample` throws when the
    // stack names a key `.env.example` dropped, and this catches a *new* AWS
    // credential added to `.env.example` that the stack never fills — which
    // would otherwise ship an empty line under a comment promising a value.
    const unfilled = envExampleKeys(readEnvExample())
      .filter((key) => /_AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION)$/.test(key))
      .filter((key) => !body.includes(`${key}=`) || body.includes(`${key}=\\n`));
    expect(unfilled, "declared in .env.example but left blank in the secret").toEqual([]);
  });

  it("keeps generic deployment credentials out of .env.example and in a profile block", () => {
    const { template } = synthesize();
    const keys = envExampleKeys(readEnvExample());
    expect(keys).not.toContain("AWS_ACCOUNT_ID");
    expect(keys).not.toContain("AWS_ACCESS_KEY_ID");
    expect(keys).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(keys).not.toContain("AWS_DEFAULT_REGION");

    const secret = Object.values(template.findResources("AWS::SecretsManager::Secret")).find(
      (resource) =>
        (resource as { Properties?: { Name?: string } }).Properties?.Name === "diveday/env",
    );
    expect(JSON.stringify(secret)).toContain("[diveday-deployer]");
  });
});
