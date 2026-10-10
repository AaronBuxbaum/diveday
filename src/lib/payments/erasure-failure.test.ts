import { describe, expect, it } from "vitest";
import { ERASURE_FAILURE_DETAIL, erasureFailureOf } from "./erasure-failure";

/**
 * `processor_erasure_obligations.last_error` is the ledger's own detail; what
 * an owner reads is one of these codes in shop words (issue #1865). Every
 * value a writer puts in the column is classified here, so the raw provider
 * string never reaches the screen.
 */
describe("erasureFailureOf", () => {
  it("answers nothing for an attempt that has not failed", () => {
    expect(erasureFailureOf(null)).toBeNull();
    expect(erasureFailureOf("")).toBeNull();
  });

  it("names an account that no longer belongs to the shop", () => {
    expect(erasureFailureOf(ERASURE_FAILURE_DETAIL.accountNotOwned)).toBe("account_not_owned");
  });

  it("reads a deployment with no Stripe key as Stripe not answering", () => {
    expect(erasureFailureOf(ERASURE_FAILURE_DETAIL.notConfigured)).toBe("unreachable");
  });

  it("reads a request that never got an answer as Stripe not answering", () => {
    expect(erasureFailureOf(ERASURE_FAILURE_DETAIL.unanswered)).toBe("unreachable");
  });

  it.each(["HTTP 400: resource_missing", "HTTP 401", "HTTP 403: account_invalid"])(
    "reads %s as Stripe refusing",
    (detail) => {
      expect(erasureFailureOf(detail)).toBe("refused");
    },
  );

  it.each([
    "HTTP 429: rate_limit",
    "HTTP 500",
    "HTTP 503: api_error",
    "fetch failed",
    "network error",
  ])("reads %s as Stripe not answering", (detail) => {
    expect(erasureFailureOf(detail)).toBe("unreachable");
  });

  it("falls back to an unconfirmed delete, which is the one claim always true of a failure", () => {
    expect(erasureFailureOf(ERASURE_FAILURE_DETAIL.notConfirmed)).toBe("not_confirmed");
    expect(erasureFailureOf("HTTP 302")).toBe("not_confirmed");
  });
});
