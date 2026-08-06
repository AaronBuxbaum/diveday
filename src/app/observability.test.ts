import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_ROUTE_PREFIXES,
  redactBreadcrumb,
  redactCapabilityUrl,
  redactEvent,
} from "./observability";

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Every `[token]` route directory under `src/app`, as `{ prefix, depth }`.
 *
 * `redactCapabilityUrl` only ever inspects the *first* path segment, so a
 * capability route nested any deeper than `src/app/<prefix>/[token]` would be
 * silently unredactable — the depth is returned so the test below can fail on
 * that rather than quietly pass.
 */
function tokenRoutesOnDisk(
  dir = APP_DIR,
  trail: string[] = [],
): { prefix: string; depth: number }[] {
  const found: { prefix: string; depth: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "[token]") {
      found.push({ prefix: trail[0] ?? "", depth: trail.length });
      continue;
    }
    found.push(...tokenRoutesOnDisk(join(dir, entry.name), [...trail, entry.name]));
  }
  return found;
}

/**
 * The guard that would have caught `/unsubscribe/[token]`.
 *
 * A capability route is created by adding a directory, and nothing about that
 * act reminds anyone to come here — which is exactly how the unsubscribe token
 * reached Analytics, Speed Insights and Sentry in the clear. Anchoring the
 * assertion to the filesystem means the next one fails this test on the commit
 * that creates it, instead of on the review that happens to look.
 */
describe("CAPABILITY_ROUTE_PREFIXES", () => {
  const onDisk = tokenRoutesOnDisk();

  it("covers every [token] route directory under src/app", () => {
    expect([...new Set(onDisk.map((r) => r.prefix))].sort()).toEqual(
      [...CAPABILITY_ROUTE_PREFIXES].sort(),
    );
  });

  it("finds every [token] route at a depth the first-segment check can reach", () => {
    expect(onDisk.filter((r) => r.depth !== 1)).toEqual([]);
  });

  it.each([...CAPABILITY_ROUTE_PREFIXES])("redacts /%s/<token>", (prefix) => {
    expect(redactCapabilityUrl(`/${prefix}/abc123.def456`)).toBe(`/${prefix}/[token]`);
  });

  it.each([...CAPABILITY_ROUTE_PREFIXES])("redacts a URL-encoded /%s/<token>", (prefix) => {
    const encoded = prefix.replace(/-/g, "%2D");
    expect(redactCapabilityUrl(`/${encoded}/abc123.def456`)).toBe(`/${prefix}/[token]`);
  });

  it.each([...CAPABILITY_ROUTE_PREFIXES])("redacts an absolute /%s/<token> URL", (prefix) => {
    expect(redactCapabilityUrl(`https://diveday.app/${prefix}/abc123.def456`)).toBe(
      `/${prefix}/[token]`,
    );
  });
});

