import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as ce from "aws-cdk-lib/aws-ce";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as destinations from "aws-cdk-lib/aws-logs-destinations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cr from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import {
  type OffDotenvCredential,
  readEnvExample,
  renderCredentialsDocument,
} from "./credentials-document";
import {
  MANUAL_ACTION_CATEGORIES,
  type ManualAction,
  renderCategoryChunks,
} from "./manual-actions";

/** The one secret this stack writes. Slash-separated so a future `diveday/*` grant is one statement. */
const CREDENTIALS_SECRET_NAME = "diveday/env";

// IAM user names as literals, for the destination headings inside the
// credentials document. `iam.User.userName` is a token there, not a string, so
// interpolating it would print `${Token[...]}` where a name belongs.
const MCP_READONLY_LOCAL_USER_NAME = "diveday-mcp-readonly-local";
const MCP_READONLY_CLOUD_USER_NAME = "diveday-mcp-readonly-cloud";
const SES_SENDER_USER_NAME = "diveday-ses-sender";
const BACKUP_UPLOADER_USER_NAME = "diveday-backup-uploader";

export class InfraStack extends cdk.Stack {
  /**
   * Every step a human still has to perform, in one uniform shape.
   * `infra/lib/manual-actions.test.ts` renders this to
   * docs/engineering/manual-actions.md and asserts the committed file matches.
   */
  readonly manualActions: readonly ManualAction[];

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucketName = this.node.tryGetContext("bucketName") || "diveday-vrt";
    const userName = this.node.tryGetContext("userName") || "reg-suit-bot";

    // Every access key this stack mints is created by CloudFormation and its
    // value delivered through one Secrets Manager secret (§13). Rotation is a
    // deploy, not a console visit: `AWS::IAM::AccessKey.Serial` may only ever be
    // incremented, and incrementing it makes CloudFormation replace the key —
    // create-then-delete, so the user is transiently at IAM's two-key ceiling
    // and never below one working key.
    //
    //   pnpm infra:deploy --parameters CredentialSerial=2
    //
    // **A CloudFormation parameter, not a `--context` value, and that is the
    // whole point.** Context is per-invocation: with `--context`, the deploy
    // *after* a rotation — any unrelated deploy, run without the flag — would
    // synthesize `Serial: 1` again, replace all eight keys, and silently delete
    // the freshly-placed ones. Email and SMS would start failing on
    // `InvalidClientTokenId` with nothing connecting it to the deploy. A stack
    // parameter is remembered by CloudFormation instead, and `cdk deploy`
    // defaults `--previous-parameters` to true, so omitting the flag keeps the
    // deployed value. Forgetting it is a no-op, which is the only safe way for
    // a footgun this destructive to behave.
    //
    // One serial for all eight rather than one each: the credentials leave in a
    // single document and land in the same four places, so a partial rotation
    // saves almost nothing, and eight template parameters would be eight more
    // things to keep straight for that almost-nothing.
    const credentialSerial = new cdk.CfnParameter(this, "CredentialSerial", {
      type: "Number",
      default: 1,
      minValue: 1,
      description:
        "Increment to rotate every access key this stack mints, then re-place the new values (see docs/engineering/manual-actions.md). Deploys that omit it keep the deployed value.",
    });

    /**
     * The value halves of one identity's credential, as CloudFormation tokens.
     *
     * `constructId` is passed rather than derived because `RegSuitUserAccessKey`
     * predates this helper, and changing its logical id would replace the key on
     * a *different* schedule than the serial does.
     */
    const mintAccessKey = (constructId: string, user: iam.User) => {
      const accessKey = new iam.CfnAccessKey(this, constructId, {
        userName: user.userName,
        serial: credentialSerial.valueAsNumber,
      });
      return { id: accessKey.ref, secret: accessKey.attrSecretAccessKey };
    };

    /** `.env.example` keys this stack fills in, accumulated as each identity is created. */
    const envValues: Record<string, string> = {};
    /** Credentials whose destination is not a dotenv file. */
    const offDotenvCredentials: OffDotenvCredential[] = [];

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

    // 4. Create Access Key for reg-suit.
    //
    // This one used to publish its secret as an unmasked `IAMUserSecretKey`
    // stack output. `cloudformation:DescribeStacks` returns resolved outputs, so
    // that credential was readable by the cdk-deployer user (§5, which holds
    // DescribeStacks on every stack in the account) and by both "read-only" MCP
    // users (§6, whose ReadOnlyAccess includes it) — each of which then had
    // s3:DeleteObject* on an unversioned bucket via `grantReadWrite` below.
    // Three identities' stated security rationale defeated by one output.
    //
    // The secret now goes to Secrets Manager (§13) and nowhere else. Outputs
    // carry names, ARNs, and instructions; never key material.
    const regSuitKey = mintAccessKey("RegSuitUserAccessKey", user);
    envValues.REG_SUIT_S3_BUCKET_NAME = bucket.bucketName;
    envValues.REG_SUIT_AWS_ACCESS_KEY_ID = regSuitKey.id;
    envValues.REG_SUIT_AWS_SECRET_ACCESS_KEY = regSuitKey.secret;

