import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_EMAIL } from "@/lib/platform-mail";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

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

const hoisted = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  signInDiveDayCredentials: vi.fn(async () => ({})),
  signOut: vi.fn(async () => ({})),
}));

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
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getAuth: vi.fn(async () => ({
    api: {
      signInDiveDayCredentials: hoisted.signInDiveDayCredentials,
      signOut: hoisted.signOut,
    },
  })),
}));
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

/**
 * Hydrate a database for the tests that actually mint a demo, and only those.
 *
 * Deliberately not a `beforeEach`: each call stands up its own ~250MB embedded
 * Postgres, and three of the tests here never reach one at all (the rate-limit
 * refusal redirects first, the server-action check is a module inspection, and
 * the failing-handle case wants `getDb` to reject). Paying for a hydration in
 * those was enough extra load to time this file out when the suite runs it
 * beside the other database-heavy specs.
 */
async function useDb(): Promise<void> {
  vi.mocked(getDb).mockResolvedValue(await seededTestDb());
}

beforeEach(() => {
  hoisted.afterTasks.length = 0;
  vi.mocked(getDb).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  // `mockReset`, not `mockClear`: several tests below install a rejecting
  // implementation, and clearing only drops the call log — the rejection would
  // leak into every test after it and fail them somewhere unrelated.
  vi.mocked(trackEvent).mockReset();
  vi.mocked(trackEvent).mockResolvedValue(undefined);
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m1" });
  // The diver pick redirects straight to the public schedule and never signs
  // anyone in; the staff picks do, resolving normally on success — the
  // action's own explicit redirect() call is what produces the landing.
  hoisted.signInDiveDayCredentials.mockReset().mockResolvedValue({});
});

describe("enterDemoAction instrumentation", () => {
  it("fires demo_entered exactly once, with the role and the page that sent them", async () => {
    await useDb();
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
    await useDb();
    await enterDemo(demoForm({ source: "not-a-real-page" }));

    expect(trackEvent).toHaveBeenCalledWith({
      name: "demo_entered",
      source: "unknown",
      role: "owner",
    });
  });

  it("alerts the founder once, and carries nothing about the visitor", async () => {
    await useDb();
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

    // The security property of this path, pinned as an exact key set rather
    // than a spot check: a future field carrying an IP, a user agent, a
    // referrer, or the generated demo-owner email fails here. Asserted on the
    // same entry rather than a second one — a whole demo shop is minted per
    // entry, and there is nothing a fresh mint would tell us that this one
    // doesn't.
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
    await useDb();
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
    await useDb();
    vi.mocked(trackEvent).mockRejectedValue(new Error("collector down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const landing = await enterDemo(demoForm({ role: "diver", source: "home-hero" }));

    expect(landing).toMatch(/^\/s\//);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe("announceDemoEntry failure paths", () => {
  it("is not a server action — it must never become a callable endpoint", async () => {
    // Security review of this change's own diff. `demo.ts` carries
    // `"use server"`, and every exported async function in such a module is a
    // callable endpoint that needs no session — `enterDemoAction` is reachable
    // by anyone by design. Exported from there, `announceDemoEntry` would take
    // a caller-supplied slug, role, and source: junk tags sprayed into the
    // funnel, founder mail about demo tries that never happened, and — with a
    // *real* shop's slug — a poisoned row written into that tenant's
    // `notification_send_queue`. The TypeScript signature stops none of it.
    const serverActionModule = await import("./demo");
    expect(serverActionModule).not.toHaveProperty("announceDemoEntry");
  });

  it("sends no alert for a shop that is no longer there", async () => {
    // The minted shop is reaped after 7 days and can be deleted by the
    // fleet-wide cap at any time; a slug that no longer resolves is a missing
    // alert, never a thrown one.
    await useDb();
    const { announceDemoEntry } = await import("./demo-instrumentation");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      announceDemoEntry({ slug: "never-existed", role: "owner", source: "nav" }),
    ).resolves.toBeUndefined();

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(sendNotification).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("swallows a database handle that will not open", async () => {
    const { announceDemoEntry } = await import("./demo-instrumentation");
    vi.mocked(getDb).mockRejectedValue(new Error("no database"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      announceDemoEntry({ slug: "blue-mantis", role: "owner", source: "nav" }),
    ).resolves.toBeUndefined();

    expect(sendNotification).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
