# 20261007-setup-request-form — "Get set up" is a public form, not a mail

- **Status:** Accepted
- **Date:** 2026-10-07
- **Amends:** [20260925-shops-are-set-up-by-hand](20260925-shops-are-set-up-by-hand.md) (its "Get set up" mail, and the "contact form" alternative it declined)
- **Amended by:** [20261009-single-use-setup-links](20261009-single-use-setup-links.md) — the onboarding mail carries the request's single-use setup link

## Context

Since 2026-09-25 every shop is set up by hand, and every public "Get set up" button was a `mailto:` to `onboarding@dive.day`. A mail link loses most of the people who press it: there may be no mail client on the device, the reader has to work out what to say, and the funnel tag is dropped, so the founder could not tell which page sent a request. The questions the first set-up call needs (where the shop is, whether it runs a boat, what it uses today) came back only if the reader happened to write them. The earlier ADR turned down a contact form as "a new surface with its own rate limit, spam and storage". Those costs are small next to a door most readers do not get through.

## Decision

- **One public page, `/get-set-up`**, with seven asks in the order a set-up call takes them: shop name, town or region, "do you run a boat?" (yes or no), what the shop uses today (paper, spreadsheets, a booking system, dive-shop software, something else), the contact's name, email, and an optional phone. Every door that was the mail now links to `/get-set-up?from=<tag>`, through `setUpHref` in `src/lib/funnel.ts`: `FunnelCtas`, sign-in's "Need a shop?" line, `/about`'s work band (tag `about-work`) and `/onboard`'s closed door (tag `onboard-closed`). The tag is posted back as a hidden field and clamped by `eventSource`.
- **The action is public, so every guard is in it** (`src/app/get-set-up/actions.ts`). In order: a per-IP rate limit (`setupRequestByIp`, 5 an hour), the honeypot, validation (`parseSetupRequest`, `src/lib/setup-requests.ts`), and then the global cap. The global cap comes after the free checks so junk cannot drain it. It has two parts: the in-memory `setupRequestGlobal` bucket as a cheap first filter, then the real cap, `SETUP_REQUESTS_PER_HOUR` (30), counted in `setup_requests` over the last hour before each insert, because the bucket is per server instance. A tripped honeypot (the off-screen `website` field) gets the same thank-you redirect as a person and nothing else: no row, no mail, no event, only a count-only `setup_request.honeypot_tripped` log line. Every typed answer refuses control, format and line-separator characters (`isSingleLineText`), and the `setup_request_alert` kind refuses them again. A refusal hands back what was typed, field by field.
- **The request is a row first**, in `setup_requests`, which carries the funnel source and the reader's locale. The redirect to `/get-set-up/sent` follows the insert, and the mail and the event run in `after()`. The mail is the `setup_request_alert` notification kind to `ONBOARDING_EMAIL`, with no Reply-To: the requester's address is in the body, labelled unverified (amendment 2026-10-25). The event is `setup_requested` with its `source`. `notified_at` is set only once the mail has left, so a request whose mail failed is still on record and the founder digest counts it ([20261007-founder-metrics](20261007-founder-metrics.md)).
- **The thank-you page offers the demo**, tagged `setup-sent`. The form page does not: Send is that page's one primary.
- **`trial_started` is deleted.** `/onboard` opens only behind the owner's setup key, so the event counted the founder filling the form in. The funnel pair is now `demo_entered` and `setup_requested`.

## Alternatives considered

- **Keep the mail and add a subject template** — still no tag and no answers, and still depends on a mail client.
- **A third-party form service** — personal data in another processor, a new runtime dependency, and the same rate limit and spam work done somewhere we cannot test.
- **A CAPTCHA** — friction for every honest reader against a volume of spam nobody has seen yet. The honeypot and two limits are the first answer; a CAPTCHA is the next one if they fail.

## Consequences

- `setup_requests` holds personal data (name, email, optional phone) about a person who is not a diver of any shop. It was kept until someone asked for it to be removed; since the 2026-10-11 code review (item 14) it is pruned 365 days after it was made (`RETENTION_DAYS.setup_requests`, with its setup link by cascade), and it is still not part of any shop's export, and nothing tenant-scoped reaches it. No shop's erasure reaches it, and DiveDay has no shop-owner account erasure yet to hang it on, so a request to forget a requester is answered by hand with `deleteSetupRequestsByEmail` or `deleteSetupRequestsByPhone` (`src/db/funnel.ts`); whichever path erases an owner's account must call both when it exists. The alert mail's subject handles are declared to the notification erasure sweep (`notificationSubjectEmail` and `notificationSubjectPhone`).
- The per-IP limit is per instance while rate limiting runs on the in-memory store (ADR 20260801-distributed-rate-limit-store). This is accepted for a form whose worst case is mail to our own inbox; the global cap is counted in the table, so it holds across instances. Two requests in the same instant can both pass the count at 29, which is accepted.
- The alert labels the address "Email (unverified)": anyone can type anyone's address into the form, so it is never a header (amendment 2026-10-25).
- Reopening self-serve sign-up (the earlier ADR's "revisit") now means pointing `setUpHref` at `/onboard`, or turning this form into an invite.

## Amendment 2026-10-22: which system, and one way to ask

The market sheet of 2026-10-22 (item 5). The pricing FAQ answered "What do I have to do to get set up?" with a mail address, and every switching page ended on a `mailto:switch@dive.day` link, so the site had three ways to ask for a shop. The form never asked which booking system or shop software, so the thank-you page could only link the list of guides and the onboarding mail could not say "FareHarbor".

- **"Which one?"** follows "A booking system" or "Dive-shop software", and only those, offering each switching guide's system and "Another one". It is optional. The answer is a guide's slug in the new nullable column `setup_requests.current_system_guide`; `parseSetupRequest` keeps it only after one of those two answers and only for a registered guide, so a crafted value or one left behind by a changed answer is stored as null.
- **A switching guide's door preselects its system.** `/get-set-up?from=switching-<slug>[-mid|-close|-concierge]` starts with that guide's answer and system checked (`setupPreselection`, `guideOfSource` in `src/lib/funnel.ts`).
- **The thank-you page links that system's guide** (`?guide=<slug>` beside `?uses=`), and the onboarding mail reads "Uses today: a booking system, FareHarbor". The `setup_request` alert accepts only a registered guide's slug.
- **The concierge's door on every switching page is the form** (`SwitchingConcierge` takes a tag: `switching-spreadsheet-concierge`, `switching-<slug>-concierge`; on the hub the offer is the closing band's support line since the 2026-10-24 visual review, B15), and so is the FareHarbor guide's website offer. `switch@dive.day` is no longer linked anywhere. The pricing FAQ's set-up answer names the form.

## Amendment 2026-10-25: no Reply-To from an unverified address

Issue 2834. The alert set Reply-To to the address typed into the public form, on a mail that carries the request's single-use setup link. Nothing has verified that address, so a quoted reply sent the link, under a DiveDay mail, to whoever typed it. The alert now sets no Reply-To. The address stays in the body as "Email (unverified)", and the founder writes a new mail to it, without the link, once they have spoken to the shop. Verifying the address by click-to-confirm before it becomes a header was considered and not built: it adds a step for the requester to protect one reply path the founder can type by hand.
