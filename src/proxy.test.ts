import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { EMBED_REQUEST_HEADER, REQUEST_PATH_HEADER } from "@/lib/auth.config";

// The real NextAuth middleware wants an edge runtime and a session store; the
// behavior under test is everything the proxy does *around* it — header
// stamping, the override-list wire protocol, frame denial — so stub it as
// "allowed, no Response of its own", the common case where the proxy falls
// back to NextResponse.next().
vi.mock("next-auth", () => ({
  default: () => ({ auth: () => Promise.resolve(undefined) }),
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
      request("/shop/blue-mantis/divers", { cookie: "authjs.session-token=abc" }),
    );
    const surviving = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(surviving).toContain("cookie");
    expect(surviving).toContain(EMBED_REQUEST_HEADER);
    expect(surviving).toContain(REQUEST_PATH_HEADER);
    expect(res.headers.get("x-middleware-request-cookie")).toBe("authjs.session-token=abc");
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
