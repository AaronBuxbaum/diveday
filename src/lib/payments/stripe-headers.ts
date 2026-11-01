/** Headers shared by connected-account Stripe form requests. */
export function connectedAccountHeaders(
  secretKey: string,
  stripeAccountId: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Account": stripeAccountId,
  };
}
