import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth gate on the four `seed-*` test routes, one table for all of them
 * (`reset` has its own colocated route.test.ts, which also covers its success
 * path). Every case here is a *refusal*: the shared guard
 * (`src/lib/e2e-test-routes.ts`) must close these routes before they touch the
 * database, so none of these tests needs a hydrated PGlite — a stubbed `getDb`
 * that is asserted never to have been called is the assertion.
 *
 * Why it matters most here: `seed-account-token` mints a real, valid
 * password-reset or invite token for any account by email, so a route that
 * answered on a misconfigured deployment would be account takeover
 * (docs/product/archive/specialist-optimization-audit-20260731.md §5).
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/shops", () => ({ getShopBySlug: vi.fn() }));

const { getDb } = await import("@/db/client");
const { getShopBySlug } = await import("@/db/shops");
const seedAccountToken = await import("./seed-account-token/route");
const seedStripeAccount = await import("./seed-stripe-account/route");
const seedLastMinute = await import("./seed-last-minute-unsubscribe-token/route");
const seedCourtesyEmail = await import("./seed-courtesy-email-unsubscribe-token/route");

const secret = "e2e-test-secret";

type SeedRoute = {
  slug: string;
  POST: (request: Request) => Promise<Response>;
  // What the route does *immediately after* the guard lets a request through.
  // Asserting it keeps the 404 cases honest: they prove the guard refused, not
  // that the route is broken in some other way that happens to 404 too.
  expectPastTheGuard: (response: Response) => Promise<void>;
};

async function expectInvalidBody(response: Response) {
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_body" });
}

const routes: SeedRoute[] = [
  {
    slug: "seed-account-token",
    POST: seedAccountToken.POST,
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-last-minute-unsubscribe-token",
    POST: seedLastMinute.POST,
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-courtesy-email-unsubscribe-token",
    POST: seedCourtesyEmail.POST,
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-stripe-account",
    POST: seedStripeAccount.POST,
    // No request body to validate — the first thing this one does past the
    // guard is open the database, so that call is the signal it got through.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockReset();
  vi.mocked(getShopBySlug)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(routes)(
  "POST /api/test/$slug — auth gate (specialist-optimization-audit-20260731.md §5)",
  ({ slug, POST, expectPastTheGuard }) => {
    function seedRequest(authorization?: string) {
      const headers: Record<string, string> = {};
      if (authorization !== undefined) headers.authorization = authorization;
      // Deliberately no body: every refusal must land before the route ever
      // reads one, so the same request shape exercises all of them.
      return new Request(`http://localhost/api/test/${slug}`, { method: "POST", headers });
    }

    async function expectRefused(response: Response) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_available" });
      // Refusal happens before any database work — these tests never hydrate one.
      expect(getDb).not.toHaveBeenCalled();
    }

    it("404s with a missing Authorization header, even with DIVEDAY_E2E=1 in a production-shaped runtime", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DIVEDAY_E2E", "1");
      await expectRefused(await POST(seedRequest()));
    });

    it("404s with the wrong bearer token", async () => {
      await expectRefused(await POST(seedRequest("Bearer wrong-secret")));
    });

    it("404s when DIVEDAY_E2E_SECRET isn't configured at all, regardless of the header sent", async () => {
      vi.stubEnv("DIVEDAY_E2E_SECRET", "");
      await expectRefused(await POST(seedRequest(`Bearer ${secret}`)));
    });

    it("404s whenever a real database is configured, even with the correct secret", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://example");
      await expectRefused(await POST(seedRequest(`Bearer ${secret}`)));
    });

    it("404s in a production runtime that never opted in via DIVEDAY_E2E, even with the correct secret", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DIVEDAY_E2E", "");
      await expectRefused(await POST(seedRequest(`Bearer ${secret}`)));
    });

    it("gets past the guard with the correct bearer token", async () => {
      await expectPastTheGuard(await POST(seedRequest(`Bearer ${secret}`)));
    });
  },
);
