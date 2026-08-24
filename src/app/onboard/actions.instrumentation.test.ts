import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_EMAIL } from "@/lib/platform-mail";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

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
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({
    api: { signInDiveDayCredentials: vi.fn(async () => ({})) },
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

/**
 * Hydrate a database for the tests that actually reach one, and only those.
 *
 * Two reasons this is not a `beforeEach`. Each call stands up its own ~250MB
 * embedded Postgres, and under a loaded machine that allocation is the thing
 * that fails first — not with a timeout but with PGlite's own "failed to
 * initialize properly", which then surfaces as a puzzling `create_failed`
 * bounce out of `onboardAction`. And the rate-limit test never reaches a
 * database at all: it is refused before `getDb()` is called, so hydrating one
 * for it was pure cost.
 *
 * The snapshot-hydrated database rather than `unseededTestDb`: that one
 * migrates from nothing, which is slower still. Signing up beside a shop that
 * already exists is also the more honest fixture — the slug and email
 * uniqueness checks have something real to miss.
 */
async function useDb(): Promise<void> {
  vi.mocked(getDb).mockResolvedValue(await seededTestDb());
}

beforeEach(() => {
  // Off, explicitly (src/lib/configured.ts). DiveDay's origin is compiled in
  // now, so without this every case here would also issue a real
  // email-verification token and send the welcome pair — a second write and
  // two more sends per sign-up, on top of the ~250MB database each one already
  // stands up, for a file that is about the event and the alert and nothing
  // else. The owner-facing mail has its own coverage; this keeps these cases
  // the size they were written to be.
  vi.stubEnv("APP_HOST", "");
  hoisted.afterTasks.length = 0;
  vi.mocked(getDb).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(trackEvent).mockReset();
  vi.mocked(trackEvent).mockResolvedValue(undefined);
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("onboardAction instrumentation", () => {
  it("fires trial_started once and alerts the founder once, on one sign-up", async () => {
    // Both observers asserted against the same sign-up rather than one each: a
    // second sign-up costs another whole database and proves nothing the first
    // doesn't, and "exactly once" is about this run of the action either way.
    await useDb();
    expect(await signUp()).toBe("/shop/reef-runners");

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith({ name: "trial_started", source: "pricing" });

    // Filtered by kind rather than counting every send: what "once" means here
    // is one founder alert per sign-up, and that stays true whether or not the
    // owner-facing mail above it went out.
    const alerts = vi
      .mocked(sendNotification)
      .mock.calls.filter(([, notification]) => notification.kind === "new_account_alert");
    expect(alerts).toHaveLength(1);
    const [, notification] = alerts[0];
    expect(notification).toMatchObject({
      kind: "new_account_alert",
      to: ALERT_EMAIL,
      ownerName: "Marisol Vega",
      ownerEmail: "marisol@reefrunners.example",
      shopName: "Reef Runners",
      shopSlug: "reef-runners",
    });
  });

  it("clamps an unregistered source rather than opening a bucket for it", async () => {
    await useDb();
    await signUp(onboardForm({ source: "not-a-real-page" }));

    expect(trackEvent).toHaveBeenCalledWith({ name: "trial_started", source: "unknown" });
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
    await useDb();
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
    await useDb();
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
    const db = await seededTestDb();
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
