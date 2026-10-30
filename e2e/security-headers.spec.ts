import { expect, READ_ONLY, test } from "./fixtures";

const BASELINE_HEADERS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
};

function expectSecurityHeaders(
  headers: Record<string, string>,
  referrerPolicy: "no-referrer" | "strict-origin-when-cross-origin",
) {
  expect(headers).toMatchObject({
    ...BASELINE_HEADERS,
    "referrer-policy": referrerPolicy,
  });
}

test("real HTTP responses tighten referrers on bearer paths and retain baseline headers", {
  tag: READ_ONLY,
}, async ({ request }) => {
  const bearerPath = "/unsubscribe/not-a-real-token";
  const bare = await request.get(bearerPath, { maxRedirects: 0 });
  expect(bare.status(), bearerPath).toBe(200);
  expectSecurityHeaders(bare.headers(), "no-referrer");

  // The RFC 8058 route is nested beneath the token page and only accepts POST.
  // A GET reaches Next's real route boundary without exercising its mutation.
  const nestedPath = `${bearerPath}/one-click`;
  const nested = await request.get(nestedPath, { maxRedirects: 0 });
  expect(nested.status(), nestedPath).toBe(405);
  expectSecurityHeaders(nested.headers(), "no-referrer");

  const ordinaryPath = "/robots.txt";
  const ordinary = await request.get(ordinaryPath, { maxRedirects: 0 });
  expect(ordinary.status(), ordinaryPath).toBe(200);
  expectSecurityHeaders(ordinary.headers(), "strict-origin-when-cross-origin");
});
