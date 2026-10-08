/**
 * **Why a processor erasure is still owed, as a code** (issue #1865).
 *
 * `processor_erasure_obligations.last_error` is the ledger's detail — an HTTP
 * status and Stripe's error code, or one of the fixed strings below — kept for
 * whoever reads the row or the log. Settings reads the code this returns and
 * words it from the bundle, so Stripe's own English never reaches the screen.
 *
 * The fixed strings live here so the writers and this reader cannot drift: a
 * writer that spelled one differently would fall through to the fallback.
 */
export const ERASURE_FAILURE_DETAIL = {
  /** The snapshotted account no longer belongs to the obligation's shop. */
  accountNotOwned: "stripe account not owned by this shop",
  /** The deployment has no Stripe key, so no call went out. */
  notConfigured: "stripe not configured",
  /** Stripe answered 2xx without the deleted-object envelope. */
  notConfirmed: "stripe did not report the customer deleted",
} as const;

export type ErasureFailure = "account_not_owned" | "refused" | "unreachable" | "not_confirmed";

const HTTP_STATUS = /^HTTP (\d{3})\b/;

/**
 * Classify a `last_error`. `null` for a row that has not failed.
 *
 * - `refused`: Stripe answered 4xx (other than 429): retrying the same call
 *   will not help on its own.
 * - `unreachable`: Stripe was busy (429, 5xx), the request never landed (a
 *   network error, which the provider records as the error's own message), or
 *   the deployment cannot reach Stripe at all. A retry may clear it.
 * - `not_confirmed`: the fallback, and the one claim true of every failure.
 */
export function erasureFailureOf(lastError: string | null): ErasureFailure | null {
  if (!lastError) return null;
  if (lastError === ERASURE_FAILURE_DETAIL.accountNotOwned) return "account_not_owned";
  if (lastError === ERASURE_FAILURE_DETAIL.notConfigured) return "unreachable";
  if (lastError === ERASURE_FAILURE_DETAIL.notConfirmed) return "not_confirmed";
  const status = HTTP_STATUS.exec(lastError);
  if (!status) return "unreachable";
  const code = Number(status[1]);
  if (code === 429 || code >= 500) return "unreachable";
  if (code >= 400) return "refused";
  return "not_confirmed";
}
