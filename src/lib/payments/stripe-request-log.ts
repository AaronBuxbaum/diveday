import { log } from "../log";

/**
 * The trace a Stripe call leaves when it *throws* rather than answers.
 *
 * Every adapter in this directory turns a thrown request -- a network error, a
 * timeout, a body that is not JSON -- into the same `{ status: "failed" }` a
 * refused request gets, and that is right for the caller: either way nothing
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
  log("stripe_api.request_threw", "warn", {
    operation,
    errorCode: error instanceof Error ? error.name : "unknown_error",
  });
}
