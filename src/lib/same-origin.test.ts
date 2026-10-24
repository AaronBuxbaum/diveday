import { describe, expect, it } from "vitest";
import { isCrossSiteHeaders, isCrossSiteRequest } from "./same-origin";

const at = (headers: Record<string, string>) =>
  new Request("https://diveday.test/api/x", { method: "POST", headers });

describe("isCrossSiteRequest (security review 2, L5)", () => {
  it("lets the app's own requests through, and a request with no Origin to the session check", () => {
    expect(isCrossSiteRequest(at({ Origin: "https://diveday.test" }))).toBe(false);
    expect(isCrossSiteRequest(at({ "Sec-Fetch-Site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(at({}))).toBe(false);
  });

  it("refuses another origin, the opaque null origin, and a cross-site fetch", () => {
    expect(isCrossSiteRequest(at({ Origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteRequest(at({ Origin: "http://diveday.test" }))).toBe(true);
    expect(isCrossSiteRequest(at({ Origin: "null" }))).toBe(true);
    expect(isCrossSiteRequest(at({ "Sec-Fetch-Site": "cross-site" }))).toBe(true);
  });
});

describe("isCrossSiteHeaders (security review of #2990, M1 and L1)", () => {
  // `publicAppUrl()` is DiveDay's own origin unless APP_HOST overrides it.
  const PUBLIC = "https://dive.day";
  const sent = (headers: Record<string, string>) => new Headers(headers);

  it("refuses a cross-site navigation or call, whatever else it carries", () => {
    expect(isCrossSiteHeaders(sent({ "sec-fetch-site": "cross-site", host: "dive.day" }))).toBe(
      true,
    );
    expect(
      isCrossSiteHeaders(
        sent({ "sec-fetch-site": "cross-site", host: "dive.day", origin: "https://dive.day" }),
      ),
    ).toBe(true);
  });

  it("allows the app's own navigation, a typed URL, and a same-site one from the app", () => {
    expect(isCrossSiteHeaders(sent({ "sec-fetch-site": "same-origin", host: "dive.day" }))).toBe(
      false,
    );
    expect(isCrossSiteHeaders(sent({ "sec-fetch-site": "none", host: "dive.day" }))).toBe(false);
    // Served at an internal host behind a proxy, opened from the public one.
    expect(
      isCrossSiteHeaders(
        sent({ "sec-fetch-site": "same-site", host: "internal:3000", referer: `${PUBLIC}/shop/x` }),
      ),
    ).toBe(false);
  });

  it("refuses a same-site navigation from a sibling host that is not DiveDay's", () => {
    expect(
      isCrossSiteHeaders(
        sent({
          "sec-fetch-site": "same-site",
          host: "app.example.test",
          referer: "https://blog.example.test/post",
        }),
      ),
    ).toBe(true);
    expect(isCrossSiteHeaders(sent({ "sec-fetch-site": "same-site", host: "dive.day" }))).toBe(
      true,
    );
  });

  it("accepts the request's own host or DiveDay's public origin, and nothing else", () => {
    expect(isCrossSiteHeaders(sent({ host: "dive.day", origin: "https://dive.day" }))).toBe(false);
    expect(
      isCrossSiteHeaders(
        sent({
          host: "internal:3000",
          "x-forwarded-host": "shop.test",
          origin: "https://shop.test",
        }),
      ),
    ).toBe(false);
    // A proxy that rewrote Host and set no x-forwarded-host (L1).
    expect(isCrossSiteHeaders(sent({ host: "internal:3000", origin: PUBLIC }))).toBe(false);
    expect(isCrossSiteHeaders(sent({ host: "dive.day", origin: "https://evil.example" }))).toBe(
      true,
    );
    expect(isCrossSiteHeaders(sent({ host: "dive.day", origin: "null" }))).toBe(true);
    expect(isCrossSiteHeaders(sent({ origin: "null" }))).toBe(true);
  });

  it("with no fetch metadata, reads the referer, and lets a bare request through", () => {
    expect(
      isCrossSiteHeaders(sent({ host: "dive.day", referer: "https://evil.example/page" })),
    ).toBe(true);
    expect(isCrossSiteHeaders(sent({ host: "dive.day", referer: "https://dive.day/shop" }))).toBe(
      false,
    );
    expect(isCrossSiteHeaders(sent({ host: "dive.day" }))).toBe(false);
  });
});
