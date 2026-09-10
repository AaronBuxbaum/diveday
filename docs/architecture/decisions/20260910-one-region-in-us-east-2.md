# 20260910-one-region-in-us-east-2 — The whole estate moves to us-east-2, and the two things that cannot follow get stacks of their own

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

AWS refused DiveDay's SES production-access request in us-east-1 with its standard no-reason "this decision is final" wording.
[20260902-sender-standards-for-ses](20260902-sender-standards-for-ses.md) closed the four gaps a reviewer's checklist reads for, and [docs/engineering/ses-email-runbook.md](../../engineering/ses-email-runbook.md) carries a case text written to be ticked row by row.
What none of that can do is make the next reviewer a different person in the same queue, days after the last one, holding the closed case.

The SES sandbox is **per region**.
A refusal in one carries no weight in another, and the runbook has always named a second region as the third thing to try.
So the identity moves to us-east-2 and the request is filed there.

The first version of this change moved SES alone and left the other fifteen sections in us-east-1, on the reasoning that nothing else needed to move and the identity would come back once there was distance from the refusal.
Two things made that the wrong shape.

The first is that a two-region estate costs something every day, and the cost is all of the invisible kind.
A console switched to the wrong region shows an empty list rather than an error.
A CloudWatch alarm cannot notify an SNS topic across the border, so the SES reputation alarms needed a second topic and a second confirmation click.
Every ARN one stack builds for the other has to be assembled from shared constants rather than read off a construct.
And — found while rebasing the original change onto a `main` that had gained two-way inbox in the meantime — **SES receives mail only for an identity verified in the receiving region**, so a receipt rule set left behind in us-east-1 would have deployed cleanly and received nothing, with no error anywhere, while every diver's reply bounced at their own mail server.

The second is that the reason to stay was proximity to data, and there is no data.
DiveDay is pre-pilot (H-49).
The buckets hold seed rows, visual-regression baselines and demo photos.
Nothing in us-east-1 is worth a migration plan, which means the usual argument against moving an estate — the copy, the cutover, the URLs already written down — does not apply here and will never be this cheap again.

Two things genuinely cannot follow, and both are AWS's boundary rather than ours.
Route 53 is a global service that publishes `AWS/Route53 HealthCheckStatus` to CloudWatch in us-east-1 and nowhere else.
And SES's sandbox verdict is per region, which is what put mail in a separate stack in the first place and is the reason to keep it there.

## Decision

- **`config/aws-regions.mjs` is the one place a region or a stack name is written down.**
  `PRIMARY_REGION` and `SES_REGION` are both `us-east-2`; `ROUTE53_METRICS_REGION` is `us-east-1` and is not a choice.
  `DEPLOY_REGIONS` is those three deduplicated, and the bootstrap script, the deploy script and the main stack's IAM grants all read it rather than counting regions themselves.
  `infra/lib/stack-config.ts` re-exports the lot for the CDK app; the scripts import it directly.
- **Every stack names its own region and none names its account.**
  `infra/bin/infra.ts` pins `DiveDay` to `PRIMARY_REGION`, `DiveDayEmail` to `SES_REGION` and `DiveDayGlobal` to `ROUTE53_METRICS_REGION`.
  The main stack used to be environment-agnostic, which meant its region was whatever `AWS_REGION` the deploying shell happened to carry — not a property of a deployment anybody reviews, and two people could deploy one commit into two regions.
  Account-agnostic stays, so `cdk synth` still runs with no credentials in the diff job.
- **`DiveDayEmail` (`diveday-email`) keeps its own stack even though it now shares a region.**
  Mail is the one part of this estate whose region is decided by AWS rather than by us; it has been refused once already, and the next verdict should be one line here rather than a resurrection of the pull request that moved it the first time.
  It holds everything CloudFormation can only create in the sending region: the identity, the configuration set and its event destination, the outbound event topic, the two `AWS/SES` reputation alarms with the topic they notify, **and the receipt rule set, its bucket and its topic**.
- **`DiveDayGlobal` (`diveday-global`) is pinned to us-east-1 and holds the external uptime monitor.**
  Route 53 health checks and the alarms on their metric, with an alarm topic of their own.
  This was section 22 of the main stack and read as an ordinary same-region alarm for as long as the main stack was in us-east-1 too.
  It is split out precisely so `PRIMARY_REGION` can move without anybody having to remember: the uptime alarms are the one place in this estate that treats missing data as breaching, so in the wrong region they do not go quiet, they page continuously about an outage that is not happening.
- **The `diveday-ses-sender` IAM user and the credentials document stay in the main stack.**
  IAM is global and the access key belongs in the one hand-off document (S16).
  Its policy names the identity, configuration-set and inbound-bucket ARNs, built from the shared constants rather than from the constructs.
- **The stacks share no synth-time reference.**
  No `crossRegionReferences`, so no SSM shuttle near a credential and no fixed deploy order.
  `SES_SNS_TOPIC_ARN` and `EMAIL_INBOUND_SNS_TOPIC_ARN` are assembled from `SES_REGION` plus a topic name, and `EMAIL_INBOUND_S3_BUCKET` from a bucket name that has no region in it at all.
