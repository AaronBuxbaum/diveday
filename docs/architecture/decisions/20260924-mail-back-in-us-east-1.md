# 20260924-mail-back-in-us-east-1 — Move mail to us-east-1 now, and the rest of the estate after it

- **Status:** Accepted
- **Date:** 2026-09-24
- **Supersedes in part:** [20260910-one-region-in-us-east-2](20260910-one-region-in-us-east-2.md) — the region only; its stack split stands

## Context

SES production access has now been asked for twice.
Case 178576512200471 (us-east-1, August 3–15) was refused three times with no reason and closed as final.
Case 178905641100543 (us-east-2, September 10) got the standard "tell us more" follow-up, was answered within half an hour, and was closed with no decision at all; two comments on the closed case drew no reply.
AWS Support's automated answer on case 178839371400539 (September 3) says the way forward is a **new** request that describes what changed since the refusal.

The owner has decided to file that request in us-east-1 and to move the whole estate back there afterwards.
The sandbox is per region, so the request can only be granted in the region the identity, configuration set, event webhook and alarms are actually in — and the case text claims all of them.
DiveDay is pre-pilot with no active users (H-49), so nothing in the mail stack needs keeping.

## Decision

- `SES_REGION` in `config/aws-regions.mjs` is `us-east-1`. `PRIMARY_REGION` stays `us-east-2` for now.
- The email stack moves as a teardown, not a cutover: deactivate the us-east-2 receipt rule set, delete `diveday-email` in us-east-2, delete the retained `diveday-inbound-mail` bucket, then deploy. The ordered steps are in [ses-email-runbook.md](../../engineering/ses-email-runbook.md), "Moving mail to another region".
- The production-access case is filed in us-east-1 only after every "Before you file" check passes there, and opens with the history above and what changed since August.
- Every manual action that names the SES region reads it from `SES_REGION` rather than spelling it, so the next move is the one line again.

## Alternatives considered

- **File a new case in us-east-2** — no reason to expect a different outcome from the region that just went silent, and the estate is heading to us-east-1 anyway.
- **Hand-verify the domain in us-east-1 and leave the stack in us-east-2** — the reviewer would find no configuration set, webhook or alarms in the region under review, and a later stack move would collide with the hand-made identity.
- **Move the whole estate to us-east-1 first** — the right end state, but a full teardown of buckets, CloudFront and IAM users (region-migration.md) standing between the owner and a case that only needs the mail stack.
- **An external email provider** — declined by the owner; SES stays the sole provider ([20260803-ses-sole-email-provider](20260803-ses-sole-email-provider.md)).

## Consequences

- The estate is two-region again until `PRIMARY_REGION` follows: the SES reputation alarms notify a topic in us-east-1, the console has to be switched per stack, and the main stack builds the mail ARNs from constants. The stack split already carries all of this.
- Replies to DiveDay mail bounce between the MX change and the rule-set activation, and sending is sandbox-only until the new case is granted.
- If us-east-1 refuses again, the likely cause is the account rather than the text or the region (new account, flagged earlier this month for CloudFront verification). The next step is then a Developer Support case asking why, not a third region.
