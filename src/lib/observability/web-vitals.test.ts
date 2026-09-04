import { describe, expect, it } from "vitest";
import {
  mutationDurationLogContext,
  normalizeBeaconPath,
  ratingFor,
  WEB_VITAL_NAMES,
  WEB_VITALS,
  webVitalsLogContext,
} from "./web-vitals";
import { mutationDurationBeaconSchema, webVitalsBeaconSchema } from "./web-vitals-beacon";

describe("the Core Web Vitals registry", () => {
  it("keeps every field name distinct — a metric filter reads one field each", () => {
    expect(new Set(WEB_VITALS.map((vital) => vital.field)).size).toBe(WEB_VITALS.length);
    expect(new Set(WEB_VITAL_NAMES).size).toBe(WEB_VITALS.length);
  });

  it("orders each band the way Google defines it", () => {
    for (const vital of WEB_VITALS) {
      expect(vital.good).toBeLessThan(vital.poor);
    }
  });
});

describe("ratingFor", () => {
  it("scores against Google's published boundaries", () => {
    expect(ratingFor("LCP", 1_200)).toBe("good");
    expect(ratingFor("LCP", 3_000)).toBe("needs_improvement");
    expect(ratingFor("LCP", 9_000)).toBe("poor");
    expect(ratingFor("CLS", 0.02)).toBe("good");
    expect(ratingFor("INP", 750)).toBe("poor");
  });

  it("counts a value exactly on a boundary as the better rating", () => {
    expect(ratingFor("LCP", 2_500)).toBe("good");
    expect(ratingFor("LCP", 4_000)).toBe("needs_improvement");
    expect(ratingFor("CLS", 0.1)).toBe("good");
  });
});

