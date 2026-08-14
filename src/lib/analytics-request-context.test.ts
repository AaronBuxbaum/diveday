import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { installCapabilityUrlRedaction, redactingHolder } from "./analytics-request-context";

const REQUEST_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

/** A stand-in for the runtime's holder — the real one exists only on Vercel. */
function holderFor(url: string | undefined, extra: Record<string, unknown> = {}) {
  return { get: () => ({ url, ...extra }) };
}

describe("capability-URL redaction for server analytics", () => {
  it("redacts a waiver token out of the URL the analytics SDK would send", () => {
    const holder = redactingHolder(
      holderFor("https://dive.day/waivers/6f1e5d4c-3b2a-1908-7766-554433221100"),
    );
    const url = holder.get()?.url ?? "";
    expect(url).not.toContain("6f1e5d4c");
    expect(url).toContain("/waivers/");
  });

  it("redacts the confirm token, which is a query param rather than a path segment", () => {
    // The one a conversion tag would be put on, and the one no path-prefix rule
    // can reach.
    const holder = redactingHolder(
      holderFor(
        "https://dive.day/s/blue-mantis/trips/abc?booking=9f8e7d6c-5b4a-3928-1716-050403020100",
      ),
    );
    expect(holder.get()?.url).not.toContain("9f8e7d6c");
  });

  it("leaves an ordinary page URL exactly as it was", () => {
    const plain = "https://dive.day/s/blue-mantis";
    expect(redactingHolder(holderFor(plain)).get()?.url).toBe(plain);
  });

  it("keeps everything else on the context, since the runtime shares that object", () => {
    // `waitUntil` and friends live on the same object the SDK reads `url` from.
    // Dropping them would break request lifetime handling, not just telemetry.
    const waitUntil = () => undefined;
    const holder = redactingHolder(holderFor("https://dive.day/waivers/tok", { waitUntil }));
    expect(holder.get()).toMatchObject({ waitUntil });
  });

  it("does not nest shims when installed twice", () => {
    const scope: Record<PropertyKey, unknown> = {
      [REQUEST_CONTEXT_SYMBOL]: holderFor("https://dive.day/waivers/tok"),
    };
    expect(installCapabilityUrlRedaction(scope).installed).toBe(true);
    const once = scope[REQUEST_CONTEXT_SYMBOL];
    expect(installCapabilityUrlRedaction(scope).installed).toBe(true);
    expect(scope[REQUEST_CONTEXT_SYMBOL]).toBe(once);
  });

  it("reports nothing to install when the runtime has not set the global", () => {
    // Dev, tests, self-hosted: no context, and correspondingly nothing to leak.
    expect(installCapabilityUrlRedaction({}).installed).toBe(false);
  });

  it("tolerates a context with no url rather than throwing inside telemetry", () => {
    expect(redactingHolder(holderFor(undefined)).get()?.url).toBeUndefined();
    expect(redactingHolder({ get: () => undefined }).get()).toBeUndefined();
  });
});

/**
 * The contract this fix rests on is **internal** to Vercel's runtime. If an
 * upgrade renames the symbol or stops reading `requestContext.url`, the shim
 * keeps "working" and silently stops redacting — the same silent failure it
 * exists to prevent. So the assertion is made against the installed SDK's own
 * source rather than against our belief about it.
 */
describe("the @vercel/analytics contract this depends on", () => {
  const sdk = readFileSync("node_modules/@vercel/analytics/dist/server/index.mjs", "utf8");

  it("still reads the page URL from the request-context global", () => {
    expect(sdk).toContain('Symbol.for("@vercel/request-context")');
    // The line that composes the event's page URL, `o`. If this stops matching,
    // read `track` in that file before assuming the redaction still holds.
    expect(sdk).toMatch(/o:\s*\(?\s*requestContext[\s\S]{0,60}?\.url/);
  });

  it("still offers no way for a caller to supply that URL itself", () => {
    // The reason the fix is a global wrapper rather than an argument. If a
    // future release adds an override (or a `beforeSend`), prefer it and delete
    // the shim -- see the upstream request in
    // docs/product/follow-ups/FU-20260814-vercel-analytics-url-override.md.
    expect(sdk).not.toMatch(/options\s*(\?\.)?\s*\.\s*url\b/);
  });
});
