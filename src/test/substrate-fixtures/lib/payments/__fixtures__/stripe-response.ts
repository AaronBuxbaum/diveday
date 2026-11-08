/**
 * A Stripe answer as `fetch` returns it, for a test's fake: the SDK reads a
 * real `Response` (status, headers, body), not an object shaped like one.
 */
export function stripeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
