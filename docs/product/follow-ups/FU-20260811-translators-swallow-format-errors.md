# FU-20260811-translators-swallow-format-errors — Decide whether the translators should throw outside production

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/diver-page-ui-refinements-rn50sm`, the copy-trim pass. Writing `src/i18n/icu-messages.test.ts` turned up a real bug that had been sitting in the bundle: `notifications.whatsappTemplate.body` is Meta's `{{1}}`/`{{2}}` positional syntax, which ICU reads as a malformed argument, so a Spanish shop's WhatsApp template registered in **English** while `templateLanguage` claimed Spanish. Nothing anywhere reported it.
- **Kind:** question
- **Effort:** S
- **Touches:** `src/i18n/messages.ts`, `src/i18n/staff-messages.ts`, `src/i18n/icu-messages.test.ts`

## What I noticed

Both `diverTranslator` (`src/i18n/messages.ts:68`) and `staffTranslator`
(`src/i18n/staff-messages.ts:47`) are built with `onError: () => {}`. A message that fails to
compile — a malformed `{count, plural, …}`, an unbalanced brace, an unescaped `{{` — therefore
renders `getMessageFallback()` (the English string, or the raw dotted key when there isn't one)
and raises nothing. No log line, no metric, no failing test unless a test happens to assert that
exact sentence.

That is the right behaviour on a diver's booking page at 6 AM: one bad string should cost one
sentence, not the page. It is the wrong behaviour everywhere else, and it is why the WhatsApp
template shipped broken for a Spanish shop: the English fallback *looked* fine in every place a
human or a spec ever looked.

`src/i18n/icu-messages.test.ts` now compiles and formats every message in every bundle in every
locale, so a malformed string fails CI. That closes the hole for strings that live in the bundle.
It does not close it for a value the *runtime* passes — a `{count}` handed a `Date`, a rich-text
tag a caller forgot — which still degrades silently in production and in dev alike.

## Why it isn't already done

Changing `onError` is a policy call about how DiveDay fails, not a copy fix, and this branch is a
copy trim. There are three defensible answers and I don't think an agent should pick:

1. **Leave it.** The new compile test covers the bundle; runtime-value mistakes are rare and the
   fallback is genuinely graceful. Cost: nothing, and the next one is found the same way this was.
2. **Throw when `NODE_ENV !== "production"`.** A missing tag or a wrong-typed value becomes a loud
   dev-server error and a red e2e run, and production is untouched. Cost: a bad string that only a
   rare surface reaches now breaks that surface in dev, which is the point but is also a
   behavioural change in a place agents iterate constantly.
3. **Keep swallowing, but count it.** Route the error through `src/lib/log.ts` with an `$.event`
   code so it lands in the observability registry (`infra/lib/observability.ts`) and can be
   alarmed. Cost: a new signal to name and thresholds to pick — a real decision, and the log line
   would carry the message text, which for a diver-facing string can include interpolated personal
   data unless it is redacted to the key alone.

My recommendation is 2 **and** 3, with the log line carrying the key only and never the formatted
message. But (3) touches the observability registry, which is a surface HD-owned thresholds sit on.

## Proposed change

In both `messages.ts` and `staff-messages.ts`, replace `onError: () => {}` with one shared handler
in a new `src/i18n/on-error.ts`:

- in production, `logEvent` with the key and `error.code`, and nothing else — never `error.message`,
  which embeds the formatted string;
- outside production, rethrow.

Then add the metric filter to `infra/lib/observability.ts` and regenerate the infra snapshot with
`pnpm test infra -u`.

I am **not** proposing that the two translators diverge — a staff string and a diver string should
fail the same way — and **not** proposing removing `getMessageFallback`, which is what makes an
untranslated key readable rather than blank.

## Prompt

```text
Read src/i18n/messages.ts, src/i18n/staff-messages.ts and src/i18n/icu-messages.test.ts, then
docs/product/follow-ups/FU-20260811-translators-swallow-format-errors.md, which states the problem
and three options with a recommendation.

Both translators are constructed with `onError: () => {}`, so an ICU formatting failure renders a
fallback silently. That hid a real bug (a WhatsApp template registering in English for a Spanish
shop) until a test that compiles every message was written. The constraint that makes this
non-obvious: swallowing is correct in production — one bad string must not blank a diver's booking
page — so the fix cannot simply be "throw".

Decide between the three options in the follow-up (leave it / throw outside production / log and
alarm), or implement the recommended combination:

- a shared handler in a new src/i18n/on-error.ts used by both translators;
- outside production, rethrow;
- in production, log through src/lib/log.ts with an $.event code carrying the message *key* and
  error code only, never the formatted message (it can embed a diver's name);
- if you add the production signal, register it in infra/lib/observability.ts and regenerate with
  `pnpm test infra -u`.

Done means: `pnpm check` green; a unit test proving a deliberately malformed message throws outside
production and returns the fallback inside it; and, if the log path landed, the infra snapshot
updated. Run `pnpm e2e waivers --reporter=line` — the waiver pages are the densest ICU surface and
are where a newly-loud error would first show. Delete
docs/product/follow-ups/FU-20260811-translators-swallow-format-errors.md as part of the change.
```