describe("redactCapabilityUrl", () => {
  it("redacts a waiver token path", () => {
    expect(redactCapabilityUrl("/waivers/abc123.def456")).toBe("/waivers/[token]");
  });

  it("redacts a readiness token path", () => {
    expect(redactCapabilityUrl("/ready/abc123.def456")).toBe("/ready/[token]");
  });

  it("redacts a recap token path", () => {
    expect(redactCapabilityUrl("/recap/abc123.def456")).toBe("/recap/[token]");
  });

  it("redacts a verify-email token path", () => {
    expect(redactCapabilityUrl("/verify/abc123.def456")).toBe("/verify/[token]");
  });

  it("redacts a password-reset token path", () => {
    expect(redactCapabilityUrl("/reset-password/abc123.def456")).toBe("/reset-password/[token]");
  });

  it("redacts a staff-invite token path", () => {
    expect(redactCapabilityUrl("/invite/abc123.def456")).toBe("/invite/[token]");
  });

  it("redacts a seat-claim token path", () => {
    expect(redactCapabilityUrl("/claim/abc123.def456")).toBe("/claim/[token]");
  });

  it("redacts a staff calendar-feed token path", () => {
    expect(redactCapabilityUrl("/calendar/abc123.def456")).toBe("/calendar/[token]");
  });

  it("redacts a calendar-feed token even with the .ics segment suffix a client subscribes to", () => {
    expect(redactCapabilityUrl("/calendar/abc123.def456.ics")).toBe("/calendar/[token]");
  });

  it("redacts an email-unsubscribe token path", () => {
    expect(redactCapabilityUrl("/unsubscribe/abc123.def456")).toBe("/unsubscribe/[token]");
  });

  it("redacts even with query string and hash", () => {
    expect(redactCapabilityUrl("/ready/abc123.def456?photo=error#section")).toBe("/ready/[token]");
  });

  it("redacts a URL-encoded token-shaped path", () => {
    expect(redactCapabilityUrl("/waivers/abc%2Ecd%2E123")).toBe("/waivers/[token]");
  });

  it("redacts a URL-encoded route prefix", () => {
    expect(redactCapabilityUrl("/%77aivers/abc123.def456")).toBe("/waivers/[token]");
  });

  it("redacts regardless of prefix casing", () => {
    expect(redactCapabilityUrl("/Waivers/abc123.def456")).toBe("/waivers/[token]");
    expect(redactCapabilityUrl("/READY/abc123.def456")).toBe("/ready/[token]");
  });

  it("redacts an absolute URL with a capability path", () => {
    expect(redactCapabilityUrl("https://diveday.example/recap/abc123.def456")).toBe(
      "/recap/[token]",
    );
  });

  it("leaves ordinary public pages unchanged", () => {
    expect(redactCapabilityUrl("/s/blue-hole")).toBe("/s/blue-hole");
  });

  it("leaves ordinary staff pages unchanged", () => {
    expect(redactCapabilityUrl("/shop/blue-hole/trips/today?filter=open")).toBe(
      "/shop/blue-hole/trips/today?filter=open",
    );
  });

  it("leaves the root path unchanged", () => {
    expect(redactCapabilityUrl("/")).toBe("/");
  });

  it("does not treat a prefix-only path as a leak but still passes it through untouched", () => {
    // No token segment present; nothing to redact, and nothing sensitive to hide.
    expect(redactCapabilityUrl("/ready")).toBe("/ready");
  });

  it("does not choke on a malformed percent-encoding", () => {
    expect(() => redactCapabilityUrl("/waivers/%E0%A4%A")).not.toThrow();
  });

  it("redacts the schedule-confirmation page's ?booking= token, even though the path itself isn't capability-prefixed (security review finding on CR-001)", () => {
    expect(redactCapabilityUrl("/s/blue-hole/trips/trip-123?booking=abc123.def456")).toBe(
      "/s/blue-hole/trips/trip-123?booking=%5Btoken%5D",
    );
  });

  it("redacts ?booking= alongside other, non-sensitive query params", () => {
    const redacted = redactCapabilityUrl(
      "/s/blue-hole/trips/trip-123?booking=abc123.def456&error=pay",
    );
    expect(redacted).toContain("booking=%5Btoken%5D");
    expect(redacted).toContain("error=pay");
    expect(redacted).not.toContain("abc123.def456");
  });

  it("redacts ?booking= on an absolute URL, including one returned from a third party (Stripe checkout)", () => {
    expect(
      redactCapabilityUrl(
        "https://diveday.example/s/blue-hole/trips/trip-123?booking=abc123.def456",
      ),
    ).toBe("/s/blue-hole/trips/trip-123?booking=%5Btoken%5D");
  });

  it("leaves a schedule page with no booking token untouched", () => {
    expect(redactCapabilityUrl("/s/blue-hole/trips/trip-123")).toBe("/s/blue-hole/trips/trip-123");
  });
});

describe("redactEvent", () => {
  it("redacts a capability token in the request URL", () => {
    const event = redactEvent({
      type: undefined,
      request: { url: "https://app.example/waivers/abc123.def456" },
    });
    expect(event.request?.url).toBe("/waivers/[token]");
  });

  it("redacts a capability token in the referer header", () => {
    const event = redactEvent({
      type: undefined,
      request: { headers: { Referer: "https://app.example/ready/abc123.def456" } },
    });
    expect(event.request?.headers?.Referer).toBe("/ready/[token]");
  });

  it("leaves an event with no request untouched", () => {
    expect(redactEvent({ type: undefined })).toEqual({ type: undefined });
  });
});

describe("redactBreadcrumb", () => {
  it("redacts navigation from/to URLs", () => {
    const breadcrumb = redactBreadcrumb({
      category: "navigation",
      data: { from: "/recap/abc123.def456", to: "/s/blue-hole" },
    });
    expect(breadcrumb.data?.from).toBe("/recap/[token]");
    expect(breadcrumb.data?.to).toBe("/s/blue-hole");
  });

  it("redacts an xhr/fetch breadcrumb URL", () => {
    const breadcrumb = redactBreadcrumb({
      category: "fetch",
      data: { url: "/verify/abc123.def456" },
    });
    expect(breadcrumb.data?.url).toBe("/verify/[token]");
  });

  it("leaves an unrelated breadcrumb untouched", () => {
    const breadcrumb = redactBreadcrumb({ category: "console", data: { message: "hi" } });
    expect(breadcrumb.data?.message).toBe("hi");
  });

  it("leaves a breadcrumb with no data untouched", () => {
    expect(redactBreadcrumb({ category: "navigation" })).toEqual({ category: "navigation" });
  });
});
