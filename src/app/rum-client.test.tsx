// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { looksAutomated, rumConfig } from "./rum-client";

/**
 * **The data plane a RUM event is posted to follows the region it is signed
 * for**, with no help from us.
 *
 * `rum-client.tsx` used to pass an explicit
 * `endpoint: https://dataplane.rum.${region}.amazonaws.com`, and that line was
 * not decoration: aws-rum-web@3.2.0 handed its *whole* default config down as
 * though the caller had supplied it, and that default carries a hardcoded
 * `us-west-2` endpoint. So the library's own "substitute the region unless the
 * caller named an endpoint" branch saw an endpoint it had provided itself and
 * never ran. Every request outside us-west-2 was signed for its real region and
 * posted to us-west-2, and the data plane refused all of them —
 * `403 {"message":"Credential should be scoped to a valid region."}`, on every
 * page load (aws-observability/aws-rum-web#881).
 *
 * 3.2.1 merges only `signing` and `telemetries`, so the branch fires and the
 * workaround is gone. This is what stops it coming back silently: a dependency
 * bump that reintroduced the old merge order would leave no failing test, no
 * type error and no visible symptom in dev — only a monitor that quietly
 * receives nothing in production.
 */
describe("the RUM client's data plane", () => {
  it("follows the configured region without being told the endpoint", async () => {
    const { AwsRum } = await import("aws-rum-web");
    // Deliberately not us-west-2 — that is the one region where the old bug
    // was invisible, because the wrong default happened to be right.
    const rum = new AwsRum("app-id", "1.0.0", "eu-central-1", {
      sessionSampleRate: 0,
      telemetries: [],
      allowCookies: false,
      enableXRay: false,
      disableAutoPageView: true,
      dispatchInterval: 0,
    });

    const { config } = rum as unknown as { config: { endpoint: string } };
    expect(config.endpoint).toBe("https://dataplane.rum.eu-central-1.amazonaws.com");
  });
});

describe("the RUM session sample rate", () => {
  afterEach(() => vi.unstubAllEnvs());

  const configured = (rate?: string) => {
    vi.stubEnv("NEXT_PUBLIC_RUM_APP_MONITOR_ID", "app");
    vi.stubEnv("NEXT_PUBLIC_RUM_IDENTITY_POOL_ID", "pool");
    vi.stubEnv("NEXT_PUBLIC_RUM_GUEST_ROLE_ARN", "arn:aws:iam::1:role/guest");
    vi.stubEnv("NEXT_PUBLIC_RUM_REGION", "us-east-1");
    if (rate !== undefined) vi.stubEnv("NEXT_PUBLIC_RUM_SAMPLE_RATE", rate);
    return rumConfig()?.sessionSampleRate;
  };

  it("records one session in ten when nothing is set", () => {
    expect(configured()).toBe(0.1);
  });

  it("honours an explicit rate in range, including 0 and 1", () => {
    expect(configured("0.5")).toBe(0.5);
    expect(configured("0")).toBe(0);
    expect(configured("1")).toBe(1);
  });

  it("falls back to the default for anything unparseable or out of range", () => {
    expect(configured("")).toBe(0.1);
    expect(configured("lots")).toBe(0.1);
    expect(configured("2")).toBe(0.1);
    expect(configured("-1")).toBe(0.1);
  });
});

describe("which visitors RUM ignores", () => {
  const ua = (userAgent: string, webdriver = false) => looksAutomated({ userAgent, webdriver });

  it("skips crawlers, headless browsers and audit tools", () => {
    expect(ua("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(
      true,
    );
    expect(ua("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
    expect(ua("Mozilla/5.0 HeadlessChrome/120.0 Safari/537.36")).toBe(true);
    expect(ua("Mozilla/5.0 Chrome-Lighthouse")).toBe(true);
    expect(ua("Mozilla/5.0 (X11; Linux) Chrome/120", true)).toBe(true);
  });

  it("keeps real divers' browsers", () => {
    expect(
      ua(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
      ),
    ).toBe(false);
    expect(ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36")).toBe(false);
  });
});
