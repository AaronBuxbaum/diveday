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

/**
 * What anything under test calls on `cookies()`: `get`, and the `set` and
 * `delete` a Server Action makes, which write through to `values` so the next
 * `cookies()` in the same test reads them back. `options` keeps the last
 * attributes each `set` was given, for a test about those.
 */
export function cookieJar(values: Record<string, string> = {}) {
  const options: Record<string, Record<string, unknown>> = {};
  return {
    get: (name: string) => (name in values ? { name, value: values[name] } : undefined),
    set: (name: string, value: string, attributes: Record<string, unknown> = {}) => {
      values[name] = value;
      options[name] = attributes;
    },
    delete: (name: string) => {
      delete values[name];
      delete options[name];
    },
    options,
  };
}

/**
 * `vi.mock("next/headers", () => nextHeadersStub())` — an empty request.
 * Pass header entries or cookies when the test is about one of them.
 */
export function nextHeadersStub(
  init: { headers?: HeadersInit; cookies?: Record<string, string> } = {},
) {
  // One jar per stub, so what an action sets, the next read in the test sees.
  const jar = cookieJar(init.cookies);
  return {
    headers: async () => new Headers(init.headers),
    cookies: async () => jar,
  };
}
