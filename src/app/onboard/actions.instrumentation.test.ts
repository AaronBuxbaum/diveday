import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_EMAIL } from "@/lib/platform-mail";
import { unseededTestDb } from "@/test/db";

/**
 * **The trial half of the marketing funnel: the event, and the founder's
 * alert** (docs ADR 20260727-sentry-error-monitoring-q7fk2p for the alert,
 * 20260805-demo-try-alerts for the pair).
 *
 * Both already shipped; neither had a test that they still fire. That is the
 * gap this file closes, because this is code that fails silently — a signup
 * still works perfectly with its event and its alert quietly gone.
 *
 * The load-bearing assertion is the last one: **a broken alert must not cost a
 * shop its signup.** The alert block awaits `getDb()` as an argument, so a
 * database handle that fails to open rejects before any `.catch` can attach.
 *
 * `after()` is stubbed to run its callback rather than defer it, so the
 * deferred work is observable.
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
vi.mock("@/lib/auth", () => ({ signIn: vi.fn() }));
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
const { onboardAction } = await import("./actions");

function onboardForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("shopName", "Reef Runners");
  form.set("shopSlug", "reef-runners");
  form.set("timezone", "America/New_York");
  form.set("ownerName", "Marisol Vega");
  form.set("ownerEmail", "marisol@reefrunners.example");
  form.set("ownerPassword", "a-long-enough-password");
  form.set("source", "pricing");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

/** Run sign-up to its redirect, then drain the work it deferred with `after()`. */
async function signUp(form = onboardForm()): Promise<string> {
  let landing = "";
  try {
    await onboardAction(form);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("REDIRECT:")) throw error;
    landing = message.slice("REDIRECT:".length);
  }
  await Promise.all(hoisted.afterTasks);
  return landing;
}

beforeEach(async () => {
  hoisted.afterTasks.length = 0;
  const db = await unseededTestDb();
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(trackEvent).mockReset();
  vi.mocked(trackEvent).mockResolvedValue(undefined);
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m1" });
  // Auth.js signals a successful credentials sign-in by throwing its redirect.
  vi.mocked(signIn).mockImplementation(async (_provider, options) => {
    throw new Error(`REDIRECT:${(options as { redirectTo: string }).redirectTo}`);
  });
});

describe("onboardAction instrumentation", () => {
  it("fires trial_started exactly once, tagged with the page that sent them", async () => {
    expect(await signUp()).toBe("/shop/reef-runners");

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith({ name: "trial_started", source: "pricing" });
  });

  it("clamps an unregistered source rather than opening a bucket for it", async () => {
    await signUp(onboardForm({ source: "not-a-real-page" }));

    expect(trackEvent).toHaveBeenCalledWith({ name: "trial_started", source: "unknown" });
  });

  it("alerts the founder once, naming the owner and the new shop", async () => {
    await signUp();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [, notification] = vi.mocked(sendNotification).mock.calls[0];
    expect(notification).toMatchObject({
      kind: "new_account_alert",
      to: ALERT_EMAIL,
      ownerName: "Marisol Vega",
      ownerEmail: "marisol@reefrunners.example",
      shopName: "Reef Runners",
      shopSlug: "reef-runners",
    });
  });

  it("counts nothing when the sign-up was refused", async () => {
    // A refused attempt bounces back to the form. No shop exists, so there is
    // no trial to count and nothing to tell the founder about — the same
    // accuracy rule the demo half is held to.
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);

    expect(await signUp()).toContain("/onboard?");
    expect(trackEvent).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("counts nothing when the slug was already taken", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await signUp();
    hoisted.afterTasks.length = 0;
    vi.mocked(trackEvent).mockClear();
    vi.mocked(sendNotification).mockClear();

    expect(await signUp()).toContain("error=shop_slug_taken");
    expect(trackEvent).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("still signs the new owner in when the alert throws", async () => {
    // The contract that matters: a failed alert costs the founder an email,
    // never a shop owner their shop.
    vi.mocked(sendNotification).mockRejectedValue(new Error("SES exploded"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await signUp()).toBe("/shop/reef-runners");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("still signs the new owner in when the alert cannot even open a database", async () => {
    // The regression this shape was changed for: `getDb()` is awaited as an
    // argument to `sendNotification`, so it rejects before any `.catch` on the
    // returned promise exists. The trailing `.catch()` this used to carry
    // never saw it, and it surfaced as an unhandled rejection.
    const db = await unseededTestDb();
    vi.mocked(getDb)
      .mockResolvedValueOnce(db) // the action's own handle
      .mockRejectedValue(new Error("no database"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await signUp()).toBe("/shop/reef-runners");
    expect(sendNotification).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
