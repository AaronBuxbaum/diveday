import { log } from "../log";

/**
 * The trace a Stripe call leaves when it *throws* rather than answers.
 *
 * Every adapter in this directory turns a request Stripe never answered -- a
 * network error, a timeout, a body that is not JSON -- into the same
 * `{ status: "failed" }` a refused request gets (or `unanswered` after a
 * mutation went out), and that is right for the caller: either way nothing
 * happened at Stripe that it can rely on. But in the back-office queue the two
 * read identically, and they are different errands: a 4xx is a request this
 * app built wrong, a throw is Stripe or the network being unreachable. This
 * line is how the second one is told apart.
 *
 * The payload is the operation and the error's *name* -- a code, never its
 * message, which can echo request detail -- matching
 * `email_inbound.read_failed`. Return values are untouched.
 */
export function logStripeRequestThrew(operation: string, error: unknown): void {
  log("stripe_api.request_threw", "warn", { operation, errorCode: errorCodeOf(error) });
}

/**
 * The name of what actually went wrong. The SDK wraps a failed request in its
 * own `StripeConnectionError`, keeping the thrown error as `detail`; that is
 * the one named, and its own deadline (`ETIMEDOUT`) reads as the
 * `TimeoutError` a fetch deadline would.
 */
function errorCodeOf(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  const detail = (error as { detail?: unknown }).detail;
  const cause = detail instanceof Error ? detail : error;
  if ((cause as { code?: unknown }).code === "ETIMEDOUT") return "TimeoutError";
  return cause.name;
}
