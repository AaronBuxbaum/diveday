# FU-20260813-checkout-recovery-has-no-unsubscribe — Decide whether the abandoned-checkout nudge is a transactional message or a commercial one

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/follow-up-decisions-xgj9o3`, a sweep of the codebase for
  policy questions the product currently answers by accident rather than by decision.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/lib/notifications/kinds.ts`, `src/db/checkout-recovery.ts`,
  `src/lib/checkout-recovery.ts`, `src/db/courtesy-email.ts`

## What I noticed

Of the three sends that go to somebody who is not attached to a confirmed booking, exactly one has no
way out of it — and it is the one that most resembles marketing.

Line them up as their schemas define them in `src/lib/notifications/kinds.ts`:

- `waitlist_invite` — carries `unsubscribeUrl`.
- `last_minute_deal` — carries `unsubscribeUrl`.
- `checkout_recovery` — does not. Its schema ends at `checkoutUrl`.

And the send path matches the schema. `src/db/checkout-recovery.ts` never reads
`people.courtesyEmailOptOutAt`, so a diver who has explicitly opted out of courtesy email — the
self-serve opt-out the other two honour, with `opted_out` as a first-class delivery outcome — still
receives this one. There is no per-recipient suppression of any kind on this path.

What the message is: a nudge, two hours after someone started a pay-at-booking checkout and did not
finish, pointing them back at the Stripe session (`RECOVERY_DELAY_HOURS`, `src/lib/checkout-recovery.ts`;
ADR 20260726-abandoned-checkout-recovery). The recipient is `customerEmail` off the checkout row.
They did not complete a purchase. They may have no relationship with the shop at all — they may have
abandoned the checkout *because* they changed their mind about the shop. In direct-marketing terms
this is a cart-recovery email, which is the textbook example of a message that sits on the line
between transactional and commercial, and every major regime draws that line somewhere:
CAN-SPAM's primary-purpose test, CASL's implied-consent window, GDPR/ePrivacy's soft opt-in.

H-09 recorded the basis on which DiveDay sends without an opt-in: *"Email is transactional/service
messaging (booking, waiver, trip logistics), so no marketing opt-in is required to send it."* Every
example named in that sentence is attached to a booking that exists. The abandoned-checkout nudge is
the one send where the booking, by definition, does not.

## Why it isn't already done

Two reasons, and the second is why this is filed as a question rather than fixed in passing.

The first is that it is genuinely arguable. A recovery nudge about a checkout the person themselves
started, sent once, two hours later, linking to their own live Stripe session, has a real claim to
being service messaging — it is closer to "you left this unfinished" than to "here is an offer." I
do not think that claim is obviously wrong.

The second is that it is H-09's territory. H-09 is `In progress` with its consent policy explicitly
still open, and the row already carries an unresolved consent dependency (SMS opt-in, gated on the
attorney). Quietly reclassifying a send while the row that owns consent policy is open would be
deciding H-09's question in a commit rather than in the register.

**Recommendation: add the unsubscribe link and the opt-out check regardless of how the
classification question is answered.** The cost is one field in a Zod schema, one query, and one
string in each locale bundle. The downside of being wrong in the other direction is a compliance
finding on a live shop's sending domain, and — worse for DiveDay specifically — SES reputation
damage that lands on the shared sender. Treating the doubtful case as commercial is the cheap side
of the bet. The classification question is still worth answering, because it decides whether this is
the only gap or whether other sends need the same read.

## Proposed change

The mechanical part, which I recommend doing under either answer:

1. `checkoutRecoverySchema` in `src/lib/notifications/kinds.ts` gains `unsubscribeUrl`, matching
   `waitlistInviteSchema` and `lastMinuteDealSchema` exactly — same `z.url().max(2_000)` shape, so
   the three siblings stay identical.
2. `src/db/checkout-recovery.ts` mints the token through the same helper the wait-list invite uses,
   `issuePersonCourtesyEmailUnsubscribeToken` (`src/db/courtesy-email.ts`), and checks
   `people.courtesyEmailOptOutAt` before sending, returning the existing `opted_out` outcome rather
   than a new one.
3. The email template renders the footer link, with copy in both locale bundles.

One real wrinkle to solve rather than trip over: the recipient here is an email address off the
checkout row, and there may be **no `people` row** to hang an opt-out on — the schema comment says as
much, noting that a party checkout covers several bookings with no reliable lead booking to key on.
So the lookup is by address within the shop, and the honest answer when no person matches is to send
with a link that creates the suppression on use, not to skip the check and pretend it passed.

The policy part: record the classification answer on H-09 in `docs/product/human-decisions.md` —
whether abandoned-checkout recovery counts as transactional under that row's reasoning — so the next
send that sits on this line has a rule to be read against instead of a precedent to be guessed at.

Do **not** solve this by deleting the feature. Recovery emails work and the ADR that introduced it
made a sound case; the question is what rides along with the message, not whether it goes.

## Prompt

```text
Give the abandoned-checkout recovery email an unsubscribe link and an opt-out check, and record the
classification decision behind it.

Read first:
  - docs/product/follow-ups/FU-20260813-checkout-recovery-has-no-unsubscribe.md (the full write-up)
  - src/lib/notifications/kinds.ts — compare checkoutRecoverySchema against waitlistInviteSchema and
    lastMinuteDealSchema; the first is missing unsubscribeUrl and the other two are the template
  - src/db/checkout-recovery.ts — it never consults people.courtesyEmailOptOutAt
  - src/db/courtesy-email.ts — issuePersonCourtesyEmailUnsubscribeToken, the helper the wait-list
    invite already uses
  - the H-09 row in docs/product/human-decisions.md, which is the row that owns consent policy

The wrinkle that makes this more than a copy-paste: this send is keyed to a checkout, not a booking,
and its recipient is an email address that may have NO people row behind it (the schema comment in
kinds.ts explains why — a party checkout covers several bookings with no lead booking to key on).
So resolve the opt-out by address within the shop, and when no person matches, still send a working
unsubscribe link that creates the suppression when used. Do not skip the check and treat it as passed.

Done means: checkoutRecoverySchema carries unsubscribeUrl in the same shape as its two siblings; the
send path checks the opt-out and returns the existing opted_out outcome; the footer link renders; the
copy lands in BOTH locales under src/i18n/locales/; and unit tests in src/db/checkout-recovery.test.ts
cover an opted-out recipient, a recipient with no people row, and the ordinary case.

Run pnpm check. Do not delete the recovery feature — the question is what rides along with the
message, not whether it sends.

Delete docs/product/follow-ups/FU-20260813-checkout-recovery-has-no-unsubscribe.md as part of the
change.
```
