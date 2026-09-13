import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth gate on every `/api/test/*` route but `reset` and `clock`, one
 * table for all of them (`reset` has its own colocated route.test.ts, which
 * also covers its success path). Every case here is a *refusal*: the shared
 * guard
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
const seedTroubleStates = await import("./seed-trouble-states/route");
const seedPrivateShop = await import("./seed-private-shop/route");
const seedEvening = await import("./seed-evening/route");
const seedChangedDiveSite = await import("./seed-changed-dive-site/route");
const seedObservedSpecies = await import("./seed-observed-species/route");
const seedDiveTimes = await import("./seed-dive-times/route");
const seedReturningDiver = await import("./seed-returning-diver/route");
const seedBookingHandoff = await import("./seed-booking-handoff/route");
const seedArrivalCode = await import("./seed-arrival-code/route");
const seedShelfToken = await import("./seed-shelf-token/route");
const seedDisplayToken = await import("./seed-display-token/route");
const seedYearBandShop = await import("./seed-year-band-shop/route");
const inboundMessage = await import("./inbound-message/route");
const seedOffSeason = await import("./seed-off-season/route");
const departTrip = await import("./depart-trip/route");
const emailPreviews = await import("./email-previews/route");
const seedContactEmail = await import("./seed-contact-email-confirmation-token/route");
const seedGift = await import("./seed-gift/route");
const seedRecapPulse = await import("./seed-recap-pulse/route");

const secret = "e2e-test-secret";

