import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_EMAIL } from "@/lib/platform-mail";
import { seededTestDb } from "@/test/db";

/**
 * **The demo half of the marketing funnel: the event, and the founder's alert**
 * (docs ADR 20260805-demo-try-alerts).
 *
 * `demo_entered` and its alert are the kind of code that stops working
 * silently — nothing renders, nothing 500s, the number just stops moving and
 * the inbox just goes quiet. So the assertions here are about *when* it fires
 * as much as *that* it fires:
 *
 * - exactly once, on a demo that actually got minted;
 * - never for an attempt the rate limiter refused, which is what it used to do
 *   when the event sat at the top of the action — a throttled visitor counted
 *   as an entry and inflated every demo-to-trial ratio read off the pair;
 * - carrying the three anonymous fields and nothing else;
 * - and never, ever taking the demo down with it when the alert fails.
 *
 * `after()` is stubbed to run its callback rather than defer it, so the
 * deferred work is observable; in production Next runs it once the redirect
 * response is already on its way (`after` fires even when the response ends in
 * `redirect` — node_modules/next/dist/docs/.../after.md).
 */

const hoisted = vi.hoisted(() => ({ afterTasks: [] as Promise<unknown>[] }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/server", () => ({
  after: vi.fn((task: () => unknown) => {
    hoisted.afterTasks.push(Promise.resolve().then(task));
  }),
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true })) };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(async () => {}) }));
vi.mock("@/db/notifications", () => ({
  sendNotification: vi.fn(async () => ({ status: "sent" })),
}));

const { getDb } = await import("@/db/client");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { trackEvent } = await import("@/lib/analytics");
const { sendNotification } = await import("@/db/notifications");
const { signIn } = await import("@/lib/auth");
const { enterDemoAction } = await import("./demo");

/** Run the action to its redirect, then drain the work it deferred with `after()`. */
async function enterDemo(form?: FormData): Promise<string> {
  let landing: string;
  try {
    await enterDemoAction(form);
    landing = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("REDIRECT:")) throw error;
    landing = message.slice("REDIRECT:".length);
  }
  await Promise.all(hoisted.afterTasks);
  return landing;
}

function demoForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

beforeEach(async () => {
  hoisted.afterTasks.length = 0;
  const db = await seededTestDb();
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  // `mockReset`, not `mockClear`: several tests below install a rejecting
  // implementation, and clearing only drops the call log — the rejection would
  // leak into every test after it and fail them somewhere unrelated.
  vi.mocked(trackEvent).mockReset();
  vi.mocked(trackEvent).mockResolvedValue(undefined);
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m1" });
  // The diver pick redirects straight to the public schedule and never signs
  // anyone in; the staff picks do, and Auth.js signals success by throwing.
  vi.mocked(signIn).mockImplementation(async (_provider, options) => {
    throw new Error(`REDIRECT:${(options as { redirectTo: string }).redirectTo}`);
  });
});

describe("enterDemoAction instrumentation", () => {
  it("fires demo_entered exactly once, with the role and the page that sent them", async () => {
    await enterDemo(demoForm({ role: "captain", source: "pricing" }));

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith({
      name: "demo_entered",
      source: "pricing",
      role: "captain",
    });
  });

  it("defaults an untagged CTA to the owner view and an unknown source", async () => {
    // The primary CTA sends no picker option and no tag; clamping happens in
    // the action, not the caller, so an unregistered tag can never open its own
    // bucket in the event stream (src/lib/funnel.ts).
    await enterDemo(demoForm({ source: "not-a-real-page" }));

    expect(trackEvent).toHaveBeenCalledWith({
      name: "demo_entered",
      source: "unknown",
      role: "owner",
    });
  });

  it("alerts the founder once, naming the minted shop, the role, and the source", async () => {
    const landing = await enterDemo(demoForm({ role: "diver", source: "home-hero" }));

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [, notification] = vi.mocked(sendNotification).mock.calls[0];
    expect(notification).toMatchObject({
      kind: "demo_started_alert",
      to: ALERT_EMAIL,
      role: "diver",
      source: "home-hero",
    });
    // The alert names the very shop the visitor was just sent to.
    expect(landing).toContain((notification as { shopSlug: string }).shopSlug);
  });

  it("carries nothing about the visitor — no identity exists to carry", async () => {
    // The security property of this path, pinned as an exact key set rather
    // than a spot check: a future field carrying an IP, a user agent, a
    // referrer, or the generated demo-owner email fails here.
    await enterDemo(demoForm({ role: "diver", source: "home-hero" }));

    const [, notification] = vi.mocked(sendNotification).mock.calls[0];
    expect(Object.keys(notification).sort()).toEqual([
      "kind",
      "role",
      "shopId",
      "shopSlug",
      "source",
      "to",
    ]);
    const trackedEvent = vi.mocked(trackEvent).mock.calls[0][0];
    expect(Object.keys(trackedEvent).sort()).toEqual(["name", "role", "source"]);
  });

  it("counts nothing when the rate limiter refused the attempt", async () => {
    // The regression this file was written for. The event used to fire at the
    // top of the action, so a throttled visitor — who never saw a demo at all
    // — was booked as an entry, and the founder got mail about a shop that was
    // never minted.
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);

    expect(await enterDemo(demoForm({ role: "owner", source: "pricing" }))).toBe(
      "/sign-in?error=1",
    );
    expect(trackEvent).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still lands the visitor in their demo when the alert throws", async () => {
    // Fail-soft is the whole contract: telemetry and alerting observe this
    // flow, they are never part of it.
    vi.mocked(sendNotification).mockRejectedValue(new Error("SES exploded"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const landing = await enterDemo(demoForm({ role: "diver", source: "home-hero" }));

    expect(landing).toMatch(/^\/s\//);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("still alerts, and still lands the visitor, when telemetry throws", async () => {
    // `trackEvent` swallows its own provider failures in production, so this
    // is the belt-and-braces case — and it is the one that found the bug it
    // now guards: with a single try block around both observers, a throw
    // escaping the analytics seam skipped the founder's mail silently.
    vi.mocked(trackEvent).mockRejectedValue(new Error("collector down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const landing = await enterDemo(demoForm({ role: "diver", source: "home-hero" }));

    expect(landing).toMatch(/^\/s\//);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe("announceDemoEntry failure paths", () => {
  it("sends no alert for a shop that is no longer there", async () => {
    // The minted shop is reaped after 7 days and can be deleted by the
    // fleet-wide cap at any time; a slug that no longer resolves is a missing
    // alert, never a thrown one.
    const { announceDemoEntry } = await import("./demo");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      announceDemoEntry({ slug: "never-existed", role: "owner", source: "nav" }),
    ).resolves.toBeUndefined();

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(sendNotification).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("swallows a database handle that will not open", async () => {
    const { announceDemoEntry } = await import("./demo");
    vi.mocked(getDb).mockRejectedValue(new Error("no database"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      announceDemoEntry({ slug: "blue-mantis", role: "owner", source: "nav" }),
    ).resolves.toBeUndefined();

    expect(sendNotification).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
