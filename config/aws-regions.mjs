/**
 * Which AWS region each half of this app is deployed into, and what the two
 * CloudFormation stacks are called.
 *
 * A `.mjs` registry rather than a TypeScript constant because both sides need
 * it and only one of them compiles: `infra/lib/stack-config.ts` re-exports it
 * for the CDK app, and `scripts/infra-bootstrap.mjs`, `scripts/infra-deploy.mjs`
 * and `scripts/post-deploy-wizard.mjs` import it directly. The same shape as
 * `config/env-registry.mjs`, and for the same reason: a region written down
 * twice is a region that will one day be two different regions, and the failure
 * that follows (a bootstrap in one region, a stack in another; a DNS record
 * naming a region no identity lives in) is silent until mail stops.
 */

/**
 * Where the app's mail is sent from, and the one line to change to move it.
 *
 * us-east-2 rather than the rest of the stack's us-east-1 because SES's
 * production-access sandbox is **per region** and AWS refused the us-east-1
 * request (docs/engineering/ses-email-runbook.md, "Production access: the
 * second request"). A refusal in one region carries no weight in another, and a
 * second request into the same region days after the first is the one shape
 * with a known answer.
 *
 * This is a temporary home -- the intent is to come back to us-east-1 once
 * there is some distance from that refusal. Setting this back to `us-east-1`
 * and deploying is most of the move: the email stack follows the constant,
 * CloudFormation deletes what it leaves behind, and the main stack's ARNs and
 * the app's `SES_AWS_REGION` follow with it. Two things do not follow, and both
 * are the reason the swap back is a decision rather than a chore -- the DNS
 * (DKIM CNAMEs and the MAIL FROM MX are region-specific, re-added by hand from
 * the new stack's outputs: manual actions `ses-dkim-dns` and `ses-mail-from-dns`),
 * and production access, which is its own sandbox and its own request in
 * whichever region is current.
 */
export const SES_REGION = "us-east-2";

/**
 * The default home of everything else, and the one `AWS_DEFAULT_REGION` falls
 * back to. Not read by the CDK app: the main stack is deliberately
 * environment-agnostic, so it deploys wherever the operator's profile points.
 * This is what the scripts assume when nothing says otherwise.
 */
export const DEFAULT_REGION = "us-east-1";

/** CDK construct id and CloudFormation stack name of the main stack. */
export const MAIN_STACK_ID = "DiveDay";
export const MAIN_STACK_NAME = "diveday-infra";

/** CDK construct id and CloudFormation stack name of the SES stack in {@link SES_REGION}. */
export const EMAIL_STACK_ID = "DiveDayEmail";
export const EMAIL_STACK_NAME = "diveday-email";

/** Every stack `cdk deploy` should target when the operator names none. */
export const STACK_IDS = [MAIN_STACK_ID, EMAIL_STACK_ID];
