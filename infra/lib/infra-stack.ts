import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as ce from "aws-cdk-lib/aws-ce";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
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

    // 7. Cost guardrails — alert-only, never auto-disable anything.
    // See ADR 20260802-aws-cost-guardrails for why these two mechanisms and
    // these thresholds specifically.
    const alertEmail = this.node.tryGetContext("alertEmail") || "aaronbuxbaum@gmail.com";
    const monthlyBudgetLimit = Number(this.node.tryGetContext("monthlyBudgetLimit") ?? 5);

    const emailSubscriber = (address: string): budgets.CfnBudget.SubscriberProperty => ({
      subscriptionType: "EMAIL",
      address,
    });

    const budgetNotification = (
      notificationType: "ACTUAL" | "FORECASTED",
      threshold: number,
    ): budgets.CfnBudget.NotificationWithSubscribersProperty => ({
      notification: {
        notificationType,
        comparisonOperator: "GREATER_THAN",
        threshold,
        thresholdType: "PERCENTAGE",
      },
      subscribers: [emailSubscriber(alertEmail)],
    });

    new budgets.CfnBudget(this, "MonthlyCostGuardrail", {
      budget: {
        budgetName: "diveday-monthly-cost-guardrail",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: {
          amount: monthlyBudgetLimit,
          unit: "USD",
        },
      },
      notificationsWithSubscribers: [
        budgetNotification("ACTUAL", 50),
        budgetNotification("ACTUAL", 80),
        budgetNotification("FORECASTED", 100),
        budgetNotification("ACTUAL", 100),
        // Outside-normal-bands siren: still just an email, nothing stops running.
        budgetNotification("ACTUAL", 200),
      ],
    });

    // AWS-managed Cost Anomaly Detection catches an unexpectedly fast rate of
    // increase in any one service — the thing the fixed budget thresholds
    // above can't see while spend is still comfortably under the cap.
    const anomalyMonitor = new ce.CfnAnomalyMonitor(this, "ServiceCostAnomalyMonitor", {
      monitorName: "diveday-service-cost-anomalies",
      monitorType: "DIMENSIONAL",
      monitorDimension: "SERVICE",
    });

    new ce.CfnAnomalySubscription(this, "ServiceCostAnomalySubscription", {
      subscriptionName: "diveday-service-cost-anomaly-alerts",
      frequency: "DAILY",
      monitorArnList: [anomalyMonitor.attrMonitorArn],
      subscribers: [{ type: "EMAIL", address: alertEmail }],
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
          MatchOptions: ["GREATER_THAN_OR_EQUAL"],
          Values: ["1"],
        },
      }),
    });

    new cdk.CfnOutput(this, "CostAlertEmail", {
      value: alertEmail,
      description:
        "Where budget threshold and cost-anomaly alerts are sent. Override with --context alertEmail=...",
    });

    // 8. SES email-provider prep — dormant until the app cuts over from Resend.
    // See ADR 20260802-ses-email-transition-prep for why this exists now, what
    // it does and doesn't do, and what's still manual before flipping the
    // switch. The app's notify() seam (src/lib/notifications/) still points
    // at Resend; nothing here changes production sending.
    const sesEmailDomain = this.node.tryGetContext("sesEmailDomain") || "ses.dive.day";

    const sesEventNotifications = new sns.Topic(this, "SesEmailEventNotifications", {
      topicName: "diveday-ses-email-events",
    });

    const sesConfigurationSet = new ses.ConfigurationSet(this, "SesConfigurationSet", {
      configurationSetName: "diveday-transactional-email",
    });

    new ses.ConfigurationSetEventDestination(this, "SesEmailEventDestination", {
      configurationSet: sesConfigurationSet,
      destination: ses.EventDestination.snsTopic(sesEventNotifications),
      // Mirrors the event set the Resend webhook tracks (resend-email-runbook.md):
      // bounces, complaints, and delivery outcomes. OPEN/CLICK are deliberately
      // excluded — the same privacy stance already documented there.
      events: [
        ses.EmailSendingEvent.BOUNCE,
        ses.EmailSendingEvent.COMPLAINT,
        ses.EmailSendingEvent.DELIVERY,
        ses.EmailSendingEvent.DELIVERY_DELAY,
        ses.EmailSendingEvent.REJECT,
        ses.EmailSendingEvent.RENDERING_FAILURE,
      ],
    });

    const sesEmailIdentity = new ses.EmailIdentity(this, "SesEmailIdentity", {
      identity: ses.Identity.domain(sesEmailDomain),
      configurationSet: sesConfigurationSet,
    });

    const sesSenderUser = new iam.User(this, "SesSenderUser", {
      userName: "diveday-ses-sender",
    });
    sesEmailIdentity.grantSendEmail(sesSenderUser);

    new cdk.CfnOutput(this, "SesSenderAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${sesSenderUser.userName}`,
      description:
        "Run only once cutover begins, to mint SES-sending credentials. Store the output in the app's SES_* env vars — never in the repo.",
    });

    new cdk.CfnOutput(this, "SesDkimRecords", {
      value: cdk.Stack.of(this).toJsonString(sesEmailIdentity.dkimRecords),
      description: `DNS CNAME records to add for ${sesEmailDomain} to complete DKIM verification (three name/value pairs).`,
    });

    new cdk.CfnOutput(this, "SesEventNotificationsTopicArn", {
      value: sesEventNotifications.topicArn,
      description:
        "SNS topic for SES bounce/complaint/delivery events. No subscriber yet — a webhook endpoint mirroring /api/webhooks/resend must subscribe before this is useful.",
    });

    // 9. Backup destination for the scheduled logical export.
    // See ADR 20260802-backup-and-restore-posture for why an S3 bucket rather
    // than a second Neon branch, and docs/engineering/backup-and-restore-runbook.md
    // for the procedure that writes to and restores from it.
    //
    // Deliberately NOT the VisualRegressionBucket above: that one is
    // publicReadAccess, RemovalPolicy.DESTROY, and expires everything after 7
    // days — the exact opposite of every property a backup needs. This bucket
    // is the one resource in the stack that must survive a `cdk destroy`, so it
    // carries RETAIN; deleting production backups should require someone to go
    // do it deliberately, by hand, in the console.
    const backupBucketName = this.node.tryGetContext("backupBucketName") || "diveday-backups";

    const backupBucket = new s3.Bucket(this, "DatabaseBackupBucket", {
      bucketName: backupBucketName,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "age-backups-into-colder-storage",
          enabled: true,
          // Current versions are never expired. Waiver records are legal
          // evidence and their retention is "indefinite" pending H-02, so a
          // lifecycle rule must never be the thing that decides a bundle has
          // outlived its usefulness — that is a legal call, not a cost one.
          // Cost is managed by getting colder instead of by deleting:
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            // Glacier *Instant* Retrieval, not Flexible/Deep: a restore happens
            // during an incident, and a multi-hour retrieval thaw would make
            // the backup useless exactly when it is needed.
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          // Non-current versions exist only to survive an overwrite of a good
          // bundle by a bad one; 90 days is far longer than that mistake takes
          // to surface, and keeping them forever would double storage for no
          // recovery value.
          noncurrentVersionExpiration: cdk.Duration.days(90),
          // A multipart upload interrupted mid-flight bills for its parts
          // indefinitely and is not a usable backup.
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // Least-privilege uploader, same posture as §5's cdk-deployer: write-only.
    // It can create a new bundle and nothing else — no GetObject, no
    // DeleteObject, no ListBucket. A leaked uploader credential therefore
    // cannot read a shop's exported waivers back out, and cannot destroy an
    // existing backup (versioning plus RETAIN cover the rest).
    const backupUploaderUser = new iam.User(this, "BackupUploaderUser", {
      userName: "diveday-backup-uploader",
    });

    backupUploaderUser.addToPolicy(
      new iam.PolicyStatement({
        sid: "WriteBackupBundlesOnly",
        actions: ["s3:PutObject", "s3:AbortMultipartUpload"],
        resources: [backupBucket.arnForObjects("*")],
      }),
    );

    new cdk.CfnOutput(this, "BackupBucketName", {
      value: backupBucket.bucketName,
      description:
        "Destination bucket for scheduled logical export bundles. Versioned, private, RETAIN — see docs/engineering/backup-and-restore-runbook.md.",
    });

    new cdk.CfnOutput(this, "BackupUploaderAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${backupUploaderUser.userName}`,
      description:
        "Run to mint credentials for whatever runs the scheduled export. Store them in that runner's secret settings — never in the repo.",
    });
  }
}