    // 5. Create a dedicated CDK Deployer user for managing all future infrastructure.
    //
    // This user holds no direct AWS permissions of its own. `cdk bootstrap`
    // provisions deploy-role/file-publishing-role/image-publishing-role/lookup-role
    // in this account; the deployer just needs to assume them.
    //
    // Be careful how much comfort to take from that. It is a real improvement
    // over handing out AdministratorAccess directly — the credential is useless
    // outside CloudFormation, and revoking it is one `DeleteAccessKey`. But it
    // is *not* a privilege boundary: the deploy role passes a CloudFormation
    // execution role, and a plain `cdk bootstrap` leaves that role at
    // AdministratorAccess (`--cloudformation-execution-policies` defaults to
    // empty). Anything deployable is therefore reachable from this key,
    // including a stack that reads §13's credentials secret. Bootstrapping with
    // scoped execution policies is what would actually bound it, and it is a
    // manual action (§14, `cdk-bootstrap`). Until then, treat this key as an
    // administrator credential — which is why the document in §13 marks it
    // workstation-only.
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

    const deployerKey = mintAccessKey("CdkDeployerUserAccessKey", deployerUser);
    envValues.AWS_ACCOUNT_ID = this.account;
    envValues.AWS_DEFAULT_REGION = this.region;
    envValues.AWS_ACCESS_KEY_ID = deployerKey.id;
    envValues.AWS_SECRET_ACCESS_KEY = deployerKey.secret;

    // 6. Read-only IAM identities for an AWS API MCP server. Local dev and
    // Claude Code's cloud environment each get their own principal so either can
    // be rotated or revoked without touching the other. Both hold only the
    // AWS-managed ReadOnlyAccess policy.
    //
    // No consumer is configured today - `.mcp.json` currently lists Sentry,
    // next-devtools, vercel, playwright, and context7, and no `aws` entry. These
    // stay because the identities are the slow part to provision and reviewing;
    // wiring an MCP server to an existing read-only key is a one-line change.
    //
    // "Read-only" has to mean it, and ReadOnlyAccess is AWS's policy to change,
    // not ours: it already grants `cloudformation:DescribeStacks`, which is how
    // the old `IAMUserSecretKey` output (§4) was readable from here. An explicit
    // Deny on `secretsmanager:GetSecretValue` is what makes the claim true
    // independent of what AWS adds to the managed policy next - a Deny always
    // beats an Allow, so these credentials can never read §14's secret and
    // escalate into the write-capable identities it carries.
    const readOnlyAccess = iam.ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess");

    const mcpReadOnlyLocalUser = new iam.User(this, "McpReadOnlyLocalUser", {
      userName: MCP_READONLY_LOCAL_USER_NAME,
      managedPolicies: [readOnlyAccess],
    });

    const mcpReadOnlyCloudUser = new iam.User(this, "McpReadOnlyCloudUser", {
      userName: MCP_READONLY_CLOUD_USER_NAME,
      managedPolicies: [readOnlyAccess],
    });

    for (const readOnlyUser of [mcpReadOnlyLocalUser, mcpReadOnlyCloudUser]) {
      readOnlyUser.addToPolicy(
        new iam.PolicyStatement({
          sid: "NeverReadAnySecretValue",
          effect: iam.Effect.DENY,
          actions: ["secretsmanager:GetSecretValue"],
          // Every secret, not just this stack's: an inspection credential has no
          // business reading key material anywhere in the account, and scoping
          // the Deny to one ARN would leave the next secret uncovered.
          resources: ["*"],
        }),
      );
    }

    const mcpReadOnlyLocalKey = mintAccessKey(
      "McpReadOnlyLocalUserAccessKey",
      mcpReadOnlyLocalUser,
    );
    const mcpReadOnlyCloudKey = mintAccessKey(
      "McpReadOnlyCloudUserAccessKey",
      mcpReadOnlyCloudUser,
    );

    offDotenvCredentials.push({
      destination: `${MCP_READONLY_LOCAL_USER_NAME} -> ~/.aws/credentials`,
      note: "A named AWS CLI profile on your workstation. Reference it with AWS_PROFILE or --profile.",
      body: [
        `[${MCP_READONLY_LOCAL_USER_NAME}]`,
        `aws_access_key_id = ${mcpReadOnlyLocalKey.id}`,
        `aws_secret_access_key = ${mcpReadOnlyLocalKey.secret}`,
        "region = us-east-1",
      ],
    });

