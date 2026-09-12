import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBED_REQUEST_HEADER,
  REFUSED_SHOP_SLUG_HEADER,
  REQUEST_PATH_HEADER,
} from "@/lib/embed-routes";
import type { PublicRouteShape } from "@/lib/public-route-shape";

/**
 * The edge refusal's two database modules, stubbed at the module boundary.
 *
 * A factory mock means neither real module is ever evaluated, which is the
 * point: `@/db/client` opens an embedded Postgres at import time, and this file
 * is about the proxy's routing decisions rather than about rows. What each
 * lookup *answers* is pinned in `src/db/public-route-existence.test.ts` against
 * a real database; what the proxy does with the answer is pinned here.
 */
const existence = vi.hoisted(() => ({
  /** What the stubbed lookup answers, and what it was asked. */
  answer: true as boolean,
  throws: false,
  asked: [] as PublicRouteShape[],
  /**
   * The shops the stub says are really there, whatever `answer` says about the
   * resource under them — `null` to let `answer` speak for every shape alike.
   * A refusal asks twice, and issue #765 is exactly the case where the two
   * answers differ: the shop is alive, the departure under it is not.
   */
  liveShops: null as Set<string> | null,
}));

vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/public-route-existence", () => ({
  publicRouteExists: async (_db: unknown, shape: PublicRouteShape) => {
    existence.asked.push(shape);
    if (existence.throws) throw new Error("database unavailable");
    // The one answer the real module gives without a query, kept here so the
    // stub cannot disagree with it.
    if (shape.kind === "malformed") return false;
    if (existence.liveShops && shape.kind === "shop") {
      return existence.liveShops.has(shape.shopSlug);
    }
    return existence.answer;
  },
}));

// The real better-auth cookie cache wants a matching encrypted payload; the
// behavior under test is everything the proxy does *around* the auth
// decision — header stamping, the override-list wire protocol, frame denial
// — so stub the cookie helpers as "a signed-in owner of blue-mantis", the
// one identity that never trips a redirect on any route these tests visit
// (a bare `/shop` or `/sign-in` request would, and none of them are).
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: () => "mock-session-token",
  getCookieCache: async () => ({
    session: {
      personId: "person-1",
      shopId: "shop-1",
      shopSlug: "blue-mantis",
      roles: ["owner"],
    },
  }),
}));

import { proxy } from "@/proxy";

function request(url: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`http://127.0.0.1${url}`, { headers });
}

