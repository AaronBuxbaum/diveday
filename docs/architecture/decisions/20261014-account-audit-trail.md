# 20261014-account-audit-trail — One CloudTrail trail records the account's management events

- **Status:** Accepted 2026-10-14 (Aaron Buxbaum, in the project thread, on the Trusted Advisor export: "build 2 and 4")
- **Date:** 2026-10-14

## Context

AWS Trusted Advisor reported on 2026-10-14 that CloudTrail was off in all 17 regions. Nothing recorded who created an access key, changed a bucket policy or opened a security group, so a leaked deployer key or a mistaken console change would leave no trace to investigate. The same export found a root-user access key, which is the kind of change a trail exists to catch.

## Decision

**The `DiveDay` stack (`infra/lib/infra-stack.ts` S23) owns one multi-region CloudTrail trail of read and write management events, written to the private bucket `diveday-audit-trail`.**

- One trail, multi-region, with global service events (IAM, STS): the account's first copy of management events is free, so the only cost is the bucket's bytes.
- Log file validation on, so CloudTrail's digest files can prove a log was not edited. The bucket is unversioned for the reason the dump bucket is: a lifecycle expiry on a versioned bucket keeps the bytes.
- Objects expire after 365 days (`AUDIT_TRAIL_RETENTION_DAYS`). The bucket is `RETAIN`, so a `cdk destroy` leaves the record of itself behind.
- No data events and no CloudWatch Logs copy: both are billed, and nobody reads the trail as a stream. `aws cloudtrail lookup-events` covers the last 90 days without either.

## Alternatives considered

- **CloudTrail's default 90-day event history only.** It is on without a trail, but it cannot be kept longer, has no digest files, and is not what Trusted Advisor or a customer security questionnaire asks for.
- **A CloudWatch Logs copy with metric-filter alarms on root sign-in and IAM changes.** Worth it once there is a team; for one owner it adds ingestion cost and alarms nobody acts on yet.

## Consequences

- One more retained bucket for `backup-bucket-readoption` and `region-move-teardown` (manual actions) to account for.
- Deleting the root user's access keys is a manual action (`root-access-key-removal`), because only root can do it and nothing in this repository may hold a root credential.