    offDotenvCredentials.push({
      destination: `${MCP_READONLY_CLOUD_USER_NAME} -> Claude Code cloud environment variables`,
      note: "claude.ai/code -> the environment for this repo -> Environment variables. Never .env.local; this key is for the cloud sandbox, not your machine.",
      body: [
        `AWS_ACCESS_KEY_ID=${mcpReadOnlyCloudKey.id}`,
        `AWS_SECRET_ACCESS_KEY=${mcpReadOnlyCloudKey.secret}`,
        "AWS_DEFAULT_REGION=us-east-1",
      ],
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
      userName: SES_SENDER_USER_NAME,
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

    const sesSenderKey = mintAccessKey("SesSenderUserAccessKey", sesSenderUser);
    envValues.SES_AWS_REGION = this.region;
    envValues.SES_AWS_ACCESS_KEY_ID = sesSenderKey.id;
    envValues.SES_AWS_SECRET_ACCESS_KEY = sesSenderKey.secret;

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

    const snsSmsSenderKey = mintAccessKey("SnsSmsSenderUserAccessKey", snsSmsSenderUser);
    envValues.SNS_AWS_REGION = this.region;
    envValues.SNS_AWS_ACCESS_KEY_ID = snsSmsSenderKey.id;
    envValues.SNS_AWS_SECRET_ACCESS_KEY = snsSmsSenderKey.secret;

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
      userName: BACKUP_UPLOADER_USER_NAME,
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

    // No destination exists for this credential yet. `src/app/api/cron/backup-export/`
    // reads no AWS credential at all, the runtime feature seals its own per-shop
    // credentials, and `.env.example` has no entry for it — the choice of runner
    // is still a `TODO(owner)` in docs/engineering/backup-and-restore-runbook.md.
    // It rides in the off-dotenv section saying exactly that, rather than in a
    // `.env` block implying a home it does not have.
    const backupUploaderKey = mintAccessKey("BackupUploaderUserAccessKey", backupUploaderUser);
    offDotenvCredentials.push({
      destination: `${BACKUP_UPLOADER_USER_NAME} -> nowhere yet`,
      note: "Whatever ends up running the scheduled export (a Vercel Cron route or a GitHub Actions schedule - undecided, see backup-and-restore-runbook.md). Until that is decided this key has no home; leave it here.",
      body: [
        `AWS_ACCESS_KEY_ID=${backupUploaderKey.id}`,
        `AWS_SECRET_ACCESS_KEY=${backupUploaderKey.secret}`,
      ],
    });

    // 12. Address lookup for the settings address card - see ADR
    // 20260804-aws-location-address-lookup. Amazon Location Service's
    // geo-places Autocomplete, called *server-side* from a Next.js server
    // action, which is the whole reason this is an IAM user rather than the
    // browser API key a Google Places widget would need: the credential never
    // reaches a browser, so there is nothing to referrer-restrict and nothing
    // spendable sitting in client JavaScript.
    //
    // Its own user, not the SES or SNS one: least privilege means a geocoding
    // key can never send mail, and a mail key can never spend the geocoding
    // budget.
    const placesLookupUser = new iam.User(this, "PlacesLookupUser", {
      userName: "diveday-places-lookup",
    });
    placesLookupUser.addToPolicy(
      new iam.PolicyStatement({
        // Autocomplete only. Not Geocode, not GetPlace, not SearchText, and
        // nothing from the maps or routes families - the app calls exactly one
        // operation, so that is exactly what this identity can do.
        actions: ["geo-places:Autocomplete"],
        // The geo-places API is resource-less for this call shape (there is no
        // place-index resource to scope to in the standalone Places API), so
        // the action list above is the actual boundary.
        resources: ["*"],
      }),
    );

    const placesLookupKey = mintAccessKey("PlacesLookupUserAccessKey", placesLookupUser);
    envValues.PLACES_AWS_REGION = this.region;
    envValues.PLACES_AWS_ACCESS_KEY_ID = placesLookupKey.id;
    envValues.PLACES_AWS_SECRET_ACCESS_KEY = placesLookupKey.secret;

    // 13. The credentials secret: one Secrets Manager secret holding a filled-in
    // `.env.example`.
    //
    // Every access key above is minted by CloudFormation and delivered here.
    // That is a reversal of the previous posture ("every IAM user mints its key
    // out of band so no secret lands in stack state"), and it is worth being
    // precise about why, because the old reasoning was half right:
    //
    //  - A `CfnAccessKey` secret is *not* readable from the template.
    //    `cloudformation:GetTemplate` returns the unresolved `Fn::GetAtt`, at
    //    both Original and Processed stages. What leaked it was putting it in a
    //    `CfnOutput` (§4), which `DescribeStacks` resolves. Outputs were the
    //    hole, not CfnAccessKey.
    //  - Minting by hand did not avoid the secret; it moved it into a terminal
    //    scrollback and a human's memory, once, unrecoverably. Lose it and the
    //    only recovery is minting another key and re-pasting it everywhere.
    //  - CloudFormation-owned keys can be rotated by deploying (`Serial`), which
    //    is the only reason rotation stops being a thing nobody does.
    //
    // The trade taken in exchange: removing a key's construct from this stack
    // *deletes the key*, breaking anything still holding it, where a hand-minted
    // key would have survived untouched. That is the correct default — a
    // credential this file no longer describes should stop working — but it is a
    // sharp edge and it is why §14's checklist carries a rotation entry.
    //
    // One secret, not eight. Secrets Manager bills $0.40 per secret per month;
    // eight would be $3.20 against the ~$5/month this account is budgeted for
    // (ADR 20260802-aws-cost-guardrails), which would make the budget's 50% and
    // 80% alerts fire every month on fixed cost and turn the guardrail into
    // noise. One secret is $0.40 and rounds to nothing. The cost is granularity:
    // whoever can read this reads all of it, and there is no per-credential read
    // scope. On a single-operator account that distinction is theoretical - the
    // same person holds account admin either way.
    //
    // **No *additional* principal is granted read**, and it is worth being exact
    // about what that does and does not buy.
    //
    // It bounds the read-only MCP users (§6) completely: they carry an explicit
    // Deny, and a Deny beats any Allow.
    //
    // It does *not* bound the deployer (§5), and saying otherwise would be the
    // same species of false comfort this whole change exists to remove. The
    // deployer can assume `cdk-<qualifier>-deploy-role`, and a plain
    // `cdk bootstrap` - which is what `pnpm infra:bootstrap` runs - leaves the
    // CloudFormation execution role at AdministratorAccess, because
    // `--cloudformation-execution-policies` defaults to empty and the bootstrap
    // template's own default applies. A holder of the deployer key can therefore
    // deploy a one-resource stack that reads this secret. Withholding
    // `grantRead` costs them a step, not the capability. What would actually
    // bound it is bootstrapping with scoped execution policies - a manual
    // action, and named as one in §14.
    //
    // That reach is why the deployer's own key is the one credential in the
    // document marked workstation-only: it is the key that yields all the
    // others, so the fewer places it sits, the better.
    //
    // The account owner reads the secret with their administrator profile, or in
    // the console. It is a hand-off point for a human, so a human's credential
    // is the one that opens it.
    envValues.SES_SNS_TOPIC_ARN = sesEventNotifications.topicArn;
    envValues.SMS_SNS_TOPIC_ARN = smsDeliveryReceipts.topicArn;

    const credentialsSecret = new secretsmanager.Secret(this, "CredentialsEnvDocument", {
      secretName: CREDENTIALS_SECRET_NAME,
      description:
        "Filled-in .env.example: every credential this stack mints, with the destination for each. The whole document goes in .env.local; only the SES_/SNS_/SMS_/PLACES_ lines go to Vercel (AWS_ACCESS_KEY_ID is the deployer's and belongs on no deployed environment). Read with: aws secretsmanager get-secret-value --secret-id diveday/env --query SecretString --output text",
      // The IAM keys are the system of record; this is a copy of them for a
      // human. Once the stack is gone the users and their keys are gone too, so
      // retaining the document would leave a file of dead credentials that still
      // looks live. CloudFormation deletes secrets with ForceDeleteWithoutRecovery,
      // so there is also no 7-30 day window blocking a redeploy of the same name.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Not `secretObjectValue`: that renders a flat JSON object, and the
      // destination format here is dotenv. The string carries CloudFormation
      // tokens (`Fn::GetAtt` on each access key), which is what `unsafePlainText`
      // is for - it is the escape hatch for a value assembled from references,
      // and CDK resolves the tokens into an `Fn::Join` at synth. No plaintext
      // credential exists anywhere in this repo or in the template.
      secretStringValue: cdk.SecretValue.unsafePlainText(
        renderCredentialsDocument({
          template: readEnvExample(),
          values: envValues,
          secretName: CREDENTIALS_SECRET_NAME,
          offDotenv: offDotenvCredentials,
        }),
      ),
    });

    new cdk.CfnOutput(this, "CredentialsSecretName", {
      // The constant, not `credentialsSecret.secretName`: without the
      // `@aws-cdk/aws-secretsmanager:parseOwnedSecretName` feature flag that
      // property renders as "split the ARN on '-' and take the first piece",
      // which is only correct while the name happens to contain no hyphen.
      value: CREDENTIALS_SECRET_NAME,
      description:
        "Secrets Manager secret holding every credential this stack mints, as a filled-in .env.example. Nothing is granted read access; use an administrator profile.",
    });

    // 14. Everything this stack deliberately cannot do, in one shape, printed
    // after every deploy so the remainder is a visible checklist rather than
    // something to remember.
    //
    // The previous version of this output listed five SES steps and called
    // itself "steps this stack cannot perform". It omitted six of the seven
    // credential hand-offs, thirteen environment variables, the SNS SMS sandbox
    // and spend-limit gate, the account-level S3 Block Public Access toggle, and
    // Cost Explorer enablement - and named a capability limit where the real
    // reason was a policy choice, which is how the reg-suit exception in §4 went
    // unnoticed for so long. Each entry below states its own `why`, so a step
    // whose reason is "we chose to" reads differently from one that is
    // structurally impossible.
    //
    // Grouped by category rather than emitted one output per action: a dozen
    // keys would bury the rest of the deploy summary, and each group stays well
    // inside CloudFormation's 4096-character output-value ceiling (asserted in
    // infra/lib/manual-actions.test.ts).
    this.manualActions = [
      {
        id: "aws-cli-admin-profile",
        title: "Install the AWS CLI and configure an administrator profile",
        category: "Prerequisites",
        when: "once per workstation",
        why: "Bootstrapping an account and reading the credentials secret both need a credential that predates this stack. The cdk-deployer user it creates cannot do either.",
        run: ["aws configure --profile diveday-admin"],
        store: "~/.aws/credentials, under the profile name you passed above.",
        note: "The only long-lived administrator credential in this picture. Everything else in the checklist exists to replace a use of it, so it should be reached for rarely and stored like it matters.",
      },
      {
        id: "cdk-bootstrap",
        title: "Bootstrap the account for CDK",
        category: "Prerequisites",
        when: "once per account and region",
        why: "CDK deploys through four roles that a bootstrap stack provisions. §5's deployer holds sts:AssumeRole on exactly those four ARNs and nothing else, so without them it can deploy nothing.",
        run: ["AWS_PROFILE=diveday-admin pnpm infra:bootstrap"],
        produces:
          "The cdk-<qualifier>-{deploy,file-publishing,image-publishing,lookup}-role roles.",
        verify: ["aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version"],
        note: "Two defaults this leaves wide. (1) If you bootstrap with --qualifier, infra-stack.ts §5 builds the four role ARNs from the @aws-cdk/core:bootstrapQualifier context value — set it to match, or the deployer's AssumeRole silently matches nothing. (2) --cloudformation-execution-policies defaults to empty, so the execution role the deploy role passes gets AdministratorAccess. That makes cdk-deployer administrator-equivalent by transitivity, whatever this stack grants it directly — including reach to the credentials secret nothing is granted read on. Pass scoped policies here to bound it; otherwise treat the deployer key as an admin credential and keep it off every deployed environment.",
      },
      {
        id: "s3-account-block-public-access",
        title: "Allow public S3 buckets at the account level",
        category: "Prerequisites",
        when: "once per account, before the first deploy",
        why: "The visual-regression bucket serves its HTML reports publicly. Account-level Block Public Access overrides the bucket's own settings and is on by default on accounts created since April 2023, so the deploy either fails or produces a bucket whose website endpoint 403s. There is no CloudFormation resource for the account-level setting.",
        run: [
          "aws s3control get-public-access-block --account-id <account-id>",
          "Turn BlockPublicAcls / BlockPublicPolicy / IgnorePublicAcls / RestrictPublicBuckets off in the S3 console's Block Public Access settings for this account.",
        ],
        verify: ["curl -s -o /dev/null -w '%{http_code}\\n' <S3WebsiteURL output>"],
      },
      {
        id: "cost-explorer-enabled",
        title: "Enable Cost Explorer",
        category: "Prerequisites",
        when: "once per account",
        why: "The Cost Anomaly Detection monitor (infra-stack.ts §7) depends on Cost Explorer, which is a one-time console opt-in with no API, and produces no findings until it has accumulated spend history. The AWS::Budgets::Budget alongside it needs nothing.",
        run: ["Billing and Cost Management console -> Cost Explorer -> enable."],
        verify: ["aws ce get-anomaly-monitors --query 'AnomalyMonitors[].MonitorName'"],
      },
      {
        id: "credentials-to-env-local",
        title: "Copy the credentials secret into .env.local",
        category: "Credentials",
        when: "after the first deploy, and after rotating any credential",
        why: "The secret is written by the deploy; putting its contents where a process will read them is a human act on a machine and a platform CloudFormation has no reach into.",
        run: [
          `AWS_PROFILE=diveday-admin aws secretsmanager get-secret-value --secret-id ${CREDENTIALS_SECRET_NAME} --query SecretString --output text`,
        ],
        produces:
          ".env.example with every value this stack can supply already filled in, plus a commented section for the credentials that do not belong in a dotenv file.",
        store:
          ".env.local at the repo root (gitignored). It is a complete file — paste over the whole thing, then fill the blanks. The stack supplies AWS credentials and topic ARNs and nothing else, so everything non-AWS stays empty (DATABASE_URL, AUTH_SECRET, APP_HOST, STRIPE_*, META_*, SECRET_ENCRYPTION_KEY, CRON_SECRET, NEXT_PUBLIC_SENTRY_DSN), as do the AWS values that are a choice rather than a credential (SES_FROM_EMAIL, SNS_SENDER_ID, REG_SUIT_GITHUB_CLIENT_ID).",
        verify: ["pnpm check:env"],
      },
      {
        id: "credentials-to-vercel",
        title: "Put the app's AWS credentials into Vercel",
        category: "Credentials",
        when: "after the first deploy, and after rotating any of them",
        why: "Vercel runs the app; CDK runs the infrastructure. Neither deploy pipeline can write to the other, so the values cross by hand.",
        run: [
          "Copy ONLY the SES_*, SNS_*, SMS_*, and PLACES_* lines out of the secret — not the whole document.",
          "Vercel -> diveday -> Settings -> Environment Variables -> Import .env, and paste those lines.",
          "Then redeploy the app: the values are read at request time from the build's environment.",
        ],
        store:
          "Vercel Production environment: SES_AWS_REGION, SES_AWS_ACCESS_KEY_ID, SES_AWS_SECRET_ACCESS_KEY, SES_FROM_EMAIL, SES_SNS_TOPIC_ARN, SNS_AWS_REGION, SNS_AWS_ACCESS_KEY_ID, SNS_AWS_SECRET_ACCESS_KEY, SMS_SNS_TOPIC_ARN, PLACES_AWS_REGION, PLACES_AWS_ACCESS_KEY_ID, PLACES_AWS_SECRET_ACCESS_KEY.",
        note: "Never AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY. Those are the cdk-deployer key, which can assume the CDK bootstrap roles and is therefore administrator-equivalent on this account. The app has no use for it, and a Vercel environment variable is readable by every project member and reachable from any compromised dependency in the server bundle. The document marks that block workstation-only for exactly this reason.",
        verify: [
          "curl -s -o /dev/null -w '%{http_code}\\n' -X POST <webhookHost>/api/webhooks/ses -d '{}'",
          "Anything but 503. A 503 means SES_SNS_TOPIC_ARN is still unset in the running deployment.",
        ],
      },
      {
        id: "credentials-to-github-actions",
        title: "Put the reg-suit credentials into GitHub Actions secrets",
        category: "Credentials",
        when: "after the first deploy, and after rotating reg-suit-bot",
        why: "CI compares visual baselines against the visual-regression bucket (infra-stack.ts §1). GitHub is a third platform, and its secrets are write-only through an API this stack has no credential for.",
        run: ["GitHub -> the repository -> Settings -> Secrets and variables -> Actions."],
        store:
          "Repository secrets REG_SUIT_S3_BUCKET_NAME, REG_SUIT_AWS_ACCESS_KEY_ID, REG_SUIT_AWS_SECRET_ACCESS_KEY (consumed by .github/workflows/ci.yml). REG_SUIT_GITHUB_CLIENT_ID is not from this stack — it comes from the reg-suit GitHub app.",
        verify: ["Push a branch and confirm the visual job uploads a report rather than skipping."],
      },
      {
        id: "credentials-off-dotenv",
        title: "Place the credentials that are not .env values",
        category: "Credentials",
        when: "after the first deploy, and after rotating them",
        why: "An AWS CLI profile is an INI file on a workstation and Claude Code's cloud environment is another vendor's settings page. Both are outside anything CloudFormation addresses.",
        run: [
          "Read the secret and scroll to the 'Not .env values' section; each block names its destination.",
        ],
        store:
          "diveday-mcp-readonly-local -> a named profile in ~/.aws/credentials. diveday-mcp-readonly-cloud -> the Claude Code cloud environment's variables. diveday-backup-uploader -> nowhere yet; the scheduled export has no runner (backup-and-restore-runbook.md).",
      },
      {
        id: "retire-hand-minted-keys",
        title: "Delete the access keys that were minted by hand",
        category: "Credentials",
        when: "once, immediately after the first deploy of this stack — not needed on a fresh account",
        why: "Until this change, seven of these eight users had their keys created by hand with `aws iam create-access-key`. CloudFormation did not create those keys and will not delete them, so each such user now holds two: the old one and the one this deploy just minted. Two is IAM's hard, non-adjustable ceiling. Rotation replaces a key create-then-delete, so the next CredentialSerial bump would call CreateAccessKey against a full user and fail with LimitExceeded. Nothing warns you in the meantime — the deploy that creates the second key succeeds, and the failure waits until the day you are rotating because something leaked.",
        run: [
          'for u in reg-suit-bot cdk-deployer diveday-mcp-readonly-local diveday-mcp-readonly-cloud diveday-ses-sender diveday-sns-sms-sender diveday-backup-uploader diveday-places-lookup; do echo "== $u"; aws iam list-access-keys --user-name "$u" --query \'AccessKeyMetadata[].[AccessKeyId,CreateDate]\' --output text; done',
          "For any user listing two, delete the OLDER one — the newer is the one this stack just created: aws iam delete-access-key --user-name <user> --access-key-id <old-id>",
        ],
        produces:
          "Every identity back to a single access key, so a future rotation has room to create its replacement.",
        verify: ["Re-run the loop above: every user lists exactly one key."],
        note: "Do this AFTER placing the new credentials, never before — the old key is what everything is still authenticating with until you have.",
      },
      {
        id: "rotate-credentials",
        title: "Rotate every credential",
        category: "Credentials",
        when: "on suspected exposure, on operator change, or on a schedule you choose",
        why: "Rotation itself is a deploy — CloudFormation replaces each key when Serial increases. What stays manual is re-placing the new values everywhere the old ones went, because those destinations are the four platforms above.",
        run: ["pnpm infra:deploy --parameters CredentialSerial=<previous + 1>"],
        store:
          "The same four destinations as the placement steps above: .env.local, Vercel's environment variables, GitHub Actions repository secrets, and the off-dotenv homes. All eight keys rotate together, so all four need re-doing.",
        verify: [
          "aws iam list-access-keys --user-name diveday-ses-sender — one key, created just now.",
          'aws cloudformation describe-stacks --stack-name diveday-infra --query "Stacks[0].Parameters" — CredentialSerial is the value you passed.',
        ],
        note: "The serial is a CloudFormation parameter rather than a --context value, so a later deploy that omits it keeps the deployed value instead of rotating everything back to 1 (cdk deploy defaults --previous-parameters to true). It may only ever increase. Nothing warns you that a stale copy of an old key is still in use somewhere.",
      },
      {
        id: "ses-dkim-dns",
        title: "Add the SES DKIM records",
        category: "DNS",
        when: "once per sending domain",
        why: "Authoritative DNS for dive.day is Vercel, not Route53 — this stack has no hosted zone to write into. Adding one would mean replicating the live mail records and replacing Vercel's apex ALIAS with anycast A records Vercel owns and rotates.",
        run: ["Read the SesDkimRecords output: three CNAME name/value pairs."],
        store: "Vercel -> dive.day -> DNS. Three CNAME records on the SES identity subdomain.",
        verify: [
          "aws sesv2 get-email-identity --email-identity <sesEmailDomain> --query DkimAttributes.Status  # SUCCESS",
        ],
      },
      {
        id: "ses-mail-from-dns",
        title: "Add the SES custom MAIL FROM records",
        category: "DNS",
        when: "once per sending domain",
        why: "Same reason as the DKIM records: the zone is at Vercel.",
        run: ["Read the SesMailFromRecords output: one MX and one TXT."],
        store:
          "Vercel -> dive.day -> DNS, on the MAIL FROM subdomain. Exactly one MX record — SES fails the setup outright if the subdomain has several.",
        verify: [
          "aws sesv2 get-email-identity --email-identity <sesEmailDomain> --query MailFromAttributes.MailFromDomainStatus  # SUCCESS",
        ],
      },
      {
        id: "ses-production-access",
        title: "Request SES production access",
        category: "AWS account",
        when: "once, before sending to anyone who has not verified their address",
        why: "A human-reviewed AWS Support case. There is no API.",
        run: ["SES console -> Account dashboard -> Request production access."],
        produces:
          "Sending to arbitrary recipients. Until then SES is in the sandbox: pre-verified addresses and the mailbox simulator only.",
        verify: ["aws sesv2 get-account --query ProductionAccessEnabled"],
      },
      {
        id: "sns-sms-account-limits",
        title: "Leave the SMS sandbox, raise the spend limit, register an origination identity",
        category: "AWS account",
        when: "once, before sending SMS to a diver",
        why: "All three are account-level SMS state. The sandbox exit and any spend limit above $1 are Support cases; a US origination identity (10DLC or toll-free) is a vetted registration with the carriers. The SetSMSAttributes custom resource (infra-stack.ts §10) deliberately touches none of them — it sets delivery-status logging and nothing else.",
        run: [
          "SNS console -> Text messaging (SMS) -> Exit SMS sandbox (a Support case).",
          "Service Quotas -> Amazon SNS -> Account spend threshold for SMS (default $1/month).",
          "SNS console -> Text messaging (SMS) -> Origination identities, for US traffic.",
        ],
        verify: ["aws sns get-sms-attributes --attributes MonthlySpendLimit"],
        note: "Skipping this does not fail anything visibly: the pipeline reads healthy end to end while sends are capped or dropped.",
      },
      {
        id: "backup-bucket-readoption",
        title: "Re-adopt the retained backup bucket",
        category: "AWS account",
        when: "only after a cdk destroy, and only if you then redeploy",
        why: "The backup bucket (infra-stack.ts §11) carries RemovalPolicy.RETAIN so production backups survive a destroyed stack. CloudFormation then tries to create a bucket whose name is already taken and the deploy fails.",
        run: [
          "Import the existing bucket into the stack, or deploy with --context backupBucketName=<a new name>.",
        ],
        produces:
          "A deploy that gets past the BucketAlreadyOwnedByYou failure without losing the bundles.",
        verify: [
          "aws s3 ls s3://diveday-backups/exports/ — the existing bundles are still listed.",
        ],
        note: "Deleting the bucket to make a deploy go green deletes production backups. That is the trade RETAIN exists to force; do not take it by reflex.",
      },
      {
        id: "verify-webhook-subscriptions",
        title: "Confirm both SNS webhook subscriptions",
        category: "Verification",
        when: "after every deploy that created or replaced a subscription",
        why: "An HTTPS subscription is only real once the endpoint answers SNS's handshake, and both routes answer 503 until their topic ARN is in the app's environment. On a fresh environment the stack therefore creates a subscription the app cannot yet confirm, and SNS deletes it after roughly three days. Nothing else detects this: every hop either side reads healthy while no event ever arrives.",
        run: [
          "aws sns list-subscriptions-by-topic --topic-arn <SesEventNotificationsTopicArn>",
          "aws sns list-subscriptions-by-topic --topic-arn <SmsDeliveryReceiptsTopicArn>",
        ],

        verify: ['Both list a real SubscriptionArn, not "PendingConfirmation".'],
        onFailure:
          '"PendingConfirmation" means the endpoint answered non-2xx — SES_SNS_TOPIC_ARN or SMS_SNS_TOPIC_ARN is missing from the running app. Set it, redeploy the app, then `aws sns unsubscribe --subscription-arn <pending>` and redeploy this stack to re-issue the handshake. Redeploying this stack alone will not fix it: CloudFormation still believes the subscription exists.',
      },
      {
        id: "verify-sms-delivery-status",
        title: "Confirm SMS delivery-status logging applied",
        category: "Verification",
        when: "after the first deploy, and after changing the delivery-status role",
        why: "infra-stack.ts §10 sets this through an AwsCustomResource because SetSMSAttributes is account-level state with no CloudFormation resource. A custom resource that succeeded is not the same as an attribute that took.",
        run: [
          "aws sns get-sms-attributes --attributes DeliveryStatusIAMRole,DeliveryStatusSuccessSamplingRate",
        ],
        verify: ["The diveday-sns-sms-delivery-status role ARN, and a sampling rate of 100."],
      },
    ];

    // Numbered because `cdk deploy` prints outputs in alphabetical order, and
    // "AWS account" would otherwise come before "Prerequisites". A category that
    // outgrows CloudFormation's 4096-character output value splits across
    // sibling keys rather than being trimmed.
    MANUAL_ACTION_CATEGORIES.forEach((category, index) => {
      const chunks = renderCategoryChunks(this.manualActions, category, 4000);
      const prefix = `ManualActions${index + 1}${category.replace(/\W/g, "")}`;
      chunks.forEach((chunk, part) => {
        new cdk.CfnOutput(this, chunks.length === 1 ? prefix : `${prefix}Part${part + 1}`, {
          value: chunk,
          description: `Manual actions: ${category}${chunks.length === 1 ? "" : ` (${part + 1}/${chunks.length})`}. Full checklist in docs/engineering/manual-actions.md.`,
        });
      });
    });
  }
}
