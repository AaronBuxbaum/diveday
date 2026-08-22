// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

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
