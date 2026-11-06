import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth gate on every `/api/test/*` route but `reset` and `clock`, one
 * table for all of them: the `shop` door that writes every named fact, and the
 * few routes that are not state (`reset` has its own colocated route.test.ts, which
 * also covers its success path). Every case here is a *refusal*: the shared
 * guard
 * (`src/lib/e2e-test-routes.ts`) must close these routes before they touch the
 * database, so none of these tests needs a hydrated PGlite — a stubbed `getDb`
 * that is asserted never to have been called is the assertion.
 *
 * Why it matters most here: the door's `accountToken` fact mints a real, valid
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
const shopDoor = await import("./shop/route");
const { knownFactNames, resolveFacts } = await import("@/db/facts");

const secret = "e2e-test-secret";

type SeedRoute = {
  /**
   * The route directory, which is also the URL segment **and** the module this
   * row exercises — resolved by `handlerFor` below rather than named a second
   * time. A row used to carry its own `handler:`, and nothing tied the two
   * together: `slug: "seed-arrival-code", handler: seedRecapPulse.POST` would have gone
   * green while `seed-arrival-code` was never called, and `check:e2e-fixtures` reads
   * the slug, so the guard would have agreed (`security-reviewer`, 2026-09-13).
   */
  slug: string;
  /** Optional query for routes whose post-guard path requires a named fixture. */
  query?: string;
  /**
   * The verb this row is about — one row per handler, because a handler is
   * guarded one at a time. `email-previews` and `demo-recap-trip` are `GET`s;
   * both are in this table because reading data is not an exemption from the
   * shared test-route guard.
   */
  method?: "GET" | "DELETE";
  /**
   * A route whose very next line past the guard throws against the stubbed
   * `getDb` — `db.transaction(...)` on a mock that returns nothing. Swallowed
   * on purpose: what this file asserts is *whether* the request reached the
   * database, never that the work succeeded against a mock.
   */
  swallowThrow?: true;
  // What the route does *immediately after* the guard lets a request through.
  // Asserting it keeps the 404 cases honest: they prove the guard refused, not
  // that the route is broken in some other way that happens to 404 too.
  expectPastTheGuard: (response: Response) => Promise<void>;
};

/**
 * The handler this row is about, imported from the slug itself so the two
 * cannot disagree. Vite resolves the template literal to a glob over the route
 * directories, so a slug naming no route fails here rather than silently
 * exercising nothing.
 */
async function handlerFor({ slug, method, swallowThrow }: SeedRoute) {
  const module = (await import(`./${slug}/route`)) as Record<
    string,
    (request: Request) => Promise<Response>
  >;
  const handler = module[method ?? "POST"];
  if (!handler) throw new Error(`${slug} exports no ${method ?? "POST"} handler`);
  return swallowThrow
    ? (request: Request) => handler(request).catch(() => new Response(null, { status: 500 }))
    : handler;
}

async function expectInvalidBody(response: Response) {
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_body" });
}

const routes: SeedRoute[] = [
  { slug: "age-staff-session", expectPastTheGuard: expectInvalidBody },
  {
    // It delivers an inbound message on a shop's behalf, which on a
    // misconfigured deployment would let anyone cancel a diver's seat (ADR
    // 20260909-reply-keywords).
    slug: "inbound-message",
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "shop",
    // No body is a valid ask (no facts, on the canonical demo), so reaching the
    // database is what proves the guard let it through. Past it are every
    // fact the registry holds: a password-reset token for any account, a
    // whole tenant whose staff sign in with a published password, a dive
    // nobody made in a real shop's log.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "shop",
    method: "DELETE",
    // The teardown half (ADR 20260815-per-test-private-shops). It takes a
    // caller-supplied slug and deletes a whole tenant, so it is guarded on its
    // own row. Past the guard with no `?slug=` at all: refused on its shape,
    // before any tenant is looked up.
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "crew-notices",
    // Body first past the guard. Read-only, but what it reads is a staffer's
    // pending crew news — their name, their address and the boats they were
    // put on — so it answers only where every other test route does.
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "email-previews",
    method: "GET",
    // The one read-only route here whose past-the-guard signal is a 200 rather
    // than a refusal or a database call: it renders fixture notifications and
    // touches nothing. Asserting `getDb` was never called is still the point —
    // it proves the 200 came from the sample renderer and not from something
    // that had reached a real shop's rows.
    expectPastTheGuard: async (response) => {
      expect(response.status).toBe(200);
      expect(getDb).not.toHaveBeenCalled();
    },
  },
  {
    slug: "demo-recap-trip",
    method: "GET",
    // Reads only the canonical demo booking's trip id, but still reaches the
    // database only after the shared E2E bearer guard.
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
  "/api/test/$slug — auth gate (specialist-optimization-audit-20260731.md §5)",
  (route) => {
    const { slug, method, query, expectPastTheGuard } = route;
    const handler = (request: Request) => handlerFor(route).then((fn) => fn(request));
    function seedRequest(authorization?: string) {
      const headers: Record<string, string> = {};
      if (authorization !== undefined) headers.authorization = authorization;
      // Deliberately no body: every refusal must land before the route ever
      // reads one, so the same request shape exercises all of them.
      return new Request(`http://localhost/api/test/${slug}${query ?? ""}`, {
        method: method ?? "POST",
        headers,
      });
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
      await expectRefused(await handler(seedRequest()));
    });

    it("404s with the wrong bearer token", async () => {
      await expectRefused(await handler(seedRequest("Bearer wrong-secret")));
    });

    it("404s when DIVEDAY_E2E_SECRET isn't configured at all, regardless of the header sent", async () => {
      vi.stubEnv("DIVEDAY_E2E_SECRET", "");
      await expectRefused(await handler(seedRequest(`Bearer ${secret}`)));
    });

    it("404s whenever a real database is configured, even with the correct secret", async () => {
      vi.stubEnv("DATABASE_URL", "postgres://example");
      await expectRefused(await handler(seedRequest(`Bearer ${secret}`)));
    });

    it("404s in a production runtime that never opted in via DIVEDAY_E2E, even with the correct secret", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DIVEDAY_E2E", "");
      await expectRefused(await handler(seedRequest(`Bearer ${secret}`)));
    });

    it("gets past the guard with the correct bearer token", async () => {
      await expectPastTheGuard(await handler(seedRequest(`Bearer ${secret}`)));
    });
  },
);

