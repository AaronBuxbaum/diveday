import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucketName = this.node.tryGetContext("bucketName") || "diveday-vrt";
    const userName = this.node.tryGetContext("userName") || "reg-suit-bot";

    // 1. Create S3 Bucket for Visual Regression
    const bucket = new s3.Bucket(this, "VisualRegressionBucket", {
      bucketName: bucketName,
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ["*"],
        },
      ],
      websiteIndexDocument: "index.html",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: "expire-old-visual-snapshots",
          enabled: true,
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    // 2. Create IAM User for reg-suit
    const user = new iam.User(this, "RegSuitUser", {
      userName: userName,
    });

    // 3. Grant Permissions
    bucket.grantReadWrite(user);
    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObjectAcl", "s3:GetObjectAcl"],
        resources: [bucket.arnForObjects("*")],
      }),
    );

    // 4. Create Access Key for reg-suit
    const accessKey = new iam.CfnAccessKey(this, "RegSuitUserAccessKey", {
      userName: user.userName,
    });

    // 5. Create a dedicated CDK Deployer user for managing all future infrastructure.
    //
    // This user holds no direct AWS permissions of its own. `cdk bootstrap`
    // provisions deploy-role/file-publishing-role/image-publishing-role/lookup-role
    // in this account, each already scoped to exactly what CDK deploys need;
    // the deployer just needs to assume them. That keeps a compromised or
    // leaked deployer credential bounded by those roles instead of by
    // AdministratorAccess.
    const deployerUser = new iam.User(this, "CdkDeployerUser", {
      userName: "cdk-deployer",
    });

    // Read the qualifier the exact same way the stack's own synthesizer
    // resolves it, so this can never drift from what `cdk bootstrap` /
    // `cdk deploy` actually use — no hardcoded "hnb659fds" to fall out of
    // sync if someone later sets the context override or bootstraps with
    // `--qualifier`.
    const bootstrapQualifier: string =
      this.node.tryGetContext("@aws-cdk/core:bootstrapQualifier") ??
      cdk.DefaultStackSynthesizer.DEFAULT_QUALIFIER;
    const bootstrapRoleArn = (roleName: string) =>
      `arn:${this.partition}:iam::${this.account}:role/cdk-${bootstrapQualifier}-${roleName}-${this.account}-${this.region}`;

    deployerUser.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: [
          bootstrapRoleArn("deploy-role"),
          bootstrapRoleArn("file-publishing-role"),
          bootstrapRoleArn("image-publishing-role"),
          bootstrapRoleArn("lookup-role"),
        ],
      }),
    );

    deployerUser.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadStackStatusAndBootstrapVersion",
        actions: ["cloudformation:DescribeStacks", "ssm:GetParameter"],
        resources: [
          `arn:${this.partition}:cloudformation:${this.region}:${this.account}:stack/*/*`,
          `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/${bootstrapQualifier}/version`,
        ],
      }),
    );

    // Outputs for reg-suit
    new cdk.CfnOutput(this, "S3BucketName", {
      value: bucket.bucketName,
      description: "The name of the created S3 bucket",
    });

    new cdk.CfnOutput(this, "S3WebsiteURL", {
      value: bucket.bucketWebsiteUrl,
      description: "The website endpoint for the visual regression reports",
    });

    new cdk.CfnOutput(this, "IAMUserAccessKey", {
      value: accessKey.ref,
      description: "AWS Access Key ID for the reg-suit IAM user",
    });

    new cdk.CfnOutput(this, "IAMUserSecretKey", {
      value: accessKey.attrSecretAccessKey,
      description: "AWS Secret Access Key for the reg-suit IAM user",
    });

    new cdk.CfnOutput(this, "CdkDeployerAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${deployerUser.userName}`,
      description:
        "Instructions for generating the access key for the cdk-deployer IAM user. Do not store in plaintext!",
    });

    // 6. Read-only IAM identities for the AWS API MCP server (see .mcp.json's
    // "aws" entry). Local dev and Claude Code's cloud environment each get their
    // own principal so either can be rotated or revoked without touching the
    // other. Both hold only the AWS-managed ReadOnlyAccess policy — no write or
    // delete action exists on these credentials at all, so a bug in the MCP
    // server's own READ_OPERATIONS_ONLY allowlist still can't mutate anything.
    // Access keys are minted out-of-band via `aws iam create-access-key`
    // (mirroring the cdk-deployer pattern above) rather than CfnAccessKey, so no
    // secret ever lands in this template, CloudFormation state, or a stack output.
    const readOnlyAccess = iam.ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess");

    const mcpReadOnlyLocalUser = new iam.User(this, "McpReadOnlyLocalUser", {
      userName: "diveday-mcp-readonly-local",
      managedPolicies: [readOnlyAccess],
    });

    const mcpReadOnlyCloudUser = new iam.User(this, "McpReadOnlyCloudUser", {
      userName: "diveday-mcp-readonly-cloud",
      managedPolicies: [readOnlyAccess],
    });

    new cdk.CfnOutput(this, "McpReadOnlyLocalAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${mcpReadOnlyLocalUser.userName}`,
      description:
        "Run to mint local-dev AWS MCP server credentials. Store the output in a named AWS CLI profile (~/.aws/credentials) — never in the repo.",
    });

    new cdk.CfnOutput(this, "McpReadOnlyCloudAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${mcpReadOnlyCloudUser.userName}`,
      description:
        "Run to mint AWS MCP server credentials for Claude Code's cloud environment. Store the output in that environment's secret/env-var settings — never in the repo.",
    });
  }
}
