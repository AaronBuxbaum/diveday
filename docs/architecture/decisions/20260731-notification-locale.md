# 20260731-notification-locale — Localize outbound email and SMS

- **Status:** Superseded by [20260731-per-person-notification-locale](20260731-per-person-notification-locale.md)
- **Date:** 2026-07-31

## Context

[20260729-diver-copy-localization](20260729-diver-copy-localization.md) and
[20260730-staff-copy-localization](20260730-staff-copy-localization.md) localized every page a
diver or staff member renders in a browser. Asked directly "have we ensured no hardcoded English
in messages coming from the backend and displayed to the user?", the honest answer was no: every
transactional email `src/lib/notifications/email.ts` sends (13 templates — booking confirmation,
waiver request, trip reminders, recap, account lifecycle, staff invite, …) and the pre-trip SMS
`src/db/reminders.ts` composes are hardcoded English, with every date/time formatted against a
literal `"en-US"`. `src/lib/readiness-summary.ts`'s `REMINDER_ACTION` map already carried an
honest comment flagging this as deferred, separate work — this ADR is that work.

The reason it was deferred rather than swept in with the page-level work: **there is no
request to negotiate a locale from.** `requestLocale()` reads `Accept-Language` off the current
HTTP request; a reminder fires from a cron job, a waiver request fires from a staff action on a
booking that isn't the diver's own request, and a webhook-triggered recap has no diver request in
flight at all. Something else has to supply the locale.

## Decision

**The shop's stored `default_locale` is the locale for every notification about that shop**,
exactly the signal the calendar feed (`src/app/calendar/[token]/route.ts`) already uses for the
same reason (`toDiverLocale(shop.defaultLocale)`, no request to negotiate from). DiveDay stores no
per-person language preference, so the shop's own locale is the only signal available at send
time — a Cozumel shop's diver gets Spanish email the same way they get a Spanish schedule page.

**Every `Notification` variant gains a `locale: DiverLocale` field**, except `new_account_alert`
(lands in the founder's internal alert inbox, not a customer's — stays English, same as an
internal ops tool would). The caller constructing the notification already has (or can cheaply
fetch) the shop row, so this is one more field alongside `shopName`/`timezone`, not a new query.

**`email.ts` and `src/db/reminders.ts`'s `reminderSmsBody` resolve their own text**, via
`diverTranslator(locale)`, rather than returning codes for something else to translate. This is a
deliberate, narrow exception to "`src/lib`/`src/db` return codes, `src/app`/`src/components` choose
words": these two are the *terminal* renderer for their content — there is no downstream React
component that picks words for an email body or an SMS payload, so the translation has to happen
here or nowhere. `src/lib/night-before-brief.ts` (the brief text shared by both channels) follows
the same rule for the same reason. `email.ts` and `night-before-brief.ts` carry an
`// i18n-exempt-file` marker pointing at this ADR — `email.ts`'s `text`/`html` return fields are
exactly the property-name shape `check-domain-strings.mjs` watches for, and would otherwise read as
a violation of the rule its own exemption documents. `reminders.ts` needs no marker: its
notification-building code has no `message`/`label`/`text`/`reason`/`summary`-named property for
the scanner to match in the first place.

**`REMINDER_ACTION` becomes a code list, not a phrase map** — `reminderReadiness()` now returns
`ReadinessBlockerCode[]`, resolved by a new `src/i18n/reminder-labels.ts` the same way every other
domain code in this codebase resolves (`readiness-labels.ts`, `rental-labels.ts`, …).

**Lists compose through `Intl.ListFormat`**, not string concatenation — the night-before brief's
"water around X°C, visibility near Y m, and calm" clause, same approach `rentalFitLineText`
already established.

## Alternatives considered

- **Negotiate from the recipient's last-known `Accept-Language`** — rejected; DiveDay stores no
  such thing per person, and inferring one from a stale header on an unrelated past request is a
  worse signal than the shop's own declared locale, not a better one.
- **A per-notification locale override param threaded from the request when one exists** (e.g. a
  staff-triggered resend) — rejected as unnecessary complexity; the shop's locale is right in both
  cases (a staff resend is still about that shop's diver), so there's no case that needs a second
  source of truth.
- **Leave `new_account_alert` on the same mechanism as everything else** — rejected; it has no
  diver or shop-owner recipient to speak to in their language, it goes to DiveDay's own team.

## Consequences

- Every notification call site needs the shop row (for `defaultLocale`) at the point it builds the
  `Notification` object — already true everywhere except the handful of account-lifecycle flows
  (`forgot-password`, `reset-password`, staff invite) that need one added lookup.
- `pnpm check:locale` grows to cover the new `notifications.*`/`reminderAction.*` diver-bundle
  namespace; `pnpm check:domain-strings` gains three file-level exemptions with this ADR as the
  stated reason.
- Spanish transactional email/SMS carries the same native-review caveat already recorded for the
  rest of Spanish copy in `docs/product/human-decisions.md`.
- Revisit if DiveDay ever stores a per-person language preference — at that point a diver's own
  preference should outrank the shop's default, and this ADR's "shop locale is the only signal"
  premise no longer holds.
