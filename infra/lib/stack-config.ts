import type { Construct } from "constructs";

/**
 * The handful of values two stacks have to agree on, resolved the same way in
 * both.
 *
 * `infra/bin/infra.ts` builds two stacks now (ADR 20260903-ses-lives-in-its-own
 * -region): `DiveDay` in whatever region the operator deploys to, and
 * `DiveDayEmail` pinned to {@link SES_REGION}. They are deliberately joined by
 * *nothing* at synth -- no cross-stack reference, no cross-region SSM shuttle --
 * because the main stack's half of SES is an IAM user whose policy needs the
 * identity and configuration-set ARNs, and CDK's `crossRegionReferences`
 * machinery would have parked those (and, worse, anything read back the other
 * way) in SSM parameters to get them across the border.
 *
 * The price of that is this file: every name either stack builds an ARN from is
 * a constant here, and every context knob is read through one helper, so the
 * two stacks cannot drift into naming different things.
 */

/**
 * Re-exported rather than defined here: the regions and stack names are also
 * read by `scripts/infra-bootstrap.mjs`, `scripts/infra-deploy.mjs` and
 * `scripts/post-deploy-wizard.mjs`, none of which compile TypeScript, so the
 * one definition lives in `config/aws-regions.mjs`. Read that file for why SES
 * is in us-east-2 and what moving it back involves.
 */
export {
  EMAIL_STACK_ID,
  EMAIL_STACK_NAME,
  MAIN_STACK_ID,
  MAIN_STACK_NAME,
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
 * The email stack's own alarm topic. A CloudWatch alarm may only notify an SNS
 * topic in its own region, and the two SES reputation alarms read `AWS/SES`
 * metrics, which are published in the sending region -- so the alarms live
 * beside the identity and cannot reach `diveday-observability-alarms` in the
 * main stack's region. One more subscription for a human to confirm (manual
 * action `confirm-observability-alarms`), and the alternative is two alarms
 * that fire into nothing.
 */
export const SES_ALARM_TOPIC_NAME = "diveday-ses-alarms";

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
