# 20261007-setup-request-form — "Get set up" is a public form, not a mail

- **Status:** Accepted
- **Date:** 2026-10-07
- **Amends:** [20260925-shops-are-set-up-by-hand](20260925-shops-are-set-up-by-hand.md) (its "Get set up" mail, and the "contact form" alternative it declined)

## Context

Since 2026-09-25 every shop is set up by hand, and every public "Get set up" button was a `mailto:` to `onboarding@dive.day`. A mail link loses most of the people who press it: there may be no mail client on the device, the reader has to work out what to say, and the funnel tag is dropped, so the founder could not tell which page sent a request. The questions the first set-up call needs (where the shop is, whether it runs a boat, what it uses today) came back only if the reader happened to write them. The earlier ADR turned down a contact form as "a new surface with its own rate limit, spam and storage". Those costs are small next to a door most readers do not get through.

## Decision

- **One public page, `/get-set-up`**, with seven asks in the order a set-up call takes them: shop name, town or region, "do you run a boat?" (yes or no), what the shop uses today (paper, spreadsheets, a booking system, dive-shop software, something else), the contact's name, email, and an optional phone. Every door that was the mail now links to `/get-set-up?from=<tag>`, through `setUpHref` in `src/lib/funnel.ts`: `FunnelCtas`, sign-in's "Need a shop?" line, `/about`'s work band (tag `about-work`) and `/onboard`'s closed door (tag `onboard-closed`). The tag is posted back as a hidden field and clamped by `eventSource`.
- **The action is public, so every guard is in it** (`src/app/get-set-up/actions.ts`). In order: a per-IP rate limit (`setupRequestByIp`, 5 an hour), the honeypot, validation (`parseSetupRequest`, `src/lib/setup-requests.ts`), and then the global cap. The global cap comes after the free checks so junk cannot drain it. It has two parts: the in-memory `setupRequestGlobal` bucket as a cheap first filter, then the real cap, `SETUP_REQUESTS_PER_HOUR` (30), counted in `setup_requests` over the last hour before each insert, because the bucket is per server instance. A tripped honeypot (the off-screen `website` field) gets the same thank-you redirect as a person and nothing else: no row, no mail, no event, only a count-only `setup_request.honeypot_tripped` log line. Every typed answer refuses control, format and line-separator characters (`isSingleLineText`), and the `setup_request_alert` kind refuses them again. A refusal hands back what was typed, field by field.
- **The request is a row first**, in `setup_requests`, which carries the funnel source and the reader's locale. The redirect to `/get-set-up/sent` follows the insert, and the mail and the event run in `after()`. The mail is the `setup_request_alert` notification kind to `ONBOARDING_EMAIL`, with Reply-To set to the requester. The event is `setup_requested` with its `source`. `notified_at` is set only once the mail has left, so a request whose mail failed is still on record and the founder digest counts it ([20261007-founder-metrics](20261007-founder-metrics.md)).
- **The thank-you page offers the demo**, tagged `setup-sent`. The form page does not: Send is that page's one primary.
- **`trial_started` is deleted.** `/onboard` opens only behind the owner's setup key, so the event counted the founder filling the form in. The funnel pair is now `demo_entered` and `setup_requested`.

## Alternatives considered

- **Keep the mail and add a subject template** — still no tag and no answers, and still depends on a mail client.
- **A third-party form service** — personal data in another processor, a new runtime dependency, and the same rate limit and spam work done somewhere we cannot test.
- **A CAPTCHA** — friction for every honest reader against a volume of spam nobody has seen yet. The honeypot and two limits are the first answer; a CAPTCHA is the next one if they fail.

## Consequences

- `setup_requests` holds personal data (name, email, optional phone) about a person who is not a diver of any shop. It is kept until someone asks for it to be removed, sits outside retention (`OUTSIDE_RETENTION` in `src/db/retention.test.ts`), is not part of any shop's export, and nothing tenant-scoped reaches it. No shop's erasure reaches it, and DiveDay has no shop-owner account erasure yet to hang it on, so a request to forget a requester is answered by hand with `deleteSetupRequestsByEmail` or `deleteSetupRequestsByPhone` (`src/db/funnel.ts`); whichever path erases an owner's account must call both when it exists. The alert mail's subject handles are declared to the notification erasure sweep (`notificationSubjectEmail` and `notificationSubjectPhone`).
- The per-IP limit is per instance while rate limiting runs on the in-memory store (ADR 20260801-distributed-rate-limit-store). This is accepted for a form whose worst case is mail to our own inbox; the global cap is counted in the table, so it holds across instances. Two requests in the same instant can both pass the count at 29, which is accepted.
- The alert labels the address "Email (unverified)": anyone can type anyone's address into the form, and Reply-To goes to it.
- Reopening self-serve sign-up (the earlier ADR's "revisit") now means pointing `setUpHref` at `/onboard`, or turning this form into an invite.
