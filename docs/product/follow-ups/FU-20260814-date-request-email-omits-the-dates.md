# FU-20260814-date-request-email-omits-the-dates — Put the requested dates in the email the shop actually reads

- **Status:** Open
- **Raised:** 2026-08-14 — branch `claude/request-a-date-for-a-course-or-dive`, which added
  `preferred_date`/`alternate_date`/`date_flexible` to `course_inquiries` and the
  `/shop/<shop>/requests` list that groups by them.
- **Kind:** half-done
- **Effort:** S
- **Touches:** `src/lib/notifications/kinds.ts`, `src/lib/notifications/email.ts`,
  `src/app/actions/inquiry.ts`, `src/i18n/locales/en-US/diver.json`,
  `src/i18n/locales/es-ES/diver.json`

## What I noticed

A diver can now ask for a specific date, and the shop's fastest signal — the `course_inquiry`
email that lands in their own inbox the moment the form is sent — does not mention it.

`courseInquiryEmail` (src/lib/notifications/email.ts) prints four facts: who is asking, how to
reach them, the free-text `timing`, how many divers, and where they are up to. It was written
before the date columns existed, and nothing added them. So a shop reading the email sees "When
suits: any Saturday" and has to open `/shop/<shop>/requests` to learn that the diver named the 6th
and could also do the 13th — which is the fact that decides whether a boat goes up.

There is a second, smaller wrinkle in the same place. A request sent from the schedule page has no
course, so `submitInquiryAction` passes the diver's free-text `interest` into the notification's
`courseTitle` field. The email reads correctly ("Marisol asked about **Two dives on the wrecks**"),
but the field is now carrying two different kinds of value under one name.

## Why it isn't already done

Scope, and the cost of the honest fix. Adding a line to that email means a new field on
`courseInquirySchema`, new copy in `notifications.courseInquiry.*` in **both** locale bundles, and
an update to the notification snapshot tests — all of it in a change that was already a schema
migration, a new public form, and a new paged staff surface. None of it is hard; it is simply a
separate, reviewable slice, and the requests list does answer the question today.

## Proposed change

1. `courseInquirySchema` (src/lib/notifications/kinds.ts) gains `preferredDate`, `alternateDate`
   (ISO calendar-date strings) and `dateFlexible`, all optional.
2. `courseInquiryEmail` renders one more fact line beside `timing` — the dates as the shop's own
   locale would read them (`formatCalendarDate`, which formats through UTC because a calendar date
   has no instant in it), and a "can move a few days" note when the flag is set. When no date was
   named, render nothing rather than "Not said": the free-text line already answers.
3. `submitInquiryAction` passes them through.
4. While in there, consider renaming the notification's `courseTitle` to something that admits it
   may be an `interest` (`subject`, say). Do **not** split the notification into two kinds — the
   email is the same email, and a second kind would double the copy for one nullable field.

## Prompt

```text
The email DiveDay sends a dive shop when a diver asks for a date does not say which dates they
asked for. Add them.

Read first:
  - docs/product/follow-ups/FU-20260814-date-request-email-omits-the-dates.md (this file — its
    "Proposed change" section is the spec)
  - src/lib/notifications/email.ts, the `courseInquiryEmail` function
  - src/lib/notifications/kinds.ts, the `courseInquirySchema` block
  - src/app/actions/inquiry.ts — the action that sends it, and the source of the values
  - src/db/schema.ts, the `courseInquiries` table (preferred_date, alternate_date, date_flexible)

The constraint that makes this non-obvious: a `date` column holds a calendar date with no instant
in it, so it must be formatted with an explicit `timeZone: "UTC"` (src/lib/calendar-date.ts's
`formatCalendarDate` already does) — never through the shop's zone, which would shift the day.
`pnpm check:timezone` enforces the rule but cannot tell you which way is right.

Done means: a shop's inquiry email names the preferred date, the alternate when there is one, and
says when the diver can move a few days; a request that named no dates renders no extra line at
all; every new string is in src/i18n/locales/en-US/diver.json AND es-ES/diver.json under
`notifications.courseInquiry.*`; and the notification tests cover both the dated and the dateless
email.

Run: pnpm check. Delete docs/product/follow-ups/FU-20260814-date-request-email-omits-the-dates.md
as part of the change.
```
