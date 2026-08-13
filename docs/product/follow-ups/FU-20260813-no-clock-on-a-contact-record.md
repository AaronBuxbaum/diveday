# FU-20260813-no-clock-on-a-contact-record — Decide how long a shop keeps somebody who never became a diver

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/follow-up-decisions-xgj9o3`, a sweep of the codebase for
  policy questions the product currently answers by accident rather than by decision.
- **Kind:** question
- **Effort:** M
- **Touches:** `src/lib/retention.ts`, `src/db/retention.ts`, `src/db/anonymize.ts`,
  `src/db/course-inquiries.ts`, `src/db/schema.ts`

## What I noticed

DiveDay has a careful, well-reasoned retention mechanism that covers six tables, and the tables
holding the most personal data are not among them.

`RETENTION_DAYS` (`src/lib/retention.ts`) is exactly the shape a retention policy should be: one
table, one number per row, a written reason for each number, and a weekly bounded prune behind it.
Its `RetainedTable` union names `stripe_webhook_events`, `notification_delivery_attempts`,
`activity_events`, `account_tokens`, `booking_payment_events`, and `push_subscriptions`. Every one is
an append-only *trail*.

The rows a person would recognise as themselves have no clock at all:

- **`people`** — name, email, phone, and (since H-08's minimum-age gate) date of birth.
- **`course_inquiries`** — somebody who filled in a form asking about a course. Name, a way to reach
  them, free-text about what they want, and nothing else.
- **`trip_waitlist_entries`** — somebody who asked to be told if a seat freed on a charter that was
  full.

The only way any of these is ever removed is a staff member finding the diver and running
`anonymizeDiver` (`src/db/anonymize.ts`) by hand. There is no automatic expiry, no dormancy rule, and
nothing that distinguishes a diver with fifteen dives and a signed waiver from a person who typed
their email into a course form in 2026, never heard back, and never came.

That last case is the one worth deciding about. It is the most sympathetic possible subject — someone
who is not a customer, has no relationship with the shop, and almost certainly does not remember
DiveDay exists — and the product currently keeps their name, email and phone number forever, with the
shop's other divers, exposed to the same import/export surface and the same breach radius.

## Why it isn't already done

It looks like H-02's job and it is not, so filing it as its own question is the point.

H-02 asks what evidence-retention period applies to **waivers and medical flags**, and its working
default — recorded 2026-07-30, explicitly pending counsel — is to retain indefinitely. That default
is defensible for what it covers: a signed release is evidence, and evidence you destroyed on a
schedule is evidence you cannot produce when a claim arrives years later. The reasoning is about
liability.

None of it reaches a course inquiry. There is no release, no medical answer, no claim to defend, and
no legal-hold argument for keeping a lead who never booked. So the indefinite retention of those rows
is not H-02's decision applied broadly; it is the absence of anyone having asked the narrower
question. Reading `human-decisions.md` today, a person could easily believe H-02 settled this.

I also can't pick the number. "How long may a shop keep a lead" is a business call before it is a
privacy one — a diver who inquires about a course in March and books in November is completely
ordinary, so a short window destroys real value, and a long one is hard to distinguish from no window
at all.

**Recommendation:** decide it as *two* windows, not one. A contact with no booking and no activity
expires on a stated dormancy clock. A person who has ever booked stays under H-02's regime, untouched
by this. That keeps the sympathetic case bounded without going anywhere near the evidence question
counsel still owns.

## Proposed change

The owner's part is to name two things: the dormancy window for a contact who never booked, and
whether expiry means deleting the row or running the existing anonymisation over it.

The build, once those are set:

1. Extend `RETENTION_DAYS`'s `RetainedTable` union with the contact tables and give each a window and
   a written reason, in exactly the established style — the file's own docblock says shortening a
   window should mean editing one table and nothing else, and that property is worth preserving as it
   grows.
2. Add the corresponding arms to `src/db/retention.ts`, respecting `PRUNE_BATCH_LIMIT` as the
   existing arms do. The predicate is the hard part and belongs in `src/lib/`, unit-tested on its
   own: a person is prunable only when they have **no** booking in any state, no waiver, no
   certification, and no staff role — a wait-list entry or course inquiry alone is not a
   relationship. Fail closed on anything ambiguous; deleting a real diver is unrecoverable and there
   are no down migrations.
3. Prefer reusing `anonymizeDiver` over a hard delete where a row is referenced elsewhere, so the
   existing erasure path stays the single definition of what erasure means.
4. Say it in the product. A shop cannot honour a retention promise it has not been told about, and a
   course inquiry form that quietly implies "forever" is the thing being fixed — this needs a line
   on the Settings data page and, once the privacy policy exists
   (`FU-20260812-no-privacy-or-terms-page.md`), a matching sentence there.

Do **not** fold this into H-02 or extend its indefinite default across these tables by analogy. The
whole finding is that the two questions have different subjects and different reasons, and merging
them buries the easy one inside the one that is waiting on counsel.

## Prompt

```text
Give contact records a retention clock: today src/lib/retention.ts prunes six append-only trails and
nothing ever expires a people, course_inquiries, or trip_waitlist_entries row.

Read first:
  - docs/product/follow-ups/FU-20260813-no-clock-on-a-contact-record.md (the full write-up)
  - src/lib/retention.ts — RETENTION_DAYS, the RetainedTable union, and the docblock explaining why
    the whole policy is one table a human edits
  - src/db/retention.ts — how each existing arm prunes, and PRUNE_BATCH_LIMIT
  - src/db/anonymize.ts — anonymizeDiver, the existing definition of erasure
  - the H-02 row in docs/product/human-decisions.md

Two constraints:

  1. H-02 is NOT this. It covers waiver and medical evidence and its indefinite-retention default is
     about defending a claim. A course inquiry has no release and no claim behind it. Keep the two
     separate: a person who has ever booked stays under H-02 untouched by this work.
  2. The prunable predicate must fail closed. A person is only prunable with NO booking in any state,
     no waiver, no certification, and no staff role — a wait-list entry or course inquiry alone is
     not a relationship. There are no down migrations and deleting a real diver is unrecoverable, so
     put the predicate in src/lib/ with its own unit tests before wiring any delete.

The windows themselves are the product owner's call — ask for them rather than inventing numbers, and
ask whether expiry means deleting the row or running anonymizeDiver over it.

Done means: the new tables appear in RETENTION_DAYS with a written reason each, matching arms exist in
src/db/retention.ts, the predicate is unit-tested including the near-miss cases, and the retention
promise is stated on the Settings data page in BOTH locales under src/i18n/locales/.

Follow the schema-change skill if any column is needed. Run pnpm check plus the focused tests. Get a
security-reviewer pass before merge — this deletes rows holding personal data.

Delete docs/product/follow-ups/FU-20260813-no-clock-on-a-contact-record.md as part of the change.
```
