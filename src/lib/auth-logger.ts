import { log } from "@/lib/log";

/**
 * What DiveDay does with the errors Auth.js reports about itself.
 *
 * By default a wrong password arrives as `[auth][error] CredentialsSignin` on
 * the console at **error** level. That is the most ordinary event on a sign-in
 * form being reported as an incident: it was 1 of the 10 lines a
 * `level:error,fatal,warn` search returned during the issue #517 triage, and
 * because its floor is "however many people fumbled a password today", no
 * count of error lines could ever be alarmed on.
 *
 * So that one cause becomes a counted `warn`, and nothing else moves. The
 * failure this must not cause is a genuine auth fault going quiet, so every
 * other error keeps the level and the destination it had.
 *
 * **No email address, no IP, no error message.** A credentials error quotes
 * the identifier it refused, and AGENTS.md's no-PII-in-logs rule is exactly
 * about keeping that out of the stream. The refusal is counted, never
 * attributed — which is enough, because what anyone needs to see is a *rate*
 * (`SignInRefusals` in `infra/lib/observability.ts`), and a rate needs no
 * names. Attribution lives in the rate limiter, which already refuses per IP
 * and per email.
 */

/**
 * Auth.js v5 errors extend `AuthError`, which carries a `type` naming the
 * specific failure; a refused password is `CredentialsSignin`. Read
 * defensively rather than with `instanceof`: the logger is handed whatever the
 * library throws, and a shape that does not match must fall through to being
 * reported as a real error rather than being silently swallowed.
 */
export function isCredentialsRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "CredentialsSignin"
  );
}

export type AuthErrorSink = (...parts: unknown[]) => void;

/**
 * The `logger.error` Auth.js calls. `reportUnexpected` is the console sink,
 * injectable so a test can assert what reaches it without capturing global
 * console output.
 */
export function logAuthError(error: Error, reportUnexpected: AuthErrorSink = console.error): void {
  if (isCredentialsRefusal(error)) {
    log("auth.sign_in_refused", "warn");
    return;
  }
  // Deliberately not `log()`: an Auth.js error carries a message and a stack,
  // and the structured logger takes a context of scalars. This is the default
  // logger's own behaviour, kept.
  reportUnexpected("[auth][error]", error);
}