- **A deploy is all three stacks.**
  `pnpm infra:deploy` adds `--all` when no stack is named, CI names all three, and `pnpm infra:bootstrap` bootstraps every region in `DEPLOY_REGIONS`.
  The deployer user and both CI roles hold the bootstrap-role, `cloudformation` and bootstrap-version-parameter grants in every one, the CI ones still scoped to these three stacks by name rather than to `stack/*/*`.
- **The move is a teardown, not a cutover.**
  S3 bucket names and IAM user names are global, so the us-east-1 estate has to be gone before the us-east-2 one can be built.
  [docs/engineering/region-migration.md](../../engineering/region-migration.md) is the ordered version, and it is written for an estate with nothing in it worth keeping.

## Alternatives considered

- **Move SES alone and leave the rest in us-east-1** — the shape this change started as.
  It works, and it costs a second alarm topic, a cross-region ARN joint at every seam, an inbound rule set that has to move anyway, and a permanent two-region map in everybody's head, in exchange for keeping seed data where it is.
- **Fold the email stack back into the main one now that they share a region** — free today, and it throws away the only mechanism that made the last SES refusal a one-line change.
  The sandbox verdict is not ours to predict.
- **Keep the uptime alarms in the main stack and remember** — the failure mode is a pager that never stops, discovered during a migration rather than before one.
- **One stack with `crossRegionReferences: true`** — CDK gets values across a region border by writing them into SSM parameters read by a custom resource.
  A poor place for anything adjacent to a sending credential, and it makes the halves deploy in a fixed order for a joint two shared string constants make for free.
- **Custom resources calling the SES API in another region** — an `AwsCustomResource` per SES resource, hand-written create/update/delete, no drift detection, DKIM tokens read back through a Lambda.
  All of the cost of a second stack and none of CloudFormation.
- **Ask again in us-east-1 and wait** — it is why `SES_REGION` is one constant rather than a hundred edits, and it is now a strictly worse trade than it was: coming back would split the estate again.

## Consequences

- **Three alarm topics, so three confirmation clicks.**
  A CloudWatch alarm can only notify an SNS topic in its own region, so `diveday-ses-alarms` and `diveday-uptime-alarms` sit beside `diveday-observability-alarms`.
  Manual action `confirm-observability-alarms` says three.
- **Every access key in the estate is new.**
  The credentials secret is recreated in us-east-2, CloudFormation mints fresh keys for every IAM user, and the post-deploy wizard pushes them to Vercel, GitHub and 1Password.
  Nothing that held an old key keeps working.
- **The DNS is region-specific and does not follow the constant.**
  SES mints different DKIM tokens per region; the MAIL FROM MX and the inbound MX both name the region.
  All are re-added by hand from the new stack's outputs (`ses-dkim-dns`, `ses-mail-from-dns`, `ses-inbound-dns`), and each MX is a delete-then-add — SES refuses the MAIL FROM setup outright if the subdomain carries more than one.
- **Production access is per region, and this is a fresh request.**
  us-east-2 starts in the sandbox: pre-verified addresses and the mailbox simulator only, and no `Reputation.*` metrics at all until it is granted, so the two SES alarms sit at their `notBreaching` default meanwhile.
- **The SMS registrations are per region too, and they are the slow ones.**
  Leaving the SNS SMS sandbox, the spend limit above $1, and a US origination identity are all account-and-region state, and 10DLC vetting takes weeks rather than days.
  Doing this now, before a pilot shop needs a text message to arrive, is most of the argument for moving pre-pilot rather than later.
- **CloudWatch history does not move.**
  Log groups, metric filters, the dashboard, the saved queries and the RUM app monitor are recreated empty in us-east-2, and whatever us-east-1 holds stays there until it is deleted.
  The RUM app monitor id changes, which is an app environment variable and therefore a Vercel redeploy.
- **The media CloudFront distribution is replaced.**
  The distribution itself is a global resource and works with an origin in any region, and no ACM certificate is involved because the media distribution uses CloudFront's own domain rather than a custom one — so the "certificates for CloudFront live in us-east-1" rule does not bite.
  But the distribution is *defined in the main stack*, so a stack in a new region creates a new one with a new `*.cloudfront.net` domain, and `MEDIA_PUBLIC_URL_BASE` changes with it.
  Any media URL already written into the database keeps the old domain.
  Pre-pilot that is seed data; after a pilot it would be a rewrite, which is the other half of the argument for doing this now.
- **`--parameters` needs a stack named.**
  Unqualified, it applies to every stack in the deploy and the other two declare none — so `pnpm infra:deploy DiveDay --parameters CredentialSerial=<n>` is the rotation command, and the wrapper refuses the unqualified form rather than half-doing it.
- **The first deploy after the move is two commands, and a `cdk diff` is red until it happens.**
  The deployer user and the two CI roles get their per-region grants *from the main stack*, so until it has been deployed once into the new region, the identities that deploy and diff cannot see the other two stacks at all.
  The failure is `AccessDenied ... cloudformation:DescribeStacks on arn:aws:cloudformation:us-east-1:*:stack/diveday-global/*`, which is the grant three files down in the same diff.
  Nothing in the change can fix that; it is what a role that defines its own permissions costs the first time.
  The order out of it is in the migration runbook.

Revisit if the us-east-2 production-access request is also refused — at which point the answer is a support plan, not a third region — or if a reason appears to put the estate somewhere nearer its shops.
Moving again is `PRIMARY_REGION`, a deploy, and the same runbook; it stops being cheap the day a real shop has photos in the media bucket.
