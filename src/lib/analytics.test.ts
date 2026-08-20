import { track as vercelTrack } from "@vercel/analytics/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      trackEvent({ name: "demo_entered", source: "home-hero", role: "owner" }),
    ).resolves.toBeUndefined();
    expect(vercelTrack).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("still runs an injected tracker when external HTTP is disabled", async () => {
    // The flag turns off the *provider*, not the seam: unit tests that inject
    // a tracker still exercise the mapping (mirrors marine-forecast.ts).
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    const tracker = vi.fn();
    await trackEvent({ name: "demo_entered", source: "home-hero", role: "owner" }, tracker);
    expect(tracker).toHaveBeenCalledWith("demo_entered", { source: "home-hero", role: "owner" });
    vi.unstubAllEnvs();
  });

  /**
   * The capability-URL redaction is installed from in here, and installing it
   * used to throw on Vercel, where the request-context slot is read-only. That
   * broke the contract every caller leans on: `authorize()` in `src/lib/auth.ts`
   * calls this as a bare `void trackEvent(...)` *because* it swallows its own
   * errors, so the TypeError surfaced as an unhandled rejection on the sign-in
   * path and as an error out of every `after()` callback that tracks an event.
   */
  describe("with the request-context global Vercel actually provides", () => {
    const REQUEST_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

    /** Read-only like the real one, but configurable so the test can clean up. */
    function installReadOnlyContext(holder: unknown) {
      Object.defineProperty(globalThis, REQUEST_CONTEXT_SYMBOL, {
        value: holder,
        writable: false,
        configurable: true,
        enumerable: false,
      });
    }

    afterEach(() => {
      delete (globalThis as Record<PropertyKey, unknown>)[REQUEST_CONTEXT_SYMBOL];
    });

    it("still sends the event instead of throwing out of telemetry", async () => {
      installReadOnlyContext({ get: () => ({ url: "https://dive.day/waivers/tok" }) });
      await expect(trackEvent({ name: "waiver_signed" })).resolves.toBeUndefined();
      expect(vercelTrack).toHaveBeenCalledWith("waiver_signed", {});
    });

    it("redacts the capability URL the SDK will read for itself", async () => {
      installReadOnlyContext({ get: () => ({ url: "https://dive.day/waivers/tok" }) });
      await trackEvent({ name: "waiver_signed" });
      const holder = (globalThis as Record<PropertyKey, unknown>)[REQUEST_CONTEXT_SYMBOL] as {
        get: () => { url: string };
      };
      expect(holder.get().url).toBe("/waivers/[token]");
    });

    it("drops the event rather than send it unredacted when nothing can be wrapped", async () => {
      // Fail closed. The SDK composes the page URL from this context itself and
      // offers no override, so an un-wrappable context means the only way not to
      // ship a live waiver token to Vercel Analytics is not to ship the event.
      installReadOnlyContext(
        Object.freeze({ get: () => ({ url: "https://dive.day/waivers/tok" }) }),
      );
      await expect(trackEvent({ name: "waiver_signed" })).resolves.toBeUndefined();
      expect(vercelTrack).not.toHaveBeenCalled();
    });
  });

  it("carries the funnel source on both halves of the marketing funnel", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "demo_entered", source: "pricing", role: "captain" }, tracker);
    await trackEvent({ name: "trial_started", source: "pricing" }, tracker);
    expect(tracker.mock.calls).toEqual([
      ["demo_entered", { source: "pricing", role: "captain" }],
      ["trial_started", { source: "pricing" }],
    ]);
  });

  it("carries the refusal reason for a blocked booking, the confusion signal", async () => {
    const tracker = vi.fn();
    await trackEvent(
      { name: "booking_blocked", source: "diver", reason: "course_prerequisite" },
      tracker,
    );
    expect(tracker).toHaveBeenCalledWith("booking_blocked", {
      source: "diver",
      reason: "course_prerequisite",
    });
  });

  it("carries which schedule builder mutation ran and how it landed", async () => {
    const tracker = vi.fn();
    await trackEvent(
      { name: "schedule_builder_action", action: "move", outcome: "already_sailed" },
      tracker,
    );
    expect(tracker).toHaveBeenCalledWith("schedule_builder_action", {
      action: "move",
      outcome: "already_sailed",
    });
  });

  it("distinguishes an automatic cancellation refund from a staff-run one", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "refund_issued", auto: true, status: "refunded" }, tracker);
    await trackEvent({ name: "refund_issued", auto: false, status: "manual" }, tracker);
    expect(tracker.mock.calls).toEqual([
      ["refund_issued", { auto: true, status: "refunded" }],
      ["refund_issued", { auto: false, status: "manual" }],
    ]);
  });

  it("records the trip packet button from the Overview surface", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "trip_print_pdf_clicked", surface: "trip_overview" }, tracker);
    expect(tracker).toHaveBeenCalledWith("trip_print_pdf_clicked", {
      surface: "trip_overview",
    });
  });
});
