import { log } from "@/lib/log";

/**
 * What Auth.js writes to the logs, and at what level.
 *
 * Auth.js catches every error inside its own request handler and hands it to
 * `logger.error`, whose default implementation prints one ANSI-coloured
 * `[auth][error] <Type>: <message>` line to `console.error`. That is right for
 * a misconfigured provider and wrong for the single most ordinary thing that
 * happens on a sign-in form: `CredentialsSignin` is what
 * `@auth/core/lib/actions/callback` throws when `authorize` returns null — a
 * mistyped password — and it was arriving at `error` level like everything
 * else.
 *
 * The cost was never the line, it was what the line did to the search that
 * finds real problems. The production triage in issue #517 started from
 * `level:error,fatal,warn` over 24 hours, got ten results, and one of them was
 * somebody fumbling a password: a 10% false-positive rate on the query an
 * operator runs when something is wrong, and a floor under the `error` count
 * that no alarm can be set below.
 *
 * **A failed sign-in is both noise and signal, so this is a downgrade plus a
 * count, never a deletion.** One person mistyping a password is a `warn`; a
 * burst of them is credential stuffing, and it is *more* visible than before
 * rather than less, because `auth.sign_in_refused` is now a structured event
 * code with a metric filter and a rate alarm behind it
 * (`SignInRefusals` in `infra/lib/observability.ts`). Do not silence it, and do
 * not filter it at the CloudWatch end — a filter there would leave the noisy
 * line in Vercel's own log view, which is where that triage was actually done.
 */

/**
 * `CredentialsSignin.type` from `@auth/core/errors`, as a literal.
 *
 * Deliberately not imported. `next-auth`'s entry point reaches for
 * `next/server`, which does not resolve under Vitest's node environment, so
 * importing the class here would make this module — the one piece of the auth
 * path that is pure and worth unit-testing — untestable. It would also make the
 * check `instanceof`-shaped, and a second physical copy of `@auth/core` in the
 * dependency graph would then silently turn the downgrade off and put the noisy
 * line back with nothing failing. Auth.js sets `type` on every `AuthError` from
 * a static that is part of its public API (it is the string in the
 * `?error=` redirect param), so comparing it is the stable read.
 */
const CREDENTIALS_SIGNIN = "CredentialsSignin";

/**
 * Auth.js's `logger.error`, with one known cause downgraded.
 *
 * Everything that is not a refused credential keeps its current level *and its
 * current destination* — the console formatting below is a faithful copy of
 * `@auth/core`'s own default, because supplying a `logger.error` replaces the
 * built-in one outright and there is no way to delegate back to it. A real
 * Auth.js failure therefore reads in Vercel's log view exactly as it always
 * has, stack and cause included. Structuring those through `log()` too would be
 * a further improvement and a different decision: it would ship an error
 * message we do not author to CloudWatch, and Auth.js wraps adapter and
 * callback errors whose messages can carry the values that caused them.
 */
export function logAuthError(error: Error): void {
  // The same discrimination the default logger makes: an `AuthError` carries a
  // stable `type`, anything else only has a class name.
  const type = read(error, "type") ?? error.name;
  if (type !== CREDENTIALS_SIGNIN) {
    defaultAuthErrorLine(error, type);
    return;
  }
  // No address, no IP, no password — AGENTS.md forbids PII in logs, and this
  // line is written on a path anyone on the internet can reach, so anything
  // taken off the attempt would be attacker-chosen text at volume. `code` is
  // the one field Auth.js documents as client-safe: it is put in the redirect
  // URL's query string, so it already cannot hint at anything sensitive.
  // The code is a literal, not a constant, and every other `log()` call in this
  // repo is too: `infra/lib/observability.test.ts` greps `src/` for the exact
  // strings its metric filters match, so a code hidden behind an identifier is
  // a filter that silently counts zero forever with no test to notice.
  log("auth.sign_in_refused", "warn", { code: read(error, "code") ?? null });
}

/** A string property of an error object, or undefined if it carries no such thing. */
function read(error: Error, key: "type" | "code"): string | undefined {
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * `@auth/core`'s built-in `logger.error`, reproduced.
 *
 * Mirrored from `@auth/core/lib/utils/logger.js` (0.41.3) because that module
 * exports `setLogger`, not the default instance it builds, so an override
 * cannot call through to it. If Auth.js changes its format, this diverges
 * cosmetically and nothing else — the level and the stream are the parts that
 * matter, and both are pinned by `auth-logger.test.ts`.
 */
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function defaultAuthErrorLine(error: Error, type: string): void {
  console.error(`${RED}[auth][error]${RESET} ${type}: ${error.message}`);
  const cause = error.cause;
  if (cause && typeof cause === "object" && "err" in cause && cause.err instanceof Error) {
    const { err, ...data } = cause as { err: Error } & Record<string, unknown>;
    console.error(`${RED}[auth][cause]${RESET}:`, err.stack);
    console.error(`${RED}[auth][details]${RESET}:`, JSON.stringify(data, null, 2));
  } else if (error.stack) {
    console.error(error.stack.replace(/.*/, "").substring(1));
  }
}
