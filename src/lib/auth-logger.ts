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
 * Auth.js's `logger.error`: one known cause downgraded, everything else
 * structured.
 *
 * A refused credential is a `warn` with a counter behind it. Every other
 * Auth.js failure stays at `error` and becomes an `auth.error` line through
 * `log()` — so it is JSON like the rest of the app's own errors, queryable in
 * CloudWatch, and counted by the `AppErrors` metric filter (`$.level = "error"`),
 * which the ANSI-coloured line it replaces never was. A misconfigured provider
 * firing three times in a quarter hour now pages someone.
 *
 * **What is shipped and what is not.** The structured line carries the `type`
 * (an Auth.js code, part of its public API), Auth.js's own `message`, and the
 * *class name* of a wrapped cause. It does not carry the cause's message or
 * stack: `CallbackRouteError` and friends wrap whatever our own code threw, and
 * a database driver's message can echo the value that caused it. Those still
 * print to `console.error` in Auth.js's own format, so a developer reading
 * Vercel's log view loses nothing — they just do not leave the log drain the
 * deployment already had.
 */
export function logAuthError(error: Error): void {
  // The same discrimination the default logger makes: an `AuthError` carries a
  // stable `type`, anything else only has a class name.
  const type = read(error, "type") ?? error.name;
  if (type !== CREDENTIALS_SIGNIN) {
    log("auth.error", "error", {
      type,
      message: error.message,
      cause: causeName(error),
    });
    defaultAuthErrorDetail(error);
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

/** The class of the error Auth.js wrapped, when it wrapped one. Never its text. */
function causeName(error: Error): string | null {
  const cause = error.cause;
  if (cause && typeof cause === "object" && "err" in cause && cause.err instanceof Error) {
    return cause.err.name;
  }
  return null;
}

/**
 * The cause and stack half of `@auth/core`'s built-in `logger.error`.
 *
 * Mirrored from `@auth/core/lib/utils/logger.js` (0.41.3) because that module
 * exports `setLogger`, not the default instance it builds, so an override
 * cannot call through to it. The `[auth][error]` headline it used to print is
 * now the structured line above; what stays here is the debugging detail, which
 * goes to the console only — deliberately, so an error message we did not
 * author never reaches CloudWatch. If Auth.js changes its format this diverges
 * cosmetically and nothing else.
 */
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function defaultAuthErrorDetail(error: Error): void {
  const cause = error.cause;
  if (cause && typeof cause === "object" && "err" in cause && cause.err instanceof Error) {
    const { err, ...data } = cause as { err: Error } & Record<string, unknown>;
    console.error(`${RED}[auth][cause]${RESET}:`, err.stack);
    console.error(`${RED}[auth][details]${RESET}:`, JSON.stringify(data, null, 2));
  } else if (error.stack) {
    console.error(error.stack.replace(/.*/, "").substring(1));
  }
}