/**
 * The door's teardown takes a caller-supplied slug and deletes a whole tenant,
 * so an unguarded copy is the worst of the set, and its refusals of the
 * canonical fixture come before any lookup.
 */
describe("DELETE /api/test/shop", () => {
  function dropRequest(slug: string, authorization?: string) {
    const headers: Record<string, string> = {};
    if (authorization !== undefined) headers.authorization = authorization;
    return new Request(`http://localhost/api/test/shop?slug=${slug}`, {
      method: "DELETE",
      headers,
    });
  }

  it("404s without the bearer token, before any database work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    const response = await shopDoor.DELETE(dropRequest("some-shop"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_available" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses the canonical demo shop by slug, past the guard", async () => {
    const response = await shopDoor.DELETE(dropRequest("blue-mantis", `Bearer ${secret}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("leaves a real shop it did not make where it is", async () => {
    const deleted: string[] = [];
    vi.mocked(getDb).mockResolvedValue({
      transaction: () => {
        deleted.push("transaction");
        throw new Error("a real shop was about to be dropped");
      },
    } as never);
    vi.mocked(getShopBySlug).mockResolvedValue({ id: "shop-1", isDemo: false } as never);
    const response = await shopDoor.DELETE(dropRequest("a-real-dive-shop", `Bearer ${secret}`));
    expect(await response.json()).toEqual({ ok: true, dropped: false });
    expect(deleted).toEqual([]);
  });
});

/**
 * **The door's slug is the caller's**, and the `isDemo` check is the whole
 * guarantee that a real tenant is never written: it sits after the lookup, so
 * asserting the refusal against a non-demo shop is asserting the thing that
 * keeps a real tenant out, the bearer guard being no help to anyone who has
 * the secret and a slug.
 */
describe("POST /api/test/shop — the caller-supplied slug", () => {
  function connectRequest(body: unknown) {
    return new Request("http://localhost/api/test/shop", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
  }

  it("refuses a malformed slug rather than sanitizing it", async () => {
    const response = await shopDoor.POST(
      connectRequest({ slug: "Not A Slug", facts: ["stripeAccount"] }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    // Refused on its shape, before the slug is ever used to find a tenant.
    expect(getShopBySlug).not.toHaveBeenCalled();
  });

  it("refuses a real shop, however well-formed the slug naming it", async () => {
    vi.mocked(getShopBySlug).mockResolvedValue({ id: "shop-1", isDemo: false } as never);
    const response = await shopDoor.POST(
      connectRequest({ slug: "a-real-dive-shop", facts: ["stripeAccount"] }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_available" });
  });
});

/**
 * **One demo-fixture gate, one refusal** (issue #2751). Every fact, and every
 * route that reads a shop, reaches it through `requireDemoTenant`
 * (`src/lib/e2e-test-routes.ts`; `check:e2e-fixtures` refuses one that does
 * not): past the bearer guard, a real shop and a missing one get the same
 * `not_available` 404 the guard itself answers with, so a caller holding the
 * secret cannot tell a real tenant's slug from no shop at all, and nothing is
 * written. A demo shop goes through. Each row is a request that reaches the
 * shop lookup; the door has one per fact in the registry.
 */
type DemoFixtureRoute = {
  slug: string;
  /** What the row is called in the report: the route, or the fact the door was asked for. */
  label?: string;
  method?: "GET";
  query?: string;
  body?: unknown;
};

const SHOP = "a-minted-shop";
const EMAIL = "diver@example.com";

/**
 * Arguments for every fact that takes some, so each one is asked for through
 * the door below. A fact added to the registry with arguments and no row here
 * fails "every fact has a sample", which is the registry's half of this file.
 */
const FACT_SAMPLES: Record<string, Record<string, unknown>> = {
  operationalTrust: { state: "capacity" },
  evening: { heads: "closed" },
  departTrip: { tripId: "trip-1", minutesAgo: 90 },
  offSeason: { opensInDays: 45 },
  pinAddedDate: { fullName: "Dana Diver" },
  returningDiver: { email: EMAIL },
  lastMinuteInterest: { fullName: "Uma", email: EMAIL },
  bookingCheckout: { email: EMAIL },
  openPackageInvoice: { email: EMAIL },
  bookingHandoff: { email: EMAIL },
  accountToken: { email: EMAIL, purpose: "invite" },
  courtesyEmailUnsubscribe: { email: EMAIL },
  interestUnsubscribe: { email: EMAIL },
  visualLink: { family: "digest" },
  waiverRequestLink: { bookingId: "00000000-0000-4000-8000-000000000001" },
  claudeAssists: { review: true },
};

function factRequest(name: string) {
  const args = FACT_SAMPLES[name];
  return args ? { name, ...args } : name;
}

describe("the fact registry", () => {
  it("has a sample for every fact, so each is asked for at the gate below", () => {
    const refused = knownFactNames().filter((name) => {
      const resolved = resolveFacts([factRequest(name)]);
      return !resolved.ok;
    });
    expect(refused).toEqual([]);
  });
});

const demoFixtureRoutes: DemoFixtureRoute[] = [
  { slug: "crew-notices", body: { shopSlug: SHOP, personName: "Dana Deck" } },
  { slug: "demo-recap-trip", method: "GET" },
  {
    slug: "inbound-message",
    body: { shopSlug: SHOP, from: EMAIL, channel: "email", body: "C" },
  },
  { slug: "shop", label: "shop (canonical)", body: {} },
  ...knownFactNames().map((name) => ({
    slug: "shop",
    label: `shop: ${name}`,
    body: { slug: SHOP, facts: [factRequest(name)] },
  })),
];

describe.each(demoFixtureRoutes.map((route) => ({ ...route, label: route.label ?? route.slug })))(
  "/api/test/$label — demo tenants only, one refusal (issue #2751)",
  ({ slug, method, query, body }) => {
    /**
     * A database that records every method a route touches and then throws:
     * a refusal must touch none of them, and a demo shop's request reaching
     * one is the proof it went past the gate.
     */
    const touched: string[] = [];
    const recordingDb = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") return undefined;
          return () => {
            touched.push(String(property));
            throw new Error(`stub database: ${String(property)}`);
          };
        },
      },
    );

    beforeEach(() => {
      touched.length = 0;
      vi.mocked(getDb).mockResolvedValue(recordingDb as never);
    });

    async function call(): Promise<Response | "threw"> {
      const module = (await import(`./${slug}/route`)) as Record<
        string,
        (request: Request) => Promise<Response>
      >;
      const handler = module[method ?? "POST"];
      if (!handler) throw new Error(`${slug} exports no ${method ?? "POST"} handler`);
      const request = new Request(`http://localhost/api/test/${slug}${query ?? ""}`, {
        method: method ?? "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return handler(request).catch(() => "threw" as const);
    }

    async function expectOneRefusal(response: Response | "threw") {
      expect(getShopBySlug).toHaveBeenCalled();
      expect(response).not.toBe("threw");
      if (response === "threw") return;
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_available" });
      expect(touched).toEqual([]);
    }

    it("refuses a real shop, and writes nothing", async () => {
      vi.mocked(getShopBySlug).mockResolvedValue({ id: "shop-1", isDemo: false } as never);
      await expectOneRefusal(await call());
    });

    it("refuses a shop that does not exist, in the same words", async () => {
      await expectOneRefusal(await call());
    });

    it("lets a demo shop through", async () => {
      vi.mocked(getShopBySlug).mockResolvedValue({
        id: "shop-1",
        slug: SHOP,
        name: "Minted",
        timezone: "America/New_York",
        isDemo: true,
      } as never);
      const response = await call();
      if (response !== "threw") {
        expect(
          response.status === 404 && (await response.clone().json()).error === "not_available",
        ).toBe(false);
      }
      expect(touched.length > 0 || response !== "threw").toBe(true);
    });
  },
);
