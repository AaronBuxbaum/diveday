import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { EMBED_REQUEST_HEADER, REQUEST_PATH_HEADER } from "@/lib/embed-routes";

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

  it("does not grant embed on a non-embeddable route, ?embed=1 or not", async () => {
    const res = await run(request("/shop/blue-mantis/divers?embed=1"));
    expect(res.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe("");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
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
