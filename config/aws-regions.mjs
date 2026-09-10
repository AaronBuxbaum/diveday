/**
 * Which AWS region each part of this app is deployed into, and what the three
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
 *
 * Three stacks and not one because the boundaries below are AWS's, not ours:
 * SES's sandbox is per region, and Route 53 publishes its health-check metrics
 * in us-east-1 only. Each constant here is the whole of one decision, and
 * `docs/engineering/region-migration.md` is what a change to one of them costs.
 */

/**
 * Where everything that is not a health-check alarm lives: every bucket, every
 * Lambda, every log group, the credentials secret, the dashboard.
 *
 * us-east-2, and the same us-east-2 as {@link SES_REGION} on purpose. Mail had
 * to move (see below); the rest of the estate followed rather than staying
 * behind, because a two-region estate costs something every day -- a console
 * switched to the wrong region shows an empty list rather than an error, an
 * alarm cannot notify a topic across the border, and every ARN either stack
 * builds for the other has to be assembled from constants instead of read off a
 * construct. None of that buys anything once the identity has moved. One region
 * for everything is the shape with the fewest things to remember, and the
 * migration is a one-way door worth walking through while the estate is still
 * pre-pilot and its buckets hold seed data.
 *
 * Changing this line is the whole of the *code* half of a move and nowhere near
 * the whole of the move: S3 bucket names and IAM user names are global, so a
 * redeploy into a new region does not relocate them, it collides with the ones
 * already there. Read `docs/engineering/region-migration.md` before touching
 * it; the parts a deploy cannot do are all in there.
 *
 * Pinned rather than left to the operator's profile so that the region is a
 * reviewable line in the repository. It used to be whatever `AWS_REGION` a
 * shell happened to carry, which meant two people could deploy the same commit
 * into two different regions and CloudFormation would cheerfully build two
 * estates.
 */
export const PRIMARY_REGION = "us-east-2";

/**
 * Where the app's mail is sent from and received at, and the one line to change
 * to move it.
 *
 * The same region as {@link PRIMARY_REGION} today, and still its own constant
 * and its own stack. That is not leftover scaffolding -- mail is the one part
 * of this estate whose region is decided by AWS rather than by us. SES's
 * production-access sandbox is **per region**, AWS refused the us-east-1
 * request with its standard no-reason wording (docs/engineering/ses-email-runbook.md,
 * "Production access: the second request"), and a refusal in one region carries
 * no weight in another. That is why the identity is in us-east-2 at all, and it
 * is exactly why the next verdict should be a one-line change here rather than
 * a resurrection of the pull request that moved it the first time.
 *
 * Setting this to a third region and deploying is most of such a move: the
 * email stack follows the constant, CloudFormation deletes what it leaves
 * behind, and the main stack's ARNs and the app's `SES_AWS_REGION` follow with
 * it. Three things do not follow -- the DKIM CNAMEs and the MAIL FROM and
 * inbound MX records, which name the region and are re-added by hand; the
 * receipt rule set activation, which is a per-region switch; and production
 * access, which is its own sandbox and its own request wherever the identity
 * lands. `docs/engineering/region-migration.md` is the ordered version.
 */
export const SES_REGION = "us-east-2";

/**
 * Where the external uptime alarms live, and **it is not a choice**.
 *
 * Route 53 is a global service that publishes `AWS/Route53 HealthCheckStatus`
 * to CloudWatch in us-east-1 and nowhere else, so an alarm on that metric reads
 * an empty series from any other region. It would not fail the deploy: the
 * alarm builds, sits in INSUFFICIENT_DATA, and -- because the uptime alarms are
 * the one place in this estate that treats missing data as breaching -- pages
 * somebody every few minutes about an outage that is not happening.
 *
 * That is why S22 is a stack of its own (`infra/lib/global-stack.ts`) rather
 * than a section of the main one. It is the piece that does not follow
 * {@link PRIMARY_REGION}, and pinning it here is what lets that constant move
 * without anybody having to remember this.
 */
export const ROUTE53_METRICS_REGION = "us-east-1";

/** CDK construct id and CloudFormation stack name of the main stack. */
export const MAIN_STACK_ID = "DiveDay";
export const MAIN_STACK_NAME = "diveday-infra";

/** CDK construct id and CloudFormation stack name of the SES stack in {@link SES_REGION}. */
export const EMAIL_STACK_ID = "DiveDayEmail";
export const EMAIL_STACK_NAME = "diveday-email";

/**
 * CDK construct id and CloudFormation stack name of the uptime stack in
 * {@link ROUTE53_METRICS_REGION}.
 */
export const GLOBAL_STACK_ID = "DiveDayGlobal";
export const GLOBAL_STACK_NAME = "diveday-global";

/** Every stack `cdk deploy` should target when the operator names none. */
export const STACK_IDS = [MAIN_STACK_ID, EMAIL_STACK_ID, GLOBAL_STACK_ID];

/**
 * Every region a deploy touches, deduplicated -- what has to be bootstrapped,
 * and the reason `scripts/infra-bootstrap.mjs` does not just take one. Two
 * entries today and one on the day the estate is single-region again; the
 * scripts read the length rather than assuming it.
 */
export const DEPLOY_REGIONS = [...new Set([PRIMARY_REGION, SES_REGION, ROUTE53_METRICS_REGION])];
