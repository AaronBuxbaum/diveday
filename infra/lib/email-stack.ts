import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { SES_REPUTATION_SIGNALS, sesReputationAlarmNameFor } from "./observability";
import {
  alertEmailFrom,
  SES_ALARM_TOPIC_NAME,
  SES_CONFIGURATION_SET_NAME,
  SES_EVENT_TOPIC_NAME,
  sesEmailDomainFrom,
  sesMailFromDomainFrom,
  webhookHostFrom,
} from "./stack-config";

/**
 * Everything about the app's mail that CloudFormation can only create in the
 * region the mail is sent from: the verified identity, the configuration set
 * and its event destination, the SNS topic those events reach the app through,
 * and the two alarms on SES's own verdict about the account.
 *
 * It is its own stack for one reason, and the reason is not tidiness. SES's
 * production-access sandbox is **per region**, AWS refused the us-east-1
 * request, and a second region is the move the runbook has always named as the
 * answer to that (docs/engineering/ses-email-runbook.md, "Where to file it",
 * step 3). CloudFormation is regional, so "SES somewhere else, the other
 * fourteen sections where they are" is two stacks or it is nothing --
 * ADR 20260903-ses-lives-in-its-own-region.
 *
 * What is deliberately *not* here: the `diveday-ses-sender` IAM user and its
 * access key. IAM is global, the key belongs in the one credentials document
 * the main stack renders (S16), and keeping it there is what lets these two
 * stacks share no synth-time reference at all -- the sender's policy scopes to
 * ARNs built from the constants in `stack-config.ts`, not from these
 * constructs. A cross-region reference would have shuttled values through SSM
 * parameters to get them across the border, which is a poor place for anything
 * near a credential and a poor dependency to have between two stacks that
 * otherwise deploy in either order.
 */
