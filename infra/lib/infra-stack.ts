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

    // 5. Create a dedicated CDK Deployer user for managing all future infrastructure
    const deployerUser = new iam.User(this, "CdkDeployerUser", {
      userName: "cdk-deployer",
    });

    // Attach AdministratorAccess managed policy to the deployer user
    deployerUser.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
    );

    // Create Access Key for the deployer user
    const deployerAccessKey = new iam.CfnAccessKey(this, "CdkDeployerAccessKey", {
      userName: deployerUser.userName,
    });

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

    // Outputs for CDK Deployer
    new cdk.CfnOutput(this, "CdkDeployerAccessKeyId", {
      value: deployerAccessKey.ref,
      description: "AWS Access Key ID for the cdk-deployer IAM user",
    });

    new cdk.CfnOutput(this, "CdkDeployerSecretAccessKey", {
      value: deployerAccessKey.attrSecretAccessKey,
      description: "AWS Secret Access Key for the cdk-deployer IAM user",
    });
  }
}