describe("webVitalsBeaconSchema", () => {
  const valid = {
    url: "/s/blue-mantis",
    navigationType: "navigate",
    metrics: [{ name: "LCP", value: 1_800 }],
  };

  it("accepts a well-formed beacon", () => {
    expect(webVitalsBeaconSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a value big enough to move a p75 on its own", () => {
    expect(
      webVitalsBeaconSchema.safeParse({
        ...valid,
        metrics: [{ name: "LCP", value: 999_999_999 }],
      }).success,
    ).toBe(false);
  });

  it("refuses a negative measurement", () => {
    expect(
      webVitalsBeaconSchema.safeParse({ ...valid, metrics: [{ name: "CLS", value: -1 }] }).success,
    ).toBe(false);
  });

  it("refuses a metric name it does not publish, rather than storing it", () => {
    expect(
      webVitalsBeaconSchema.safeParse({ ...valid, metrics: [{ name: "FID", value: 10 }] }).success,
    ).toBe(false);
  });

  it("refuses an empty report and an oversized one", () => {
    expect(webVitalsBeaconSchema.safeParse({ ...valid, metrics: [] }).success).toBe(false);
    expect(
      webVitalsBeaconSchema.safeParse({
        ...valid,
        metrics: Array.from({ length: WEB_VITALS.length + 1 }, () => ({
          name: "LCP" as const,
          value: 1,
        })),
      }).success,
    ).toBe(false);
  });

  it("bounds the URL rather than accepting an arbitrary string", () => {
    expect(webVitalsBeaconSchema.safeParse({ ...valid, url: "x".repeat(4_000) }).success).toBe(
      false,
    );
    expect(webVitalsBeaconSchema.safeParse({ ...valid, url: "" }).success).toBe(false);
  });
});

describe("normalizeBeaconPath", () => {
  it("keeps an ordinary path and its query", () => {
    expect(normalizeBeaconPath("/s/blue-mantis/trips/42?from=email")).toBe(
      "/s/blue-mantis/trips/42?from=email",
    );
  });

  it("drops the host, so a stranger cannot write someone else's URL into the log group", () => {
    expect(normalizeBeaconPath("https://evil.example/phish?x=1")).toBe("/phish?x=1");
    expect(normalizeBeaconPath("https://user:pass@evil.example/x")).toBe("/x");
  });

  it("drops the fragment, which no server ever sees anyway", () => {
    expect(normalizeBeaconPath("/s/blue-mantis#anchor")).toBe("/s/blue-mantis");
  });

  it("caps the length rather than logging whatever arrived", () => {
    expect(normalizeBeaconPath(`/${"a".repeat(2_000)}`).length).toBe(512);
  });

  it("leaves a capability prefix at the front, where the redaction looks for it", () => {
    // The cap must never be able to truncate a path into one the redaction no
    // longer recognises.
    expect(normalizeBeaconPath(`/waivers/${"t".repeat(2_000)}`).startsWith("/waivers/")).toBe(true);
  });

  it("fails closed on a URL it cannot parse", () => {
    expect(normalizeBeaconPath("http://[")).toBe("[unparseable]");
  });
});

describe("webVitalsLogContext", () => {
  const parse = (input: unknown) => {
    const parsed = webVitalsBeaconSchema.parse(input);
    return webVitalsLogContext(parsed, "/s/[shopSlug]");
  };

  it("flattens each metric to its own field, with a rating beside it", () => {
    expect(
      parse({
        url: "/ignored",
        navigationType: "navigate",
        metrics: [
          { name: "LCP", value: 1_800.4 },
          { name: "CLS", value: 0.0521 },
        ],
      }),
    ).toEqual({
      route: "/s/[shopSlug]",
      navigationType: "navigate",
      lcp: 1_800,
      lcpRating: "good",
      cls: 0.0521,
      clsRating: "good",
    });
  });

  it("keeps CLS's precision and rounds the timings", () => {
    const context = parse({
      url: "/x",
      metrics: [
        { name: "CLS", value: 0.123456789 },
        { name: "TTFB", value: 412.87 },
      ],
    });
    expect(context.cls).toBe(0.1235);
    expect(context.ttfb).toBe(413);
  });

  it("takes the last value when a metric is reported more than once", () => {
    // The browser re-reports INP and CLS as a visit degrades; the final figure
    // is the one that describes the visit.
    const context = parse({
      url: "/x",
      metrics: [
        { name: "INP", value: 90 },
        { name: "INP", value: 340 },
      ],
    });
    expect(context.inp).toBe(340);
    expect(context.inpRating).toBe("needs_improvement");
  });

  it("uses the route it was handed, never the URL from the beacon body", () => {
    // Redaction happens at the route handler; this module must not be able to
    // leak a capability token by preferring its own input.
    const context = parse({ url: "/waivers/secret-token", metrics: [{ name: "LCP", value: 10 }] });
    expect(JSON.stringify(context)).not.toContain("secret-token");
    expect(context.route).toBe("/s/[shopSlug]");
  });

  it("omits a navigation type that was never reported", () => {
    expect(parse({ url: "/x", metrics: [{ name: "LCP", value: 10 }] })).not.toHaveProperty(
      "navigationType",
    );
  });
});

describe("mutationDurationBeaconSchema", () => {
  it("accepts bounded action duration samples and rounds the log value", () => {
    const parsed = mutationDurationBeaconSchema.parse({
      mutations: [{ action: "roll-call", durationMs: 120.26 }],
    });
    const mutation = parsed.mutations[0];
    expect(mutation).toBeDefined();
    if (!mutation) throw new Error("expected one mutation");
    expect(mutationDurationLogContext(mutation)).toEqual({
      action: "roll-call",
      durationMs: 120.3,
    });
  });

  it("rejects unbounded or identifying action labels", () => {
    expect(
      mutationDurationBeaconSchema.safeParse({
        mutations: [{ action: "roll call", durationMs: 10 }],
      }).success,
    ).toBe(false);
    expect(
      mutationDurationBeaconSchema.safeParse({
        mutations: [{ action: "x", durationMs: 700_000 }],
      }).success,
    ).toBe(false);
  });
});
