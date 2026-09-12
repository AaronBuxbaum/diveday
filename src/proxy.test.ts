import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBED_REQUEST_HEADER,
  REFUSED_SHOP_SLUG_HEADER,
  REQUEST_PATH_HEADER,
} from "@/lib/embed-routes";
import type { PublicRouteQuery } from "@/lib/public-route-shape";
import { TEST_FROZEN_CLOCK } from "@/test/frozen-clock";

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
  /**
   * What a throwing lookup throws. The proxy's `catch` now classifies it, and
   * the two classes take different branches, so "an outage" and "a slug the
   * server refused" have to be distinguishable here.
   */
  throwsWith: null as unknown,
  asked: [] as PublicRouteQuery[],
  /**
   * The shops the stub says are really there, whatever `answer` says about the
   * resource under them — `null` to let `answer` speak for both halves alike.
   * Issue #765 is exactly the case where the two differ: the shop is alive, the
   * departure under it is not. One question, two facts back.
   */
  liveShops: null as Set<string> | null,
}));

vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/public-route-existence", () => ({
  publicRouteLookup: async (_db: unknown, shape: PublicRouteQuery) => {
    existence.asked.push(shape);
    if (existence.throws) throw existence.throwsWith ?? new Error("database unavailable");
    // A town names no shop, so the real module never resolves one and answers
    // `shopExists: false` whatever it finds — the refusal is DiveDay's own
    // (issue #1734).
    if (shape.kind === "region") return { exists: existence.answer, shopExists: false };
    const shopExists = existence.liveShops
      ? existence.liveShops.has(shape.shopSlug)
      : existence.answer;
    // Two answers the real module gives whatever the resource reader would
    // have said, kept here so the stub cannot disagree with it: a segment that
    // could never have been minted names nothing, and nothing at all exists
    // under a shop that does not.
    if (shape.kind === "malformed") return { exists: false, shopExists };
    return { exists: shopExists && existence.answer, shopExists };
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

/**
 * The proxy with the refused-statement damper's module state reset.
 *
 * `reportRefusedQuery` keeps its last-reported instant and swallowed count in
 * module scope — that is what makes the bound per instance — so a test that
 * expects the first line of a fresh instance has to say so, or it passes or
 * fails on file order. The `vi.hoisted` `existence` stub survives
 * `vi.resetModules()`, which is what makes this safe (`src/lib/rate-limit.test.ts`
 * leans on the same thing).
 */
async function freshProxy(): Promise<typeof proxy> {
  vi.resetModules();
  return (await import("@/proxy")).proxy;
}

async function runOn(fresh: typeof proxy, req: NextRequest): Promise<Response> {
  const res = await fresh(req, {});
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
    existence.throwsWith = null;
    existence.asked = [];
    existence.liveShops = null;
  });

  /**
   * A slug Postgres refuses: SQLSTATE 22021, wrapped by drizzle exactly as the
   * driver hands it over — the SQL followed by the bound parameters verbatim,
   * which is the caller's own string and must never reach a log line.
   */
  function refuseWithSqlState(): void {
    const driver = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
      code: "22021",
    });
    existence.throws = true;
    existence.throwsWith = new Error(
      'Failed query: select "id" from "shops" where "shops"."slug" = $1\nparams: probe-slug,1',
      { cause: driver },
    );
  }

  function rewriteTarget(res: Response): string | null {
    const value = res.headers.get("x-middleware-rewrite");
    return value ? new URL(value).pathname : null;
  }

  /**
   * Every structured line `log()` wrote while `act` ran, parsed back.
   *
   * `src/lib/log.ts` writes over `console.error`/`console.warn`, so this reads
   * what a log drain would receive — which is the point of the assertions
   * below: what is *absent* from the shipped line matters as much as what is
   * in it.
   */
  async function logged(act: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
    const lines: Record<string, unknown>[] = [];
    const capture = (line: unknown) => {
      if (typeof line !== "string") return;
      try {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Not a structured line; nothing under test writes one.
      }
    };
    const spies = (["error", "warn"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(capture),
    );
    try {
      await act();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    return lines;
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
    // One question. The shape needs no resource query, and the shop probe that
    // decides whose 404 the diver is about to read (issue #765) comes back on
    // the same answer — it used to be a second call from this file.
    expect(existence.asked).toEqual([{ kind: "malformed", shopSlug: "blue-mantis" }]);
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("blue-mantis");
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

  /**
   * The three dynamic routes outside `/s/**` (issue #1734). They answered 200
   * with a not-found page for six weeks after this refusal shipped, because a
   * pathname `publicRouteShape` has no opinion about is passed through
   * untouched — silence by construction, which is why
   * `src/app/edge-refusal-coverage.test.ts` now reads the route tree.
   */
  it("refuses an unregistered incumbent and an unknown story without opening a database", async () => {
    // `MIGRATION_GUIDE_SLUGS` and `DEMO_STORY_IDS` are closed lists this
    // repository holds, so the pure half settles both. `asked` staying empty is
    // the assertion: a crawler probing these must not be able to make a cold
    // instance open a connection it has no question for.
    existence.answer = true;
    for (const path of ["/switching/checkfront", "/demo/not-a-story"]) {
      const res = await run(request(path));
      expect(rewriteTarget(res), path).toBe("/_not-found");
      // No shop over these — they are DiveDay's own pages, so the refusal is
      // DiveDay's own and issue #765's frame does not apply.
      expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`), path).toBe("");
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
    }
    expect(existence.asked).toEqual([]);
  });

  it("leaves a registered guide, a real story and the spreadsheet page alone", async () => {
    // The direction that costs an outage rather than crawl budget. The
    // spreadsheet guide is the sharp one: a live page whose slug is
    // deliberately not an incumbent, so a `[competitor]`-shaped judgement of
    // its path would 404 it.
    existence.answer = false;
    for (const path of [
      "/switching/eve",
      "/switching/spreadsheet",
      "/switching",
      "/demo/weather-day",
    ]) {
      expect(rewriteTarget(await run(request(path))), path).toBeNull();
    }
    expect(existence.asked).toEqual([]);
  });

  it("asks the database about a town, and refuses the one nobody dives out of", async () => {
    // There is no closed list of towns — `isRegionSlug` is a pattern, and the
    // set is a projection of `shops.region_slug` — so `/dive/not-a-town` is the
    // one of the three that has to be a read. This is the assertion a
    // shape-only fix fails.
    existence.answer = false;
    const res = await run(request("/dive/not-a-town"));
    expect(rewriteTarget(res)).toBe("/_not-found");
    expect(existence.asked).toEqual([{ kind: "region", regionSlug: "not-a-town" }]);
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("");

    existence.asked = [];
    existence.answer = true;
    expect(rewriteTarget(await run(request("/dive/key-largo")))).toBeNull();
    expect(existence.asked).toEqual([{ kind: "region", regionSlug: "key-largo" }]);
  });

  it("refuses a town segment no locality could have produced, with no read at all", async () => {
    // The free half: `dive/[region]/page.tsx` shape-tests before it queries, so
    // the edge may apply the same test a layer earlier.
    existence.answer = true;
    for (const segment of ["Key%20Largo", "key_largo", "-key-largo"]) {
      expect(rewriteTarget(await run(request(`/dive/${segment}`))), segment).toBe("/_not-found");
    }
    expect(existence.asked).toEqual([]);
  });

  it("serves a town when the read fails, exactly as it serves a shop", async () => {
    // The fail-open policy reaches the new shape too: a database outage must
    // not take `/dive/key-largo` off the internet to fix a soft 404.
    existence.throws = true;
    await logged(async () => {
      expect(rewriteTarget(await run(request("/dive/key-largo")))).toBeNull();
    });
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
    // And the frame costs no question of its own. This used to ask the shop
    // again, so a dead link under a live shop — the one URL nobody legitimate
    // requests — was the most expensive request in the public namespace.
    expect(existence.asked).toEqual([{ kind: "trip", shopSlug: "blue-mantis", tripId: TRIP_ID }]);
  });

  it("frames a segment no shop could have minted as that shop's own refusal", async () => {
    // A live shop with an unmintable segment under it is still a diver at that
    // shop, not a stranger at DiveDay's door — so the malformed shape carries
    // the shop it sat under, and the claim is read off that.
    existence.answer = false;
    existence.liveShops = new Set(["blue-mantis"]);
    const res = await run(request("/s/blue-mantis/sites/Molasses%20Reef"));
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe("blue-mantis");
  });

  it("frames the refusal for a shop whose slug is legal but unusual", async () => {
    // Sign-up sells `[a-z0-9-]+`, so `blue--mantis` is somebody's storefront.
    // The claim used to be re-parsed out of the pathname and held to a
    // narrower matcher, which returned null here — and a dead link under a
    // real shop was answered by DiveDay's *sales* 404 with a trial button,
    // which is the regression issue #765 exists to prevent. The slug now comes
    // off the shape the lookup already used.
    existence.answer = false;
    existence.liveShops = new Set(["blue--mantis"]);
    const res = await run(request(`/s/blue--mantis/trips/${TRIP_ID}`));
    expect(rewriteTarget(res)).toBe("/_not-found");
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe(
      "blue--mantis",
    );
  });

  it("frames the refusal for a live shop reached through a percent-escape", async () => {
    // `/s/blue%2Dmantis` is the same shop the page would have rendered, and
    // the shape decodes it before the lookup. The old second parse read the
    // raw pathname, so this lost the frame too.
    existence.answer = false;
    existence.liveShops = new Set(["blue-mantis"]);
    const res = await run(request(`/s/blue%2Dmantis/trips/${TRIP_ID}`));
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

  it("carries a refused-shop claim a non-browser client made for itself, bounded rather than blanked", async () => {
    // `/_not-found` is inside the matcher, so `curl` sends both headers
    // straight at it and gets the frame it named. Blanking them on a direct
    // hit is not available as a fix: the pass above *is* a direct hit and
    // indistinguishable from one, and blanking there is issue #765 again. The
    // residual is bounded rather than removed, and these are the bounds — the
    // forger is the only reader of the page they forged, nothing is looked up
    // on their behalf, and `no-store` keeps a shared cache from handing it to
    // anybody else. `src/app/not-found.tsx` holds the value to the slug
    // charset, so the frame it can name is a real shop's public chrome or
    // nothing at all.
    const res = await run(
      request("/_not-found", {
        [REQUEST_PATH_HEADER]: "/s/somebody-elses-shop/trips/nope",
        [REFUSED_SHOP_SLUG_HEADER]: "somebody-elses-shop",
      }),
    );
    expect(res.headers.get(`x-middleware-request-${REFUSED_SHOP_SLUG_HEADER}`)).toBe(
      "somebody-elses-shop",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
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

  it("tells every cache never to keep the refusal", async () => {
    // The rewrite keeps the original URL, so a cached negative answer is
    // pinned to the path a diver typed — and a shop slug probed an hour before
    // onboarding finishes, or a course slug probed before the shop publishes
    // it, would keep answering 404 after the row exists. The refusal carries
    // the directive itself rather than inheriting whatever `/_not-found`
    // happens to emit.
    existence.answer = false;
    const res = await run(request("/s/no-such-shop"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("puts back the no-store the availability document loses on this path", async () => {
    // `/s/<shop>/availability.json` answers its own 404 `no-store` on purpose
    // (its route handler says so). For a shop that does not exist the edge
    // refuses first and that handler never runs, so the one route in the
    // namespace with a stated caching intent would silently lose it.
    existence.answer = false;
    const res = await run(request("/s/no-such-shop/availability.json"));
    expect(rewriteTarget(res)).toBe("/_not-found");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the refusal uncacheable on the second pass, and on a bare not-found render", async () => {
    // Next routes the rewrite from the top, so `proxy` is re-entered with
    // `/_not-found` and no refusal in hand. Whichever pass's headers reach the
    // wire, the answer is the same.
    const second = await run(
      request("/_not-found", { [REQUEST_PATH_HEADER]: "/s/blue-mantis/courses/nope" }),
    );
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect((await run(request("/_not-found"))).headers.get("cache-control")).toBe("no-store");
  });

  it("says nothing about caching a page that is really there", async () => {
    // Scoped to the refusal: a live storefront's caching is the app's to
    // decide, and an edge `no-store` on it would take every public page off
    // every cache at once.
    expect((await run(request("/s/blue-mantis"))).headers.get("cache-control")).toBeNull();
  });

  it("leaves the referral cookie's stronger directive alone", async () => {
    // A dead partner link is both a refusal and a mint. `private, no-store`
    // already forbids every cache the refusal cares about and says one more
    // true thing about the Set-Cookie, so the refusal is stamped before the
    // cookie rather than after it.
    existence.answer = false;
    const res = await run(
      request("/s/no-such-shop?utm_source=partner&utm_campaign=coral-sands", {
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
      }),
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not refuse when the lookup itself fails", async () => {
    // A 404 fired by a database outage would take every live shop off the
    // internet to fix a soft 404 on dead links.
    existence.throws = true;
    const res = await run(request("/s/blue-mantis"));
    expect(rewriteTarget(res)).toBeNull();
  });

  it("logs an unreachable database at the code the alarm counts", async () => {
    // Failing open means this line is the only trace the failure leaves, and
    // `DatabaseUnavailable` in `infra/lib/observability.ts` counts it by this
    // exact string. Renaming the code silently stops the alarm.
    existence.throws = true;
    existence.throwsWith = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    const [line, ...rest] = await logged(() => run(request("/s/blue-mantis/courses/open-water")));
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      level: "error",
      event: "public_route.existence_unavailable",
      shape: "course",
      code: "ECONNREFUSED",
    });
    // The same absence the refused branch asserts. Held here too, because
    // otherwise adding `error: String(error)` to this branch's `log()` would
    // ship drizzle's wrapper message — the SQL and the bound parameters
    // verbatim, which is the caller's own string — with the suite green.
    expect(JSON.stringify(line)).not.toContain("10.0.0.1");
    expect(JSON.stringify(line)).not.toContain("open-water");
  });

  it("logs a statement the server refused at warn, carrying none of the request's own strings", async () => {
    // A shop slug reaches this lookup unfiltered and length-unbounded on
    // purpose, so `/s/%00` is a statement Postgres refuses — SQLSTATE 22021,
    // once per request, free to send. Logging that at `error` alongside a real
    // outage put whoever was sending it in charge of the alarm, and the line
    // carried their own path *and* drizzle's wrapper message, which is the SQL
    // followed by the bound parameters verbatim.
    refuseWithSqlState();
    const fresh = await freshProxy();
    const lines = await logged(() => runOn(fresh, request("/s/probe-slug")));
    expect(lines).toHaveLength(1);
    // The level is asserted, not just the count: putting this back to `error`
    // would hand whoever is sending `/s/%00` the `AppErrors` alarm.
    expect(lines[0]).toMatchObject({
      level: "warn",
      event: "public_route.existence_query_refused",
      shape: "shop",
      code: "22021",
      swallowed: 1,
    });
    expect(JSON.stringify(lines)).not.toContain("probe-slug");
    expect(JSON.stringify(lines)).not.toContain("invalid byte sequence");
  });

  it("writes one line for a flood of refused statements, and still serves every page", async () => {
    // The line is what an anonymous GET can make the app write, so it is
    // bounded per instance. 200 requests, one line.
    refuseWithSqlState();
    const fresh = await freshProxy();
    const responses: Response[] = [];
    const lines = await logged(async () => {
      for (let i = 0; i < 200; i += 1) {
        responses.push(await runOn(fresh, request("/s/probe-slug")));
      }
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", swallowed: 1 });
    // Failing open is the behaviour the damper must not have disturbed: every
    // one of those requests still served its page rather than a refusal.
    expect(responses.filter((res) => rewriteTarget(res) !== null)).toEqual([]);
  });

  it("carries the swallowed count into the next interval, so the rate stays visible", async () => {
    // Damped is not dropped. The second line says how many the first stood in
    // for, the same as `rate_limit.store_failed`.
    refuseWithSqlState();
    const fresh = await freshProxy();
    const first = await logged(async () => {
      for (let i = 0; i < 200; i += 1) await runOn(fresh, request("/s/probe-slug"));
    });
    expect(first).toHaveLength(1);

    // The unit clock is frozen, so a minute has to be stated rather than waited
    // for.
    const later = new Date(Date.parse(TEST_FROZEN_CLOCK) + 61_000).toISOString();
    vi.stubEnv("DIVEDAY_CLOCK", later);
    try {
      const second = await logged(() => runOn(fresh, request("/s/probe-slug")));
      expect(second).toHaveLength(1);
      expect(second[0]).toMatchObject({
        level: "warn",
        event: "public_route.existence_query_refused",
        swallowed: 200,
      });
    } finally {
      // `vitest.config.ts` sets `DIVEDAY_CLOCK` process-wide and nothing
      // unstubs it between tests, so leaving this stubbed would hand a clock 61
      // seconds ahead to every later test in this worker — and the frozen
      // instant is load-bearing in several of them.
      vi.unstubAllEnvs();
    }
  });

  it("alarms on our own credentials being rejected, mid-flood and undamped", async () => {
    // `28P01` is our own `DATABASE_URL` being refused: no bound parameter
    // produces it, and it takes this whole check back to fail-open soft 404s
    // for every diver. It used to classify into the damped `warn` branch, where
    // no metric counted it and whoever was flooding `/s/%00` could at best
    // delay it by a minute (issue #1750). It is now the `error` line
    // `DatabaseUnavailable` alarms on at one datapoint in five minutes, which
    // is never damped — so it arrives on its first occurrence even while a
    // flood is in progress.
    refuseWithSqlState();
    const fresh = await freshProxy();
    const lines = await logged(async () => {
      for (let i = 0; i < 50; i += 1) await runOn(fresh, request("/s/probe-slug"));
      existence.throwsWith = Object.assign(new Error("password authentication failed"), {
        code: "28P01",
      });
      await runOn(fresh, request("/s/probe-slug"));
      await runOn(fresh, request("/s/probe-slug"));
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      level: "warn",
      event: "public_route.existence_query_refused",
      code: "22021",
      swallowed: 1,
    });
    for (const line of lines.slice(1)) {
      expect(line).toMatchObject({
        level: "error",
        event: "public_route.existence_unavailable",
        shape: "shop",
        code: "28P01",
      });
    }
  });

  it("keeps one refused code's flood out of another's bucket", async () => {
    // A single global bucket would let whoever is sending `/s/%00` hold it open
    // and fold every other refused statement into `swallowed`, unreported —
    // letting a stranger choose what an operator can see. Both codes here are
    // class 22 now that the branch is narrowed to the caller's own bytes, and
    // `22P05` must still get its own first line mid-flood.
    refuseWithSqlState();
    const fresh = await freshProxy();
    const lines = await logged(async () => {
      for (let i = 0; i < 50; i += 1) await runOn(fresh, request("/s/probe-slug"));
      const driver = Object.assign(new Error("has no equivalent in encoding"), { code: "22P05" });
      existence.throwsWith = new Error("Failed query", { cause: driver });
      await runOn(fresh, request("/s/probe-slug"));
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ code: "22021", swallowed: 1, level: "warn" });
    expect(lines[1]).toMatchObject({ code: "22P05", swallowed: 1, level: "warn" });
  });

  it("never damps a database failure that is ours", async () => {
    // The other branch is the one worth waking somebody for:
    // `DatabaseUnavailable` alarms at one datapoint in five minutes, so a
    // damper on it would blunt the alarm the split exists to protect.
    existence.throws = true;
    existence.throwsWith = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });
    const fresh = await freshProxy();
    const lines = await logged(async () => {
      await runOn(fresh, request("/s/blue-mantis"));
      await runOn(fresh, request("/s/blue-mantis"));
    });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({
        level: "error",
        event: "public_route.existence_unavailable",
      });
    }
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
