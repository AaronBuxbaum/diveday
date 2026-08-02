# 20260731-per-person-notification-locale — Write to a diver in the language they told us they read

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

[20260731-notification-locale](20260731-notification-locale.md) localized every transactional email
and SMS DiveDay sends, and picked **the shop's `default_locale`** as the language for all of them.
Its reasoning was sound at the time and is worth quoting rather than paraphrasing: "DiveDay stores
no per-person language preference, so the shop's own locale is the only signal available at send
time." Its "Alternatives considered" section then explicitly rejected the thing this record does:

> **Negotiate from the recipient's last-known `Accept-Language`** — rejected; DiveDay stores no
> such thing per person, and inferring one from a stale header on an unrelated past request is a
> worse signal than the shop's own declared locale, not a better one.

That rejection had two halves. The first half ("stores no such thing") was a statement about the
schema, and it is the half this record changes. The second half ("a stale header on an unrelated
past request") is a real objection and survives — it is why the capture rule below is as narrow as
it is.

The ADR named its own trigger in its final consequence:

> Revisit if DiveDay ever stores a per-person language preference — at that point a diver's own
> preference should outrank the shop's default, and this ADR's "shop locale is the only signal"
> premise no longer holds.

That trigger has fired. Persona 5 (Ingrid, `docs/product/personas.md`) is the concrete case: a
German diver booking with a Cozumel shop gets her confirmation, her waiver request, her night-before
brief, and her recap in Spanish, because the shop declared `es-ES`. She read the booking form in
English — her own browser said so — and DiveDay threw that away.

## Decision

**`people.locale` (nullable `text`) records the language a diver reads, and outranks the shop's
`default_locale` at send time.** Null keeps the previous behaviour exactly: the shop's locale, the
way every notification worked before this column existed. Nothing about the shop-locale fallback,
the `Notification.locale` field, or the terminal-renderer exception in `email.ts`/`reminders.ts` /
`night-before-brief.ts` changes — only where the value comes from when DiveDay has a better one.

**It is written only from a request the diver made themselves.** That is the whole safety property,
and it answers the surviving half of the original ADR's objection. The capture points are the four
places where the HTTP request in flight is unambiguously the diver's own:

- a public booking submitted from the shop's schedule page (`bookSpot`, `actor: "public"`), for the
  **lead booker only** — every other party member's details were typed *by* the lead, so the header
  says nothing about them;
- a waiver draft-save or signature at `/waivers/[token]`;
- any action at `/ready/[token]` (captured once in that file's `contextFor` chokepoint);
- a photo upload or review at `/recap/[token]`.

Each of those is a bearer capability the diver holds, or a public form they filled in. A
staff-triggered action — issuing a waiver from the roster, resending a confirmation, importing a
CSV, adding a walk-in at the counter — carries the *staff* member's `Accept-Language` and must never
write this column. A front-desk agent in Cozumel booking a German walk-in would otherwise stamp
`es-ES` onto that diver permanently, which is worse than the shop default it replaced: the shop
default is an honest guess, a staff header is a confident wrong answer.

**The rule is enforced by shape, not by discipline.** The write lives behind
`recordDiverOwnLocale` in `src/db/people.ts` (and `recordDiverOwnLocaleForBooking`, for the recap
link, which resolves a booking id to its person), whose doc comment states the constraint and why.
It is deliberately *not* an optional `locale` parameter on `findOrCreatePerson` — that function is
the shared identity path for booking, wait-list, walk-ins and the CSV importer, and a parameter
there is something any of those callers could reach for without noticing what they were asserting.

**Only a genuinely negotiated header is stored.** `requestLocale()` always answers with something,
because a page always has to render; when the header matches nothing it answers with the *shop's*
locale. That fallback is not evidence about the visitor. So a new
`firstHandLocale()` / `requestFirstHandLocale()` pair (`src/i18n/negotiate.ts`, `src/i18n/request.ts`)
returns `DiverLocale | null` and answers null exactly where `requestLocale` would have fallen back.
`recordDiverOwnLocale` takes `DiverLocale | null`, never a raw header, so an attacker-controllable
`Accept-Language` cannot reach the column; null is a no-op, never a clear.

**The last first-hand signal wins.** People change phones, travel, and switch their device language.
The most recent request a diver made themselves is the best available evidence, so a later capture
overwrites an earlier one. A null never overwrites anything.

**Send time reads through one helper**, `recipientLocale(personLocale, shopDefaultLocale)` in
`src/lib/notifications/index.ts`: the person's value if DiveDay still carries a bundle for it,
otherwise the shop's. Every notification *addressed to a diver* passes the recipient's locale —
booking confirmation (fresh, rescheduled, and staff-resent), waiver request, wait-list invite,
last-minute deal, both trip-reminder cadences and the SMS that accompanies them. Notifications
addressed to **staff or to the shop's own inbox** — the staff invite, the course-lead notification,
and every account-lifecycle email (`welcome`, `email_verification`, `password_reset_request`,
`password_changed`) — keep the shop's locale and never read `people.locale`, even where their query
already joins `people`. `new_account_alert` stays English, unchanged.

**`people.locale` does not travel through CSV export or import.** It is an inferred signal DiveDay
observed first-hand, not a fact the shop entered and not one an incumbent system's export can vouch
for. Accepting one from a CSV would be precisely the "stale header from an unrelated past request"
the original ADR was right to reject, and it would let an import silently overwrite a real signal.
Omitting it from the export also keeps one more attribute of a person out of a file that gets
emailed around. A re-imported person simply reads as null and falls back to the shop's locale —
the pre-existing behaviour.

## Alternatives considered

- **Leave it as the shop's locale (the status quo, 20260731-notification-locale).** Rejected on the
  evidence its own consequence section asked for: the premise "the shop's locale is the only signal
  available" stops being true the moment a column exists, and Ingrid is a real, common case rather
  than an edge one. Every shop with international divers has this problem, and it is invisible to
  the shop — nobody emails to say "your confirmation was in the wrong language".
- **Ask the diver to pick a language.** Rejected; it contradicts
  [20260729-diver-copy-localization](20260729-diver-copy-localization.md)'s standing decision that
  DiveDay does not ask — no switcher, no `/es/` URL. The device already answered the question, and
  adding a form field to re-ask it is worse experience for the same information.
- **Capture on any request that resolves to a person, including staff surfaces.** Rejected — this
  is the failure mode the whole design is arranged against. It is also the version that is easy to
  write by accident, which is why the write is a narrowly-named function rather than a parameter.
- **Store the raw `Accept-Language` header and negotiate at send time.** Rejected; it persists
  attacker-controlled text on a personal-data row for no benefit, and defers a decision that is
  cheaper and safer to make once, at capture, against a closed enum.
- **Overwrite only when the column is null (first signal wins).** Rejected; it fossilizes whatever
  device the diver happened to use first, and it makes the wrong answer permanent in the very case
  we most want to be self-correcting — a diver whose locale was mis-captured has no way to fix it
  except by making another first-hand request, which is exactly what last-write-wins honours.
- **Carry the locale in export/import for round-trip fidelity.** Rejected, as above: an imported
  locale is not first-hand, and null already round-trips to the identical rendered result.

## Consequences

- [20260731-notification-locale](20260731-notification-locale.md) is superseded by this record. Its
  localization work — the `Notification.locale` field, `diverTranslator` in `email.ts`, the
  `REMINDER_ACTION` code list, `Intl.ListFormat`, the `// i18n-exempt-file` markers, the
  English-only `new_account_alert` — all stands unchanged. Only its "the shop's locale is the only
  signal" premise is replaced.
- A diver's language is now personal data on `people`, alongside their email, phone, and emergency
  contact. It is covered by the same soft-delete, shop scoping, and export rules as the rest of that
  row (minus the export, per above), and warrants the `security-reviewer` pass AGENTS.md mandates
  for rows holding personal data.
- A shop can no longer assume every diver on a trip gets the same email text. Anything that reads
  as "what did we send them" for staff should render from the delivery record, not by re-composing
  in the staff member's own language.
- The public booking form captures for the lead booker only, so a party of four books with one
  recorded locale and three nulls. Those three converge on their own the first time each opens their
  waiver or readiness link.
- A staff member sharing a shop tablet with a diver (a counter booking driven through the public
  page, a waiver signed on a shop iPad) records the *tablet's* language. This is a known, accepted
  imprecision: it is no worse than the shop default it replaces, and last-write-wins means the
  diver's own next visit corrects it. If it turns out to matter, the fix is a device-level signal,
  not a wider capture rule.
- `pnpm check:locale`, `pnpm check:copy`, and the diver/staff bundles are unaffected — this changes
  which bundle is selected, never what is in one.
