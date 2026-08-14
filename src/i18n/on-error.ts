import { log } from "@/lib/log";

/**
 * What both translators do when a message fails to compile or format.
 *
 * Before this, both were built with `onError: () => {}`. A malformed
 * `{count, plural, …}`, an unbalanced brace, an unescaped `{{`, or a runtime
 * value of the wrong type rendered `getMessageFallback()` — the English string,
 * or the raw dotted key when there isn't one — and raised nothing. No log line,
 * no metric, no failing test unless a spec happened to assert that exact
 * sentence.
 *
 * That is the right behaviour on a diver's booking page at 6 AM: one bad string
 * should cost one sentence, not the page. It is the wrong behaviour everywhere
 * else, and it is why `notifications.whatsappTemplate.body` shipped broken — it
 * is Meta's `{{1}}`/`{{2}}` positional syntax, which ICU reads as a malformed
 * argument, so a Spanish shop's WhatsApp template registered in **English**
 * while `templateLanguage` claimed Spanish. Nothing anywhere reported it, and
 * the English fallback looked fine in every place a human or a spec ever looked.
 *
 * So the two halves are split by where the failure can still be cheap:
 *
 * - **Outside production**, rethrow. A dev server, a unit test and an e2e run
 *   all fail loudly on a message this code cannot format, which is the only
 *   moment fixing it is free. `src/i18n/icu-messages.test.ts` already compiles
 *   every message in every bundle, so this covers what that cannot: a value the
 *   *runtime* passes — a `{count}` handed a `Date`, a rich-text tag a caller
 *   forgot.
 * - **In production**, swallow and count. The fallback still renders, and the
 *   event says a string is broken without saying which diver saw it.
 *
 * ## Why the log line carries so little
 *
 * `IntlError.message` embeds `originalMessage`, which for a diver-facing string
 * can contain interpolated personal data — a name, an email, a departure they
 * booked. So the line carries the error **code** and nothing else. That is
 * enough to alarm on ("messages started failing to format") and enough to date
 * the regression, and the bundle-wide compile test is what names the string.
 * A signal that leaks a diver's name into a log to save a grep is a bad trade.
 */

/** Production keeps rendering; everywhere else, a broken message is a failure. */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The shared `onError` for `diverTranslator` and `staffTranslator`.
 *
 * Deliberately one handler rather than two: a staff string and a diver string
 * are broken in the same way and should fail the same way. The asymmetry that
 * matters is production-vs-not, not audience.
 */
export function translatorOnError(error: unknown): void {
  if (!isProduction()) throw error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "UNKNOWN";
  log("i18n.message_format_failed", "warn", { code });
}
