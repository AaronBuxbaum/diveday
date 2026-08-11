# FU-20260809-confirm-address-lookup-region — Get the deployment signing with the address-lookup key the account actually holds

- **Status:** Open
- **Raised:** 2026-08-09 — branch `claude/mobile-ui-ux-fixes-o4971v`, while fixing the reported
  "Address lookup isn't available right now" on Settings
- **Updated:** 2026-08-11 — PR #458 made the failure name its own cause; the name was then read off
  the deployment and the AWS side checked. What is left is a deployment step, not an AWS one.
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
key that existed but lacked the geo-places action the app calls would be `AccessDeniedException`,
and a key
whose secret did not match would be `SignatureDoesNotMatch`.

So the deployment holds a `PLACES_AWS_ACCESS_KEY_ID` that no longer exists in account
`417160702652` — or never did. Note this is invisible from the box: the search field renders
whenever all three `PLACES_AWS_*` values are merely *present*, so a hand-filled or superseded value
looks exactly like a working one until the first request.

Checked on 2026-08-11: the stack is **not** stale — `diveday-infra` was last updated at 17:57:55Z,
ten minutes before the log line above, and `diveday-places-lookup` has existed since 2026-08-05. So
the user and its key are real, and what the running app signs with is not the pair the account
holds. The ordering is itself the clue: a failure timestamped shortly *after* a deploy is the
signature of a deployment carrying pre-deploy environment values, not of a wrong value sitting in
the dashboard.

## Why it isn't already done

It needs someone who can reach the AWS account and the Vercel project. Agent sessions here have
neither — outbound AWS calls are blocked by policy — and re-pasting a live credential is not
something a session should be doing unattended in any case.

## Proposed change

1. Find out which key the account holds, and which one the deployment sends:
   ```
   aws iam list-access-keys --user-name diveday-places-lookup
   AWS_ACCESS_KEY_ID=<deployed PLACES_AWS_ACCESS_KEY_ID> \
   AWS_SECRET_ACCESS_KEY=<deployed PLACES_AWS_SECRET_ACCESS_KEY> aws sts get-caller-identity
   ```
   `list-access-keys` gives the id, its `Status`, and a `CreateDate` — a `CreateDate` matching the
   stack's last update means that deploy rotated the pair and deleted its predecessor (§12 mints
   through a `credentialSerial` parameter). `Inactive` reads as an unrecognised client too.
2. **`get-caller-identity` fails** ⇒ the value in Vercel is stale. Repaste
   `PLACES_AWS_ACCESS_KEY_ID` and `PLACES_AWS_SECRET_ACCESS_KEY` in Vercel Production from Secrets
   Manager `diveday/env`, which the last deploy refreshed.
3. **Redeploy the app, whether or not step 2 changed anything.** Vercel resolves environment
   variables into a deployment: editing one in the dashboard does not reach a deployment that is
   already running, so a build that started before the credential moved keeps signing with the dead
   pair indefinitely. This is the step most likely to be skipped, because the dashboard shows the
   right value the whole time — and if `get-caller-identity` *succeeded* in step 1, it is the entire
   remaining fix. Suspect it first whenever the failure timestamp sits shortly after a stack deploy;
   that ordering is the signature of this, not of a bad value.
4. Confirm from the box: four characters into the address search should list real places, and
   picking one should save that address on the settings card (the five text boxes it used to fill
   are gone — ADR 20260811-address-is-one-search-box). If the reason changes to `denied` with
   `AccessDeniedException`, the credential is now valid and §12's policy is the next thing to read —
   note that policy moved from `geo-places:Autocomplete` to `geo-places:Suggest` on 2026-08-11, so a
   stack that has not been redeployed since will deny every request on its own.

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
geo-places:Suggest policy, and mintAccessKey's credentialSerial), and
docs/architecture/decisions/20260804-aws-location-address-lookup.md plus its amendment
docs/architecture/decisions/20260811-address-is-one-search-box.md.

Note the policy statement changed from geo-places:Autocomplete to geo-places:Suggest on 2026-08-11.
A stack deployed before that answers every keystroke with AccessDeniedException regardless of the
credential, so confirm cdk deploy has run since before spending time on the key itself.

Already checked on 2026-08-11, so do not redo it: the diveday-infra stack is current (last updated
17:57:55Z) and the diveday-places-lookup user has existed since 2026-08-05. The account is fine; the
running deployment is what is signing with the wrong pair.

Do this: run `aws iam list-access-keys --user-name diveday-places-lookup`, then
`aws sts get-caller-identity` using the PLACES_AWS_* pair the deployment holds. If that fails,
repaste both values in Vercel Production from Secrets Manager diveday/env. Then redeploy the app
either way — Vercel resolves environment variables into a deployment, so an edit in the dashboard
never reaches a build that is already running, and a failure timestamped just after a stack deploy
is usually exactly this.

Do not change application code. The app reached AWS, signed correctly, and reported the refusal
accurately; there is nothing for it to fix.

Done means: typing four characters into the address search on /shop/<slug>/settings lists real
places and picking one fills all five address boxes, stated as an observation of the deployed site.
Delete docs/product/follow-ups/FU-20260809-confirm-address-lookup-region.md as part of the change.
```
