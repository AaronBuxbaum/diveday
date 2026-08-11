import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as ce from "aws-cdk-lib/aws-ce";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as destinations from "aws-cdk-lib/aws-logs-destinations";
import * as rum from "aws-cdk-lib/aws-rum";
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
import type { ManualAction } from "./manual-actions";
import {
  alarmDescriptionFor,
  alarmNameFor,
  filterPatternFor,
  LOG_SIGNALS,
  METRIC_NAMESPACE,
  queryConstructIdFor,
  SAVED_LOG_QUERIES,
  WEB_VITAL_SIGNALS,
  webVitalAlarmNameFor,
  webVitalFilterPatternFor,
} from "./observability";

/** The credential hand-off document. Slash-separated for the `diveday/*` secret namespace. */
const CREDENTIALS_SECRET_NAME = "diveday/env";
const APP_SECRET_SEED_NAME = "diveday/app-secret-seed";

/**
 * Scopes every GitHub Actions OIDC trust condition below (§18) to this repo.
 *
 * Spelled with GitHub's own casing, and it has to be. This string lands in an
 * IAM `StringLike` on `token.actions.githubusercontent.com:sub`, GitHub mints
 * that claim as `repo:AaronBuxbaum/diveday:<context>` using the account name as
 * the account holder wrote it, and `StringLike` is case-sensitive with no
 * ignore-case variant to reach for. Lower-cased here, the condition matches
 * nothing: every credentialed CI step fails with `Not authorized to perform
 * sts:AssumeRoleWithWebIdentity`, which reads like a missing role or an
 * unfinished setup step rather than a spelling. GitHub's URLs and API are
 * case-insensitive, so nothing else in the repo notices.
 */
const GITHUB_REPO = "AaronBuxbaum/diveday";
/** Must match the `environment:` name .github/workflows/infra.yml's deploy job declares (§18). */
const GITHUB_DEPLOY_ENVIRONMENT = "infra-deploy";

// IAM user names as literals, for the destination headings inside the
// credentials document. `iam.User.userName` is a token there, not a string, so
// interpolating it would print `${Token[...]}` where a name belongs.
const MCP_READONLY_LOCAL_USER_NAME = "diveday-mcp-readonly-local";
const MCP_READONLY_CLOUD_USER_NAME = "diveday-mcp-readonly-cloud";
const SES_SENDER_USER_NAME = "diveday-ses-sender";
const BACKUP_UPLOADER_USER_NAME = "diveday-backup-uploader";
const LOG_SHIPPER_USER_NAME = "diveday-cloudwatch-shipper";

/**
 * The app's own log group (§13). A literal rather than a derived token because
 * it is both an IAM policy's scope and a value a human pastes into Vercel, and
 * `${Token[...]}` is no use for the second of those.
 */
