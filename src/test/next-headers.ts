/**
 * A stub for `next/headers`, for a unit test that renders a Server Component
 * or calls a Route Handler outside a request.
 *
 * It exists because `requestLocale` (src/i18n/request.ts) reads *both*
 * `headers()` and `cookies()` — the header the device sent and the language the
 * reader picked (ADR 20260812-reader-chosen-language) — so a mock returning
 * only one of the two throws at the other. Every such test wants the same
 * thing: an empty request that has asked for nothing. One helper, so the next
 * request-scoped read `requestLocale` grows is added here rather than in seven
 * test files, in six of which it will be forgotten.
 */

/** The one method anything under test calls on `cookies()`. */
export function cookieJar(values: Record<string, string> = {}) {
  return {
    get: (name: string) => (name in values ? { name, value: values[name] } : undefined),
  };
}

/**
 * `vi.mock("next/headers", () => nextHeadersStub())` — an empty request.
 * Pass header entries or cookies when the test is about one of them.
 */
export function nextHeadersStub(
  init: { headers?: HeadersInit; cookies?: Record<string, string> } = {},
) {
  return {
    headers: async () => new Headers(init.headers),
    cookies: async () => cookieJar(init.cookies),
  };
}
