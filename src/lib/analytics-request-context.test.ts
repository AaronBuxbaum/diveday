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
    expect(installCapabilityUrlRedaction(scope).status).toBe("installed");
    const once = scope[REQUEST_CONTEXT_SYMBOL];
    expect(installCapabilityUrlRedaction(scope).status).toBe("installed");
    expect(scope[REQUEST_CONTEXT_SYMBOL]).toBe(once);
    const url = (scope[REQUEST_CONTEXT_SYMBOL] as { get: () => { url: string } }).get().url;
    expect(url).toBe("/waivers/[token]");
  });

  it("reports nothing to install when the runtime has not set the global", () => {
    // Dev, tests, self-hosted: no context, and correspondingly nothing to leak.
    expect(installCapabilityUrlRedaction({}).status).toBe("absent");
  });

  /**
   * The production shape, and the regression this file most needs to hold.
   *
   * Vercel's runtime does not merely *set* the global — it defines the slot
   * non-writable, so the `scope[SYMBOL] = ...` this used to install with threw
   * a TypeError on every server-side event: an error out of each `after()`
   * callback, and an unhandled rejection out of `authorize()`'s fire-and-forget
   * `trackEvent` that took a sign-in to a 504.
   */
  describe("when the runtime's global slot is read-only, as it is on Vercel", () => {
    function vercelScope(url: string) {
      const scope: Record<PropertyKey, unknown> = {};
      Object.defineProperty(scope, REQUEST_CONTEXT_SYMBOL, {
        value: holderFor(url),
        writable: false,
        configurable: false,
        enumerable: false,
      });
      return scope;
    }

    it("installs without throwing", () => {
      const scope = vercelScope("https://dive.day/waivers/tok");
      expect(() => installCapabilityUrlRedaction(scope)).not.toThrow();
      expect(installCapabilityUrlRedaction(scope).status).toBe("installed");
    });

    it("actually redacts, rather than merely surviving", () => {
      // The half a swallowed error would have hidden: not throwing is worthless
      // if the token still reaches the SDK.
      const scope = vercelScope("https://dive.day/waivers/6f1e5d4c-3b2a-1908-7766-554433221100");
      installCapabilityUrlRedaction(scope);
      const holder = scope[REQUEST_CONTEXT_SYMBOL] as { get: () => { url: string } };
      expect(holder.get().url).toBe("/waivers/[token]");
    });

    it("redacts for a reference captured before the install, too", () => {
      // Swapping the holder's `get` in place rather than the slot is what makes
      // this hold — anything the runtime handed out earlier reads the shim.
      const scope = vercelScope("https://dive.day/ready/tok");
      const captured = scope[REQUEST_CONTEXT_SYMBOL] as { get: () => { url: string } };
      installCapabilityUrlRedaction(scope);
      expect(captured.get().url).toBe("/ready/[token]");
    });

    it("does not recurse when read twice", () => {
      // The shim's `get` is assigned back onto the holder it reads through, so
      // a late (rather than bound) read of the original would be infinite.
      const scope = vercelScope("https://dive.day/s/blue-mantis");
      installCapabilityUrlRedaction(scope);
      const holder = scope[REQUEST_CONTEXT_SYMBOL] as { get: () => { url: string } };
      expect(holder.get().url).toBe("https://dive.day/s/blue-mantis");
      expect(holder.get().url).toBe("https://dive.day/s/blue-mantis");
    });
  });

  it("reports failure, without throwing, when nothing can be wrapped at all", () => {
    // Frozen holder in a read-only slot: no way in. `trackEvent` turns this
    // into a dropped event rather than an unredacted one.
    const scope: Record<PropertyKey, unknown> = {};
    Object.defineProperty(scope, REQUEST_CONTEXT_SYMBOL, {
      value: Object.freeze(holderFor("https://dive.day/waivers/tok")),
      writable: false,
      configurable: false,
    });
    expect(installCapabilityUrlRedaction(scope).status).toBe("failed");
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
    // Where the event's page URL comes from. If this stops matching, read
    // `track` in that file before assuming the redaction still holds.
    //
    // Matched loosely, on the *derivation* rather than on the `o:` property it
    // used to be written inline against. vercel/analytics#208 hoists the same
    // expression into a `pageUrl` local so a `beforeSend` hook can edit it
    // before the body is built -- after which `o: pageUrl` no longer names
    // `requestContext` at all, though the SDK reads it exactly as before and
    // the shim keeps working. Pinned to the old shape this would have gone red
    // on that release saying the redaction contract had broken, which is both
    // false and the opposite of the actual news. The arrival of a supported
    // API is the `beforeSend` assertion's job to report, and only its job.
    expect(sdk).toMatch(/requestContext[\s\S]{0,40}?\.url/);
  });

  it("still offers no way for a caller to supply that URL itself", () => {
    // The reason the fix is a global wrapper rather than an argument. If a
    // future release adds an override, prefer it and delete the shim -- see the
    // upstream request in
    // docs/product/follow-ups/FU-20260814-vercel-analytics-url-override.md.
    expect(sdk).not.toMatch(/options\s*(\?\.)?\s*\.\s*url\b/);
    // Name the proposed shape too, not just the generic one. The request went
    // upstream as vercel/analytics#208, a `beforeSend` hook mirroring the
    // browser SDK's -- whose source reads `options?.beforeSend` and `event.url`
    // and so matches neither the regex above nor anything else here. This is a
    // tripwire, and a tripwire that stays green through exactly the API we
    // asked for is no tripwire at all: without this line the shim would have
    // outlived its own replacement, silently, which is the failure mode this
    // whole file exists to avoid.
    expect(sdk).not.toContain("beforeSend");
  });
});
