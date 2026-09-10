import type { Construct } from "constructs";

/**
 * The handful of values the three stacks have to agree on, resolved the same
 * way in each.
 *
 * `infra/bin/infra.ts` builds three (ADR 20260910-one-region-in-us-east-2,
 * ADR 20260910-one-region-in-us-east-2): `DiveDay` pinned to
 * {@link PRIMARY_REGION}, `DiveDayEmail` to {@link SES_REGION}, and
 * `DiveDayGlobal` to {@link ROUTE53_METRICS_REGION}. They are deliberately joined by
 * *nothing* at synth -- no cross-stack reference, no cross-region SSM shuttle --
 * because the main stack's half of SES is an IAM user whose policy needs the
 * identity and configuration-set ARNs, and CDK's `crossRegionReferences`
 * machinery would have parked those (and, worse, anything read back the other
 * way) in SSM parameters to get them across the border.
 *
 * The price of that is this file: every name a stack builds an ARN from is a
 * constant here, and every context knob is read through one helper, so the
 * three cannot drift into naming different things.
 */

/**
 * Re-exported rather than defined here: the regions and stack names are also
 * read by `scripts/infra-bootstrap.mjs`, `scripts/infra-deploy.mjs` and
 * `scripts/post-deploy-wizard.mjs`, none of which compile TypeScript, so the
 * one definition lives in `config/aws-regions.mjs`. Read that file for why SES
 * is in us-east-2 and what moving it back involves.
 */
export {
  DEPLOY_REGIONS,
  EMAIL_STACK_ID,
  EMAIL_STACK_NAME,
  GLOBAL_STACK_ID,
  GLOBAL_STACK_NAME,
  MAIN_STACK_ID,
  MAIN_STACK_NAME,
  PRIMARY_REGION,
  ROUTE53_METRICS_REGION,
  SES_REGION,
} from "../../config/aws-regions.mjs";

/**
 * The configuration set every send is authorized against and every event is
 * published from. A literal shared by both stacks: the email stack creates it,
 * and the main stack's sender policy scopes to its ARN without being able to
 * see the construct.
 */
export const SES_CONFIGURATION_SET_NAME = "diveday-transactional-email";

/** The SES event topic the email stack creates and `/api/webhooks/ses` reads from. */
export const SES_EVENT_TOPIC_NAME = "diveday-ses-email-events";

/**
 * Where SES stores the mail divers send back, and the topic that announces each
 * object. Both are the email stack's (ADR 20260910-one-region-in-us-east-2): SES
 * receives only for an identity verified **in the receiving region**, so the
 * rule set has to sit beside the identity or it receives nothing at all. The
 * main stack still names them, because the sender credential reads the bucket
 * and the credentials document carries both values -- from these constants
 * rather than from the constructs, for the same reason the identity ARNs are.
 */
export const SES_INBOUND_TOPIC_NAME = "diveday-ses-inbound-mail";

/**
 * The one prefix SES writes received mail under, and the one the sender
 * credential may read. Shared because the two halves are in different stacks
 * and a disagreement fails closed but silently: mail arrives, the app's read
 * 403s, and the webhook answers 500 until somebody reads the log.
 */
export const SES_INBOUND_OBJECT_PREFIX = "mail/";
export const SES_INBOUND_RULE_SET_NAME = "diveday-inbound";

/**
 * How long a received message's raw object survives. The app copies what it
 * keeps into `inbound_messages` within seconds of the object landing, so this
 * window is a replay buffer, not the record.
 */
export const INBOUND_MAIL_RETENTION_DAYS = 30;

/** Resolve `--context inboundMailBucketName=`, identically in both stacks. */
export function inboundMailBucketNameFrom(scope: Construct): string {
  return scope.node.tryGetContext("inboundMailBucketName") || "diveday-inbound-mail";
}

/** Resolve `--context sesInboundDomain=`, identically in both stacks. */
export function sesInboundDomainFrom(scope: Construct): string {
  return scope.node.tryGetContext("sesInboundDomain") || `inbound.${sesEmailDomainFrom(scope)}`;
}

/**
 * The email stack's own alarm topic. A CloudWatch alarm may only notify an SNS
 * topic in its own region, and the two SES reputation alarms read `AWS/SES`
 * metrics, which are published in the sending region -- so the alarms live
 * beside the identity and cannot reach `diveday-observability-alarms` in the
 * main stack's region. One more subscription for a human to confirm (manual
 * action `confirm-observability-alarms`), and the alternative is two alarms
 * that fire into nothing.
 */
export const SES_ALARM_TOPIC_NAME = "diveday-ses-alarms";

/**
 * The uptime stack's own alarm topic, and the third one for the same reason
 * there is a second: a CloudWatch alarm may only notify an SNS topic in its own
 * region, the Route 53 health-check metric exists only in us-east-1, and the
 * main stack's topic is wherever `PRIMARY_REGION` points.
 */
export const UPTIME_ALARM_TOPIC_NAME = "diveday-uptime-alarms";

/** Resolve `--context sesEmailDomain=`, identically in both stacks. */
export function sesEmailDomainFrom(scope: Construct): string {
  return scope.node.tryGetContext("sesEmailDomain") || "ses.dive.day";
}

/**
 * The envelope sender (Return-Path) domain, derived from the identity rather
 * than written out flat: SES requires the MAIL FROM domain be a *child* of the
 * verified identity, and a sibling under the same parent is rejected. Settled
 * by experiment -- `mail.dive.day` against identity `ses.dive.day` answered 400
 * with "Provided MAIL-FROM domain <mail.dive.day> is not subdomain of the
 * domain of the identity <ses.dive.day>", which contradicts the developer
 * guide's "subdomain of the parent domain of a verified identity" and matches
 * the SetIdentityMailFromDomain API reference. Trust the API reference.
 */
export function sesMailFromDomainFrom(scope: Construct): string {
  return scope.node.tryGetContext("sesMailFromDomain") || `mail.${sesEmailDomainFrom(scope)}`;
}

/**
 * The operational mailbox every alert in the product terminates at. Kept as a
 * context override so a fork or a second account can point it elsewhere
 * without editing a stack (OPS-4).
 */
export function alertEmailFrom(scope: Construct): string {
  return scope.node.tryGetContext("alertEmail") || "alerts@dive.day";
}

/**
 * The app's own origin, used to subscribe its webhook routes to the SNS topics
 * either stack creates. Must be the canonical origin: `dive.day`
 * 308-redirects to `www.dive.day`, and a redirect is not a confirmation.
 */
export function webhookHostFrom(scope: Construct): string {
  return scope.node.tryGetContext("webhookHost") || "https://www.dive.day";
}
