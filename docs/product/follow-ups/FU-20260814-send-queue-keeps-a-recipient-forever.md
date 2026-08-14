# FU-20260814-send-queue-keeps-a-recipient-forever — Two notification tables hold a person's contact details on no clock at all

- **Status:** Open
- **Raised:** 2026-08-14 — `security-reviewer` pass on the new `/privacy` page, checking whether the
  retention paragraph was true. The published numbers are now correct; these two tables are why the
  paragraph had to be reworded, and they are a real gap rather than a wording problem.
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/lib/retention.ts`, `src/db/retention.ts`, `src/db/notifications.ts`,
  `src/db/schema.ts`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`

## What I noticed

`RETENTION_DAYS` prunes `notification_delivery_attempts` at 400 days. Two neighbouring tables that
hold more identifying data than it does are on no clock at all:

- **`notification_send_queue.payload`** is a `jsonb` of the whole validated notification, recipient
  address included. `src/db/notifications.ts` only ever *updates* rows to a terminal status; there is
  no `delete(notificationSendQueue)` anywhere in the repo. A diver's email address therefore sits in
  that column indefinitely, including for a diver whose person row was later erased.
- **`notification_deliveries`** is the outcome row — the durable "did the shop reach them" record. It
  is not in `RetainedTable`. Its `providerDetail` and `sendError` columns are free text straight from
  SES, SNS or Meta, and a bounce string routinely quotes the address it failed to reach.

The erasure path is the sharp end. `src/db/anonymize.ts` scrubs the person, but nothing walks these
two tables, so a shop that erases a diver on request leaves that diver's address behind in a queue
payload and possibly in a provider error string. That is the one case where "we deleted them" is not
quite true, and it is now a case a published privacy page invites someone to check.

Worth being precise about what is *not* wrong here: H-02's standing decision is that DiveDay retains
customer and contact data indefinitely and deletes it only when told to, and `RETENTION_DAYS`
deliberately prunes append-only trails only, never a table holding a person. This entry does not
re-propose a dormancy clock. It says that a *trail* table quietly became a table holding a person,
which is a different thing and one the retention design did not intend.

## Why it isn't already done

Out of scope for the change that found it, which was publishing a privacy page, and the fix is not
obvious in a way I should pick alone.

`notification_deliveries` is genuinely the record a "you never told me the trip was cancelled"
conversation turns on — the same argument that earned `notification_delivery_attempts` its 400 days
rather than something shorter. So the question is not "prune it" but "what part of it is evidence and
what part is a leftover address", and those are different columns with different answers. The send
queue is easier (a delivered row's payload has done its job), but "easier" is not the same as
decided, and both want the retention owner rather than a passing agent.

## Proposed change

Three separable pieces, smallest first:

1. **Clear the payload on a terminal send.** Once a queued notification is `sent` or permanently
   failed, `payload` has served its purpose; null it in the same update that sets the status. This
   needs no new window, no migration beyond making the column nullable, and closes the larger half.
2. **Reach both tables from erasure.** `anonymize.ts` should scrub the recipient out of a queue
   payload and out of `providerDetail`/`sendError` for the erased person, the way it already does for
   the person's own rows. Without this, "a shop can erase a diver's record" is true with an asterisk.
3. **Decide a window for `notification_deliveries`,** or state deliberately that it has none and why.
   If it gets one, 400 days matches its sibling and the reasoning already written on
   `notification_delivery_attempts`.

Whatever is chosen, `marketing.privacy.keep.*` in **both** locale bundles is part of the change: the
published page currently says delivery *attempts* are pruned at 400 days and is careful not to claim
anything about the outcome rows. If (3) gives them a window, the page should say so.

**Not proposed:** a dormancy clock on people or contacts. H-02 settled that, twice, and this is not
that argument.

## Prompt

```text
Two of DiveDay's notification tables hold a person's contact details with no retention window and no
erasure path, which makes "a shop can erase a diver's record" true with an asterisk.

Read first:
  - docs/product/follow-ups/FU-20260814-send-queue-keeps-a-recipient-forever.md (this file)
  - src/lib/retention.ts -- RETENTION_DAYS, and the standing decision at the top that it prunes
    append-only trails only and never a table holding a person. Do NOT re-propose a dormancy clock;
    H-02 settled that twice.
  - src/db/notifications.ts -- notificationSendQueue is only ever UPDATED to a terminal status;
    there is no delete anywhere
  - src/db/schema.ts -- notification_send_queue.payload (jsonb, holds the recipient) and
    notification_deliveries.providerDetail / .sendError (free text from SES/SNS/Meta, which quotes
    the address in a bounce)
  - src/db/anonymize.ts -- the erasure path, which does not currently walk either table
  - docs/product/human-decisions.md rows H-02 and H-36

Do these in order, and each is separately shippable:
1. Null notification_send_queue.payload once the send reaches a terminal status.
2. Teach anonymize.ts to scrub the erased person out of both tables.
3. Decide whether notification_deliveries gets a window (400 days matches its sibling) or
   deliberately has none, and write down which.

The constraint that makes 3 non-obvious: notification_deliveries is the durable proof a shop DID
reach a diver -- the record a "you never told me the trip was cancelled" dispute turns on. That is
the same argument that earned the attempts table 400 days rather than something shorter. So separate
the columns that are evidence from the columns that are a leftover address, rather than pruning the
row wholesale.

If step 3 gives those rows a window, update marketing.privacy.keep.* in BOTH locale bundles -- the
published /privacy page deliberately says "delivery attempts" today and claims nothing about the
outcome rows, because claiming a number that was not enforced is the bug this entry came out of.

Done when: pnpm check is green, a test covers erasure reaching both tables, and the privacy copy
matches whatever was decided. Delete
docs/product/follow-ups/FU-20260814-send-queue-keeps-a-recipient-forever.md as part of the change.
```