export class EmailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const sesEmailDomain = sesEmailDomainFrom(this);
    const sesMailFromDomain = sesMailFromDomainFrom(this);
    const webhookHost = webhookHostFrom(this);
    const alertEmail = alertEmailFrom(this);

    // Bounce, complaint and delivery events, straight to the app. Subscribed
    // here rather than left as a runbook step (ADR
    // 20260803-webhook-subscriptions-in-cdk): an unsubscribed topic is the
    // failure nothing detects, because every hop either side of it looks
    // perfectly healthy while no event ever arrives.
    const sesEventNotifications = new sns.Topic(this, "SesEmailEventNotifications", {
      topicName: SES_EVENT_TOPIC_NAME,
    });
    sesEventNotifications.addSubscription(
      new subscriptions.UrlSubscription(`${webhookHost}/api/webhooks/ses`),
    );

    const sesConfigurationSet = new ses.ConfigurationSet(this, "SesConfigurationSet", {
      configurationSetName: SES_CONFIGURATION_SET_NAME,
      // A permanent bounce or a recipient complaint must stop future sends to
      // that address automatically. App-level delivery records help staff
      // investigate, but SES's account-level suppression is the send-time
      // safeguard that protects the account's reputation across every
      // notification path.
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
      // Per-configuration-set bounce and complaint rates in CloudWatch beside
      // the account-level ones the alarms below read: when the account rate
      // moves, this is what says whether it was DiveDay's mail or something
      // else the account sends.
      reputationMetrics: true,
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
      // Without a custom MAIL FROM, SES uses a shared `amazonses.com`
      // subdomain as the envelope sender. Mail still authenticates (DKIM signs
      // as the identity domain), but SPF then aligns to Amazon's domain rather
      // than ours, so DMARC passes on DKIM alone. Owning the envelope domain
      // gets both halves aligned, which is what makes a booking confirmation
      // survive a strict receiver.
      mailFromDomain: sesMailFromDomain,
      // Degrade rather than refuse. REJECT_MESSAGE would turn a missing or
      // slow-propagating MX record into a hard failure on every send - the
      // envelope domain is a deliverability improvement, not a precondition for
      // a diver getting their booking confirmation. Falling back to the
      // amazonses.com envelope is exactly the behaviour we have today.
      mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE,
      // Bounce and complaint notifications arrive through the configuration
      // set's SNS destination above and land on the notification row and the
      // shop's dashboard. SES's default is to *also* forward each one as an
      // email to the sender address, which is noreply@ses.dive.day: a mailbox
      // nobody reads, on a subdomain that receives no mail. Off, so the one
      // record of a bounce is the one the app keeps.
      feedbackForwarding: false,
    });

    // SES's own verdict on the account, alarmed before AWS acts on it. These
    // read `AWS/SES` account-level metrics, which are published in the sending
    // region -- so both the alarms and the topic they notify have to be here,
    // rather than beside the log-signal alarms in the main stack's S13. A
    // CloudWatch alarm cannot notify an SNS topic in another region.
    const sesAlarms = new sns.Topic(this, "SesAlarms", {
      topicName: SES_ALARM_TOPIC_NAME,
      displayName: "DiveDay email alarms",
    });
    sesAlarms.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    const alarmAction = new cloudwatchActions.SnsAction(sesAlarms);

    for (const signal of SES_REPUTATION_SIGNALS) {
      new cloudwatch.Alarm(this, `${signal.constructId}Alarm`, {
        alarmName: sesReputationAlarmNameFor(signal),
        alarmDescription: `${signal.title}. ${signal.response}`,
        metric: new cloudwatch.Metric({
          namespace: "AWS/SES",
          metricName: signal.metricName,
          statistic: "Average",
          period: cdk.Duration.hours(1),
        }),
        threshold: signal.threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // No mail this hour means no rate, not a clean bill; and the sandbox
        // publishes nothing at all.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);
    }

    new cdk.CfnOutput(this, "SesDkimRecords", {
      value: cdk.Stack.of(this).toJsonString(sesEmailIdentity.dkimRecords),
      description: `DNS CNAME records to add for ${sesEmailDomain} to complete DKIM verification (three name/value pairs). Region-specific: SES mints different DKIM tokens per region, so moving this stack means re-adding these.`,
    });

    // Authoritative DNS for dive.day is Vercel, not Route53, so these two
    // records are added by hand rather than by this stack - there is no hosted
    // zone here to write them into. Exactly one MX record is required: SES fails
    // the MAIL FROM setup outright if the subdomain has more than one.
    new cdk.CfnOutput(this, "SesMailFromRecords", {
      value: `MX ${sesMailFromDomain} -> 10 feedback-smtp.${this.region}.amazonses.com | TXT ${sesMailFromDomain} -> "v=spf1 include:amazonses.com ~all"`,
      description: `DNS records to add for the custom MAIL FROM domain ${sesMailFromDomain}, in Vercel DNS. Exactly one MX record - SES rejects the setup if there are several, so replacing the old region's MX is a delete-then-add, never an add.`,
    });

    new cdk.CfnOutput(this, "SesEventNotificationsTopicArn", {
      value: sesEventNotifications.topicArn,
      description: `SNS topic for SES bounce/complaint/delivery events. ${webhookHost}/api/webhooks/ses is subscribed by this stack. The app reads it as SES_SNS_TOPIC_ARN, which the main stack already fills in from the same name -- this output is for confirming the subscription, not for pasting anywhere.`,
    });

    new cdk.CfnOutput(this, "SesAlarmTopicArn", {
      value: sesAlarms.topicArn,
      description: `SNS topic the two SES reputation alarms notify. Its email subscription to ${alertEmail} needs the same one-time confirmation click as the main stack's alarm topic (manual action confirm-observability-alarms).`,
    });

    new cdk.CfnOutput(this, "SesRegion", {
      value: this.region,
      description:
        "The region this stack's SES identity, configuration set and sandbox status live in. The app's SES_AWS_REGION is filled in from the same constant (infra/lib/stack-config.ts).",
    });
  }
}
