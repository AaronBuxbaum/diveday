import { track as vercelTrack } from "@vercel/analytics/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AnalyticsEvent, type Tracker, trackEvent } from "./analytics";

// The default tracker is the only path that touches the network; stubbing it
// lets the provider-skip rule be asserted without making a real request.
vi.mock("@vercel/analytics/server", () => ({ track: vi.fn() }));

describe("trackEvent", () => {
  beforeEach(() => {
    vi.mocked(vercelTrack).mockClear();
  });

  it("splits the event name from its properties and forwards them", async () => {
    const calls: Array<{ name: string; props: unknown }> = [];
    const tracker: Tracker = (name, props) => {
      calls.push({ name, props });
    };
    const event: AnalyticsEvent = {
      name: "staff_recovery",
      kind: "waiver_sent",
      surface: "today",
    };
    await trackEvent(event, tracker);
    expect(calls).toEqual([
      { name: "staff_recovery", props: { kind: "waiver_sent", surface: "today" } },
    ]);
  });

  it("never throws when the tracker fails — telemetry is best-effort", async () => {
    const tracker: Tracker = () => {
      throw new Error("provider down");
    };
    await expect(
      trackEvent({ name: "blockers_surfaced", count: 3, urgent: 1 }, tracker),
    ).resolves.toBeUndefined();
  });

  it("awaits an async tracker and swallows a rejected promise", async () => {
    const rejecting = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(
      trackEvent({ name: "checkout_abandoned", isDeposit: true }, rejecting),
    ).resolves.toBeUndefined();
    expect(rejecting).toHaveBeenCalledWith("checkout_abandoned", { isDeposit: true });
  });

  it("skips the default provider when external HTTP is disabled", async () => {
    // Regression: the default tracker is a network call, and `trackEvent` is
    // awaited at the top of `enterDemoAction` before the shop is minted. Under
    // restricted egress the call hangs until it fails rather than erroring
    // fast, adding that stall to a user-facing flow — in e2e it blew past the
    // 15s per-test budget with the CTA stuck on "Getting your shop ready…".
    // Best-effort telemetry must not be able to add latency either.
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    await expect(
      trackEvent({ name: "demo_entered", source: "home-hero" }),
    ).resolves.toBeUndefined();
    expect(vercelTrack).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("still runs an injected tracker when external HTTP is disabled", async () => {
    // The flag turns off the *provider*, not the seam: unit tests that inject
    // a tracker still exercise the mapping (mirrors marine-forecast.ts).
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    const tracker = vi.fn();
    await trackEvent({ name: "demo_entered", source: "home-hero" }, tracker);
    expect(tracker).toHaveBeenCalledWith("demo_entered", { source: "home-hero" });
    vi.unstubAllEnvs();
  });

  it("carries the funnel source on both halves of the marketing funnel", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "demo_entered", source: "pricing" }, tracker);
    await trackEvent({ name: "trial_started", source: "pricing" }, tracker);
    expect(tracker.mock.calls).toEqual([
      ["demo_entered", { source: "pricing" }],
      ["trial_started", { source: "pricing" }],
    ]);
  });
});