type SeedRoute = {
  slug: string;
  /**
   * The verb this route answers on. Only `email-previews` is a `GET`; it is in
   * this table for the same reason the rest are — the guard has to close it
   * before it does anything, and "it only reads" is not an exemption when the
   * thing it reads is every notification template the product sends.
   */
  method?: "GET";
  handler: (request: Request) => Promise<Response>;
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
    // Not a `seed-*` name, and gated by exactly the same guard: it delivers an
    // inbound message on a shop's behalf, which on a misconfigured deployment
    // would let anyone cancel a diver's seat (ADR 20260909-reply-keywords).
    slug: "inbound-message",
    handler: inboundMessage.POST,
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-account-token",
    handler: seedAccountToken.POST,
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-last-minute-unsubscribe-token",
    handler: seedLastMinute.POST,
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-courtesy-email-unsubscribe-token",
    handler: seedCourtesyEmail.POST,
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-stripe-account",
    handler: seedStripeAccount.POST,
    // No request body to validate — the first thing this one does past the
    // guard is open the database, so that call is the signal it got through.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-trouble-states",
    handler: seedTroubleStates.POST,
    // Same shape as seed-stripe-account: no body, so reaching the database is
    // what proves the guard let it through. This one writes a stuck payment
    // intent, an owed refund and two erasure obligations, so a route that
    // answered on a misconfigured deployment would be writing that into a real
    // shop's tables.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-evening",
    handler: seedEvening.POST,
    // Same shape as the two above: no body, so reaching the database is what
    // proves the guard let it through. This one rewrites the departure times
    // of a whole shop day, so a route that answered on a misconfigured
    // deployment would be moving a real shop's boats.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-changed-dive-site",
    handler: seedChangedDiveSite.POST,
    // Same shape as the three above: no body, so reaching the database is what
    // proves the guard let it through. This one writes an `executed_dives` row
    // — a record of a dive that was performed — so a route that answered on a
    // misconfigured deployment would be putting a fabricated dive into a real
    // shop's log, which is the table `buildIncidentExport` reads for an
    // investigator.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-observed-species",
    handler: seedObservedSpecies.POST,
    // The same `executed_dives` write as the route above, carrying a *claim
    // about what somebody saw* — so a route answering on a misconfigured
    // deployment would put a sighting nobody made onto a real diver's keepsake,
    // over a shop's name. Reaching the database is what proves the guard let it
    // through.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-dive-times",
    handler: seedDiveTimes.POST,
    // The same `executed_dives` write as the two above, carrying times in and
    // out — the instants the fly-safe line counts from. A route answering on a
    // misconfigured deployment would be telling a real diver when they may
    // board a plane off a dive nobody made. Reaching the database is what
    // proves the guard let it through.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-booking-handoff",
    handler: seedBookingHandoff.POST,
    // A shop slug and an email, refused first — and it must be, because past
    // that it mints a working ten-minute credential over a diver's booking. A
    // route answering on a misconfigured deployment would be handing out the
    // door to a real diver's contact details.
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-arrival-code",
    handler: seedArrivalCode.POST,
    // A shop slug and an email, refused first — and it must be, because past
    // that it mints a working arrival code for a diver's seat, and a scan of
    // one *writes an arrival on a manifest*. A route answering on a
    // misconfigured deployment would let anyone put a diver on a boat they
    // never came to (issue #1725).
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-shelf-token",
    handler: seedShelfToken.POST,
    // A shop slug and an email, refused first — and it must be, because past
    // that it mints a year-long credential over a diver's whole file at that
    // shop. A route answering on a misconfigured deployment would be handing
    // out the door to a real diver's certifications, waiver and sizes.
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-returning-diver",
    handler: seedReturningDiver.POST,
    // It takes a shop slug and an email, so the body is what it refuses first —
    // and it must, because past that it writes a diver's sizes and their
    // emergency contact. A route answering on a misconfigured deployment would
    // be rewriting the number a coastguard calls.
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-display-token",
    handler: seedDisplayToken.POST,
    // No body is a valid ask (the defaults are the fixture), so reaching the
    // database is what proves the guard let it through. Past that it mints a
    // working, non-expiring link over a shop's whole day for a lobby screen —
    // a route answering on a misconfigured deployment would be handing out a
    // real shop's board to anyone.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-off-season",
    handler: seedOffSeason.POST,
    // No body is a valid ask (the shared fixture is the default), so reaching
    // the database is what proves the guard let it through. Past that it soft-
    // deletes every upcoming departure a shop has, so a route answering on a
    // misconfigured deployment would take a real shop's whole board off its own
    // storefront.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-private-shop",
    // `getDb` is stubbed here and returns nothing, so this route's very next
    // line (`db.transaction`) throws the moment the guard lets it through.
    // Swallowed on purpose: what this file asserts is *whether* the request
    // reached the database, never that the mint succeeded against a mock.
    handler: async (request) =>
      seedPrivateShop.POST(request).catch(() => new Response(null, { status: 500 })),
    // Same shape as the two above: no body, so reaching the database is what
    // proves the guard let it through. This one mints a whole `isDemo` tenant
    // whose staff sign in with a published password (ADR
    // 20260815-per-test-private-shops), so a route that answered on a
    // misconfigured deployment would be handing anyone a shop and the
    // credentials to it.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "depart-trip",
    handler: departTrip.POST,
    // Body first past the guard. It names one trip and slides its departure
    // into the past, so a route answering on a misconfigured deployment would
    // be telling a real shop's counter that a boat it can still see on the
    // board has already sailed — which is what opens "Not here?" against a
    // diver who is standing there.
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "email-previews",
    method: "GET",
    handler: emailPreviews.GET,
    // The one read-only route here, and the only one whose past-the-guard
    // signal is a 200 rather than a refusal or a database call: it renders
    // fixture notifications and touches nothing. Asserting `getDb` was never
    // called is still the point — it proves the 200 came from the sample
    // renderer and not from something that had reached a real shop's rows.
    expectPastTheGuard: async (response) => {
      expect(response.status).toBe(200);
      expect(getDb).not.toHaveBeenCalled();
    },
  },
  {
    slug: "seed-contact-email-confirmation-token",
    handler: seedContactEmail.POST,
    // Body first past the guard. Same class as the two unsubscribe-token
    // routes above it: the token it mints is otherwise only ever readable from
    // inside the confirmation email and is hashed at rest, so a route that
    // answered would hand anyone the address-confirmation for any shop.
    expectPastTheGuard: expectInvalidBody,
  },
  {
    slug: "seed-gift",
    handler: seedGift.POST,
    // Database first, then the body — so reaching the database is what proves
    // the guard let it through. Past that it books a real seat through
    // `createGiftBooking` and mints a claim capability for it, so a route that
    // answered on a misconfigured deployment would be selling a real shop's
    // seats and handing out the links to sit in them.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-recap-pulse",
    handler: seedRecapPulse.POST,
    // No body at all, so reaching the database is the signal. Past that it
    // files a private pulse against a booking — a diver's own words about
    // something that went wrong — so a route that answered would be putting
    // fabricated complaints into a real shop's moderation queue.
    expectPastTheGuard: async () => {
      expect(getDb).toHaveBeenCalled();
    },
  },
  {
    slug: "seed-year-band-shop",
    handler: async (request) =>
      seedYearBandShop.POST(request).catch(() => new Response(null, { status: 500 })),
    // No body, so reaching the database is what proves the guard let it
    // through. This one writes a shop with `show_year_on_diveday` on, which is
    // the row DiveDay's homepage band reads (ADR 20260908-one-hand, decision 6,
    // lever T): a route that answered on a misconfigured deployment would put a
    // shop nobody owns under the hero of dive.day.
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
  ({ slug, method, handler, expectPastTheGuard }) => {
    function seedRequest(authorization?: string) {
      const headers: Record<string, string> = {};
      if (authorization !== undefined) headers.authorization = authorization;
      // Deliberately no body: every refusal must land before the route ever
      // reads one, so the same request shape exercises all of them.
      return new Request(`http://localhost/api/test/${slug}`, {
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
 * `seed-private-shop` is the one of these with a second handler — the fixture's
 * teardown drops the shop it minted (ADR 20260815-per-test-private-shops) — and
 * a handler is guarded one at a time. This one takes a caller-supplied slug and
 * hard-deletes a whole tenant, so an unguarded copy is the worst of the set.
 */
describe("DELETE /api/test/seed-private-shop", () => {
  function dropRequest(slug: string, authorization?: string) {
    const headers: Record<string, string> = {};
    if (authorization !== undefined) headers.authorization = authorization;
    return new Request(`http://localhost/api/test/seed-private-shop?slug=${slug}`, {
      method: "DELETE",
      headers,
    });
  }

  it("404s without the bearer token, before any database work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    const response = await seedPrivateShop.DELETE(dropRequest("some-shop"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_available" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses the canonical demo shop by slug, past the guard", async () => {
    const response = await seedPrivateShop.DELETE(dropRequest("blue-mantis", `Bearer ${secret}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a request naming no shop at all", async () => {
    const response = await seedPrivateShop.DELETE(dropRequest("", `Bearer ${secret}`));
    expect(response.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });
});

/**
 * `seed-stripe-account` grew a `?slug=` so a spec that takes a shop of its own
 * can still reach a payments surface (`e2e/tax.spec.ts` — the tax opt-in's only
 * consequence is on checkout and invoicing). That parameter is the reason these
 * two cases exist: the slug is caller-supplied, and the route hands whatever it
 * names a connected Stripe account with charges enabled.
 *
 * The `isDemo` check is the whole guarantee, and it sits *after* the lookup, so
 * asserting the refusal against a non-demo shop is asserting the thing that
 * keeps a real tenant out — the bearer guard above already being no help to
 * anyone who has the secret and a slug.
 */
describe("POST /api/test/seed-stripe-account — the caller-supplied slug", () => {
  function connectRequest(query: string) {
    return new Request(`http://localhost/api/test/seed-stripe-account${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
  }

  it("refuses a malformed slug rather than sanitising it", async () => {
    const response = await seedStripeAccount.POST(connectRequest("?slug=Not%20A%20Slug"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_slug" });
    // Refused on its shape, before the slug is ever used to find a tenant.
    expect(getShopBySlug).not.toHaveBeenCalled();
  });

  it("refuses a real shop, however well-formed the slug naming it", async () => {
    vi.mocked(getShopBySlug).mockResolvedValue({ id: "shop-1", isDemo: false } as never);

    const response = await seedStripeAccount.POST(connectRequest("?slug=a-real-dive-shop"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_available" });
  });
});
