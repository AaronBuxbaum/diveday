import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as ce from "aws-cdk-lib/aws-ce";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as destinations from "aws-cdk-lib/aws-logs-destinations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cr from "aws-cdk-lib/custom-resources";
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
    // `cdk deploy` actually use - no hardcoded "hnb659fds" to fall out of
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
    // other. Both hold only the AWS-managed ReadOnlyAccess policy - no write or
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
        "Run to mint local-dev AWS MCP server credentials. Store the output in a named AWS CLI profile (~/.aws/credentials) - never in the repo.",
    });

    new cdk.CfnOutput(this, "McpReadOnlyCloudAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${mcpReadOnlyCloudUser.userName}`,
      description:
        "Run to mint AWS MCP server credentials for Claude Code's cloud environment. Store the output in that environment's secret/env-var settings - never in the repo.",
    });

    // 7. Cost guardrails - alert-only, never auto-disable anything.
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
    // increase in any one service - the thing the fixed budget thresholds
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

    // The app's own origin, used to subscribe its webhook routes to the two SNS
    // topics below (SES delivery events in §8, SMS delivery receipts in §10).
    // Both were runbook steps until ADR 20260803-webhook-subscriptions-in-cdk;
    // an unsubscribed topic is the failure nothing detects, because every hop
    // either side of it looks perfectly healthy while no event ever arrives.
    //
    // Defaulted rather than gated behind an opt-in flag, deliberately. A
    // conditional subscription is worse than no automation: once created by a
    // flagged deploy, the next *unflagged* `cdk deploy` drops the resource from
    // the template and CloudFormation deletes it - restoring the exact silent
    // gap this exists to close, at the moment someone least expects it.
    //
    // Must be the canonical origin. `dive.day` 308-redirects to `www.dive.day`,
    // and a redirect is not a confirmation.
    const webhookHost = this.node.tryGetContext("webhookHost") || "https://www.dive.day";
    const webhookSubscription = (path: string) =>
      new subscriptions.UrlSubscription(`${webhookHost}${path}`);

    // 8. SES email-provider infra. SES is the app's sole provider in code
    // (ADR 20260803-ses-sole-email-provider, superseding 20260802-ses-adapter-
    // and-webhook's opt-in flag and 20260802-ses-email-transition-prep's
    // original "prep ahead of a possible Resend swap" framing) - but the
    // AWS-side production access request, DKIM DNS verification, and credential
    // minting are still manual steps, so this stays inert until those are done.
    const sesEmailDomain = this.node.tryGetContext("sesEmailDomain") || "ses.dive.day";

    // The envelope sender (Return-Path), a different address from the From
    // header and one that has to live on its own subdomain - never the one you
    // send from, so not `ses.dive.day` itself.
    //
    // Without this, SES uses a shared `amazonses.com` subdomain as the envelope
    // sender. Mail still authenticates (DKIM signs as the identity domain), but
    // SPF then aligns to Amazon's domain rather than ours, so DMARC passes on
    // DKIM alone. Owning the envelope domain gets both halves aligned, which is
    // what makes a booking confirmation survive a strict receiver.
    //
    // Derived from the identity, not written out flat, because SES requires the
    // MAIL FROM domain be a *child* of the verified identity - a sibling under
    // the same parent is rejected. This is settled by experiment, not by
    // reading: `mail.dive.day` was tried against identity `ses.dive.day` and
    // SES answered 400 with
    //
    //   Provided MAIL-FROM domain <mail.dive.day> is not subdomain of the
    //   domain of the identity <ses.dive.day>
    //
    // which contradicts the developer guide's "subdomain of the parent domain
    // of a verified identity" and matches the SetIdentityMailFromDomain API
    // reference's "subdomain of the verified identity". Trust the API reference.
    // Deriving the name keeps the two in step if `sesEmailDomain` ever moves.
    const sesMailFromDomain =
      this.node.tryGetContext("sesMailFromDomain") || `mail.${sesEmailDomain}`;

    const sesEventNotifications = new sns.Topic(this, "SesEmailEventNotifications", {
      topicName: "diveday-ses-email-events",
    });

    sesEventNotifications.addSubscription(webhookSubscription("/api/webhooks/ses"));

    const sesConfigurationSet = new ses.ConfigurationSet(this, "SesConfigurationSet", {
      configurationSetName: "diveday-transactional-email",
      vdmOptions: { optimizedSharedDelivery: true },
    });

    new ses.ConfigurationSetEventDestination(this, "SesEmailEventDestination", {
      configurationSet: sesConfigurationSet,
      destination: ses.EventDestination.snsTopic(sesEventNotifications),
      // Bounces, complaints, and delivery outcomes. OPEN/CLICK are deliberately
      // excluded - the same no-opens/no-clicks privacy stance documented in
      // docs/engineering/ses-email-runbook.md.
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
      mailFromDomain: sesMailFromDomain,
      // Degrade rather than refuse. REJECT_MESSAGE would turn a missing or
      // slow-propagating MX record into a hard failure on every send - the
      // envelope domain is a deliverability improvement, not a precondition for
      // a diver getting their booking confirmation. Falling back to the
      // amazonses.com envelope is exactly the behaviour we have today.
      mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE,
    });

    const sesSenderUser = new iam.User(this, "SesSenderUser", {
      userName: "diveday-ses-sender",
    });
    sesEmailIdentity.grantSendEmail(sesSenderUser);

    // A send is authorized against **every** SES resource it touches, and the
    // configuration set above is attached to the identity — so it is on every
    // send, whether or not the app names it. `grantSendEmail` only ever adds
    // the identity ARN (aws-cdk-lib/aws-ses `EmailIdentityBase.grant`), which
    // leaves the config set unauthorized and every send answering 403
    // `AccessDeniedException` on `configuration-set/diveday-transactional-email`
    // — including sends to the mailbox simulator, which is how this was found.
    // Granting the identity alone is a working setup only for an identity with
    // no configuration set.
    sesSenderUser.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: [
          this.formatArn({
            service: "ses",
            resource: "configuration-set",
            resourceName: sesConfigurationSet.configurationSetName,
          }),
        ],
      }),
    );

    new cdk.CfnOutput(this, "SesSenderAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${sesSenderUser.userName}`,
      description:
        "Run only once cutover begins, to mint SES-sending credentials. Store the output in the app's SES_* env vars - never in the repo.",
    });

    new cdk.CfnOutput(this, "SesDkimRecords", {
      value: cdk.Stack.of(this).toJsonString(sesEmailIdentity.dkimRecords),
      description: `DNS CNAME records to add for ${sesEmailDomain} to complete DKIM verification (three name/value pairs).`,
    });

    // Authoritative DNS for dive.day is Vercel, not Route53, so these two
    // records are added by hand rather than by this stack - there is no hosted
    // zone here to write them into. Exactly one MX record is required: SES fails
    // the MAIL FROM setup outright if the subdomain has more than one.
    new cdk.CfnOutput(this, "SesMailFromRecords", {
      value: `MX ${sesMailFromDomain} -> 10 feedback-smtp.${this.region}.amazonses.com | TXT ${sesMailFromDomain} -> "v=spf1 include:amazonses.com ~all"`,
      description: `DNS records to add for the custom MAIL FROM domain ${sesMailFromDomain}, in Vercel DNS. Exactly one MX record - SES rejects the setup if there are several.`,
    });

    new cdk.CfnOutput(this, "SesEventNotificationsTopicArn", {
      value: sesEventNotifications.topicArn,
      description: `SNS topic for SES bounce/complaint/delivery events. ${webhookHost}/api/webhooks/ses is subscribed by this stack; set this ARN as SES_SNS_TOPIC_ARN in the app.`,
    });

    // 9. SNS direct-to-phone SMS sending - see ADR 20260802-sns-sms-adapter.
    // This is a distinct SNS use from SesEmailEventNotifications above (that
    // topic carries *inbound* SES event notifications the app subscribes to;
    // this IAM user only ever calls sns:Publish outbound, no topic involved).
    // A least-privilege IAM user, scoped to publishing only - never full SNS
    // access, and never able to create/manage topics or subscriptions.
    const snsSmsSenderUser = new iam.User(this, "SnsSmsSenderUser", {
      userName: "diveday-sns-sms-sender",
    });
    snsSmsSenderUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sns:Publish"],
        // A direct-to-phone-number Publish (no TopicArn) has no ARN to scope
        // to - AWS requires "*" for this call shape. The action list is the
        // actual boundary: this user can publish and nothing else (no
        // topic/subscription management, no read access to any topic).
        resources: ["*"],
      }),
    );

    new cdk.CfnOutput(this, "SnsSmsSenderAccessKeyInstructions", {
      value: `aws iam create-access-key --user-name ${snsSmsSenderUser.userName}`,
      description:
        "Run only once SMS sending is enabled, to mint SNS-publishing credentials. Store the output in the app's SNS_* env vars - never in the repo.",
    });

    // 10. SMS delivery receipts - see ADR 20260802-sms-delivery-receipts.
    //
    // The awkward part, and the reason this is a pipeline rather than a topic
    // subscription: **SNS has no delivery webhook for a direct-to-phone
    // `Publish`.** Email gets one from SES, WhatsApp gets one from Meta, but an
    // SMS receipt is written to CloudWatch Logs and nowhere else. A CloudWatch
    // subscription filter can only target Lambda, Kinesis, or Firehose - not
    // SNS - so reaching the app takes a forwarder.
    //
    // Logs → filter → Lambda → SNS topic → /api/webhooks/sms. The extra SNS hop
    // buys the thing that makes it worth having: the receipt arrives over the
    // same signed SNS envelope the SES webhook already verifies, so the app
    // needs no new authentication path for a third provider.
    const smsDeliveryReceipts = new sns.Topic(this, "SmsDeliveryReceipts", {
      topicName: "diveday-sms-delivery-receipts",
    });

    smsDeliveryReceipts.addSubscription(webhookSubscription("/api/webhooks/sms"));

    // SNS assumes this to write delivery receipts.
    const smsDeliveryStatusRole = new iam.Role(this, "SnsSmsDeliveryStatusRole", {
      roleName: "diveday-sns-sms-delivery-status",
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
      description: "Lets SNS write SMS delivery receipts to CloudWatch Logs.",
    });
    smsDeliveryStatusRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:PutMetricFilter",
          "logs:PutRetentionPolicy",
        ],
        resources: ["*"],
      }),
    );

    // SNS writes to these exact names, and creates them itself on first send if
    // they are absent. They are declared here so retention is bounded rather
    // than "never expire" - these records name a diver's phone number, so
    // keeping them forever is a liability, and the app has already copied the
    // outcome it needs onto the delivery row.
    const smsLogGroupPrefix = `sns/${this.region}/${this.account}/DirectPublishToPhoneNumber`;
    const smsSuccessLogs = new logs.LogGroup(this, "SnsSmsDeliveryLogs", {
      logGroupName: smsLogGroupPrefix,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const smsFailureLogs = new logs.LogGroup(this, "SnsSmsDeliveryFailureLogs", {
      logGroupName: `${smsLogGroupPrefix}/Failure`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Republishes each receipt verbatim so the app parses the same bytes
    // CloudWatch wrote. Inline rather than a bundled asset: it is a dozen lines
    // with no dependencies beyond the SDK the runtime already ships, and a
    // build step for that would be more moving parts than the function.
    const smsReceiptForwarder = new lambda.Function(this, "SmsReceiptForwarder", {
      functionName: "diveday-sms-receipt-forwarder",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(30),
      environment: { TOPIC_ARN: smsDeliveryReceipts.topicArn },
      code: lambda.Code.fromInline(`
const { gunzipSync } = require("node:zlib");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const sns = new SNSClient({});

exports.handler = async (event) => {
  const payload = JSON.parse(gunzipSync(Buffer.from(event.awslogs.data, "base64")).toString("utf8"));
  // CONTROL_MESSAGE is CloudWatch checking the destination is reachable.
  if (payload.messageType !== "DATA_MESSAGE") return;
  for (const logEvent of payload.logEvents ?? []) {
    await sns.send(new PublishCommand({ TopicArn: process.env.TOPIC_ARN, Message: logEvent.message }));
  }
};
`),
    });
    smsDeliveryReceipts.grantPublish(smsReceiptForwarder);

    for (const [id, group] of [
      ["SnsSmsDeliveryLogsToTopic", smsSuccessLogs],
      ["SnsSmsDeliveryFailureLogsToTopic", smsFailureLogs],
    ] as const) {
      new logs.SubscriptionFilter(this, id, {
        logGroup: group,
        destination: new destinations.LambdaDestination(smsReceiptForwarder),
        // Every record, unfiltered: the app decides what it models, and a
        // filter pattern here would silently drop receipt shapes AWS adds later.
        filterPattern: logs.FilterPattern.allEvents(),
      });
    }

    new cdk.CfnOutput(this, "SmsDeliveryReceiptsTopicArn", {
      value: smsDeliveryReceipts.topicArn,
      description: `SNS topic carrying SMS delivery receipts. ${webhookHost}/api/webhooks/sms is subscribed by this stack; set this ARN as SMS_SNS_TOPIC_ARN in the app.`,
    });

    // Switch delivery-status logging on. There is no native resource for this:
    // `AWS::SNS::Topic.DeliveryStatusLogging` covers only the http/sqs/lambda/
    // firehose/application protocols and is scoped to a topic, whereas a
    // direct-to-phone `Publish` uses no topic and is configured by the
    // account-level `SetSMSAttributes` API.
    //
    // No native resource is not the same as not expressible, though, and this
    // is exactly what `AwsCustomResource` is for. Leaving it as a runbook step
    // would make the one thing nothing else can detect - every downstream hop
    // sits idle and healthy-looking without it - also the one thing a human has
    // to remember. `SetSMSAttributes` merges the attributes it is given rather
    // than replacing the set, so this touches neither the spend limit nor the
    // default SMS type.
    const smsDeliveryStatusAttributes = new cr.AwsCustomResource(
      this,
      "SnsSmsDeliveryStatusAttributes",
      {
        onCreate: {
          service: "SNS",
          action: "setSMSAttributes",
          parameters: {
            attributes: {
              DeliveryStatusIAMRole: smsDeliveryStatusRole.roleArn,
              // Every send is logged. Set to "0" to record only failures, which
              // is the cheaper posture if volume ever makes the CloudWatch line
              // per message worth counting.
              DeliveryStatusSuccessSamplingRate: "100",
            },
          },
          physicalResourceId: cr.PhysicalResourceId.of("sns-sms-delivery-status"),
        },
        // Same call on update, so changing the role or the sampling rate is a
        // stack deploy rather than a second thing to remember.
        onUpdate: {
          service: "SNS",
          action: "setSMSAttributes",
          parameters: {
            attributes: {
              DeliveryStatusIAMRole: smsDeliveryStatusRole.roleArn,
              DeliveryStatusSuccessSamplingRate: "100",
            },
          },
          physicalResourceId: cr.PhysicalResourceId.of("sns-sms-delivery-status"),
        },
        // Cleared on delete: the role goes with the stack, and an account left
        // pointing at a deleted role logs nothing while looking configured.
        onDelete: {
          service: "SNS",
          action: "setSMSAttributes",
          parameters: { attributes: { DeliveryStatusIAMRole: "" } },
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          // SetSMSAttributes takes no resource ARN - it is account-level state.
          new iam.PolicyStatement({ actions: ["sns:SetSMSAttributes"], resources: ["*"] }),
          // Handing SNS a role to assume is a PassRole, scoped to that one role.
          new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [smsDeliveryStatusRole.roleArn],
          }),
        ]),
        installLatestAwsSdk: false,
      },
    );
    // The attributes name the role, so it has to exist first.
    smsDeliveryStatusAttributes.node.addDependency(smsDeliveryStatusRole);

    // 11. Backup destination for the scheduled logical export.
    // See ADR 20260802-backup-and-restore-posture for why an S3 bucket rather
    // than a second Neon branch, and docs/engineering/backup-and-restore-runbook.md
    // for the procedure that writes to and restores from it.
    //
    // Deliberately NOT the VisualRegressionBucket above: that one is
    // publicReadAccess, RemovalPolicy.DESTROY, and expires everything after 7
    // days - the exact opposite of every property a backup needs. This bucket
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
          // outlived its usefulness - that is a legal call, not a cost one.
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

    // 12. Everything this stack deliberately cannot do, printed after every
    // deploy so the remainder is a visible checklist rather than something to
    // remember. Each entry is here for a structural reason, not because it is
    // unfinished — see §7's "why each one resists automation" table in
    // docs/engineering/infrastructure-runbook.md.
    //
    // Kept as one output rather than several so it reads as a list in the
    // deploy summary instead of scattering through alphabetised output keys.
    new cdk.CfnOutput(this, "ManualActionItems", {
      value: [
        `1. DNS (Vercel, not Route53): add SesDkimRecords CNAMEs to ${sesEmailDomain}, and SesMailFromRecords MX+TXT to ${sesMailFromDomain} — exactly one MX.`,
        "2. SES production access: open an AWS Support case. Until then sending is sandbox-only (pre-verified recipients).",
        `3. Mint sender credentials: aws iam create-access-key --user-name ${sesSenderUser.userName}`,
        "4. Set SES_AWS_REGION / SES_AWS_ACCESS_KEY_ID / SES_AWS_SECRET_ACCESS_KEY / SES_FROM_EMAIL / SES_SNS_TOPIC_ARN in Vercel, then redeploy the app.",
        `5. Verify both webhook subscriptions confirmed: aws sns list-subscriptions-by-topic --topic-arn ${sesEventNotifications.topicArn} - a SubscriptionArn of "PendingConfirmation" means ${webhookHost} answered non-2xx (503 = step 4 not done). Fix, then unsubscribe and redeploy to re-issue the handshake.`,
      ].join("\n"),
      description:
        "Steps this stack cannot perform. Re-read after every deploy; item 5 is the one nothing else surfaces.",
    });
  }
}
