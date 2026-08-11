# FU-20260809-confirm-address-lookup-region — Mint (or repaste) the address-lookup credential the deployment is missing

- **Status:** Open
- **Raised:** 2026-08-09 — branch `claude/mobile-ui-ux-fixes-o4971v`, while fixing the reported
  "Address lookup isn't available right now" on Settings
- **Updated:** 2026-08-11 — PR #458. The failure was made to name its own cause, the cause was then
  read off the deployment, and the remaining work is one AWS action.
- **Kind:** half-done
- **Effort:** S
- **Touches:** `infra/lib/infra-stack.ts` (§12, where the credential is minted), `.env.example`
  (the `PLACES_AWS_*` names the deployment must hold),
  `docs/architecture/decisions/20260804-aws-location-address-lookup.md`

## What I noticed

The address type-ahead on `/shop/<slug>/settings` fails on the deployed site, reproducibly, on every
keystroke. As of PR #458 the failure classifies itself, and on 2026-08-11 it was read:

```
{"level":"warn","event":"address_lookup.failed","error":"UnrecognizedClientException",
 "code":null,"status":403,"reason":"denied"}
```

Every part of that is load-bearing. An AWS endpoint **answered**, with a status and an exception
name, so the host resolved and `PLACES_AWS_REGION` names a region that serves the Places API — the
region hypothesis this entry was originally opened for is dead. `UnrecognizedClientException` is the
signature-layer refusal, not the authorization one: AWS does not know the access key id at all. A
key that existed but lacked `geo-places:Autocomplete` would be `AccessDeniedException`, and a key
whose secret did not match would be `SignatureDoesNotMatch`.

So the deployment holds a `PLACES_AWS_ACCESS_KEY_ID` that no longer exists in account
`417160702652` — or never did. Note this is invisible from the box: the search field renders
whenever all three `PLACES_AWS_*` values are merely *present*, so a hand-filled or superseded value
looks exactly like a working one until the first request.

The likely single cause, shared with FU-20260811-deploy-the-fixed-ci-trust-policies: **the
`diveday-infra` stack has not been deployed since §12 was added on 2026-08-04.** That would mean the
`diveday-places-lookup` user and its key were never minted (this failure), and that §18's CI roles
were never created either — which produces exactly the `sts:AssumeRoleWithWebIdentity` refusal that
entry is about, since AWS returns the same "Not authorized" for a role that does not exist. One
deploy would settle both.

## Why it isn't already done

It needs someone who can reach the AWS account. Agent sessions here have no AWS access — outbound
AWS calls are blocked by policy — and minting an IAM credential is not something a session should be
doing unattended in any case.

## Proposed change

1. Check whether the stack is stale, which is the fork everything else hangs off:
   ```
   aws cloudformation describe-stacks --stack-name diveday-infra \
     --query 'Stacks[0].LastUpdatedTime' --output text
   aws iam get-user --user-name diveday-places-lookup
   ```
   A last-update time before 2026-08-04, or `NoSuchEntity`, confirms it.
2. **Stack stale** ⇒ run `pnpm infra:deploy` from a workstation with the `diveday-admin` profile. It
   mints the `diveday-places-lookup` user and key, creates §18's CI roles, and the wizard pushes the
   resulting `PLACES_AWS_*` values into Vercel. This also discharges
   FU-20260811-deploy-the-fixed-ci-trust-policies.
3. **Stack current** ⇒ the key exists and the deployment is holding a superseded one (§12's keys are
   minted with a `credentialSerial` parameter, so a deploy that bumped it deleted the old pair).
   Repaste `PLACES_AWS_ACCESS_KEY_ID` and `PLACES_AWS_SECRET_ACCESS_KEY` in Vercel Production from
   Secrets Manager `diveday/env`.
4. Confirm from the box: four characters into the address search should list real places, and
   picking one should fill all five boxes.

Not proposing any application change. The code path is proven — it reached AWS, signed a request,
and reported the refusal accurately — and nothing an app can do fixes a credential the account does
not recognise.

## Prompt

```text
DiveDay's shop-address type-ahead is dead on the deployed site. The cause is known and the remaining
work is one AWS action; nobody with account access has performed it yet.

The deployment's log line reads:
  {"event":"address_lookup.failed","error":"UnrecognizedClientException","status":403,"reason":"denied"}
An AWS endpoint answered, so the region is fine. UnrecognizedClientException means the access key id
in PLACES_AWS_ACCESS_KEY_ID is not a key that exists in account 417160702652.

Read first: section 12 of infra/lib/infra-stack.ts (the diveday-places-lookup IAM user, its
geo-places:Autocomplete policy, and mintAccessKey's credentialSerial), and
docs/architecture/decisions/20260804-aws-location-address-lookup.md.

Do this: run `aws cloudformation describe-stacks --stack-name diveday-infra --query
'Stacks[0].LastUpdatedTime'` and `aws iam get-user --user-name diveday-places-lookup`. If the stack
predates 2026-08-04 or the user does not exist, run `pnpm infra:deploy` from a workstation with the
diveday-admin profile — that mints the user and key and pushes the values to Vercel, and also
discharges docs/product/follow-ups/FU-20260811-deploy-the-fixed-ci-trust-policies.md. If the stack is
current, the deployment is holding a superseded key: repaste PLACES_AWS_ACCESS_KEY_ID and
PLACES_AWS_SECRET_ACCESS_KEY in Vercel Production from Secrets Manager diveday/env.

Do not change application code. The app reached AWS, signed correctly, and reported the refusal
accurately; there is nothing for it to fix.

Done means: typing four characters into the address search on /shop/<slug>/settings lists real
places and picking one fills all five address boxes, stated as an observation of the deployed site.
Delete docs/product/follow-ups/FU-20260809-confirm-address-lookup-region.md as part of the change.
```
