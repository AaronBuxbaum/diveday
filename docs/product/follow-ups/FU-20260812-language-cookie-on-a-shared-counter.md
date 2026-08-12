# FU-20260812-language-cookie-on-a-shared-counter — Decide how long a language choice should outlive the person who made it

- **Status:** Open
- **Raised:** 2026-08-12 — branch `claude/shop-booking-updates-kko48a`, the language switcher
- **Kind:** question
- **Effort:** S
- **Touches:** `src/i18n/locale-cookie.ts`, `src/app/actions/set-locale.ts`, `docs/architecture/decisions/20260812-reader-chosen-language.md`

## What I noticed

A reader's language choice is a `diveday_locale` cookie with a one-year life
(`LOCALE_COOKIE_MAX_AGE`). That is right for the case it was built for: a diver who picks Spanish on
their own phone in July should still get Spanish in November, and being asked again every visit is
the failure the switcher replaced.

It is less obviously right for the two shared devices a dive shop actually runs.

- **The counter tablet.** A Spanish-speaking customer is handed the tablet, taps *español*, and the
  next staffer picks up a back office in Spanish. Recoverable in two taps from the same menu it was
  set in, and the options name themselves, so nobody is stranded — but it is a year-long change made
  by someone who does not work there.
- **The boat phone.** Same shape, worse timing: it happens at 07:00 with a manifest open.

A staff *session* is not the right scope either — a staffer who genuinely reads Spanish would have
to re-pick every sign-in, which is the bug this replaced, one layer in.

## Why it isn't already done

It is a policy call about a trade-off between two real people, not a technical gap, and the honest
answer probably depends on how shops actually use their devices — which nobody knows yet, because
no shop is live. Shipping the simple version and asking later seemed better than guessing at a
split rule now.

## Proposed change

Three options, in the order I would consider them:

1. **Leave it.** One year, both surfaces. Simplest, and the recovery is two taps in a menu that is
   already where staff go to sign out. This is my recommendation until a real shop complains.
2. **Split the lifetime by surface.** A choice made under `/shop/**` gets a session-length cookie;
   a choice made on a public `/s/**` page keeps the year. Justifiable — the diver is on their own
   device, the staffer usually is not — but it means the same control behaves differently in two
   places, which is a thing to explain rather than a thing to notice.
3. **Give staff a per-person language on their `people` row**, set in Settings, that outranks the
   cookie for signed-in staff. The most correct and the most work; it also duplicates the
   per-person notification locale column that already exists for a different purpose
   (ADR 20260731-per-person-notification-locale), so the two would need reconciling first.

## Prompt

```text
Read docs/product/follow-ups/FU-20260812-language-cookie-on-a-shared-counter.md, then
src/i18n/locale-cookie.ts, src/app/actions/set-locale.ts, src/i18n/request.ts, and
docs/architecture/decisions/20260812-reader-chosen-language.md.

The question is scope, not mechanism: a language choice made on a shop's shared counter tablet
currently lasts a year for whoever picks the device up next. Pick one of the three options in the
follow-up (leave it / split the lifetime by surface / a per-person staff language), implement it,
and amend the ADR's Consequences section to record the decision and why.

If you split by surface, the switcher's Server Action needs to know which surface called it — pass
it explicitly from the call site, never infer it from a referer header.

Checks: pnpm check, and pnpm e2e e2e/language.spec.ts --reporter=line. Delete this follow-up file
as part of the change.
```