const APP_LOG_GROUP_NAME = "/diveday/app";

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
    // value delivered through the credential hand-off secret (§16). Rotation is a
    // deploy, not a console visit: `AWS::IAM::AccessKey.Serial` may only ever be
    // incremented, and incrementing it makes CloudFormation replace the key --
    // create-then-delete, so the user is transiently at IAM's two-key ceiling
    // and never below one working key.
    //
    //   pnpm infra:deploy --parameters CredentialSerial=2
    //
    // **A CloudFormation parameter, not a `--context` value, and that is the
    // whole point.** Context is per-invocation: with `--context`, the deploy
    // *after* a rotation -- any unrelated deploy, run without the flag -- would
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
    const mintedKeys: iam.CfnAccessKey[] = [];
    const keyedUsers: iam.User[] = [];
    const mintAccessKey = (constructId: string, user: iam.User) => {
      const accessKey = new iam.CfnAccessKey(this, constructId, {
        userName: user.userName,
        serial: credentialSerial.valueAsNumber,
      });
      mintedKeys.push(accessKey);
      keyedUsers.push(user);
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
    // users (§6, whose ReadOnlyAccess includes it) -- each of which then had
    // s3:DeleteObject* on an unversioned bucket via `grantReadWrite` below.
    // Three identities' stated security rationale defeated by one output.
    //
    // The secret now goes to Secrets Manager (§16) and nowhere else. Outputs
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
    // over handing out AdministratorAccess directly -- the credential is useless
    // outside CloudFormation, and revoking it is one `DeleteAccessKey`. But it
    // is *not* a privilege boundary: the deploy role passes a CloudFormation
    // execution role, and a plain `cdk bootstrap` leaves that role at
    // AdministratorAccess (`--cloudformation-execution-policies` defaults to
    // empty). Anything deployable is therefore reachable from this key,
    // including a stack that reads §16's credentials secret. Bootstrapping with
    // scoped execution policies is what would actually bound it, and it is a
    // manual action (§17, `cdk-bootstrap`). Until then, treat this key as an
    // administrator credential -- which is why the document in §16 marks it
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
    offDotenvCredentials.push({
      destination: "diveday-deployer -> ~/.aws/credentials",
      note: "The workstation-only CDK deployer profile. The post-deploy wizard writes it automatically; never copy it into a dotenv file, Vercel, or GitHub.",
      body: [
        "[diveday-deployer]",
        `aws_access_key_id = ${deployerKey.id}`,
        `aws_secret_access_key = ${deployerKey.secret}`,
        `region = ${this.region}`,
      ],
    });

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
    // beats an Allow, so these credentials can never read §16's secret and
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
    // The operational mailbox, not a personal inbox: every other alert path in
    // the product already terminated here (`ALERT_EMAIL` in
    // src/lib/platform-mail.ts, Sentry issue alerts, the cron monitor's missed
    // check-in), and the AWS cost alerts were the one that still landed
    // somewhere else. Kept as a context override so a fork or a second account
    // can point it elsewhere without editing the stack (OPS-4).
    const alertEmail = this.node.tryGetContext("alertEmail") || "alerts@dive.day";
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

    // No `budgetName` here, deliberately: a fixed one collides with itself on
    // the replacement `--context monthlyBudgetLimit=...` forces. See the
    // "Troubleshooting" note in docs/engineering/infrastructure-runbook.md
    // §6 for the mechanism; the resolved name is in the output below.
    const monthlyCostGuardrail = new budgets.CfnBudget(this, "MonthlyCostGuardrail", {
      budget: {
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

    new cdk.CfnOutput(this, "MonthlyCostGuardrailBudgetName", {
      value: monthlyCostGuardrail.ref,
      description:
        "AWS-assigned name of the monthly cost guardrail budget (Billing and Cost Management -> Budgets). No longer a fixed literal -- see the comment above.",
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
      // A permanent bounce or a recipient complaint must stop future sends to
      // that address automatically. App-level delivery records help staff
      // investigate, but SES's account-level suppression is the send-time
      // safeguard that protects the account's reputation across every
      // notification path.
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
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
    // configuration set above is attached to the identity -- so it is on every
    // send, whether or not the app names it. `grantSendEmail` only ever adds
    // the identity ARN (aws-cdk-lib/aws-ses `EmailIdentityBase.grant`), which
    // leaves the config set unauthorized and every send answering 403
    // `AccessDeniedException` on `configuration-set/diveday-transactional-email`
    // -- including sends to the mailbox simulator, which is how this was found.
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
    // It can create a new bundle and nothing else -- no GetObject, no
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
        "Destination bucket for scheduled logical export bundles. Versioned, private, RETAIN -- see docs/engineering/backup-and-restore-runbook.md.",
    });

    // No destination exists for this credential yet. `src/app/api/cron/backup-export/`
    // reads no AWS credential at all, the runtime feature seals its own per-shop
    // credentials, and `.env.example` has no entry for it -- the choice of runner
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
    // 20260804-aws-location-address-lookup, amended by ADR
    // 20260811-address-is-one-search-box. Amazon Location Service's geo-places
    // Suggest, called *server-side* from a Next.js server action, which is the
    // whole reason this is an IAM user rather than the browser API key a Google
    // Places widget would need: the credential never reaches a browser, so
    // there is nothing to referrer-restrict and nothing spendable sitting in
    // client JavaScript.
    //
    // Its own user, not the SES or SNS one: least privilege means a geocoding
    // key can never send mail, and a mail key can never spend the geocoding
    // budget.
    const placesLookupUser = new iam.User(this, "PlacesLookupUser", {
      userName: "diveday-places-lookup",
    });
    placesLookupUser.addToPolicy(
      new iam.PolicyStatement({
        // Suggest only. Not Autocomplete, not Geocode, not GetPlace, not
        // SearchText, and nothing from the maps or routes families - the app
        // calls exactly one operation, so that is exactly what this identity
        // can do.
        //
        // It was `geo-places:Autocomplete` until 2026-08-11. **A stack still
        // holding the old statement answers every keystroke with
        // AccessDeniedException** once the app switches operations, which the
        // card reports as the same "address lookup isn't available right now"
        // an outage does - so `cdk deploy` has to land with (or before) the app
        // release, not after it. Nothing else in the app calls Autocomplete, so
        // the reverse order is safe: this policy may be widened early.
        actions: ["geo-places:Suggest"],
        // The geo-places API is resource-less for this call shape (there is no
        // place-index resource to scope to in the standalone Places API), so
        // the action list above is the actual boundary.
        resources: ["*"],
      }),
    );

    const placesLookupKey = mintAccessKey("PlacesLookupUserAccessKey", placesLookupUser);
    // Named, not inherited. Every other AWS credential here takes `this.region`,
    // which is whatever region the human who ran `cdk deploy` had configured -
    // an accident, not a decision. That is harmless for SES, SNS and CloudWatch,
    // which are served everywhere. Amazon Location's Places API is not: the SDK
    // builds `geo-places.<region>.amazonaws.com` out of this string and there is
    // no ruleset check behind it, so a region that does not serve the API fails
    // in DNS on every keystroke - no HTTP status, no AWS exception name, nothing
    // to read but "address lookup isn't available right now". The address card
    // is the one feature whose whole surface a moved stack could silently take
    // out, so it says which region it calls.
    const PLACES_LOOKUP_REGION = "us-east-1";
    envValues.PLACES_AWS_REGION = PLACES_LOOKUP_REGION;
    envValues.PLACES_AWS_ACCESS_KEY_ID = placesLookupKey.id;
    envValues.PLACES_AWS_SECRET_ACCESS_KEY = placesLookupKey.secret;

    // 13. Observability: where the app's own log lines go, what is counted, and
    // what wakes somebody up. See ADR 20260806-cloudwatch-log-shipping and
    // docs/engineering/cloudwatch-observability-runbook.md.
    //
    // The gap this fills. DiveDay runs on Vercel, whose log view is a live tail
    // with about an hour of history and no query language. Sentry catches what
    // *throws*. Neither keeps what the app *decided*: a Stripe webhook refusing
    // a payment against a cancelled booking, a reminder that never sent, a prune
    // that failed one table. Those are `log()` lines on stdout, and until now
    // they were gone by the time anyone thought to look for them.
    //
    // Four resources, in the order a question gets answered: a group to keep the
    // lines, metric filters to count the ones worth counting, alarms to say so,
    // and a dashboard plus saved queries to look at afterwards.
    const appLogGroup = new logs.LogGroup(this, "AppLogs", {
      logGroupName: APP_LOG_GROUP_NAME,
      // A month: long enough to answer "what happened at last month-end", short
      // enough that the record of every payment decision is not an open-ended
      // liability. Same bounded posture as the SMS receipt groups in §10, and
      // the reason the group is declared here at all rather than left for the
      // shipper's first write to create - a group CloudWatch creates for you
      // never expires anything.
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const logShipperUser = new iam.User(this, "CloudWatchLogShipperUser", {
      userName: LOG_SHIPPER_USER_NAME,
    });
    logShipperUser.addToPolicy(
      new iam.PolicyStatement({
        // Append to streams in this one group, and nothing else. No
        // CreateLogGroup (which would let the app make an unexpiring group and
        // keep its own operational record forever), no Describe/Get/Filter
        // (this credential lives in a third party's environment and has no
        // business reading DiveDay's logs back), no Delete anything.
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${appLogGroup.logGroupArn}:*`],
      }),
    );

    const logShipperKey = mintAccessKey("CloudWatchLogShipperAccessKey", logShipperUser);
    envValues.CLOUDWATCH_AWS_REGION = this.region;
    envValues.CLOUDWATCH_AWS_ACCESS_KEY_ID = logShipperKey.id;
    envValues.CLOUDWATCH_AWS_SECRET_ACCESS_KEY = logShipperKey.secret;
    // The literal, not `appLogGroup.logGroupName`: the latter synthesizes a
    // `Ref` token, and this value is read by a human out of the credentials
    // document as often as it is pasted into Vercel.
    envValues.CLOUDWATCH_LOG_GROUP = APP_LOG_GROUP_NAME;

    // Alarms land in the same mailbox as every other operational alert (§7's
    // cost guardrails, the in-app new-account and demo alerts, Sentry's issue
    // alerts). One inbox to watch is the whole point; a second alert channel
    // nobody reads is worse than no alarm.
    //
    // An SNS email subscription needs a confirmation click that no API can
    // perform, which is why this is one of the few things here that turns into
    // a manual action (§17, `confirm-observability-alarms`).
    const observabilityAlarms = new sns.Topic(this, "ObservabilityAlarms", {
      topicName: "diveday-observability-alarms",
      displayName: "DiveDay alarms",
    });
    observabilityAlarms.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    const alarmAction = new cloudwatchActions.SnsAction(observabilityAlarms);

    // One registry row becomes a filter, an alarm, and a dashboard series. See
    // infra/lib/observability.ts for why the set is deliberately small.
    const signalMetrics = LOG_SIGNALS.map((signal) => {
      const filter = new logs.MetricFilter(this, `${signal.metricName}Filter`, {
        logGroup: appLogGroup,
        metricNamespace: METRIC_NAMESPACE,
        metricName: signal.metricName,
        filterPattern: logs.FilterPattern.literal(filterPatternFor(signal)),
        metricValue: "1",
        // Publish a 0 for a period the app logged in but this signal did not
        // match. Without it a metric filter emits nothing at all when things are
        // fine, so every graph is gappy and every alarm sits at
        // INSUFFICIENT_DATA - which reads identically to "the alarm is broken".
        defaultValue: 0,
      });
      // No `label` here, deliberately: a labelled metric forces CloudFormation
      // to render the alarm as a metric-math query rather than the flat
      // MetricName/Period form, which is harder to read in the console and in a
      // template diff. The dashboard adds the label where it is actually shown.
      const metric = filter.metric({
        statistic: "Sum",
        period: cdk.Duration.minutes(signal.periodMinutes),
      });
      const alarm = new cloudwatch.Alarm(this, `${signal.metricName}Alarm`, {
        alarmName: alarmNameFor(signal),
        alarmDescription: alarmDescriptionFor(signal),
        metric,
        threshold: signal.threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // A quiet app is a healthy app. `defaultValue` above covers the periods
        // the app logged anything at all; a genuinely idle period has no
        // datapoint, and treating that as breaching would page on a slow Tuesday.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(alarmAction);
      return metric;
    });

    // Core Web Vitals, read out of the `web_vital.reported` line the browser
    // beacon writes (ADR 20260806-cloudwatch-rum-and-vitals). Same machinery as
    // the counts above with one difference that matters: `metricValue` names a
    // *field* rather than the literal 1, so the metric carries the measurement
    // and the statistic below scores it.
    const vitalMetrics = WEB_VITAL_SIGNALS.map((signal) => {
      const filter = new logs.MetricFilter(this, `${signal.metricName}Filter`, {
        logGroup: appLogGroup,
        metricNamespace: METRIC_NAMESPACE,
        metricName: signal.metricName,
        filterPattern: logs.FilterPattern.literal(webVitalFilterPatternFor(signal)),
        metricValue: `$.${signal.field}`,
        // No `defaultValue` here, unlike the counts: a page view that reported
        // no INP did not score zero on it, and publishing a 0 would drag the
        // percentile down until the metric flattered the app.
      });
      // p75, not average: Core Web Vitals are scored at the 75th percentile
      // because a mean lets a fast majority hide a slow quarter, and the slow
      // quarter is the people giving up on a booking form.
      const metric = filter.metric({
        statistic: "p75",
        period: cdk.Duration.hours(1),
      });
      if (signal.alarm) {
        new cloudwatch.Alarm(this, `${signal.metricName}Alarm`, {
          alarmName: webVitalAlarmNameFor(signal),
          alarmDescription: `${signal.title} is past Google's "good" boundary. ${signal.response}`,
          metric,
          threshold: signal.goodThreshold,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          // Three hours, not one. A single slow hour on a young product is one
          // visitor on hotel wifi; a sustained regression is a deploy.
          evaluationPeriods: 3,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }).addAlarmAction(alarmAction);
      }
      return metric.with({ label: signal.title });
    });

    // Amazon CloudWatch RUM: the session, geography, and device context the
    // metrics above cannot answer. The browser reaches it through a Cognito
    // identity pool, because `PutRumEvents` has to be callable by a visitor who
    // has not identified themselves and never will.
    const rumAppMonitorName = "diveday";
    const rumIdentityPool = new cognito.CfnIdentityPool(this, "RumIdentityPool", {
      identityPoolName: "diveday_rum",
      // The whole point: an anonymous visitor exchanges nothing for a
      // short-lived credential scoped to the one action below.
      allowUnauthenticatedIdentities: true,
    });

    const rumGuestRole = new iam.Role(this, "RumGuestRole", {
      roleName: "diveday-rum-guest",
      description: "Lets an anonymous browser session write RUM events, and nothing else.",
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          // Both conditions are load-bearing. The `aud` binds the role to *this*
          // identity pool, so a role ARN that leaks (and it does leak — it ships
          // in the browser bundle) cannot be assumed through somebody else's
          // pool. The `amr` binds it to the unauthenticated flow, so it can
          // never be handed out as if it were an authenticated identity's role.
          StringEquals: { "cognito-identity.amazonaws.com:aud": rumIdentityPool.ref },
          "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "unauthenticated" },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });
    rumGuestRole.addToPolicy(
      new iam.PolicyStatement({
        // One action, one app monitor. This credential is public by
        // construction — anyone can open the site and mint one — so the only
        // meaningful bound is how little it can do. The worst an abuser
        // achieves is writing junk page views into this monitor's own data.
        actions: ["rum:PutRumEvents"],
        resources: [`arn:aws:rum:${this.region}:${this.account}:appmonitor/${rumAppMonitorName}`],
      }),
    );

    new cognito.CfnIdentityPoolRoleAttachment(this, "RumIdentityPoolRoles", {
      identityPoolId: rumIdentityPool.ref,
      roles: { unauthenticated: rumGuestRole.roleArn },
    });

    const rumAppMonitor = new rum.CfnAppMonitor(this, "RumAppMonitor", {
      name: rumAppMonitorName,
      // RUM refuses events whose Origin header is not listed. It is the only
      // server-side control on who may write here, so it is set to the app's
      // canonical host rather than left open.
      domain: new URL(webhookHost).hostname,
      // Off: RUM would otherwise create its own log group with no retention
      // policy, duplicating what §13's group already keeps under a bounded one.
      cwLogEnabled: false,
      appMonitorConfiguration: {
        identityPoolId: rumIdentityPool.ref,
        guestRoleArn: rumGuestRole.roleArn,
        allowCookies: false,
        enableXRay: false,
        sessionSampleRate: 1,
        // Performance only. Errors are Sentry's, and RUM's `http` telemetry
        // records request URLs — which in this app include bearer-capability
        // paths (docs/engineering/capability-telemetry-runbook.md).
        telemetries: ["performance"],
      },
    });

    // Public by necessity: the browser is the only consumer, and none of the
    // four is a secret — the identity pool hands the same credential to anyone
    // who loads the page, and it can do exactly one thing.
    envValues.NEXT_PUBLIC_RUM_APP_MONITOR_ID = rumAppMonitor.attrId;
    envValues.NEXT_PUBLIC_RUM_IDENTITY_POOL_ID = rumIdentityPool.ref;
    envValues.NEXT_PUBLIC_RUM_GUEST_ROLE_ARN = rumGuestRole.roleArn;
    envValues.NEXT_PUBLIC_RUM_REGION = this.region;

    // The one page to open when someone asks how the app is doing. Counts along
    // the top, trends underneath, and the raw lines at the bottom so a spike is
    // one scroll from the events that caused it rather than a separate console.
    const observabilityDashboard = new cloudwatch.Dashboard(this, "ObservabilityDashboard", {
      dashboardName: "DiveDay",
      defaultInterval: cdk.Duration.days(7),
    });
    observabilityDashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: "Last 7 days",
        metrics: signalMetrics.map((metric, index) =>
          metric.with({ label: LOG_SIGNALS[index]?.title }),
        ),
        width: 24,
        height: 4,
      }),
    );
    // Two graphs per row, in registry order, so adding a signal extends the page
    // rather than requiring a layout decision.
    for (let index = 0; index < signalMetrics.length; index += 2) {
      observabilityDashboard.addWidgets(
        ...signalMetrics.slice(index, index + 2).map(
          (metric, offset) =>
            new cloudwatch.GraphWidget({
              title: LOG_SIGNALS[index + offset]?.title,
              left: [metric],
              width: 12,
              height: 6,
            }),
        ),
      );
    }
    observabilityDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Core Web Vitals (p75) — timings",
        left: vitalMetrics.filter((_metric, index) => WEB_VITAL_SIGNALS[index]?.field !== "cls"),
        // Google's LCP boundary, drawn on the graph so a reader does not have to
        // remember it to know whether the line is where it should be.
        leftAnnotations: [{ value: 2_500, label: "LCP good ≤ 2.5s" }],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "Cumulative Layout Shift (p75)",
        // Its own widget: CLS is a unitless fraction under 1 and would be a flat
        // line against milliseconds in the thousands.
        left: vitalMetrics.filter((_metric, index) => WEB_VITAL_SIGNALS[index]?.field === "cls"),
        leftAnnotations: [{ value: 0.1, label: "good ≤ 0.1" }],
        width: 12,
        height: 6,
      }),
    );
    observabilityDashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: "Slowest routes by LCP (p75)",
        logGroupNames: [APP_LOG_GROUP_NAME],
        queryLines: [
          "fields route, lcp",
          'filter event = "web_vital.reported" and ispresent(lcp)',
          "stats pct(lcp, 75) as lcpP75, count(*) as views by route",
          "sort lcpP75 desc",
          "limit 20",
        ],
        width: 24,
        height: 9,
      }),
      new cloudwatch.LogQueryWidget({
        title: "Handled errors, newest first",
        logGroupNames: [APP_LOG_GROUP_NAME],
        queryLines: [
          "fields @timestamp, event, @message",
          'filter level = "error"',
          "sort @timestamp desc",
          "limit 50",
        ],
        width: 24,
        height: 9,
      }),
      new cloudwatch.LogQueryWidget({
        title: "Event volume by code",
        logGroupNames: [APP_LOG_GROUP_NAME],
        queryLines: ["fields event", "stats count(*) as lines by event, level", "sort lines desc"],
        width: 24,
        height: 9,
      }),
    );

    // Saved Logs Insights queries: the free half of this, and where every event
    // code that did not earn a metric stays answerable. A query definition costs
    // nothing and is the difference between an operator picking a question off a
    // list at 6am and writing query syntax against a schema from memory.
    for (const query of SAVED_LOG_QUERIES) {
      new logs.CfnQueryDefinition(this, `LogQuery${queryConstructIdFor(query)}`, {
        name: query.name,
        queryString: query.queryString,
        logGroupNames: [APP_LOG_GROUP_NAME],
      });
    }

    new cdk.CfnOutput(this, "AppLogGroupName", {
      value: APP_LOG_GROUP_NAME,
      description:
        "CloudWatch Logs group the app ships its structured lines to. Set as CLOUDWATCH_LOG_GROUP; retention is one month.",
    });

    new cdk.CfnOutput(this, "ObservabilityAlarmTopicArn", {
      value: observabilityAlarms.topicArn,
      description: `SNS topic carrying the log-signal alarms. ${alertEmail} is subscribed by this stack and must confirm the subscription email once.`,
    });

    new cdk.CfnOutput(this, "ObservabilityDashboardUrl", {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/${observabilityDashboard.dashboardName}`,
      description: "The CloudWatch dashboard built from infra/lib/observability.ts.",
    });

    new cdk.CfnOutput(this, "RumAppMonitorName", {
      value: rumAppMonitorName,
      description: `CloudWatch RUM app monitor (console: RUM -> ${rumAppMonitorName}). Its four NEXT_PUBLIC_RUM_* values are in the credentials document; all are public by design.`,
    });

    // 14. Retire the access keys this stack did not create.
    //
    // Before this stack minted keys, seven of its eight users had theirs made by
    // hand with `aws iam create-access-key`. CloudFormation neither knows about
    // those nor deletes them, so the deploy that adds a managed key leaves each
    // such user holding two -- **IAM's ceiling is two per user, hard and not
    // adjustable.** Rotation replaces a key create-then-delete, so the next
    // `CredentialSerial` bump would call `CreateAccessKey` against a full user
    // and fail with `LimitExceeded`, on the day someone is rotating *because*
    // something leaked. Nothing surfaces it in the meantime: the deploy that
    // creates the second key succeeds.
    //
    // This was a numbered manual step for one draft, and a manual step is the
    // wrong shape for it -- the whole hazard is that nobody knows it is armed.
    // Making revocation something the system does is also what makes "revoke and
    // re-create" a usable answer to any future exposure, rather than a procedure
    // whose first attempt fails.
    //
    // **Two safety properties, and they are the reason this is safe to automate:**
    //
    //  1. It never touches a user with fewer than two keys, so it can never
    //     leave an identity with none. Nothing to do is the common case.
    //  2. It keeps the *newest* key and deletes the rest. CloudFormation created
    //     its key seconds earlier and the dependency below guarantees that
    //     ordering, so the newest is always the managed one.
    //
    // Deliberately NOT re-run on rotation. Its properties name the users, not
    // the key ids, so bumping `CredentialSerial` does not re-invoke it. If it
    // did, it would delete the outgoing key during the same update in which
    // CloudFormation is already deleting it -- a race with the stack's own
    // cleanup, for no gain: after this has run once, every user holds exactly
    // one key and rotation has the room it needs natively.
    const accessKeyPruner = new lambda.Function(this, "AccessKeyPruner", {
      functionName: "diveday-access-key-pruner",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(2),
      logGroup: new logs.LogGroup(this, "AccessKeyPrunerLogs", {
        logGroupName: "/aws/lambda/diveday-access-key-pruner",
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      code: lambda.Code.fromInline(`
const { IAMClient, ListAccessKeysCommand, DeleteAccessKeyCommand } = require("@aws-sdk/client-iam");
const iam = new IAMClient({});

exports.handler = async (event) => {
  // Nothing to do on delete: the stack's own keys go with the stack, and a key
  // this function already removed is not ours to restore.
  if (event.RequestType === "Delete") return {};

  const retired = [];
  for (const userName of event.ResourceProperties.UserNames) {
    const { AccessKeyMetadata = [] } = await iam.send(new ListAccessKeysCommand({ UserName: userName }));
    // One key is the steady state. Never act on it - deleting the only
    // credential an identity has is the one outcome worse than the surplus.
    if (AccessKeyMetadata.length < 2) continue;
    const [newest, ...stale] = [...AccessKeyMetadata].sort(
      (a, b) => new Date(b.CreateDate).getTime() - new Date(a.CreateDate).getTime(),
    );
    console.log("keeping " + userName + "/" + newest.AccessKeyId);
    for (const key of stale) {
      await iam.send(new DeleteAccessKeyCommand({ UserName: userName, AccessKeyId: key.AccessKeyId }));
      console.log("retired " + userName + "/" + key.AccessKeyId);
      retired.push(userName + "/" + key.AccessKeyId);
    }
  }
  return { Data: { Retired: retired.join(" ") || "none" } };
};
`),
    });

    accessKeyPruner.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "RetireSurplusAccessKeys",
        actions: ["iam:ListAccessKeys", "iam:DeleteAccessKey"],
        // Only the eight identities this stack owns. It cannot reach a key on
        // any other user in the account, including a human's.
        resources: keyedUsers.map((keyedUser) => keyedUser.userArn),
      }),
    );

    const retireStrayAccessKeys = new cdk.CustomResource(this, "RetireStrayAccessKeys", {
      serviceToken: new cr.Provider(this, "AccessKeyPrunerProvider", {
        onEventHandler: accessKeyPruner,
      }).serviceToken,
      properties: {
        // The user list, and only the user list. See the note above on why the
        // serial is deliberately absent.
        UserNames: keyedUsers.map((keyedUser) => keyedUser.userName),
      },
    });

    // Must run after every key exists, or "keep the newest" would keep a
    // hand-minted one and delete the managed key that had not been created yet.
    for (const mintedKey of mintedKeys) retireStrayAccessKeys.node.addDependency(mintedKey);

    new cdk.CfnOutput(this, "RetiredAccessKeys", {
      value: retireStrayAccessKeys.getAttString("Retired"),
      description:
        "Access keys this deploy revoked because the identity held more than one -- the hand-minted keys that predate CloudFormation-managed ones. 'none' is the steady state.",
    });

    // 15. Stable root material for the app's three independent secrets.
    //
    // Secrets Manager can generate one random value in a CloudFormation
    // resource, not three. Keep one 64-character alphanumeric root in a
    // separate secret and derive the three 32-byte environment values with
    // HKDF in scripts/distribute-env.mjs. The derivation labels make the auth,
    // credential-sealing, and cron values independent while keeping creation
    // idempotent: a redeploy cannot silently invalidate Auth.js sessions,
    // stored WhatsApp credentials, or Vercel Cron authentication.
    //
    // The AWS-managed secrets-manager KMS key encrypts this at rest. A
    // customer-managed KMS key would add $1/month without improving the
    // single-account access boundary, so the explicit Deny for the inspection
    // identities remains the control that matters here.
    const appSecretSeed = new secretsmanager.Secret(this, "ApplicationSecretSeed", {
      secretName: APP_SECRET_SEED_NAME,
      description:
        "Stable root material from which scripts/distribute-env.mjs derives AUTH_SECRET, SECRET_ENCRYPTION_KEY, and CRON_SECRET. Never place this value in a deployed environment.",
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        requireEachIncludedType: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 16. The credentials secret: one Secrets Manager secret holding a filled-in
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
    // key would have survived untouched. That is the correct default -- a
    // credential this file no longer describes should stop working -- but it is a
    // sharp edge and it is why §16's checklist carries a rotation entry.
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
    // **Exactly one additional principal is granted read** -- GitHubActionsCdkDeployRole
    // (§18), scoped to this secret's own ARN and nothing else -- and it is worth
    // being exact about what that does and does not buy.
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
    // action, and named as one in §17.
    //
    // That reach is why the deployer's own key is the one credential in the
    // document marked workstation-only: it is the key that yields all the
    // others, so the fewer places it sits, the better.
    //
    // The account owner reads the secret with their administrator profile, or in
    // the console. It is also a hand-off point for CI: once a human has approved
    // the infra-deploy GitHub Environment (§18), `pnpm infra:deploy` reads this
    // same secret with the OIDC-assumed deploy role to run the post-deploy wizard
    // non-interactively (ADR 20260811-ci-deploy-full-wizard) -- a narrower reach
    // than the deployer's own already has, and one the resource-scoped Allow below
    // cannot widen past this one secret.
    envValues.SES_SNS_TOPIC_ARN = sesEventNotifications.topicArn;
    envValues.SMS_SNS_TOPIC_ARN = smsDeliveryReceipts.topicArn;
    // The generated seed is resolved by CloudFormation into this hand-off
    // document. It never appears in a stack output, and the distribution
    // helper consumes it locally before making target-specific dotenv files.
    envValues.APP_SECRET_SEED = appSecretSeed.secretValue.unsafeUnwrap();

    // Not assigned: nothing else in the stack references it. Read access is
    // granted to no principal (see above), and the output below names the secret
    // from the constant rather than from `Secret.secretName` -- which, without
    // the `parseOwnedSecretName` feature flag, renders as "split the ARN on '-'
    // and take the first piece" and is only correct while the name has no hyphen.
    const credentialsSecret = new secretsmanager.Secret(this, "CredentialsEnvDocument", {
      secretName: CREDENTIALS_SECRET_NAME,
      description:
        "Filled-in application .env.example plus named-profile credentials and the seed used locally to derive the three app secrets. pnpm infra:deploy automatically writes .env.local, .env.vercel, and .env.github; the deployer key stays only in its workstation profile block.",
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
      value: CREDENTIALS_SECRET_NAME,
      description:
        "Secrets Manager secret holding filled-in application env and named workstation profiles. Read access is granted to no principal other than GitHubActionsCdkDeployRole (§18, scoped to this secret's own ARN); everyone else uses an administrator profile.",
    });

    // 17. Only first-run account approvals that no CLI can truthfully perform.
    // The deploy wrapper handles workstation actions as an interactive wizard,
    // so those do not become an exhausting post-deploy checklist.
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
    const availableManualActions: readonly ManualAction[] = [
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
        why: "CDK deploys through four roles that a bootstrap stack provisions. §5's deployer holds sts:AssumeRole on exactly those four ARNs and nothing else, so without them it can deploy nothing. The wrapper opens aws login if needed, reads the signed-in profile's AWS account, asks you to confirm it, then sets the account-level S3 public-access configuration the visual-report bucket needs.",
        run: ["pnpm infra:bootstrap"],
        produces:
          "The cdk-<qualifier>-{deploy,file-publishing,image-publishing,lookup}-role roles.",
        verify: [
          "aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version",
          "aws s3control get-public-access-block --account-id <12-digit-account-id> --query PublicAccessBlockConfiguration",
        ],
        note: "The wrapper requires you to type the resolved account id; in a non-interactive terminal pass --confirm-account <12-digit-account-id>. It does not require a root-user credential: programmatic root credentials are a security regression. The account-level Block Public Access change permits public buckets but does not itself make any bucket public; an AWS Organizations policy can still prohibit it. If you bootstrap with --qualifier, infra-stack.ts §5 builds the four role ARNs from the @aws-cdk/core:bootstrapQualifier context value -- set it to match, or the deployer's AssumeRole silently matches nothing. --cloudformation-execution-policies defaults to empty, so pass scoped policies here to avoid an administrator-equivalent deployer credential.",
      },
      {
        id: "github-actions-cdk-oidc",
        title: "Authorize GitHub Actions to run cdk diff/deploy",
        category: "Credentials",
        when: "once, after the first deploy of this stack, and again if the deploy role's required reviewer needs to change",
        why: "The role ARNs and the required-reviewer approval gate both live on GitHub, not AWS -- this stack has no credential for GitHub's API. `pnpm infra:deploy`'s post-deploy wizard offers both as yes/no prompts right after a successful deploy (scripts/post-deploy-wizard.mjs), each a thin wrapper around the two commands below. Both need a gh-authenticated workstation, which is why this stays a wizard prompt rather than something CloudFormation could do -- GitHubActionsCdkDeployRole's trust policy (infra-stack.ts §18) only ever hands an OIDC token to a job that references the infra-deploy environment, so nothing runs until this has happened at least once.",
        run: [
          "node scripts/sync-github-cdk-ci-vars.mjs < <(printf 'AWS_CDK_DIFF_ROLE_ARN=%s\\nAWS_CDK_DEPLOY_ROLE_ARN=%s' <GitHubActionsCdkDiffRoleArn output> <GitHubActionsCdkDeployRoleArn output>)",
          "node scripts/sync-github-cdk-ci-environment.mjs",
        ],
        produces:
          ".github/workflows/infra.yml's diff job can assume a role on any pull request; its deploy job can only obtain one once a required reviewer approves a run against the infra-deploy environment.",
        store:
          "GitHub repo Settings -> Environments (infra-deploy) and Settings -> Secrets and variables -> Actions -> Variables (AWS_CDK_DIFF_ROLE_ARN, AWS_CDK_DEPLOY_ROLE_ARN) -- the CfnOutputs are GitHubActionsCdkDiffRoleArn and GitHubActionsCdkDeployRoleArn.",
        verify: [
          'Open a pull request that touches infra/ and confirm the "cdk synth + diff" check posts a PR comment.',
          'Actions -> Infra -> Run workflow, command: deploy -- confirm the run stops at "Review pending deployments" until approved.',
        ],
        note: "The role ARNs are stored as repository variables, not secrets: they are identifiers, not credentials, and a secret's value is redacted from logs, which would make a failed sts:AssumeRoleWithWebIdentity impossible to read. Re-running the environment prompt only ever adds the current gh user as a reviewer -- it never removes anyone else's approval right, so adding a second reviewer is a manual GitHub-side edit.",
      },
      {
        id: "ci-github-admin-token",
        title: "Mint a GitHub token for the CI deploy job's own gh CLI calls",
        category: "Credentials",
        when: "once, before the first CI-run post-deploy wizard, and again if the token expires or is revoked",
        why: "The default GITHUB_TOKEN a workflow run receives cannot manage repository secrets, variables, or environments -- those need the Administration/Secrets/Variables permissions, which are not among the ones the `permissions:` key in a workflow file can grant it. The wizard's GitHub steps (sync-github-secrets.mjs, sync-github-cdk-ci-vars.mjs, sync-github-cdk-ci-environment.mjs) run under the gh CLI, which needs a token that actually holds those scopes -- and minting one is an account-level action no CLI can perform on its own behalf.",
        run: [
          "GitHub -> Settings -> Developer settings -> Fine-grained tokens -> Generate new token, scoped to this repository only, with Secrets (read/write), Variables (read/write), and Environments (read/write) repository permissions -- not Actions, which none of the wizard's gh calls use.",
          "gh secret set INFRA_DEPLOY_GH_TOKEN",
        ],
        produces:
          ".github/workflows/infra.yml's deploy job can export it as GH_TOKEN so the gh CLI the post-deploy wizard shells out to is authenticated with admin-level repository access, matching what a workstation operator's own `gh auth login` already provides.",
        store:
          "GitHub repo Settings -> Secrets and variables -> Actions -> Secrets -> INFRA_DEPLOY_GH_TOKEN.",
        verify: [
          "Actions -> Infra -> Run workflow, command: deploy -- after approval, confirm the run's log shows the wizard's GitHub steps succeeding rather than gh reporting 403/Resource not accessible.",
        ],
        note: "This token is a materially broader credential than AWS_CDK_DIFF_ROLE_ARN/AWS_CDK_DEPLOY_ROLE_ARN (identifiers, not secrets) -- it can rewrite this repository's Actions secrets, variables, and environment protection rules. It is reachable only from the deploy job, which is itself gated by the infra-deploy environment's required-reviewer approval (ADR 20260811-ci-deploy-full-wizard).",
      },
      {
        id: "ci-vercel-deploy-token",
        title: "Mint a Vercel token and link the project for the CI deploy job",
        category: "Credentials",
        when: "once, before the first CI-run post-deploy wizard, and again if the token is revoked",
        why: "The wizard's Vercel steps (import-vercel-env.mjs, `vercel --prod`, the SES DNS records) shell out to the Vercel CLI, which needs both a token and to know which Vercel project/org it is acting on. A workstation operator supplies both by having run `vercel login` and `vercel link` once, interactively, out of band -- neither has an unattended CLI equivalent.",
        run: [
          "Vercel -> Account Settings -> Tokens -> Create, scoped to the team that owns the project.",
          "gh secret set INFRA_DEPLOY_VERCEL_TOKEN",
          "vercel link (once, on any workstation, against the same project) to read .vercel/project.json's orgId/projectId, then: gh variable set VERCEL_ORG_ID --body <orgId>; gh variable set VERCEL_PROJECT_ID --body <projectId>",
        ],
        produces:
          "The deploy job can export VERCEL_TOKEN/VERCEL_ORG_ID/VERCEL_PROJECT_ID so every `vercel` CLI call in the wizard runs unattended against the right project instead of prompting to link one.",
        store:
          "GitHub repo Settings -> Secrets and variables -> Actions -> Secrets (INFRA_DEPLOY_VERCEL_TOKEN) and -> Variables (VERCEL_ORG_ID, VERCEL_PROJECT_ID).",
        verify: [
          "Actions -> Infra -> Run workflow, command: deploy -- after approval, confirm the wizard's Vercel steps push/deploy rather than the CLI reporting 'no project linked'.",
        ],
        note: "A revoked or expired token fails the wizard's Vercel steps loudly (a nonzero `vercel` exit code fails the job) rather than silently skipping them, since scripts/infra-deploy.mjs propagates the wizard's own exit status.",
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
        id: "provider-spend-caps",
        title: "Set a spend cap or usage alert in the Vercel, Neon, and Sentry consoles",
        category: "Prerequisites",
        when: "once per provider account, and again after changing plan",
        why: "AWS Budgets (infra-stack.ts §7) can only see the AWS bill, which is the smallest one DiveDay pays. Vercel, Neon, and Sentry each bill on their own console with their own limits, and none of them exposes an API for setting one. The in-app monitor (src/app/api/cron/usage) polls usage and emails; it deliberately cannot stop spending, so the vendor-side cap is the only hard stop that exists.",
        run: [
          "Vercel -> Settings -> Billing -> Spend Management: set an amount and an email notification.",
          "Neon -> Organization -> Billing: set the plan's usage alert, and confirm whether exceeding it suspends compute or bills overage on your plan.",
          "Sentry -> Settings -> Subscription -> Usage: set a spend cap and per-category quota alerts.",
        ],
        produces:
          "A vendor-side notification that arrives even when the in-app monitor is not running, and, where the provider offers one, an actual ceiling.",
        note: "Neon is the one whose overflow can take DiveDay down rather than cost money: on the free plan an exhausted compute allowance suspends the endpoint. Record which behaviour your plan has in docs/engineering/cost-guardrails-runbook.md.",
      },
      {
        id: "credentials-to-vercel",
        title: "Put the app's AWS credentials into Vercel",
        category: "Credentials",
        when: "after the first deploy, and after rotating any of them",
        why: "Vercel runs the app; CDK runs the infrastructure. Neither deploy pipeline can write to the other, so a local CLI authenticated to both is the narrow hand-off point. The target file excludes workstation and CI credentials before Vercel sees it.",
        run: [
          "node scripts/import-vercel-env.mjs .env.vercel production",
          "pnpm exec vercel --prod",
        ],
        store:
          ".env.vercel (gitignored) is the full Vercel target file, generated from the completed .env.local. The importer supplies every nonblank entry to Vercel Production; it deliberately excludes APP_SECRET_SEED and every REG_SUIT_* value. The generic deployer credential is not a dotenv value at all.",
        note: "Never place the excluded generic AWS credentials in Vercel. They are the cdk-deployer key, which can assume the CDK bootstrap roles and is therefore administrator-equivalent on this account.",
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
        run: ["gh secret set --env-file .env.github"],
        store:
          ".env.github (gitignored) is the full GitHub Actions target file, imported as repository secrets. It contains REG_SUIT_S3_BUCKET_NAME, REG_SUIT_AWS_ACCESS_KEY_ID, REG_SUIT_AWS_SECRET_ACCESS_KEY, and REG_SUIT_GITHUB_CLIENT_ID.",
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
        id: "usage-guardrail-tokens",
        title: "Mint the Vercel and Neon usage read tokens",
        category: "Credentials",
        when: "once, before the usage monitor can measure anything, and again after rotating either",
        why: "Both are another vendor's account credentials -- this stack has no identity on either platform and no API that could mint one. Nothing else in DiveDay needs them, so they exist only for the daily usage poll.",
        run: [
          "Vercel -> Account Settings -> Tokens -> Create: scope it to the team that holds the billing account, read access only.",
          "Neon -> Organization -> API keys -> Create: an organization key, not a personal one, so the consumption endpoint can report every project.",
        ],
        produces:
          "The four values GET /api/cron/usage needs in order to report a number instead of not_configured.",
        store:
          "USAGE_VERCEL_TOKEN and USAGE_VERCEL_TEAM_ID (team_...), USAGE_NEON_API_KEY and USAGE_NEON_ORG_ID (org-...), in .env.manual for a local run and in Vercel Production for the deployment. .env.manual is the one configuration file a human edits; .env.local is generated over on every deploy. Each pair is all-or-nothing: a token with no id reads as not configured.",
        note: "Absent is a supported state and the monitor says so out loud -- the affected ceiling reports not_configured, which is deliberately never rendered as ok. The USAGE_ prefix is not cosmetic: VERCEL_ is the namespace Vercel injects its own system variables into.",
      },
      {
        id: "verify-usage-guardrails",
        title: "Confirm the usage monitor reports numbers and reaches a real inbox",
        category: "Verification",
        when: "after minting the tokens, and after changing OPS_ALERT_EMAIL",
        why: "Every failure mode of this monitor is silent by construction. A wrong token, a revoked scope, a renamed provider field, or an unreachable alert mailbox all leave a cron that runs green and reports nothing, which is indistinguishable from a month with no cost problem.",
        run: [
          "curl -s -H \"Authorization: Bearer $CRON_SECRET\" <webhookHost>/api/cron/usage | jq '.evaluations[] | {ceilingId, level, value}'",
          "Compare the vercel_spend and neon_* figures against the two consoles once, by eye.",
        ],
        verify: [
          "Every polled ceiling reports ok/warn/over with a number. A level of not_configured means the token pair is missing; unavailable means it is present and the read failed.",
        ],
        onFailure:
          "unavailable carries a reason code (unauthorized, forbidden, no_charge_rows, metric_absent, unrecognised_shape) -- read it from the response or from cron_usage.scan_complete in the log drain, then see docs/engineering/cost-guardrails-runbook.md. Do not treat a quiet monitor as a healthy one.",
      },
      {
        id: "confirm-stray-keys-retired",
        title: "Confirm the surplus access keys were revoked",
        category: "Verification",
        when: "after the first deploy, and after any deploy that adds an IAM identity",
        why: "The stack revokes them itself (infra-stack.ts §14), but this is the one automation whose failure is invisible until it matters. IAM allows two access keys per user, hard and not adjustable; the keys minted by hand before this stack existed are not CloudFormation's to delete. If any survive, the identity is at the ceiling and the NEXT rotation fails with LimitExceeded -- on the day someone is rotating because something leaked.",
        run: [
          "Read the RetiredAccessKeys stack output: the keys this deploy revoked, or 'none'.",
          'for u in reg-suit-bot cdk-deployer diveday-mcp-readonly-local diveday-mcp-readonly-cloud diveday-ses-sender diveday-sns-sms-sender diveday-backup-uploader diveday-places-lookup; do echo "== $u"; aws iam list-access-keys --user-name "$u" --query \'AccessKeyMetadata[].AccessKeyId\' --output text; done',
        ],
        verify: ["Every identity lists exactly one access key."],
        onFailure:
          "A user with two means the pruner did not run or could not reach it -- check the diveday-access-key-pruner log group. Deleting the older key by hand is safe and restores the invariant: aws iam delete-access-key --user-name <user> --access-key-id <older-id>",
        note: "It never touches a user holding fewer than two keys, so it cannot leave an identity with none, and it keeps the newest -- which is always the one CloudFormation just created.",
      },
      {
        id: "rotate-credentials",
        title: "Rotate every credential",
        category: "Credentials",
        when: "on suspected exposure, on operator change, or on a schedule you choose",
        why: "Rotation itself is a deploy -- CloudFormation replaces each key when Serial increases. What stays manual is re-placing the new values everywhere the old ones went, because those destinations are the four platforms above.",
        run: ["pnpm infra:deploy --parameters CredentialSerial=<previous + 1>"],
        store:
          "The same four destinations as the placement steps above: .env.local, Vercel's environment variables, GitHub Actions repository secrets, and the off-dotenv homes. All eight keys rotate together, so all four need re-doing.",
        verify: [
          "aws iam list-access-keys --user-name diveday-ses-sender -- one key, created just now.",
          'aws cloudformation describe-stacks --stack-name diveday-infra --query "Stacks[0].Parameters" -- CredentialSerial is the value you passed.',
        ],
        note: "The serial is a CloudFormation parameter rather than a --context value, so a later deploy that omits it keeps the deployed value instead of rotating everything back to 1 (cdk deploy defaults --previous-parameters to true). It may only ever increase. Nothing warns you that a stale copy of an old key is still in use somewhere.",
      },
      {
        id: "ses-dkim-dns",
        title: "Add the SES DKIM records",
        category: "DNS",
        when: "once per sending domain",
        why: "Authoritative DNS for dive.day is Vercel, not Route53 -- this stack has no hosted zone to write into. Adding one would mean replicating the live mail records and replacing Vercel's apex ALIAS with anycast A records Vercel owns and rotates.",
        run: [
          "For each name/value pair in SesDkimRecords: pnpm exec vercel dns add dive.day <name-without-.dive.day> CNAME <value>.",
        ],
        store:
          "Vercel DNS for dive.day. The CLI creates the three CNAME records on the SES identity subdomain.",
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
        run: [
          "pnpm exec vercel dns add dive.day mail.ses MX feedback-smtp.<region>.amazonses.com 10",
          "pnpm exec vercel dns add dive.day mail.ses TXT 'v=spf1 include:amazonses.com ~all'",
        ],
        store:
          "Vercel -> dive.day -> DNS, on the MAIL FROM subdomain. Exactly one MX record -- SES fails the setup outright if the subdomain has several.",
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
        why: "All three are account-level SMS state. The sandbox exit and any spend limit above $1 are Support cases; a US origination identity (10DLC or toll-free) is a vetted registration with the carriers. The SetSMSAttributes custom resource (infra-stack.ts §10) deliberately touches none of them -- it sets delivery-status logging and nothing else.",
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
          "aws s3 ls s3://diveday-backups/exports/ -- the existing bundles are still listed.",
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
          '"PendingConfirmation" means the endpoint answered non-2xx -- SES_SNS_TOPIC_ARN or SMS_SNS_TOPIC_ARN is missing from the running app. Set it, redeploy the app, then `aws sns unsubscribe --subscription-arn <pending>` and redeploy this stack to re-issue the handshake. Redeploying this stack alone will not fix it: CloudFormation still believes the subscription exists.',
      },
      {
        id: "confirm-observability-alarms",
        title: "Confirm the observability alarm subscription email",
        category: "AWS account",
        when: "once per alert address, and again if the address changes",
        why: "An SNS email subscription is not live until a human clicks the link AWS mails to that address. There is no API for it -- by design, since otherwise anyone could subscribe anyone. Until it is clicked every log-signal alarm (infra-stack.ts §13) transitions correctly and notifies nobody, which is the failure mode the alarms exist to prevent.",
        run: [
          "Open the 'AWS Notification - Subscription Confirmation' mail sent to the alert address and click Confirm subscription.",
          "aws sns list-subscriptions-by-topic --topic-arn <ObservabilityAlarmTopicArn>",
        ],
        verify: ['A real SubscriptionArn, not "PendingConfirmation".'],
        onFailure:
          "The confirmation link expires after three days. Re-issue it with `aws sns subscribe --topic-arn <ObservabilityAlarmTopicArn> --protocol email --notification-endpoint <address>`, which mails a fresh one without touching the stack.",
        note: "The alert address is alerts@dive.day unless the stack was deployed with --context alertEmail=...; the CostAlertEmail output names the resolved one.",
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
    this.manualActions = availableManualActions.filter(({ id }) =>
      new Set([
        "aws-cli-admin-profile",
        "cdk-bootstrap",
        "cost-explorer-enabled",
        // The three non-AWS cost guardrails (ADR
        // 20260806-provider-usage-guardrails). They belong in the short list
        // for the same reason the AWS ones do: no CLI in this repo can mint
        // another vendor's token or set another vendor's spend cap, and the
        // consequence of skipping them is invisible rather than loud.
        "provider-spend-caps",
        "usage-guardrail-tokens",
        "verify-usage-guardrails",
        // Minting a GitHub PAT or a Vercel token is the same class of
        // no-CLI-can-do-this step as usage-guardrail-tokens above -- the CI
        // deploy job's own gh/vercel CLI calls need one of each before the
        // post-deploy wizard can run unattended (ADR 20260811-ci-deploy-full-wizard).
        "ci-github-admin-token",
        "ci-vercel-deploy-token",
        "ses-production-access",
        "sns-sms-account-limits",
        // Clicking a link in an email is the whole step, and no CLI can do it
        // (ADR 20260806-cloudwatch-log-shipping). Skipping it leaves every
        // alarm silently notifying nobody.
        "confirm-observability-alarms",
      ]).has(id),
    );

    new cdk.CfnOutput(this, "PostDeployWizard", {
      value:
        "pnpm infra:deploy writes the env files and offers Vercel, GitHub, and SES DNS handoffs interactively. The short manual-actions.md has only account approvals a CLI cannot perform.",
      description: "Post-deploy handoff: run pnpm infra:deploy from a terminal.",
    });

    // 18. GitHub Actions CI: OIDC federation so .github/workflows/infra.yml can
    // run `cdk diff`/`pnpm infra:deploy` from a workflow instead of only a
    // workstation (§5's cdk-deployer is explicitly workstation-only -- see its
    // comment). The deploy job runs the full wrapper, post-deploy wizard
    // included, non-interactively (ADR 20260811-ci-deploy-full-wizard).
    //
    // Two roles, deliberately not one, because "can see what would change" and
    // "can make it happen" are different privileges with different attack
    // surfaces:
    //
    //   - GitHubActionsCdkDiffRole trusts any workflow run in this repo (its sub
    //     condition is a wildcard) and can only create, describe, and discard a
    //     CloudFormation change set -- never execute one. A PR from any branch
    //     can assume it.
    //   - GitHubActionsCdkDeployRole's sub condition names the infra-deploy
    //     GitHub Environment specifically, so GitHub only mints an OIDC token
    //     for it once a required reviewer has approved that job (manual action
    //     "github-actions-cdk-oidc", §17) -- the environment is what turns
    //     "workflow_dispatch was clicked" into "a human clicked Approve", not
    //     anything this role's trust policy alone could enforce.
    //
    // GitHubActionsCdkDiffRole can never read the credentials secret (§16): it
    // carries the same explicit, unscoped Deny as §6's read-only MCP identities,
    // so a change to what AWS::IAM::Role or the OIDC bootstrap roles can reach
    // can never make a `diff` run -- assumable by any branch in this repo --
    // capable of exfiltrating it.
    //
    // GitHubActionsCdkDeployRole is the one exception in this stack (ADR
    // 20260811-ci-deploy-full-wizard): once the required-reviewer approval above
    // has already happened, `pnpm infra:deploy` needs the same secret read a
    // workstation operator's administrator profile performs, to run the
    // post-deploy wizard non-interactively (write .env.local/.env.vercel/
    // .env.github, then answer yes to every wizard prompt). Its Allow is scoped
    // to exactly this secret's ARN -- not `Resource: "*"` -- and a Deny on every
    // *other* secret still applies beneath it, so this role gains nothing beyond
    // the one document it was already trusted, via the environment gate, to
    // finish a deploy with. `cdk deploy`'s actual resource writes run under the
    // bootstrap deploy-role's own permissions (AdministratorAccess by default --
    // see §5's note on --cloudformation-execution-policies), not this role's --
    // the policies here bound only what the *caller* can do directly.
    const githubActionsOidcProvider = new iam.OpenIdConnectProvider(
      this,
      "GitHubActionsOidcProvider",
      {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
      },
    );

    const githubActionsPrincipal = (subCondition: string) =>
      new iam.FederatedPrincipal(
        githubActionsOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
          StringLike: { "token.actions.githubusercontent.com:sub": subCondition },
        },
        "sts:AssumeRoleWithWebIdentity",
      );

    const cdkStackArn = `arn:${this.partition}:cloudformation:${this.region}:${this.account}:stack/diveday-infra/*`;
    const bootstrapVersionParameterArn = `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/${bootstrapQualifier}/version`;
    const denyReadingAnySecret = () =>
      new iam.PolicyStatement({
        sid: "NeverReadAnySecretValue",
        effect: iam.Effect.DENY,
        actions: ["secretsmanager:GetSecretValue"],
        resources: ["*"],
      });

    const cdkDiffRole = new iam.Role(this, "GitHubActionsCdkDiffRole", {
      roleName: "diveday-github-actions-cdk-diff",
      assumedBy: githubActionsPrincipal(`repo:${GITHUB_REPO}:*`),
      description:
        "Assumed by .github/workflows/infra.yml to run `cdk diff` against the deployed stack. Can create and discard a change set; never executes one.",
      maxSessionDuration: cdk.Duration.hours(1),
    });
    cdkDiffRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DiffAgainstDeployedStack",
        actions: [
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          "cloudformation:CreateChangeSet",
          "cloudformation:DescribeChangeSet",
          "cloudformation:DeleteChangeSet",
        ],
        resources: [cdkStackArn],
      }),
    );
    cdkDiffRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadBootstrapVersion",
        actions: ["ssm:GetParameter"],
        resources: [bootstrapVersionParameterArn],
      }),
    );
    cdkDiffRole.addToPolicy(denyReadingAnySecret());

    const cdkDeployRole = new iam.Role(this, "GitHubActionsCdkDeployRole", {
      roleName: "diveday-github-actions-cdk-deploy",
      assumedBy: githubActionsPrincipal(
        `repo:${GITHUB_REPO}:environment:${GITHUB_DEPLOY_ENVIRONMENT}`,
      ),
      description:
        "Assumed by .github/workflows/infra.yml's deploy job, gated on the infra-deploy GitHub Environment's required reviewer.",
      maxSessionDuration: cdk.Duration.hours(1),
    });
    // Same four ARNs §5's cdk-deployer user holds sts:AssumeRole on -- the
    // bootstrap roles are what actually carry deploy-time permissions under the
    // modern CDK synthesizer, so this identity needs nothing broader than they
    // do.
    cdkDeployRole.addToPolicy(
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
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DeployTheStack",
        actions: [
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          "cloudformation:CreateChangeSet",
          "cloudformation:DescribeChangeSet",
          "cloudformation:ExecuteChangeSet",
          "cloudformation:DeleteChangeSet",
        ],
        resources: [cdkStackArn],
      }),
    );
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadBootstrapVersion",
        actions: ["ssm:GetParameter"],
        resources: [bootstrapVersionParameterArn],
      }),
    );
    // The post-deploy wizard's Vercel-sync step (scripts/import-vercel-env.mjs)
    // diffs against a fingerprint checkpoint in Parameter Store, keyed by
    // environment (ADR 20260811-vercel-sync-checkpoint-in-ssm) -- not a
    // CDK-managed resource, so this is a name-pattern grant rather than a
    // reference to a construct. Read and write, scoped to that one path prefix
    // only: nothing else this role does touches Parameter Store.
    const vercelSyncParameterArn = `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter/diveday/env-sync/vercel/*`;
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadWriteVercelSyncCheckpoint",
        actions: ["ssm:GetParameter", "ssm:PutParameter"],
        resources: [vercelSyncParameterArn],
      }),
    );
    // The one exception to "neither CI role can read a secret" (ADR
    // 20260811-ci-deploy-full-wizard): scoped to this secret's own ARN, so it
    // widens nothing else. `denyReadingAnySecret()` below still applies to
    // every *other* secret in the account, including the app-secret seed this
    // stack also creates (§16) -- NotResource makes the Deny bind everywhere
    // except the one ARN just allowed, rather than nowhere at all.
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadCredentialsDocumentForPostDeployWizard",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [credentialsSecret.secretArn],
      }),
    );
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "NeverReadAnyOtherSecretValue",
        effect: iam.Effect.DENY,
        actions: ["secretsmanager:GetSecretValue"],
        notResources: [credentialsSecret.secretArn],
      }),
    );

    new cdk.CfnOutput(this, "GitHubActionsCdkDiffRoleArn", {
      value: cdkDiffRole.roleArn,
      description:
        "role-to-assume for .github/workflows/infra.yml's diff job. Store as the AWS_CDK_DIFF_ROLE_ARN repository variable (manual action, §17).",
    });
    new cdk.CfnOutput(this, "GitHubActionsCdkDeployRoleArn", {
      value: cdkDeployRole.roleArn,
      description:
        "role-to-assume for .github/workflows/infra.yml's deploy job. Store as the AWS_CDK_DEPLOY_ROLE_ARN repository variable (manual action, §17).",
    });
  }
}