async function run(req: NextRequest): Promise<Response> {
  const res = await proxy(req, {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

describe("proxy request-header overrides", () => {
  it("stamps both proxy headers in one override and keeps every original request header on the surviving list", async () => {
    // Regression guard for the bug this helper's doc comment describes twice
    // over: (a) an override list built from scratch dropped `cookie` and
    // signed every visitor out on their next navigation; (b) two sequential
    // single-header calls rebuilt the list and the second dropped the first.
    const res = await run(
      request("/shop/blue-mantis/divers", { cookie: "better-auth.session_token=abc" }),
    );
    const surviving = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(surviving).toContain("cookie");
    expect(surviving).toContain(EMBED_REQUEST_HEADER);
    expect(surviving).toContain(REQUEST_PATH_HEADER);
    expect(res.headers.get("x-middleware-request-cookie")).toBe("better-auth.session_token=abc");
    expect(res.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe("");
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe(
      "/shop/blue-mantis/divers",
    );
  });

  it("overwrites client-supplied copies of both trusted headers", async () => {
    const res = await run(
      request("/shop/blue-mantis/divers", {
        [EMBED_REQUEST_HEADER]: "1",
        [REQUEST_PATH_HEADER]: "/shop/blue-mantis/schedule",
      }),
    );
    // The spoofed "this is an embed of a public page" pair comes out as what
    // the request actually is: a plain staff-route visit.
    expect(res.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe("");
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe(
      "/shop/blue-mantis/divers",
    );
  });
});

describe("proxy embed handling", () => {
  it("grants the framing exception only to a genuine single-valued embed request", async () => {
    const res = await run(request("/s/blue-mantis?embed=1"));
    expect(res.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe("1");
    expect(res.headers.get("X-Frame-Options")).toBeNull();
    // The framing exception is about `frame-ancestors` and nothing else. An
    // embedded page is still a page of this app, so it keeps the rest of the
    // policy — this assertion used to read `toBeNull()`, which was true only
    // while `frame-ancestors` WAS the entire CSP (issue #718).
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("frame-ancestors");
    expect(csp).toContain("object-src 'none'");
  });

  it("does not grant embed on a repeated ?embed=1&embed=0 — the page and the proxy must agree", async () => {
    const res = await run(request("/s/blue-mantis?embed=1&embed=0"));
    expect(res.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe("");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("treats a widget view as an embed by path alone, with no ?embed=1 to forget", async () => {
    const res = await run(request("/s/blue-mantis/embed/grid"));
    expect(res.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe("1");
    expect(res.headers.get("X-Frame-Options")).toBeNull();
    expect(res.headers.get("Content-Security-Policy") ?? "").not.toContain("frame-ancestors");
  });

  it("forwards only a well-formed host colour and face, and drops anything else", async () => {
    const good = await run(
      request("/s/blue-mantis/embed/courses?brand=%23B45309&font=Georgia%2C%20serif"),
    );
    expect(good.headers.get("x-middleware-request-x-diveday-embed-brand")).toBe("#b45309");
    expect(good.headers.get("x-middleware-request-x-diveday-embed-font")).toBe("Georgia, serif");
    const hostile = await run(
      request(
        "/s/blue-mantis/embed/courses?brand=javascript%3Aalert(1)&font=%3C%2Fstyle%3E%3Cscript%3E",
      ),
    );
    expect(hostile.headers.get("x-middleware-request-x-diveday-embed-brand")).toBe("");
    expect(hostile.headers.get("x-middleware-request-x-diveday-embed-font")).toBe("");
    // And never on the storefront itself, which is not an embed request.
    const storefront = await run(request("/s/blue-mantis?brand=%23b45309"));
    expect(storefront.headers.get("x-middleware-request-x-diveday-embed-brand")).toBe("");
  });

  it("does not grant embed on a non-embeddable route, ?embed=1 or not", async () => {
    const res = await run(request("/shop/blue-mantis/divers?embed=1"));
    expect(res.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe("");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("the public namespace's edge refusal", () => {
  const TRIP_ID = "11111111-2222-4333-8444-555555555555";

  beforeEach(() => {
    existence.answer = true;
    existence.throws = false;
    existence.asked = [];
    existence.liveShops = null;
  });

  function rewriteTarget(res: Response): string | null {
    const value = res.headers.get("x-middleware-rewrite");
    return value ? new URL(value).pathname : null;
  }

  it("rewrites a URL that names nothing to Next's own not-found entry", async () => {
    // `/_not-found` is the one destination whose status is set before anything
    // renders (base-server.js), which is the whole reason this refusal lives
    // above the streaming boundary rather than in the page.
    existence.answer = false;
    const res = await run(request("/s/no-such-shop"));
    expect(rewriteTarget(res)).toBe("/_not-found");
  });

  it("stamps the original path on the refusal, so the shop's own 404 still knows where it was going", async () => {
    // Issue #765: `not-found.tsx` is handed no props at all and reads
    // REQUEST_PATH_HEADER to offer that shop's schedule. A refusal that
    // stamped the rewritten path would strand the diver.
    existence.answer = false;
    const res = await run(request(`/s/blue-mantis/trips/${TRIP_ID}`));
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe(
      `/s/blue-mantis/trips/${TRIP_ID}`,
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
  });

  it("leaves a URL that names something completely alone", async () => {
    const res = await run(request("/s/blue-mantis/sites/molasses-reef"));
    expect(rewriteTarget(res)).toBeNull();
    expect(existence.asked).toEqual([
      { kind: "site", shopSlug: "blue-mantis", siteSlug: "molasses-reef" },
    ]);
  });

  it("refuses a segment that could never name a row, live shop or not", async () => {
    // The shop exists; the id is not a uuid. `uuidParam` is the page's own
    // check, so this is the edge applying it a layer earlier rather than a
    // second opinion about what a trip id may look like.
    const res = await run(request("/s/blue-mantis/trips/not-a-uuid"));
    expect(rewriteTarget(res)).toBe("/_not-found");
    // Two questions, and the second is only asked because the first said no:
    // the shape needs no query, and the shop probe behind it is what decides
    // whose 404 the diver is about to read (issue #765).
    expect(existence.asked).toEqual([
      { kind: "malformed" },
      { kind: "shop", shopSlug: "blue-mantis" },
    ]);
  });

  it("never refuses anything but a GET or a HEAD", async () => {
    // A Server Action posts to the route it sits on. A booking that landed on
    // a 404 instead of the page would be a lost sale.
    existence.answer = false;
    const res = await run(
      new NextRequest("http://127.0.0.1/s/blue-mantis/register", { method: "POST" }),
    );
    expect(rewriteTarget(res)).toBeNull();
    expect(existence.asked).toEqual([]);
  });

  it("asks nothing about a path outside the diver-facing namespace", async () => {
    for (const path of ["/shop/blue-mantis/divers", "/api/cron/retention", "/sign-in", "/"]) {
      await run(request(path));
    }
    expect(existence.asked).toEqual([]);
  });

  it("names the shop when the shop is alive and only the thing under it is gone", async () => {
    // Issue #765's whole rule, and the half a diver actually sees: a link that
    // outlived its departure lands on that shop's own refusal, framed by that
    // shop's chrome, with its board as the way onward. `/_not-found` renders
    // under the *root* layout, so this header is the only thing telling it
    // whose page to be.
    existence.answer = false;
    existence.liveShops = new Set(["blue-mantis"]);
    const res = await run(request(`/s/blue-mantis/trips/${TRIP_ID}`));
    expect(rewriteTarget(res)).toBe("/_not-found");
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("blue-mantis");
  });

  it("frames a segment no shop could have minted as that shop's own refusal", async () => {
    // The malformed shape carries no slug of its own, so the claim is read off
    // the pathname — and a live shop with an unmintable segment under it is
    // still a diver at that shop, not a stranger at DiveDay's door.
    existence.answer = false;
    existence.liveShops = new Set(["blue-mantis"]);
    const res = await run(request("/s/blue-mantis/sites/Molasses%20Reef"));
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("blue-mantis");
  });

  it("names no shop when the shop is the part that is missing", async () => {
    // Offering the board of a shop that does not exist would hand the diver a
    // second 404. The bare storefront answers this without a second question:
    // the shape it was refused on *is* the shop.
    existence.answer = false;
    existence.liveShops = new Set();
    const bare = await run(request("/s/no-such-shop"));
    expect(bare.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("");
    expect(existence.asked).toEqual([{ kind: "shop", shopSlug: "no-such-shop" }]);

    existence.asked = [];
    const deeper = await run(request(`/s/no-such-shop/trips/${TRIP_ID}`));
    expect(deeper.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("");
  });

  it("overwrites a client-supplied copy of the refused-shop header", async () => {
    // Same rule as the two trusted headers above: a live page must never carry
    // a value a client sent, or a visitor could dress DiveDay's 404 — or any
    // page that reads it later — as a shop of their choosing.
    const live = await run(
      request("/s/blue-mantis", { [REFUSED_SHOP_SLUG_HEADER]: "somebody-elses-shop" }),
    );
    expect(live.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("");

    existence.answer = false;
    existence.liveShops = new Set(["blue-mantis"]);
    const refused = await run(
      request(`/s/blue-mantis/trips/${TRIP_ID}`, {
        [REFUSED_SHOP_SLUG_HEADER]: "somebody-elses-shop",
      }),
    );
    expect(refused.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe(
      "blue-mantis",
    );
  });

  it("carries the refusal's own facts through the second pass, and asks nothing on it", async () => {
    // Next routes a rewrite from the top, matcher included, so `proxy` is
    // re-entered with `/_not-found` as its own pathname. Recomputing there
    // blanked both headers — the path came back as the literal `/_not-found`
    // and the shop came back empty — which is a shop-framed 404 quietly
    // reverting to DiveDay's sales-page one. Verified against a real build
    // before it was fixed; this is the regression guard.
    const res = await run(
      request("/_not-found", {
        [REQUEST_PATH_HEADER]: `/s/blue-mantis/trips/${TRIP_ID}`,
        [REFUSED_SHOP_SLUG_HEADER]: "blue-mantis",
      }),
    );
    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe(
      `/s/blue-mantis/trips/${TRIP_ID}`,
    );
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("blue-mantis");
    // The first pass did the lookups; a second round of them would be paid on
    // every 404 in the app for an answer already in hand.
    expect(existence.asked).toEqual([]);
  });

  it("carries nothing into a bare /_not-found render", async () => {
    // Next's own `notFound()` reaches this route without a refusal in front of
    // it — a stale email link, a cross-tenant staff URL. Nothing to carry, and
    // the headers say so rather than keeping whatever was last there.
    const res = await run(request("/_not-found"));
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("");
    expect(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/_not-found");
  });

  it("does not refuse when the lookup itself fails", async () => {
    // A 404 fired by a database outage would take every live shop off the
    // internet to fix a soft 404 on dead links.
    existence.throws = true;
    const res = await run(request("/s/blue-mantis"));
    expect(rewriteTarget(res)).toBeNull();
  });
});

describe("proxy CSP handling", () => {
  it("allows unsafe-eval in report-only policy during e2e runs", async () => {
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("NODE_ENV", "production");
    const res = await run(request("/shop/blue-mantis/divers"));
    const reportOnly = res.headers.get("Content-Security-Policy-Report-Only") ?? "";
    expect(reportOnly).toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
  });

  it("keeps unsafe-eval out of report-only policy in production when not in e2e", async () => {
    vi.stubEnv("DIVEDAY_E2E", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await run(request("/shop/blue-mantis/divers"));
    const reportOnly = res.headers.get("Content-Security-Policy-Report-Only") ?? "";
    expect(reportOnly).not.toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
  });
});

/**
 * **The shop home answers to no query any more.**
 *
 * `?view=` chose between the urgency and by-departure renderings of one work
 * queue, and `?page=` paged the second of them. The home is a single
 * chronological spine now (ADR 20260827-clearwater-surface-language, decision
 * 4), so neither selects anything — and a bookmark carrying one must land on
 * the page rather than on a URL that quietly means nothing.
 *
 * It happens at the edge because that is the only layer that can answer a real
 * **308**: under `cacheComponents` a redirect thrown from a page body answers
 * 200 with the hop resolving inside the streamed payload, which a browser
 * follows and a bookmark manager, a crawler and a `curl` do not.
 */
describe("proxy retired-query redirects", () => {
  it("308s the shop home's ?view= and ?page= away, keeping everything else", async () => {
    for (const [from, to] of [
      ["/shop/blue-mantis?view=departures", "/shop/blue-mantis"],
      ["/shop/blue-mantis?view=urgency&page=3", "/shop/blue-mantis"],
      ["/shop/blue-mantis?page=2", "/shop/blue-mantis"],
      ["/shop/blue-mantis?view=departures&created=Reef", "/shop/blue-mantis?created=Reef"],
    ] as const) {
      const res = await run(request(from));
      expect(res.status, from).toBe(308);
      // Absolute, because Next's middleware adapter parses this header through
      // `NextURL` and a relative value there has no base to resolve against —
      // it throws and the request answers 500. The origin is the request's
      // own, which is what stops the hop pinning a visitor to whichever host
      // the proxy happened to resolve (the trap `/blockers` documents).
      const location = new URL(res.headers.get("location") ?? "", "http://x");
      expect(location.origin, from).toBe(new URL(request(from).url).origin);
      expect(`${location.pathname}${location.search}`, from).toBe(to);
    }
  });

  it("leaves a home with no retired query, and every page below it, alone", async () => {
    // `?page=` is a live parameter on plenty of staff lists — the strip is the
    // home's own, not a rule about the word.
    for (const path of [
      "/shop/blue-mantis",
      "/shop/blue-mantis?created=Reef",
      "/shop/blue-mantis/orders?page=2",
      "/shop/blue-mantis/divers?view=all",
    ]) {
      expect((await run(request(path))).status, path).not.toBe(308);
    }
  });
});

describe("the partner referral cookie (issue #1285)", () => {
  /**
   * A real top-level navigation. `SameSite` does not stop a cross-site
   * `Set-Cookie` — it governs what is *sent*, not what is stored — so an
   * `<img src="…?utm_source=partner&utm_campaign=rival">` on any page would
   * otherwise plant an attribution on every visitor it has. `Sec-Fetch-*` is
   * browser-set and unforgeable by page script, so a document navigation is
   * the one shape that mints.
   */
  const NAVIGATION = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

  function setCookie(res: Response): string | null {
    return res.headers.get("set-cookie");
  }

  it("remembers the partner a storefront visit arrived through, bound to that shop", async () => {
    const res = await run(
      request("/s/blue-mantis?utm_source=partner&utm_medium=referral&utm_campaign=coral-sands", {
        ...NAVIGATION,
      }),
    );
    const cookie = setCookie(res);
    // The shop is *in the value*: one cookie covers the whole /s/ namespace, so
    // the booking action has to be able to tell whose link minted it.
    expect(cookie).toContain("diveday_ref=blue-mantis%3Acoral-sands");
    // HttpOnly so the page cannot steer what the booking action reads; scoped
    // to /s/ so it is never sent up with a staff request.
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/s/");
    // Never cached: the value is a pure function of the URL, but only a cache
    // that keys on the query string can be trusted to keep it that way.
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("writes nothing at all for an ordinary storefront visit", async () => {
    expect(setCookie(await run(request("/s/blue-mantis", { ...NAVIGATION })))).toBeNull();
    expect(
      setCookie(
        await run(
          request("/s/blue-mantis?utm_source=newsletter&utm_campaign=spring", { ...NAVIGATION }),
        ),
      ),
    ).toBeNull();
  });

  it("refuses to mint on anything but a document navigation", async () => {
    const link = "/s/blue-mantis?utm_source=partner&utm_campaign=rival-hotel";
    // What an <img> on a hostile page produces. X-Frame-Options refuses an
    // iframe only *after* the response and its headers were processed, so the
    // refusal has to happen here.
    expect(
      setCookie(
        await run(request(link, { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" })),
      ),
    ).toBeNull();
    expect(
      setCookie(
        await run(request(link, { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" })),
      ),
    ).toBeNull();
    expect(
      setCookie(await run(request(link, { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }))),
    ).toBeNull();
    // No headers at all — an old browser or a non-browser client. Mints nothing
    // rather than falling back to trusting it.
    expect(setCookie(await run(request(link)))).toBeNull();
  });

  it("never writes one outside the diver-facing namespace", async () => {
    expect(
      setCookie(
        await run(
          request("/shop/blue-mantis?utm_source=partner&utm_campaign=x", { ...NAVIGATION }),
        ),
      ),
    ).toBeNull();
    expect(
      setCookie(await run(request("/?utm_source=partner&utm_campaign=x", { ...NAVIGATION }))),
    ).toBeNull();
  });

  it("stores the slug, never what the URL happened to say", async () => {
    const res = await run(
      request(
        "/s/blue-mantis?utm_source=partner&utm_campaign=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
        { ...NAVIGATION },
      ),
    );
    expect(setCookie(res)).toContain("diveday_ref=blue-mantis%3Ascript-alert-1-script");
  });
});
